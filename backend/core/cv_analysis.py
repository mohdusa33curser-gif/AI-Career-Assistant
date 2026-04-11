"""CV text processing, skill extraction, and analyze_cv_skills."""

from __future__ import annotations

import re
import unicodedata
import math
from functools import lru_cache
from typing import Any, Iterable

import numpy as np

from models import JobRecord
from utils import clean_optional_text
from .skill_core import (
    SKILL_ALIAS_MAP,
    SKILL_FAMILY_MAP,
    SKILL_EXTRACTION_BLOCKLIST_LOWER,
    GENERIC_FAMILY_SKILLS,
    DISPLAY_HIDDEN_GENERIC_SKILLS,
    SKILL_INFERENCE_RULES,
    DEFAULT_USER_SKILL_WEIGHT,
    canonicalize_skill_name,
    normalize_skill_surface,
    prettify_skill_label,
    display_label_for_canonical,
    aliases_for_canonical_key,
    _skill_surface_forms,
)
from .dataset import collect_canonical_vocabulary
from .matching import (
    SkillGapEntry,
    ScoredJob,
    get_text_embedding,
    build_cv_profile_text,
    calculate_weighted_skill_match,
    calculate_exact_overlap_ratio,
    calculate_category_alignment_score,
    calculate_calibrated_hybrid_score,
    calculate_enhanced_hybrid_score,
    _build_user_skill_weights,
    _build_job_skill_weights,
    _split_skill_strengths,
    gap_summary_to_serializable,
    enrich_job_signals,
    infer_user_experience_level,
    calculate_demand_score,
    calculate_salary_score,
    calculate_experience_alignment_score,
    _SALARY_REFERENCE_MAX,
)


# ---------------------------------------------------------------------------
# Text cleaning
# ---------------------------------------------------------------------------

def clean_cv_text(raw: str) -> str:
    """
    Produce human-readable plain text: collapse whitespace, trim, strip control chars.

    Preserves word boundaries and typical punctuation inside sentences.
    """
    if not raw:
        return ""
    text = raw.replace("\x00", " ")
    text = re.sub(r"[\r\t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def normalize_for_skill_matching(text: str) -> str:
    """
    Return text suitable for regex skill scans (case-insensitive patterns use the original).

    Collapses whitespace so multi-word skills match reliably.
    """
    cleaned = clean_cv_text(text)
    return re.sub(r"\s+", " ", cleaned).strip()


# ---------------------------------------------------------------------------
# CV validation + confidence scoring
# ---------------------------------------------------------------------------

_CV_SECTION_KEYWORDS: frozenset[str] = frozenset({
    "experience", "education", "skills", "projects", "work history",
    "employment", "qualifications", "objective", "summary", "career",
    "internship", "certification", "achievements", "professional",
    "responsibilities", "profile", "languages", "portfolio",
})

_MIN_CV_TEXT_LENGTH = 150
_MIN_CV_SECTION_HITS = 2


def is_valid_cv(text: str) -> tuple[bool, str]:
    """
    Lightweight heuristic gate: is this text plausibly a CV?

    Returns (True, "ok") or (False, reason).
    Does NOT call the AI model — this runs before any matching.
    """
    if not text or len(text.strip()) < _MIN_CV_TEXT_LENGTH:
        return False, "Document is too short to be a CV."

    lower = text.lower()
    section_hits = sum(1 for kw in _CV_SECTION_KEYWORDS if kw in lower)
    if section_hits < _MIN_CV_SECTION_HITS:
        return False, "Document does not appear to contain standard CV sections (experience, education, skills, etc.)."

    return True, "ok"


def compute_cv_confidence(text: str, skill_weights: dict[str, int]) -> float:
    """
    Estimate how information-rich and CV-like this document is.

    Returns float in [0.0, 1.0].

    Weights:
      0.45 — skill count  (proxy for technical depth)
      0.30 — CV structure (section keyword hits)
      0.15 — text length  (proxy for detail level)
      0.10 — avg skill weight (proxy for skill depth)
    """
    score = 0.0

    # Factor 1: skill count
    skill_count = len(skill_weights)
    score += min(skill_count / 20.0, 1.0) * 0.45

    # Factor 2: structure
    lower = text.lower()
    section_hits = sum(1 for kw in _CV_SECTION_KEYWORDS if kw in lower)
    score += min(section_hits / 6.0, 1.0) * 0.30

    # Factor 3: text length
    score += min(len(text.strip()) / 1500.0, 1.0) * 0.15

    # Factor 4: average skill weight
    if skill_weights:
        avg_weight = sum(skill_weights.values()) / len(skill_weights)
        score += min(avg_weight / 3.0, 1.0) * 0.10

    return round(min(1.0, max(0.0, score)), 4)


def _apply_confidence_penalty(score: float, confidence: float) -> float:
    """
    Deflate a job's final score based on how weak/unreliable the CV is.

    confidence >= 0.70 → no penalty      (full, realistic score)
    confidence 0.45–0.70 → 22% reduction (mid-quality CV)
    confidence < 0.45    → 50% reduction (very weak / non-CV document)
    """
    if confidence >= 0.70:
        return score
    if confidence >= 0.45:
        return score * 0.78
    return score * 0.50


def normalize_cv_text_for_skill_extraction(raw: str) -> str:
    """
    Normalize PDF/CV text for vocabulary skill extraction.

    - Unicode NFKC (compatibility composition)
    - Strip zero-width / BOM characters that break token boundaries
    - Replace common separators with spaces (keeps ``+``, ``#``, ``/`` inside tech tokens)
    - Lowercase for stable case-insensitive matching without per-pattern flags
    - Collapse whitespace
    """
    if not raw:
        return ""
    text = unicodedata.normalize("NFKC", raw)
    text = text.replace("\x00", " ")
    text = re.sub(r"[\u200b-\u200f\u202f\u2060\ufeff]", "", text)
    text = re.sub(r"[\r\t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    # "CI/CD" → tokens without breaking URLs (no ://)
    text = re.sub(r"(?<=[A-Za-z0-9])/(?=[A-Za-z0-9])", " ", text)
    # Separate glued enumerations: "Python,SQL" / "Python|SQL" → spaces
    text = re.sub(r"[,;|•·](?=\S)", " ", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip().lower()


# ---------------------------------------------------------------------------
# PDF parsing
# ---------------------------------------------------------------------------

def extract_text_from_pdf_bytes(data: bytes) -> str:
    """
    Read every page and concatenate text in document order.

    Raises:
        ValueError: If the bytes are not a readable PDF or extraction fails.
    """
    if not data:
        raise ValueError("Empty file.")
    if not data.startswith(b"%PDF"):
        raise ValueError("File does not look like a PDF (missing %PDF header).")

    try:
        import fitz  # PyMuPDF
    except ImportError as exc:  # pragma: no cover
        raise ValueError("PyMuPDF is not installed.") from exc

    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise ValueError(f"Could not open PDF: {exc}") from exc

    try:
        parts: list[str] = []
        for page_index in range(doc.page_count):
            page = doc.load_page(page_index)
            try:
                # sort=True improves reading order on multi-column / complex layouts
                parts.append(page.get_text("text", sort=True) or "")
            except Exception:
                try:
                    parts.append(page.get_text("text") or "")
                except Exception:
                    parts.append("")
        return "\n".join(parts)
    finally:
        doc.close()


# ---------------------------------------------------------------------------
# Phrase pattern helpers
# ---------------------------------------------------------------------------

def _phrases_for_canonical(canonical: str) -> set[str]:
    """Search phrases (lowercased) that should map to this canonical skill key."""
    return set(aliases_for_canonical_key(canonical))


def _build_ordered_phrases(vocabulary: frozenset[str]) -> list[tuple[str, str]]:
    """(phrase, canonical) sorted longest-first for greedy overlap resolution."""
    pairs: list[tuple[str, str]] = []
    for canon in vocabulary:
        for phrase in _phrases_for_canonical(canon):
            pl = phrase.lower()
            if len(pl) < 1:
                continue
            pairs.append((pl, canon))
    pairs.sort(key=lambda x: (-len(x[0]), x[0], x[1]))
    return pairs


@lru_cache(maxsize=8192)
def _compiled_phrase_pattern(phrase_lower: str) -> re.Pattern[str]:
    """
    Word-boundary-safe pattern; supports multi-word phrases and hyphen/space runs.

    Scan text is lowercased ASCII-oriented; boundaries avoid stealing letters from neighbors.
    """
    parts = phrase_lower.split()
    if len(parts) == 1:
        core = re.escape(parts[0])
    else:
        core = r"[\s\-]+".join(re.escape(p) for p in parts)
    return re.compile(
        r"(?<![A-Za-z0-9+#])" + core + r"(?![A-Za-z0-9+#])",
    )


def _surface_exists_in_text(normalized_text: str, surface: str) -> bool:
    """
    Check if a skill surface form exists in normalized CV text.
    Uses stricter matching for short tokens.
    """
    if not normalized_text or not surface:
        return False

    padded_text = f" {normalized_text} "
    normalized_surface = normalize_skill_surface(surface)

    if not normalized_surface:
        return False

    # One-letter skills like R need strict surrounding spaces.
    if len(normalized_surface) == 1:
        return f" {normalized_surface} " in padded_text

    # Technical tokens with punctuation are safer with padded phrase matching.
    if any(ch in normalized_surface for ch in ".+#/"):
        return f" {normalized_surface} " in padded_text

    # Multi-word phrase
    if " " in normalized_surface:
        return f" {normalized_surface} " in padded_text

    # One plain token
    return re.search(rf"\b{re.escape(normalized_surface)}\b", normalized_text) is not None


def _contains_normalized_phrase(normalized_text: str, phrase: str) -> bool:
    normalized_phrase = normalize_cv_text_for_skill_extraction(phrase)
    if not normalized_phrase:
        return False
    return f" {normalized_phrase} " in f" {normalized_text} "


# ---------------------------------------------------------------------------
# Skill weight helpers
# ---------------------------------------------------------------------------

def _apply_skill_weight(target: dict[str, int], skill: str, weight: int) -> None:
    if not skill:
        return
    current = target.get(skill, 0)
    if int(weight) > current:
        target[skill] = int(weight)


def _infer_family_skills_from_detected(detected_skills: dict[str, int]) -> dict[str, int]:
    inferred: dict[str, int] = {}

    for skill, weight in detected_skills.items():
        family_skills = SKILL_FAMILY_MAP.get(skill, set())
        for family_skill in family_skills:
            inferred_weight = max(1, int(weight) - 1)
            _apply_skill_weight(inferred, family_skill, inferred_weight)

    return inferred


def _infer_context_skills_from_text(
    normalized_text: str,
    detected_skills: dict[str, int],
) -> dict[str, int]:
    inferred: dict[str, int] = {}

    for target_skill, phrases in SKILL_INFERENCE_RULES.items():
        hit_count = 0

        for phrase in phrases:
            if _contains_normalized_phrase(normalized_text, phrase):
                hit_count += 1

        if hit_count == 0:
            continue

        inferred_weight = 2 if hit_count >= 2 else 1
        _apply_skill_weight(inferred, target_skill, inferred_weight)

        # family expansion للمهارات المستنتجة أيضًا
        for family_skill in SKILL_FAMILY_MAP.get(target_skill, set()):
            _apply_skill_weight(inferred, family_skill, max(1, inferred_weight - 1))

    # promotion rule:
    # إذا كان عندنا recommendation systems أو personalization أو ranking model
    # فهذا يرفع machine learning و data science أكثر
    recommendation_like_phrases = (
        "recommendation system",
        "recommendation engine",
        "personalization",
        "ranking model",
    )

    recommendation_hits = sum(
        1 for phrase in recommendation_like_phrases
        if _contains_normalized_phrase(normalized_text, phrase)
    )
    if recommendation_hits > 0:
        _apply_skill_weight(inferred, "machine learning", 2)
        _apply_skill_weight(inferred, "data science", 1)

    # إذا كان النص فيه ec2/s3/lambda/redshift بقوة، نرفع aws
    aws_like_hits = sum(
        1 for phrase in ("ec2", "s3", "lambda", "redshift", "cloudwatch", "iam")
        if _contains_normalized_phrase(normalized_text, phrase)
    )
    if aws_like_hits >= 2:
        _apply_skill_weight(inferred, "aws", 2)

    return inferred


def _merge_detected_skill_maps(*skill_maps: dict[str, int]) -> dict[str, int]:
    merged: dict[str, int] = {}

    for skill_map in skill_maps:
        for skill, weight in skill_map.items():
            _apply_skill_weight(merged, skill, int(weight))

    return merged


def _dampen_generic_skill_weights(skill_weights: dict[str, int]) -> dict[str, int]:
    adjusted: dict[str, int] = {}

    for skill, weight in skill_weights.items():
        canonical = canonicalize_skill_name(skill)
        if not canonical:
            continue

        if canonical in GENERIC_FAMILY_SKILLS:
            adjusted[canonical] = min(int(weight), 1)
        else:
            adjusted[canonical] = int(weight)

    return adjusted


def prepare_display_extracted_skills(
    extracted_skill_weights: dict[str, int],
    limit: int = 24,
) -> list[str]:
    visible: list[tuple[str, int]] = []

    for skill, weight in extracted_skill_weights.items():
        canonical = canonicalize_skill_name(skill)
        if not canonical:
            continue
        if canonical in DISPLAY_HIDDEN_GENERIC_SKILLS:
            continue
        if int(weight) <= 0:
            continue
        visible.append((canonical, int(weight)))

    visible.sort(key=lambda item: (-item[1], item[0]))
    return [display_label_for_canonical(skill) for skill, _ in visible[:limit]]


# ---------------------------------------------------------------------------
# Skill extraction
# ---------------------------------------------------------------------------

def extract_skills_from_cv_text(text: str, jobs: list[JobRecord]) -> dict[str, int]:
    if not text or not jobs:
        return {}

    normalized_text = normalize_cv_text_for_skill_extraction(text)
    vocabulary = collect_canonical_vocabulary(jobs)

    direct_detected: dict[str, int] = {}

    # 1) direct extraction from known vocabulary
    for skill in vocabulary:
        if skill in SKILL_EXTRACTION_BLOCKLIST_LOWER:
            continue

        surfaces = _skill_surface_forms(skill)
        for surface in surfaces:
            if _surface_exists_in_text(normalized_text, surface):
                _apply_skill_weight(direct_detected, skill, DEFAULT_USER_SKILL_WEIGHT)
                break

    # 2) contextual inference
    context_inferred = _infer_context_skills_from_text(
        normalized_text,
        direct_detected,
    )

    # 3) family inference
    family_inferred = _infer_family_skills_from_detected(
        _merge_detected_skill_maps(direct_detected, context_inferred)
    )

    # 4) merge all
    merged_detected = _merge_detected_skill_maps(
        direct_detected,
        context_inferred,
        family_inferred,
    )

    # 5) reduce generic skill inflation
    merged_detected = _dampen_generic_skill_weights(merged_detected)

    # 6) final cleanup and stable ordering
    cleaned_detected: dict[str, int] = {}
    for skill, weight in merged_detected.items():
        canonical = canonicalize_skill_name(skill)
        if not canonical:
            continue
        if canonical in SKILL_EXTRACTION_BLOCKLIST_LOWER:
            continue
        cleaned_detected[canonical] = max(cleaned_detected.get(canonical, 0), int(weight))

    return dict(
        sorted(
            cleaned_detected.items(),
            key=lambda item: (-item[1], item[0]),
        )
    )

def vocabulary_sample_for_debug(vocabulary: frozenset[str], limit: int = 80) -> list[str]:
    """Sorted slice of canonical skills for debug endpoints."""
    return sorted(vocabulary)[:limit]


# ---------------------------------------------------------------------------
# Analyze service helpers
# ---------------------------------------------------------------------------

def skill_labels_to_weight_map(skill_labels: list[str], default_weight: int = 2) -> dict[str, int]:
    """
Convert incoming user/CV skill labels into canonical weighted skills.

    Why:
    - user input may be: cpp, ML, ReactJS, nodejs
    - backend matching must compare canonical forms only
    """
    canonical_weights: dict[str, int] = {}

    if not skill_labels:
        return canonical_weights

    for raw_label in skill_labels:
        canonical = canonicalize_skill_name(raw_label)
        if not canonical:
            continue

        current_weight = canonical_weights.get(canonical, 0)
        canonical_weights[canonical] = max(current_weight, default_weight)

    return canonical_weights


def _aggregate_gaps(top_jobs: list[ScoredJob]) -> list[dict[str, Any]]:
    """
    Merge missing/partial gaps across top roles for a compact API surface.

    If a skill is **missing** in any top match, the aggregate status is missing.
    Otherwise it is partial. ``job_weight`` is the maximum requirement weight seen;
    ``user_weight`` is the minimum observed user weight among partial rows (0 if missing).
    """
    by_skill: dict[str, dict[str, Any]] = {}

    def feed(entries: list[SkillGapEntry], status: str) -> None:
        for entry in entries:
            skill = entry["skill"]
            jw = entry["job_weight"]
            uw = entry["user_weight"]
            row = by_skill.get(skill)
            if row is None:
                by_skill[skill] = {
                    "skill": skill,
                    "status": status,
                    "job_weight": jw,
                    "user_weight": uw if status == "partial" else 0,
                }
                continue
            if status == "missing":
                row["status"] = "missing"
                row["job_weight"] = max(int(row["job_weight"]), jw)
                row["user_weight"] = 0
            else:
                if row["status"] == "missing":
                    row["job_weight"] = max(int(row["job_weight"]), jw)
                else:
                    row["job_weight"] = max(int(row["job_weight"]), jw)
                    row["user_weight"] = min(int(row["user_weight"]), uw)

    for sj in top_jobs:
        feed(sj.gap["missing"], "missing")
    for sj in top_jobs:
        feed(sj.gap["partial"], "partial")

    rank = {"missing": 2, "partial": 1}
    ordered = sorted(
        by_skill.values(),
        key=lambda x: (-rank[str(x["status"])], -int(x["job_weight"]), str(x["skill"])),
    )
    return ordered


def _top_job_payload(sj: ScoredJob) -> dict[str, Any]:
    return {
        "job_title": sj.job.job_title,
        "category": sj.job.category,
        "match_percent": sj.match_percent,
        "parsed_skills": dict(sj.job.parsed_skills),
        "gap_analysis": gap_summary_to_serializable(sj.gap),
        "source_row_index": sj.job.source_row_index,
        "final_skill_count": sj.job.final_skill_count,
    }


# ---------------------------------------------------------------------------
# Career insight helpers
# ---------------------------------------------------------------------------

def _readiness_band(score: float) -> str:
    if score >= 80:
        return "High Readiness"
    if score >= 65:
        return "Strong Foundation"
    if score >= 50:
        return "Developing Fit"
    return "Emerging Fit"


def _build_career_path(top_jobs: list[dict[str, Any]]) -> dict[str, Any]:
    if not top_jobs:
        return {
            "primary_path": "Unknown",
            "secondary_path": None,
            "confidence_percent": 0.0,
            "summary": "No clear career direction could be inferred yet.",
        }

    category_scores: dict[str, float] = {}

    for index, job in enumerate(top_jobs[:5]):
        category = str(job.get("category", "Unknown")).strip() or "Unknown"
        weighted_score = float(job.get("match_percent", 0.0)) * max(0.4, 1.0 - (index * 0.15))
        category_scores[category] = category_scores.get(category, 0.0) + weighted_score

    ranked_categories = sorted(
        category_scores.items(),
        key=lambda item: (-item[1], item[0]),
    )

    primary_path, primary_score = ranked_categories[0]
    secondary_path = ranked_categories[1][0] if len(ranked_categories) > 1 else None

    total_score = sum(score for _, score in ranked_categories) or 1.0
    confidence_percent = round((primary_score / total_score) * 100.0, 2)

    if secondary_path and confidence_percent < 75:
        summary = (
            f"Your profile is currently strongest for {primary_path} roles, "
            f"with a meaningful secondary pull toward {secondary_path}."
        )
    else:
        summary = f"Your profile is currently strongest for {primary_path} roles."

    return {
        "primary_path": primary_path,
        "secondary_path": secondary_path,
        "confidence_percent": confidence_percent,
        "summary": summary,
    }


def _build_next_role(
    top_jobs: list[dict[str, Any]],
    career_path: dict[str, Any],
) -> dict[str, Any]:
    if not top_jobs:
        return {
            "current_best_fit": "Unknown",
            "stretch_role": None,
            "summary": "No next-role insight is available yet.",
        }

    current_best_fit = str(top_jobs[0].get("job_title", "Unknown Role")).strip() or "Unknown Role"
    primary_path = str(career_path.get("primary_path", "")).strip()
    stretch_role: str | None = None

    for job in top_jobs[1:]:
        title = str(job.get("job_title", "")).strip()
        category = str(job.get("category", "")).strip()
        if not title or title == current_best_fit:
            continue
        if primary_path and category == primary_path:
            stretch_role = title
            break

    if stretch_role is None:
        for job in top_jobs[1:]:
            title = str(job.get("job_title", "")).strip()
            if title and title != current_best_fit:
                stretch_role = title
                break

    if stretch_role:
        summary = (
            f"Your best immediate fit is {current_best_fit}. "
            f"A strong next-step target is {stretch_role}."
        )
    else:
        summary = f"Your best current fit is {current_best_fit}."

    return {
        "current_best_fit": current_best_fit,
        "stretch_role": stretch_role,
        "summary": summary,
    }


def _gap_priority_label(status: str, job_weight: int) -> str:
    if status == "missing" and job_weight >= 3:
        return "High"
    if job_weight >= 2:
        return "Medium"
    return "Low"


def _gap_impact_label(status: str, job_weight: int) -> str:
    if status == "missing" and job_weight >= 3:
        return "High role impact"
    if status == "missing":
        return "Moderate role impact"
    return "Fast improvement opportunity"


def _build_learning_roadmap(gaps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    roadmap: list[dict[str, Any]] = []

    for gap in gaps[:5]:
        raw_skill = str(gap.get("skill", "")).strip()
        canonical = canonicalize_skill_name(raw_skill) or raw_skill.lower()
        display_skill = display_label_for_canonical(canonical) if canonical else raw_skill

        status = str(gap.get("status", "missing")).strip().lower()
        job_weight = int(gap.get("job_weight", 0))

        if status == "missing":
            reason = (
                f"{display_skill} appears as a recurring missing requirement "
                "across your top-matching roles."
            )
        else:
            reason = (
                f"{display_skill} is already partially present in your profile "
                "and could quickly increase your role fit."
            )

        roadmap.append(
            {
                "skill": display_skill,
                "priority": _gap_priority_label(status, job_weight),
                "reason": reason,
                "estimated_impact": _gap_impact_label(status, job_weight),
            }
        )

    return roadmap


def _build_why_this_role(job: dict[str, Any]) -> list[str]:
    reasons: list[str] = []

    strong_skills = job.get("strong_skills", []) or []
    partial_skills = job.get("partial_skills", []) or []
    score_breakdown = job.get("score_breakdown", {}) or {}
    category = str(job.get("category", "")).strip()

    demand_score = float(score_breakdown.get("demand_score", 0.5))
    experience_alignment = float(score_breakdown.get("experience_alignment_score", 0.7))
    salary_score = float(score_breakdown.get("salary_score", 0.5))
    semantic_pct = float(score_breakdown.get("semantic_match_percent", 0.0))

    # --- Skill alignment (highest signal) ---
    if strong_skills:
        strong_display = ", ".join(
            display_label_for_canonical(skill)
            for skill in strong_skills[:3]
        )
        reasons.append(f"Strong skill alignment in {strong_display}.")

    # --- Demand signal ---
    if demand_score >= 0.85:
        reasons.append("High market demand increases this role's ranking.")
    elif demand_score >= 0.65:
        reasons.append("Solid market demand contributes positively to this role's ranking.")

    # --- Experience alignment ---
    if experience_alignment >= 0.9:
        reasons.append("Experience level closely matches your profile.")
    elif experience_alignment >= 0.75:
        reasons.append("Experience level is a reasonable match for your profile.")
    elif experience_alignment < 0.5:
        reasons.append("Experience gap exists — consider this a stretch target role.")

    # --- Salary signal (low-weight boost, only if notable) ---
    if salary_score >= 0.7 and len(reasons) < 3:
        reasons.append("Salary competitiveness slightly boosts this role.")

    # --- Semantic fallback ---
    if semantic_pct >= 70.0 and len(reasons) < 3:
        reasons.append("Your background language is semantically close to this role.")

    # --- Category direction fallback ---
    if category and len(reasons) < 3:
        reasons.append(f"Role aligns with your {category} career direction.")

    # --- Partial skills fallback ---
    if len(reasons) < 3 and partial_skills:
        partial_display = ", ".join(
            display_label_for_canonical(skill)
            for skill in partial_skills[:2]
        )
        reasons.append(f"Partial overlap in {partial_display} — skills to build on.")

    return reasons[:3]


def _build_insight_summary(
    top_jobs: list[dict[str, Any]],
    career_score: float,
    career_path: dict[str, Any],
    gaps: list[dict[str, Any]],
) -> dict[str, Any]:
    if not top_jobs:
        return {
            "readiness_band": _readiness_band(career_score),
            "strongest_category": "Unknown",
            "best_match_title": "Unknown",
            "best_match_percent": 0.0,
            "main_gap": None,
        }

    best_job = top_jobs[0]
    main_gap: str | None = None

    if gaps:
        raw_skill = str(gaps[0].get("skill", "")).strip()
        canonical = canonicalize_skill_name(raw_skill) or raw_skill.lower()
        if canonical:
            main_gap = display_label_for_canonical(canonical)

    return {
        "readiness_band": _readiness_band(career_score),
        "strongest_category": str(career_path.get("primary_path", "Unknown")),
        "best_match_title": str(best_job.get("job_title", "Unknown Role")),
        "best_match_percent": round(float(best_job.get("match_percent", 0.0)), 2),
        "main_gap": main_gap,
    }


def _build_recommendations_from_top_jobs(
    top_jobs: list[dict[str, Any]],
    gaps: list[dict[str, Any]],
    career_path: dict[str, Any],
    next_role: dict[str, Any],
) -> list[dict[str, Any]]:
    if not top_jobs:
        return [
            {
                "title": "Add More Technical Skills",
                "description": "Add more technical skills to your CV.",
                "priority": 1.0,
            },
            {
                "title": "Clarify Project Impact",
                "description": "Include clearer project descriptions with measurable outcomes.",
                "priority": 2.0,
            },
            {
                "title": "Use Stronger Keywords",
                "description": "Use explicit role-related keywords that match target jobs.",
                "priority": 3.0,
            },
        ]

    roadmap = _build_learning_roadmap(gaps)
    recommendations: list[dict[str, Any]] = []

    recommendations.append(
        {
            "title": "Primary Career Direction",
            "description": str(career_path.get("summary", "")),
            "priority": 1.0,
        }
    )

    stretch_role = next_role.get("stretch_role")
    if stretch_role:
        recommendations.append(
            {
                "title": "Next Role Target",
                "description": f"After strengthening your current gaps, aim toward {stretch_role}.",
                "priority": 2.0,
            }
        )

    priority_value = 3.0
    for step in roadmap[:2]:
        recommendations.append(
            {
                "title": f"Learn {step['skill']}",
                "description": str(step["reason"]),
                "priority": priority_value,
            }
        )
        priority_value += 1.0

    recommendations.append(
        {
            "title": "Improve CV Positioning",
            "description": "Highlight project impact, system scale, tools, and measurable outcomes more explicitly.",
            "priority": priority_value,
        }
    )

    return recommendations[:5]


def _calculate_career_score_from_top_jobs(top_jobs: list[dict[str, Any]]) -> float:
    if not top_jobs:
        return 0.0

    top_scores = [float(job.get("match_percent", 0.0)) for job in top_jobs[:5]]
    if not top_scores:
        return 0.0

    return round(sum(top_scores) / len(top_scores), 2)


def _build_gap_analysis_payload(
    strong_skills: list[str],
    partial_skills: list[str],
    missing_skills: list[str],
    user_skill_weights: dict[str, float],
    job_skill_weights: dict[str, float],
) -> dict[str, list[dict[str, Any]]]:
    return {
        "strong": [
            {
                "skill": skill,
                "job_weight": int(job_skill_weights.get(skill, 0)),
                "user_weight": int(user_skill_weights.get(skill, 0)),
            }
            for skill in strong_skills
        ],
        "partial": [
            {
                "skill": skill,
                "job_weight": int(job_skill_weights.get(skill, 0)),
                "user_weight": int(user_skill_weights.get(skill, 0)),
            }
            for skill in partial_skills
        ],
        "missing": [
            {
                "skill": skill,
                "job_weight": int(job_skill_weights.get(skill, 0)),
                "user_weight": 0,
            }
            for skill in missing_skills
        ],
    }


def _aggregate_priority_gaps(top_jobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    gap_map: dict[str, dict[str, Any]] = {}

    for job in top_jobs[:5]:
        gap_analysis = job.get("gap_analysis", {})

        for entry in gap_analysis.get("missing", []):
            skill = canonicalize_skill_name(str(entry.get("skill", "")))
            if not skill:
                continue

            row = gap_map.get(skill)
            job_weight = int(entry.get("job_weight", 0))

            if row is None:
                gap_map[skill] = {
                    "skill": skill,
                    "status": "missing",
                    "job_weight": job_weight,
                    "user_weight": 0,
                }
            else:
                row["status"] = "missing"
                row["job_weight"] = max(int(row["job_weight"]), job_weight)
                row["user_weight"] = 0

        for entry in gap_analysis.get("partial", []):
            skill = canonicalize_skill_name(str(entry.get("skill", "")))
            if not skill:
                continue

            job_weight = int(entry.get("job_weight", 0))
            user_weight = int(entry.get("user_weight", 0))
            row = gap_map.get(skill)

            if row is None:
                gap_map[skill] = {
                    "skill": skill,
                    "status": "partial",
                    "job_weight": job_weight,
                    "user_weight": user_weight,
                }
            elif row["status"] != "missing":
                row["job_weight"] = max(int(row["job_weight"]), job_weight)
                row["user_weight"] = min(int(row["user_weight"]), user_weight)

    return sorted(
        gap_map.values(),
        key=lambda x: (
            0 if x["status"] == "missing" else 1,
            -int(x["job_weight"]),
            str(x["skill"]),
        ),
    )


# ---------------------------------------------------------------------------
# Main analysis entry point
# ---------------------------------------------------------------------------

def _compute_sort_key(job: dict[str, Any], sort_by: str) -> float:
    """
    Compute a composite sort key for a job dict given the requested sort mode.

    sort_by modes:
      "match"      — pure hybrid score (default)
      "demand"     — demand-boosted: demand * 0.65 + match * 0.35
      "salary"     — salary-boosted: salary * 0.65 + match * 0.35
      "experience" — experience-boosted: experience_alignment * 0.65 + match * 0.35
    """
    match = float(job.get("match_percent", 0)) / 100.0
    demand = float(job.get("demand_score", 0.5))
    salary = float(job.get("salary_score", 0.5))
    exp = float(job.get("experience_alignment_score", 0.5))

    if sort_by == "demand":
        return demand * 0.65 + match * 0.35
    if sort_by == "salary":
        return salary * 0.65 + match * 0.35
    if sort_by == "experience":
        return exp * 0.65 + match * 0.35
    return match  # "match" — default


def analyze_cv_skills(
    user_skills: dict[str, Any],
    jobs: list[Any],
    top_k: int = 10,
    cv_text: str | None = None,
    job_embedding_lookup: dict[int, np.ndarray] | None = None,
    sort_by: str = "match",
    confidence_score: float = 1.0,
) -> dict[str, Any]:
    base_user_skill_weights = _build_user_skill_weights(user_skills)

    # dampen generic skills one last time before ranking
    user_skill_weights = {
        skill: float(weight)
        for skill, weight in _dampen_generic_skill_weights(
            {key: int(value) for key, value in base_user_skill_weights.items()}
        ).items()
    }

    # Phase-1: infer user seniority for experience alignment scoring
    user_experience_level = infer_user_experience_level(user_skill_weights)

    # Phase-1: compute salary pool ceiling for normalization
    salary_pool_max = _SALARY_REFERENCE_MAX
    if jobs:
        pool_midpoints = [
            enrich_job_signals(j).salary_midpoint
            for j in jobs
        ]
        valid_midpoints = [m for m in pool_midpoints if m is not None and m > 0]
        if valid_midpoints:
            salary_pool_max = max(max(valid_midpoints), _SALARY_REFERENCE_MAX)

    ranked_jobs: list[dict[str, Any]] = []
    semantic_score_by_row: dict[int, float] = {}

    if cv_text and job_embedding_lookup:
        cv_profile_text = build_cv_profile_text(cv_text, user_skill_weights)
        cv_embedding = get_text_embedding(cv_profile_text)

        if cv_embedding.size > 0:
            row_ids = list(job_embedding_lookup.keys())
            matrix = np.vstack(
                [np.asarray(job_embedding_lookup[row_id], dtype=np.float32) for row_id in row_ids]
            )

            similarities = np.clip(matrix @ cv_embedding, -1.0, 1.0)
            similarities = np.clip((similarities + 1.0) / 2.0, 0.0, 1.0)

            semantic_score_by_row = {
                row_id: float(score)
                for row_id, score in zip(row_ids, similarities)
            }

    for job in jobs:
        job_skill_weights = _build_job_skill_weights(job)

        semantic_score = semantic_score_by_row.get(job.source_row_index, 0.0)
        weighted_skill_score = calculate_weighted_skill_match(
            user_skill_weights,
            job_skill_weights,
        )
        exact_overlap_score = calculate_exact_overlap_ratio(
            user_skill_weights,
            job_skill_weights,
        )
        category_alignment_score = calculate_category_alignment_score(
            user_skill_weights,
            getattr(job, "category", ""),
        )

        # Phase-1: new signal scores
        job_signals = enrich_job_signals(job)
        demand_score = calculate_demand_score(job_signals)
        exp_alignment_score = calculate_experience_alignment_score(
            user_experience_level, job_signals
        )
        sal_score = calculate_salary_score(job_signals, salary_pool_max)

        final_score = calculate_enhanced_hybrid_score(
            semantic_score,
            weighted_skill_score,
            exact_overlap_score,
            category_alignment_score,
            demand_score=demand_score,
            experience_alignment_score=exp_alignment_score,
            salary_score=sal_score,
        )
        final_score = _apply_confidence_penalty(final_score, confidence_score)

        strong_skills, partial_skills, missing_skills = _split_skill_strengths(
            user_skill_weights,
            job_skill_weights,
        )

        gap_analysis = _build_gap_analysis_payload(
            strong_skills,
            partial_skills,
            missing_skills,
            user_skill_weights,
            job_skill_weights,
        )

        score_breakdown = {
            "semantic_match_percent": round(semantic_score * 100.0, 2),
            "weighted_skill_percent": round(weighted_skill_score * 100.0, 2),
            "exact_overlap_percent": round(exact_overlap_score * 100.0, 2),
            "category_alignment_percent": round(category_alignment_score * 100.0, 2),
            # Phase-2 multi-factor signals – raw [0,1] for _build_why_this_role
            # and percent-scaled for display/debugging
            "demand_score": round(demand_score, 4),
            "demand_score_percent": round(demand_score * 100.0, 2),
            "experience_alignment_score": round(exp_alignment_score, 4),
            "experience_alignment_percent": round(exp_alignment_score * 100.0, 2),
            "salary_score": round(sal_score, 4),
            "salary_score_percent": round(sal_score * 100.0, 2),
        }

        ranked_jobs.append(
            {
                "job_title": getattr(job, "job_title", "Unknown Role"),
                "category": getattr(job, "category", "Unknown"),
                "match_percent": round(final_score * 100.0, 2),

                "parsed_skills": getattr(job, "parsed_skills", {}),
                "gap_analysis": gap_analysis,
                "source_row_index": getattr(job, "source_row_index", 0),
                "final_skill_count": getattr(job, "final_skill_count", None),

                "strong_skills": strong_skills[:10],
                "partial_skills": partial_skills[:10],
                "missing_skills": missing_skills[:10],

                "score_breakdown": score_breakdown,

                # Phase-1: exposed ranking signals
                "demand_score": round(demand_score, 4),
                "experience_alignment_score": round(exp_alignment_score, 4),
                "salary_score": round(sal_score, 4),
                # DB structured text labels (None when not available)
                "experience_level": job_signals.experience_level_label,
                "demand_level": job_signals.demand_level_label,
                "salary_level": job_signals.salary_level_label,
            }
        )

    ranked_jobs.sort(
        key=lambda item: (
            -_compute_sort_key(item, sort_by),
            -float(item["score_breakdown"]["semantic_match_percent"]),
            -float(item["score_breakdown"]["weighted_skill_percent"]),
            str(item["job_title"]),
        )
    )

    top_jobs = ranked_jobs[:top_k]
    gaps = _aggregate_priority_gaps(top_jobs)
    career_score = _calculate_career_score_from_top_jobs(top_jobs)

    for job in top_jobs:
        job["why_this_role"] = _build_why_this_role(job)

    career_path = _build_career_path(top_jobs)
    next_role = _build_next_role(top_jobs, career_path)
    learning_roadmap = _build_learning_roadmap(gaps)
    insight_summary = _build_insight_summary(
        top_jobs,
        career_score,
        career_path,
        gaps,
    )
    recommendations = _build_recommendations_from_top_jobs(
        top_jobs,
        gaps,
        career_path,
        next_role,
    )

    return {
        "skills": user_skill_weights,
        "gaps": gaps,
        "top_jobs": top_jobs,
        "recommendations": recommendations,
        "career_score": career_score,
        "career_path": career_path,
        "next_role": next_role,
        "learning_roadmap": learning_roadmap,
        "insight_summary": insight_summary,
    }


__all__ = [
    # text cleaning
    "clean_cv_text",
    "normalize_for_skill_matching",
    "normalize_cv_text_for_skill_extraction",
    # pdf parsing
    "extract_text_from_pdf_bytes",
    # phrase pattern helpers
    "_phrases_for_canonical",
    "_build_ordered_phrases",
    "_compiled_phrase_pattern",
    # surface matching
    "_surface_exists_in_text",
    "_contains_normalized_phrase",
    # skill weight helpers
    "_apply_skill_weight",
    "_infer_family_skills_from_detected",
    "_infer_context_skills_from_text",
    "_merge_detected_skill_maps",
    "_dampen_generic_skill_weights",
    "prepare_display_extracted_skills",
    # skill extraction
    "extract_skills_from_cv_text",
    "vocabulary_sample_for_debug",
    # analyze service
    "skill_labels_to_weight_map",
    "_aggregate_gaps",
    "_top_job_payload",
    # career insight helpers
    "_readiness_band",
    "_build_career_path",
    "_build_next_role",
    "_gap_priority_label",
    "_gap_impact_label",
    "_build_learning_roadmap",
    "_build_why_this_role",
    "_build_insight_summary",
    "_build_recommendations_from_top_jobs",
    "_calculate_career_score_from_top_jobs",
    "_build_gap_analysis_payload",
    "_aggregate_priority_gaps",
    # main analysis
    "analyze_cv_skills",
    # phase-1 re-exports (used indirectly via cv_analysis)
    "enrich_job_signals",
    "infer_user_experience_level",
    "calculate_demand_score",
    "calculate_salary_score",
    "calculate_experience_alignment_score",
    "calculate_enhanced_hybrid_score",
]
