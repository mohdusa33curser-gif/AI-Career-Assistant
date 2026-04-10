"""Scoring algorithms, semantic matching, and gap analysis."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Final, TypedDict

import numpy as np
from sentence_transformers import SentenceTransformer

from models import JobRecord
from .skill_core import (
    SKILL_FAMILY_MAP,
    CATEGORY_SIGNATURE_SKILLS,
    canonicalize_skill,
    canonicalize_skill_name,
    normalize_skill_name,
    prettify_skill_label,
    display_label_for_canonical,
    normalize_skill_surface,
    _priority_weight_to_label,
)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SEMANTIC_MODEL_NAME: Final[str] = "all-MiniLM-L6-v2"
SEMANTIC_TEXT_MAX_CHARS: Final[int] = 4000
HYBRID_SCORE_WEIGHTS: Final[dict[str, float]] = {
    "semantic": 0.50,
    "weighted_skill": 0.30,
    "exact_overlap": 0.20,
}

SEMANTIC_WEIGHT = 0.50
WEIGHTED_SKILL_WEIGHT = 0.30
EXACT_OVERLAP_WEIGHT = 0.20

# ---------------------------------------------------------------------------
# Job signal enrichment – Phase 1 Ranking Engine
# ---------------------------------------------------------------------------

_JOB_TREND_NUMERIC: Final[dict[str, float]] = {
    "high": 1.0,
    "growing": 1.0,
    "medium": 0.7,
    "moderate": 0.7,
    "stable": 0.7,
    "low": 0.4,
    "declining": 0.3,
}

_EXPERIENCE_LEVEL_NUMERIC: Final[dict[str, float]] = {
    "junior": 0.4,
    "entry": 0.4,
    "entry-level": 0.4,
    "entry level": 0.4,
    "mid": 0.7,
    "mid-level": 0.7,
    "mid level": 0.7,
    "intermediate": 0.7,
    "senior": 1.0,
    "lead": 1.0,
    "principal": 1.0,
    "staff": 1.0,
    "expert": 1.0,
}

_SALARY_REFERENCE_MAX: Final[float] = 200_000.0


def _parse_salary_midpoint(salary_range: str | None) -> float | None:
    """Extract numeric salary midpoint from a range string like '80000 - 120000' or '$80k-$120k'."""
    if not salary_range:
        return None
    text = salary_range.strip().lower()
    text = re.sub(r"[$£€,]", "", text)
    text = re.sub(r"(\d+)\s*k\b", lambda m: str(int(m.group(1)) * 1000), text)
    numbers = re.findall(r"\d+(?:\.\d+)?", text)
    if not numbers:
        return None
    values = [float(n) for n in numbers if float(n) >= 10_000]
    if not values:
        return None
    if len(values) >= 2:
        return (values[0] + values[1]) / 2.0
    return values[0]


def _normalize_job_trend(job_trend: str | None) -> float:
    """Map job trend text to a numeric score in [0.0, 1.0]. Neutral default = 0.5."""
    if not job_trend:
        return 0.5
    key = job_trend.strip().lower()
    return _JOB_TREND_NUMERIC.get(key, 0.5)


def _normalize_experience_level(experience: str | None) -> float:
    """Convert experience text to level score: junior=0.4, mid=0.7, senior=1.0."""
    if not experience:
        return 0.7
    text = experience.strip().lower()
    for key, score in _EXPERIENCE_LEVEL_NUMERIC.items():
        if key in text:
            return score
    year_match = re.search(r"(\d+)\s*\+?\s*(?:years?|yrs?)", text)
    if year_match:
        years = int(year_match.group(1))
        if years <= 2:
            return 0.4
        if years <= 5:
            return 0.7
        return 1.0
    return 0.7


_LEVEL_RANK: Final[dict[str, int]] = {"junior": 0, "mid": 1, "senior": 2}


def normalize_experience_level(value: str | None) -> str | None:
    """Normalize raw DB experience_level to 'Junior' | 'Mid' | 'Senior' | None."""
    if not value:
        return None
    key = value.strip().lower()
    if key in ("junior", "entry", "entry-level", "entry level"):
        return "Junior"
    if key in ("mid", "mid-level", "mid level", "intermediate"):
        return "Mid"
    if key in ("senior", "lead", "principal", "staff", "expert"):
        return "Senior"
    return None


def normalize_demand_level(value: str | None) -> str | None:
    """Normalize raw DB demand_level to 'High' | 'Medium' | 'Low' | None."""
    if not value:
        return None
    key = value.strip().lower()
    if key in ("high", "growing"):
        return "High"
    if key in ("medium", "moderate", "stable"):
        return "Medium"
    if key in ("low", "declining"):
        return "Low"
    return None


def normalize_salary_level(value: str | None) -> str | None:
    """Normalize raw DB salary_level to 'High' | 'Medium' | 'Low' | None."""
    if not value:
        return None
    key = value.strip().lower()
    if key == "high":
        return "High"
    if key in ("medium", "moderate"):
        return "Medium"
    if key == "low":
        return "Low"
    return None


def map_demand_to_score(level: str | None) -> float:
    """Map normalized demand level to [0,1] score."""
    return {"High": 1.0, "Medium": 0.65, "Low": 0.35}.get(level or "", 0.5)


def map_salary_to_score(level: str | None) -> float:
    """Map normalized salary level to [0,1] score."""
    return {"High": 1.0, "Medium": 0.65, "Low": 0.35}.get(level or "", 0.5)


def map_experience_to_score(level: str | None) -> float:
    """Map normalized experience level to [0,1] score."""
    return {"Junior": 0.35, "Mid": 0.65, "Senior": 1.0}.get(level or "", 0.7)


@dataclass(frozen=True)
class JobSignals:
    """Extracted numeric signals from a job record for multi-factor ranking."""
    demand_score: float = 0.5
    salary_midpoint: float | None = None
    experience_level: float = 0.7
    # Normalized text labels from DB columns (None when not available)
    experience_level_label: str | None = None
    demand_level_label: str | None = None
    salary_level_label: str | None = None
    # Direct salary score from DB level (overrides midpoint math when set)
    salary_score_direct: float | None = None


def enrich_job_signals(job_record: Any) -> JobSignals:
    """
    Extract and normalize demand, salary, and experience signals from a job record.

    Prefers structured DB columns (db_demand_level, db_experience_level,
    db_salary_level) over legacy text fields. Falls back to neutral defaults.
    """
    # --- DB-structured signals (preferred) ---
    raw_exp = getattr(job_record, "db_experience_level", None)
    raw_demand = getattr(job_record, "db_demand_level", None)
    raw_salary_lvl = getattr(job_record, "db_salary_level", None)

    exp_label = normalize_experience_level(raw_exp)
    demand_label = normalize_demand_level(raw_demand)
    salary_label = normalize_salary_level(raw_salary_lvl)

    if exp_label is not None:
        exp_score = map_experience_to_score(exp_label)
    else:
        # fallback: legacy text field
        experience = getattr(job_record, "experience", None) or ""
        exp_score = _normalize_experience_level(experience)

    if demand_label is not None:
        demand_score = map_demand_to_score(demand_label)
    else:
        job_trend = getattr(job_record, "job_trend", None) or ""
        demand_score = _normalize_job_trend(job_trend)

    salary_score_direct: float | None = None
    if salary_label is not None:
        salary_score_direct = map_salary_to_score(salary_label)
        salary_midpoint = None
    else:
        salary_range = getattr(job_record, "salary_range", None) or ""
        salary_midpoint = _parse_salary_midpoint(salary_range)

    return JobSignals(
        demand_score=demand_score,
        salary_midpoint=salary_midpoint,
        experience_level=exp_score,
        experience_level_label=exp_label,
        demand_level_label=demand_label,
        salary_level_label=salary_label,
        salary_score_direct=salary_score_direct,
    )


def infer_user_experience_level(user_skill_weights: dict[str, float]) -> float:
    """
    Heuristic: estimate user seniority from their skill weight distribution.

    >= 6 skills with weight >= 3 → senior (1.0)
    >= 3 skills with weight >= 2 → mid (0.7)
    otherwise → junior (0.4)
    """
    if not user_skill_weights:
        return 0.4
    high_weight = sum(1 for w in user_skill_weights.values() if w >= 3.0)
    mid_weight = sum(1 for w in user_skill_weights.values() if w >= 2.0)
    if high_weight >= 6:
        return 1.0
    if mid_weight >= 3:
        return 0.7
    return 0.4


def calculate_demand_score(signals: JobSignals) -> float:
    """Return the normalized market demand score derived from job_trend."""
    return signals.demand_score


def calculate_salary_score(
    signals: JobSignals,
    salary_max_in_pool: float = _SALARY_REFERENCE_MAX,
) -> float:
    """
    Normalize salary to [0, 1].

    Uses direct DB salary level score when available; otherwise normalizes
    salary midpoint relative to the pool ceiling. Returns 0.5 when absent.
    """
    if signals.salary_score_direct is not None:
        return signals.salary_score_direct
    if signals.salary_midpoint is None:
        return 0.5
    ref = max(salary_max_in_pool, 1.0)
    return max(0.0, min(1.0, signals.salary_midpoint / ref))


def calculate_experience_alignment_score(
    user_level: float,
    job_signals: JobSignals,
) -> float:
    """
    Score how well the user's inferred seniority matches the job's requirement.

    When the job has a structured DB level label, uses discrete rank distance:
      exact match → 1.0, one level apart → 0.70, two levels apart → 0.40.
    Falls back to continuous distance math for legacy float-only signals.
    """
    job_label = job_signals.experience_level_label
    if job_label is not None:
        # Map user float to nearest discrete rank
        if user_level >= 0.85:
            user_rank = 2  # Senior
        elif user_level >= 0.55:
            user_rank = 1  # Mid
        else:
            user_rank = 0  # Junior
        job_rank = _LEVEL_RANK.get(job_label.lower(), 1)
        distance = abs(user_rank - job_rank)
        return {0: 1.0, 1: 0.70, 2: 0.40}.get(distance, 0.40)
    # Fallback: continuous distance
    alignment = 1.0 - abs(user_level - job_signals.experience_level)
    return max(0.0, min(1.0, alignment))


# ---------------------------------------------------------------------------
# Embedding model
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def get_sentence_transformer_model():
    if SentenceTransformer is None:
        raise RuntimeError(
            "sentence-transformers is not installed. Run: pip install -r requirements.txt"
        )
    return SentenceTransformer(SEMANTIC_MODEL_NAME)


@lru_cache(maxsize=1)
def get_embedding_model() -> SentenceTransformer:
    cache_dir = Path.home() / ".cache" / "huggingface" / "hub"
    return SentenceTransformer(
        SEMANTIC_MODEL_NAME,
        cache_folder=str(cache_dir),
        local_files_only=True,
    )


# ---------------------------------------------------------------------------
# Profile text helpers
# ---------------------------------------------------------------------------

def _coerce_weight(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)

    text = str(value).strip().lower()
    mapping = {
        "high": 3.0,
        "moderate": 2.0,
        "medium": 2.0,
        "low": 1.0,
    }
    return mapping.get(text, 1.0)


def _normalize_profile_fragment(value: str | None) -> str:
    if not value:
        return ""
    from .skill_core import normalize_whitespace
    return normalize_whitespace(str(value))


def _truncate_profile_text(text: str, max_chars: int = SEMANTIC_TEXT_MAX_CHARS) -> str:
    from .skill_core import normalize_whitespace
    cleaned = normalize_whitespace(text or "")
    if len(cleaned) <= max_chars:
        return cleaned

    clipped = cleaned[:max_chars].rsplit(" ", 1)[0].strip()
    return clipped or cleaned[:max_chars].strip()


def build_job_profile_text(job: JobRecord) -> str:
    weighted_skills = job.effective_skill_weights()
    weighted_skills_text = ", ".join(
        f"{prettify_skill_label(skill)} [{_priority_weight_to_label(weight)}]"
        for skill, weight in sorted(weighted_skills.items(), key=lambda item: (-item[1], item[0]))
    )
    core_skills_text = ", ".join(
        prettify_skill_label(skill) for skill in sorted(job.core_skills_canonical)
    )
    description_hints_text = ", ".join(
        prettify_skill_label(skill) for skill in sorted(job.description_skill_hints)
    )
    soft_skills_text = ", ".join(x.strip() for x in job.soft_skills if str(x).strip())

    parts = [
        f"Job Title: {_normalize_profile_fragment(job.job_title)}",
        f"Category: {_normalize_profile_fragment(job.category)}",
    ]

    if weighted_skills_text:
        parts.append(f"Priority Skills: {weighted_skills_text}")
    if core_skills_text:
        parts.append(f"Core Skills: {core_skills_text}")
    if description_hints_text:
        parts.append(f"Description Hints: {description_hints_text}")
    if soft_skills_text:
        parts.append(f"Soft Skills: {soft_skills_text}")
    if job.description:
        parts.append(f"Description: {_normalize_profile_fragment(job.description)}")
    if job.education:
        parts.append(f"Education: {_normalize_profile_fragment(job.education)}")
    if job.experience:
        parts.append(f"Experience: {_normalize_profile_fragment(job.experience)}")

    return _truncate_profile_text("\n".join(part for part in parts if part.strip()))


def build_cv_profile_text(
    cv_text: str | None,
    extracted_skills: dict[str, int] | list[str] | None,
) -> str:
    ordered_skill_labels: list[str] = []

    if isinstance(extracted_skills, dict):
        ordered_skill_labels = [
            prettify_skill_label(skill)
            for skill, _weight in sorted(
                extracted_skills.items(),
                key=lambda item: (-int(item[1]), item[0]),
            )
        ]
    elif extracted_skills:
        ordered_skill_labels = [
            prettify_skill_label(str(skill))
            for skill in extracted_skills
            if str(skill).strip()
        ]

    parts: list[str] = []
    if ordered_skill_labels:
        parts.append(f"Detected Skills: {', '.join(ordered_skill_labels)}")
    if cv_text:
        parts.append(f"CV Content: {_normalize_profile_fragment(cv_text)}")

    return _truncate_profile_text("\n".join(parts))


def encode_texts_to_embeddings(texts: list[str]) -> list[np.ndarray]:
    normalized_texts = [
        _truncate_profile_text(str(text))
        for text in texts
        if text and str(text).strip()
    ]
    if not normalized_texts:
        return []

    model = get_embedding_model()
    vectors = model.encode(
        normalized_texts,
        convert_to_numpy=True,
        normalize_embeddings=True,
        show_progress_bar=False,
        batch_size=64,
    )
    return [np.asarray(vector, dtype=np.float32) for vector in vectors]


def get_text_embedding(text: str) -> np.ndarray:
    normalized_text = _truncate_profile_text(text)
    if not normalized_text:
        return np.zeros(384, dtype=np.float32)

    model = get_embedding_model()
    vector = model.encode(
        normalized_text,
        convert_to_numpy=True,
        normalize_embeddings=True,
        show_progress_bar=False,
    )
    return np.asarray(vector, dtype=np.float32)


def cosine_similarity_embeddings(
    vec1: np.ndarray | list[float],
    vec2: np.ndarray | list[float],
) -> float:
    a = np.asarray(vec1, dtype=np.float32)
    b = np.asarray(vec2, dtype=np.float32)

    if a.size == 0 or b.size == 0 or a.shape != b.shape:
        return 0.0

    similarity = float(np.dot(a, b))
    similarity = max(-1.0, min(1.0, similarity))
    return max(0.0, min(1.0, (similarity + 1.0) / 2.0))


def calculate_semantic_match_score(
    cv_embedding: np.ndarray | list[float],
    job_embedding: np.ndarray | list[float],
) -> float:
    return round(cosine_similarity_embeddings(cv_embedding, job_embedding) * 100.0, 4)


def calculate_weighted_skill_match(
    user_skill_weights: dict[str, float],
    job_skill_weights: dict[str, float],
) -> float:
    if not job_skill_weights:
        return 0.0

    total_required_weight = sum(job_skill_weights.values())
    if total_required_weight <= 0:
        return 0.0

    matched_weight = 0.0
    for skill, required_weight in job_skill_weights.items():
        user_weight = user_skill_weights.get(skill, 0.0)
        if user_weight > 0:
            matched_weight += min(user_weight, required_weight)

    return max(0.0, min(1.0, matched_weight / total_required_weight))


def calculate_exact_overlap_ratio(
    user_skill_weights: dict[str, float],
    job_skill_weights: dict[str, float],
) -> float:
    if not job_skill_weights:
        return 0.0

    job_skills = set(job_skill_weights.keys())
    if not job_skills:
        return 0.0

    user_skills = set(user_skill_weights.keys())
    return len(job_skills & user_skills) / len(job_skills)


def calculate_hybrid_match_score(
    semantic_score: float,
    weighted_skill_score: float,
    exact_overlap_score: float,
) -> float:
    score = (
        (SEMANTIC_WEIGHT * semantic_score)
        + (WEIGHTED_SKILL_WEIGHT * weighted_skill_score)
        + (EXACT_OVERLAP_WEIGHT * exact_overlap_score)
    )
    return max(0.0, min(1.0, score))


def _build_job_skill_weights(job: Any) -> dict[str, float]:
    parsed_skills = getattr(job, "parsed_skills", {}) or {}
    result: dict[str, float] = {}

    for raw_skill, raw_weight in parsed_skills.items():
        canonical = canonicalize_skill(raw_skill)
        if canonical:
            result[canonical] = _coerce_weight(raw_weight)

    return result


def _build_user_skill_weights(user_skills: dict[str, Any]) -> dict[str, float]:
    result: dict[str, float] = {}

    for raw_skill, raw_weight in (user_skills or {}).items():
        canonical = canonicalize_skill(raw_skill)
        if canonical:
            result[canonical] = max(result.get(canonical, 0.0), _coerce_weight(raw_weight))

    return result


def _split_skill_strengths(
    user_skill_weights: dict[str, float],
    job_skill_weights: dict[str, float],
) -> tuple[list[str], list[str], list[str]]:
    strong: list[str] = []
    partial: list[str] = []
    missing: list[str] = []

    for skill, required_weight in job_skill_weights.items():
        user_weight = user_skill_weights.get(skill, 0.0)

        if user_weight >= required_weight and user_weight > 0:
            strong.append(skill)
        elif user_weight > 0:
            partial.append(skill)
        else:
            missing.append(skill)

    return strong, partial, missing


# ---------------------------------------------------------------------------
# Skill gap
# ---------------------------------------------------------------------------

class SkillGapEntry(TypedDict):
    """One skill in a gap report with job-side importance and optional user weight."""

    skill: str
    job_weight: int
    user_weight: int


def _family_expansion_for_skill(skill: str) -> set[str]:
    """
    Return family/domain concepts implied by a canonical skill.
    Example:
    - aws -> {"cloud"}
    - tensorflow -> {"machine learning", "deep learning", "ai"}
    """
    if not skill:
        return set()
    return set(SKILL_FAMILY_MAP.get(skill, set()))


def expand_skill_set_for_matching(weighted_skills: dict[str, int]) -> dict[str, int]:
    """
    Expand a canonical weighted skill map with family/domain hints.

    Rules:
    - exact skills keep their original weight
    - family/domain implied skills are added with lighter weight
    - if skill already exists, keep the higher weight
    """
    expanded: dict[str, int] = dict(weighted_skills)

    for skill, weight in list(weighted_skills.items()):
        for family_skill in _family_expansion_for_skill(skill):
            inferred_weight = max(1, weight - 1)
            current = expanded.get(family_skill, 0)
            if inferred_weight > current:
                expanded[family_skill] = inferred_weight

    return expanded


def _skill_overlap_score(
    user_skills: dict[str, int],
    job_skills: dict[str, int],
) -> tuple[float, dict[str, str]]:
    """
    Compute overlap between user and job using:
    1) exact canonical match
    2) family/domain expansion

    Returns:
    - weighted matched total
    - match mode per job skill:
      {"python": "exact", "cloud": "family", ...}
    """
    expanded_user = expand_skill_set_for_matching(user_skills)
    overlap_modes: dict[str, str] = {}
    matched_total = 0.0

    for job_skill, job_weight in job_skills.items():
        if job_skill in user_skills:
            matched_total += min(user_skills[job_skill], job_weight)
            overlap_modes[job_skill] = "exact"
            continue

        if job_skill in expanded_user:
            matched_total += min(expanded_user[job_skill], job_weight) * 0.7
            overlap_modes[job_skill] = "family"

    return matched_total, overlap_modes


def analyze_skill_gap(user_skills: dict[str, int], job_skills: dict[str, int]) -> dict[str, list[dict[str, int | str]]]:
    """
    Classify job skills into:
    - strong: exact canonical match with enough user weight
    - partial: exact but lower weight, OR family/domain level match
    - missing: no meaningful coverage at all
    """
    result: dict[str, list[dict[str, int | str]]] = {
        "strong": [],
        "partial": [],
        "missing": [],
    }

    if not job_skills:
        return result

    expanded_user = expand_skill_set_for_matching(user_skills)

    for job_skill, job_weight in job_skills.items():
        direct_user_weight = user_skills.get(job_skill, 0)
        expanded_user_weight = expanded_user.get(job_skill, 0)

        if direct_user_weight >= job_weight and direct_user_weight > 0:
            result["strong"].append(
                {
                    "skill": prettify_skill_label(job_skill),
                    "job_weight": job_weight,
                    "user_weight": direct_user_weight,
                }
            )
            continue

        if direct_user_weight > 0:
            result["partial"].append(
                {
                    "skill": prettify_skill_label(job_skill),
                    "job_weight": job_weight,
                    "user_weight": direct_user_weight,
                }
            )
            continue

        if expanded_user_weight > 0:
            result["partial"].append(
                {
                    "skill": prettify_skill_label(job_skill),
                    "job_weight": job_weight,
                    "user_weight": expanded_user_weight,
                }
            )
            continue

        result["missing"].append(
            {
                "skill": prettify_skill_label(job_skill),
                "job_weight": job_weight,
                "user_weight": 0,
            }
        )

    return result


def gap_summary_to_serializable(gap: dict[str, list[SkillGapEntry]]) -> dict[str, list[dict[str, Any]]]:
    """Return a plain dict copy suitable for JSON responses."""
    return {
        "strong": [dict(x) for x in gap["strong"]],
        "partial": [dict(x) for x in gap["partial"]],
        "missing": [dict(x) for x in gap["missing"]],
    }


# ---------------------------------------------------------------------------
# Matcher
# ---------------------------------------------------------------------------

def calculate_match_score(user_skills: dict[str, int], job_skills: dict[str, int]) -> float:
    """
    Structured match score between user skills and a job profile.

    - exact canonical matches count fully
    - family/domain matches count partially
    - denominator stays based on the job's direct required skills
    """
    if not user_skills or not job_skills:
        return 0.0

    total_job_weight = sum(job_skills.values())
    if total_job_weight <= 0:
        return 0.0

    matched_total, _ = _skill_overlap_score(user_skills, job_skills)
    score = (matched_total / total_job_weight) * 100.0
    return round(max(0.0, min(score, 100.0)), 4)


def calculate_exact_overlap_score(user_skills: dict[str, int], job_skills: dict[str, int]) -> float:
    """Direct canonical overlap only, without family expansion."""
    if not user_skills or not job_skills:
        return 0.0

    total_job_weight = sum(job_skills.values())
    if total_job_weight <= 0:
        return 0.0

    matched = 0.0
    for skill, job_weight in job_skills.items():
        direct_user_weight = user_skills.get(skill, 0)
        if direct_user_weight > 0:
            matched += min(float(direct_user_weight), float(job_weight))

    score = (matched / total_job_weight) * 100.0
    return round(max(0.0, min(score, 100.0)), 4)


def sparse_cosine_similarity(a: dict[str, int], b: dict[str, int]) -> float:
    """
    Cosine similarity between two sparse non-negative integer skill vectors.

    Used to suggest roles with similar skill *patterns* (vector similarity), separate
    from the main hybrid score.
    """
    if not a or not b:
        return 0.0

    dot = 0.0
    for key, av in a.items():
        bv = b.get(key)
        if bv is not None:
            dot += av * bv

    norm_a = math.sqrt(sum(v * v for v in a.values()))
    norm_b = math.sqrt(sum(v * v for v in b.values()))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0

    sim = dot / (norm_a * norm_b)
    return round(max(0.0, min(1.0, sim)), 6)


def build_skill_vector(skill_dict: dict[str, int]) -> dict[str, int]:
    """Canonical sparse vector suitable for matching and similarity."""
    result: dict[str, int] = {}
    for raw_name, weight in skill_dict.items():
        if weight <= 0:
            continue
        key = normalize_skill_name(str(raw_name))
        if not key:
            continue
        prev = result.get(key)
        if prev is None or weight > prev:
            result[key] = weight
    return result


def calculate_career_score(match_scores: list[float]) -> float:
    if not match_scores:
        return 0.0

    top = sorted(match_scores, reverse=True)[:5]
    avg = sum(top) / len(top)
    return round(max(0.0, min(100.0, avg)), 4)


def calculate_category_alignment_score(
    user_skill_weights: dict[str, float],
    job_category: str | None,
) -> float:
    category_key = normalize_skill_surface(job_category or "")
    signature_skills = CATEGORY_SIGNATURE_SKILLS.get(category_key)

    if not signature_skills:
        return 0.0

    total = 0.0
    matched = 0.0

    for skill in signature_skills:
        total += 1.0
        user_weight = float(user_skill_weights.get(skill, 0.0))
        if user_weight > 0:
            matched += min(user_weight, 2.0) / 2.0

    if total == 0.0:
        return 0.0

    return max(0.0, min(1.0, matched / total))


def calculate_calibrated_hybrid_score(
    semantic_score: float,
    weighted_skill_score: float,
    exact_overlap_score: float,
    category_alignment_score: float,
) -> float:
    score = (
        (0.45 * semantic_score)
        + (0.30 * weighted_skill_score)
        + (0.15 * exact_overlap_score)
        + (0.10 * category_alignment_score)
    )
    return max(0.0, min(1.0, score))


def calculate_enhanced_hybrid_score(
    semantic_score: float,
    weighted_skill_score: float,
    exact_overlap_score: float,
    category_alignment_score: float,
    demand_score: float = 0.5,
    experience_alignment_score: float = 0.7,
    salary_score: float = 0.5,
) -> float:
    """
    Multi-factor hybrid score integrating market demand, experience fit, and salary signals.

    Phase-3 weights (DB signals active):
      semantic              0.35
      weighted_skill        0.25
      exact_overlap         0.10
      category_alignment    0.05
      demand_score          0.12
      experience_alignment  0.08
      salary_score          0.05
    All inputs must be in [0, 1]; result is clamped to [0, 1].
    """
    score = (
        0.35 * semantic_score
        + 0.25 * weighted_skill_score
        + 0.10 * exact_overlap_score
        + 0.05 * category_alignment_score
        + 0.12 * demand_score
        + 0.08 * experience_alignment_score
        + 0.05 * salary_score
    )
    return max(0.0, min(1.0, score))


@dataclass(frozen=True)
class ScoredJob:
    """Job with structured + semantic scoring, final rank, and gap analysis."""

    job: JobRecord
    user_vector: dict[str, int]
    job_vector: dict[str, int]
    match_percent: float
    structured_match_percent: float
    exact_overlap_percent: float
    semantic_match_percent: float
    gap: dict[str, list[SkillGapEntry]]


def _compute_final_hybrid_score(
    *,
    structured_match_percent: float,
    exact_overlap_percent: float,
    semantic_match_percent: float,
    use_semantic: bool,
    has_structured_signal: bool,
) -> float:
    if use_semantic and not has_structured_signal:
        return round(max(0.0, min(100.0, semantic_match_percent)), 4)

    if not use_semantic:
        return round(max(0.0, min(100.0, structured_match_percent)), 4)

    final_score = (
        semantic_match_percent * HYBRID_SCORE_WEIGHTS["semantic"]
        + structured_match_percent * HYBRID_SCORE_WEIGHTS["weighted_skill"]
        + exact_overlap_percent * HYBRID_SCORE_WEIGHTS["exact_overlap"]
    )
    return round(max(0.0, min(100.0, final_score)), 4)


def score_jobs_against_user(
    jobs: list[JobRecord],
    user_skills: dict[str, int],
    *,
    cv_text: str | None = None,
    job_embedding_lookup: dict[int, list[float]] | None = None,
) -> list[ScoredJob]:
    """Build all per-job scores using structured matching and optional semantic matching."""
    user_vector = build_skill_vector(user_skills)
    scored: list[ScoredJob] = []

    use_semantic = bool(cv_text and job_embedding_lookup)
    has_structured_signal = bool(user_vector)
    cv_embedding: list[float] = []
    if use_semantic:
        cv_profile_text = build_cv_profile_text(cv_text or "", user_vector)
        cv_embedding = get_text_embedding(cv_profile_text)
        use_semantic = bool(cv_embedding)

    for job in jobs:
        job_vector = build_skill_vector(job.effective_skill_weights())
        structured_match_percent = calculate_match_score(user_vector, job_vector)
        exact_overlap_percent = calculate_exact_overlap_score(user_vector, job_vector)

        semantic_match_percent = 0.0
        if use_semantic and job_embedding_lookup is not None:
            job_embedding = job_embedding_lookup.get(job.source_row_index, [])
            semantic_match_percent = calculate_semantic_match_score(cv_embedding, job_embedding)

        final_match_percent = _compute_final_hybrid_score(
            structured_match_percent=structured_match_percent,
            exact_overlap_percent=exact_overlap_percent,
            semantic_match_percent=semantic_match_percent,
            use_semantic=use_semantic,
            has_structured_signal=has_structured_signal,
        )
        gap = analyze_skill_gap(user_vector, job_vector)
        scored.append(
            ScoredJob(
                job=job,
                user_vector=user_vector,
                job_vector=job_vector,
                match_percent=final_match_percent,
                structured_match_percent=structured_match_percent,
                exact_overlap_percent=exact_overlap_percent,
                semantic_match_percent=semantic_match_percent,
                gap=gap,
            ),
        )
    return scored


def select_top_matches(scored: list[ScoredJob], limit: int = 5) -> list[ScoredJob]:
    """Return the highest ranked jobs using final hybrid score."""
    if limit <= 0:
        return []
    ordered = sorted(
        scored,
        key=lambda s: (-s.match_percent, -s.structured_match_percent, s.job.job_title, s.job.source_row_index),
    )
    return ordered[:limit]


def get_top_jobs(
    jobs: list[JobRecord],
    user_skills: dict[str, int],
    *,
    limit: int = 5,
    cv_text: str | None = None,
    job_embedding_lookup: dict[int, list[float]] | None = None,
) -> list[ScoredJob]:
    scored = score_jobs_against_user(
        jobs,
        user_skills,
        cv_text=cv_text,
        job_embedding_lookup=job_embedding_lookup,
    )
    return select_top_matches(scored, limit)


def get_missing_skills_recommendation(top_jobs: list[ScoredJob]) -> list[dict[str, str | int]]:
    """
    Aggregate missing skills from top matches, ranked by job importance (weight).

    Deduplicates by skill name keeping the highest ``job_weight`` seen.
    """
    best_weight: dict[str, int] = {}
    for sj in top_jobs:
        for entry in sj.gap["missing"]:
            skill = entry["skill"]
            jw = entry["job_weight"]
            prev = best_weight.get(skill)
            if prev is None or jw > prev:
                best_weight[skill] = jw

    ranked = sorted(best_weight.items(), key=lambda x: (-x[1], x[0]))
    out: list[dict[str, str | int]] = []
    for skill, weight in ranked[:12]:
        label = display_label_for_canonical(skill)
        out.append(
            {
                "skill": label,
                "job_weight": weight,
                "message": f"Add or strengthen \u201c{label}\u201d (importance weight {weight} in target roles).",
            },
        )
    return out


def rank_alternative_jobs(
    scored: list[ScoredJob],
    top_jobs: list[ScoredJob],
    limit: int = 3,
) -> list[dict[str, str | float]]:
    """
    Suggest roles with similar skill *shape* (cosine) that are not in the top list.

    Excludes jobs already in ``top_jobs`` and sorts remaining by cosine similarity
    to the user vector, descending.
    """
    if limit <= 0 or not scored:
        return []

    top_ids = {sj.job.source_row_index for sj in top_jobs}
    if not scored:
        return []

    user_vec = scored[0].user_vector

    candidates: list[tuple[ScoredJob, float]] = []
    for sj in scored:
        if sj.job.source_row_index in top_ids:
            continue
        cos = sparse_cosine_similarity(user_vec, sj.job_vector)
        candidates.append((sj, cos))

    candidates.sort(
        key=lambda t: (-t[1], -t[0].match_percent, t[0].job.job_title),
    )

    alts: list[dict[str, str | float]] = []
    for sj, cos in candidates[:limit]:
        alts.append(
            {
                "job_title": sj.job.job_title,
                "category": sj.job.category,
                "similarity": cos,
                "match_percent": sj.match_percent,
                "message": (
                    f"Similar skill pattern (cosine {cos:.2f}) with "
                    f"{sj.match_percent:.1f}% weighted coverage\u2014consider as a related path."
                ),
            },
        )
    return alts


def get_alternative_jobs(
    jobs: list[JobRecord],
    user_skills: dict[str, int],
    *,
    top_limit: int = 5,
    limit: int = 3,
) -> list[dict[str, str | float]]:
    """
    Score all jobs, hold back the current top matches, and return cosine-similar alternates.

    When a scored list is already available, call :func:`rank_alternative_jobs` instead
    to avoid duplicate work.
    """
    scored = score_jobs_against_user(jobs, user_skills)
    top = select_top_matches(scored, top_limit)
    return rank_alternative_jobs(scored, top, limit)


def build_text_recommendations(
    missing_recs: list[dict[str, str | int]],
    career_score: float,
) -> list[dict[str, str | float]]:
    """
    Short actionable bullets combining readiness and missing-skill focus.
    """
    recs: list[dict[str, str | float]] = []

    if career_score >= 75:
        recs.append(
            {
                "title": "Strong alignment",
                "description": "Your profile lines up well with several roles; refine niche skills to stand out.",
                "priority": 1.0,
            },
        )
    elif career_score >= 45:
        recs.append(
            {
                "title": "Solid base",
                "description": "Close priority gaps below to unlock higher match tiers.",
                "priority": 1.0,
            },
        )
    else:
        recs.append(
            {
                "title": "Build core coverage",
                "description": "Focus on high-weight missing skills from your best-matching roles first.",
                "priority": 1.0,
            },
        )

    for i, item in enumerate(missing_recs[:3], start=2):
        recs.append(
            {
                "title": f"Target: {item['skill']}",
                "description": str(item["message"]),
                "priority": float(i),
            },
        )

    return recs


__all__ = [
    # constants
    "SEMANTIC_MODEL_NAME",
    "SEMANTIC_TEXT_MAX_CHARS",
    "HYBRID_SCORE_WEIGHTS",
    "SEMANTIC_WEIGHT",
    "WEIGHTED_SKILL_WEIGHT",
    "EXACT_OVERLAP_WEIGHT",
    # embedding model
    "get_sentence_transformer_model",
    "get_embedding_model",
    # profile text helpers
    "_coerce_weight",
    "_normalize_profile_fragment",
    "_truncate_profile_text",
    "build_job_profile_text",
    "build_cv_profile_text",
    "encode_texts_to_embeddings",
    "get_text_embedding",
    "cosine_similarity_embeddings",
    "calculate_semantic_match_score",
    "calculate_weighted_skill_match",
    "calculate_exact_overlap_ratio",
    "calculate_hybrid_match_score",
    "_build_job_skill_weights",
    "_build_user_skill_weights",
    "_split_skill_strengths",
    # skill gap
    "SkillGapEntry",
    "_family_expansion_for_skill",
    "expand_skill_set_for_matching",
    "_skill_overlap_score",
    "analyze_skill_gap",
    "gap_summary_to_serializable",
    # matcher
    "calculate_match_score",
    "calculate_exact_overlap_score",
    "sparse_cosine_similarity",
    "build_skill_vector",
    "calculate_career_score",
    "calculate_category_alignment_score",
    "calculate_calibrated_hybrid_score",
    # phase-1 ranking engine
    "_JOB_TREND_NUMERIC",
    "_EXPERIENCE_LEVEL_NUMERIC",
    "_SALARY_REFERENCE_MAX",
    "_LEVEL_RANK",
    "_parse_salary_midpoint",
    "_normalize_job_trend",
    "_normalize_experience_level",
    "normalize_experience_level",
    "normalize_demand_level",
    "normalize_salary_level",
    "map_experience_to_score",
    "map_demand_to_score",
    "map_salary_to_score",
    "JobSignals",
    "enrich_job_signals",
    "infer_user_experience_level",
    "calculate_demand_score",
    "calculate_salary_score",
    "calculate_experience_alignment_score",
    "calculate_enhanced_hybrid_score",
    "ScoredJob",
    "_compute_final_hybrid_score",
    "score_jobs_against_user",
    "select_top_matches",
    "get_top_jobs",
    "get_missing_skills_recommendation",
    "rank_alternative_jobs",
    "get_alternative_jobs",
    "build_text_recommendations",
]
