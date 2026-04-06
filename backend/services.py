"""Business logic: settings, dataset pipeline, skill parsing, matching, analysis."""

from __future__ import annotations

import math
import os
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Final, TypedDict, Iterable

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field, field_validator
from sentence_transformers import SentenceTransformer


from models import DatasetSummary, JobRecord , CanonicalSkillProfile
from utils import clean_optional_text, split_pipe_values


# --- constants (merged) ---

ALLOWED_CATEGORIES: Final[frozenset[str]] = frozenset(
    {
        "Frontend",
        "Backend",
        "Full Stack",
        "Data",
        "AI",
        "DevOps",
        "Mobile",
        "Cybersecurity",
    }
)

SKILL_PRIORITY_WEIGHTS: Final[dict[str, int]] = {
    "High": 3,
    "Moderate": 2,
    "Low": 1,
}

"""Default weight for user-supplied skills when no job-specific priority is known."""
DEFAULT_USER_SKILL_WEIGHT: Final[int] = SKILL_PRIORITY_WEIGHTS["Moderate"]

SEMANTIC_MODEL_NAME: Final[str] = "all-MiniLM-L6-v2"
SEMANTIC_TEXT_MAX_CHARS: Final[int] = 4000
HYBRID_SCORE_WEIGHTS: Final[dict[str, float]] = {
    "semantic": 0.50,
    "weighted_skill": 0.30,
    "exact_overlap": 0.20,
}

# --- config (merged) ---

class Settings(BaseModel):
    """Runtime configuration; override via environment variables."""

    APP_NAME: str = Field(
        default="Smart Career Analysis and Recommendation System",
        description="Human-readable application name.",
    )
    APP_VERSION: str = Field(default="0.1.0", description="Semantic or project version string.")
    DEBUG: bool = Field(default=False, description="Enable verbose debug behavior when true.")
    DATASET_PATH: Path = Field(
        default=Path("data/jobs.csv"),
        description="Path to the jobs CSV file, relative to the backend root or absolute.",
    )

    @field_validator("DATASET_PATH", mode="before")
    @classmethod
    def _coerce_dataset_path(cls, value: str | Path) -> Path:
        return Path(value) if not isinstance(value, Path) else value


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


_DEFAULT_APP_NAME = "Smart Career Analysis and Recommendation System"
_DEFAULT_APP_VERSION = "0.1.0"
_DEFAULT_DATASET = Path("data/jobs.csv")


@lru_cache
def get_settings() -> Settings:
    """Return cached settings instance (singleton per process)."""
    path_raw = os.getenv("DATASET_PATH")
    return Settings(
        APP_NAME=(os.getenv("APP_NAME") or _DEFAULT_APP_NAME).strip() or _DEFAULT_APP_NAME,
        APP_VERSION=(os.getenv("APP_VERSION") or _DEFAULT_APP_VERSION).strip() or _DEFAULT_APP_VERSION,
        DEBUG=_env_bool("DEBUG", False),
        DATASET_PATH=Path(path_raw.strip()) if path_raw and path_raw.strip() else _DEFAULT_DATASET,
    )

# --- column_mapping (merged) ---

REQUIRED_LOGICAL_COLUMNS: tuple[str, ...] = (
    "Job Title",
    "Category",
    "Description",
    "UI Description",
    "Core Skills",
    "Skill Priority Level",
    "Soft Skills",
    "Education",
    "Experience",
    "Salary Range",
    "Job Trend",
    "Final Skill Count",
)

COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "Job Title": ("Job Title", "Title", "JobTitle", "Job_Title"),
    "Category": ("Category", "Job Category", "Role Category"),
    "Description": ("Description", "ML Description", "Job Description", "Full Description"),
    "UI Description": ("UI Description", "Short Description", "Summary"),
    "Core Skills": ("Core Skills", "CoreSkills", "Technical Skills", "Key Skills"),
    "Skill Priority Level": (
        "Skill Priority Level",
        "Skill Priorities",
        "Skills Priority",
        "Priority Skills",
    ),
    "Soft Skills": ("Soft Skills", "SoftSkills", "Interpersonal Skills"),
    "Education": ("Education", "Education Degree", "Degree", "Qualification"),
    "Experience": ("Experience", "Years of Experience", "Exp"),
    "Salary Range": ("Salary Range", "Salary", "Compensation"),
    "Job Trend": ("Job Trend", "Trend", "Market Trend"),
    "Final Skill Count": ("Final Skill Count", "Skill Count", "Total Skills"),
}


def _strip_lookup(columns: pd.Index) -> dict[str, str]:
    """Map stripped header text to the exact column label in the frame."""
    lookup: dict[str, str] = {}
    for col in columns:
        label = str(col)
        stripped = label.strip()
        if stripped not in lookup:
            lookup[stripped] = label
    return lookup


def resolve_column_mapping(df: pd.DataFrame) -> dict[str, str]:
    """
    Map each logical column name to the actual ``DataFrame`` column label.

    Tries aliases in order: exact match against ``df.columns``, then stripped
    header match (first occurrence wins).

    Returns:
        ``{ logical_name: actual_csv_header }`` for every required logical field.

    Raises:
        ValueError: If any logical field cannot be resolved.
    """
    col_list = [str(c) for c in df.columns]
    col_set = set(col_list)
    strip_map = _strip_lookup(df.columns)

    resolved: dict[str, str] = {}
    missing: list[str] = []

    for logical in REQUIRED_LOGICAL_COLUMNS:
        candidates = COLUMN_ALIASES.get(logical, (logical,))
        found: str | None = None
        for candidate in candidates:
            if candidate in col_set:
                found = candidate
                break
            key = candidate.strip()
            if key in strip_map:
                found = strip_map[key]
                break
        if found is None:
            missing.append(logical)
        else:
            resolved[logical] = found

    if missing:
        available = ", ".join(col_list[:40])
        more = " …" if len(col_list) > 40 else ""
        tried = "; ".join(
            f"{m}: [{', '.join(COLUMN_ALIASES.get(m, (m,)))}]" for m in missing
        )
        raise ValueError(
            f"Could not resolve required column(s): {', '.join(missing)}. "
            f"Tried aliases: {tried}. "
            f"Columns in file: {available}{more}"
        )

    return resolved


# ---------------------------------------------------------------------------
# Skill intelligence layer - part 1
# Canonicalization + job skill profile building
# ---------------------------------------------------------------------------

SKILL_TOKEN_SPLIT_RE = re.compile(r"[|,/;]+")
MULTISPACE_RE = re.compile(r"\s+")
PARENS_RE = re.compile(r"\([^)]*\)")
NON_ALNUM_KEEP_TECH_RE = re.compile(r"[^a-zA-Z0-9\s\+\#\.\-]")

GENERIC_NON_SKILL_TERMS = {
    "documentation",
    "technical documentation",
    "system",
    "systems",
    "project",
    "projects",
    "analysis",
    "development",
    "software development",
    "application development",
    "technical support",
    "communication",
    "teamwork",
    "leadership",
    "problem solving",
    "critical thinking",
}

# canonical form = what the backend should compare internally
SKILL_ALIAS_MAP: dict[str, str] = {
    # programming languages
    "cpp": "c++",
    "c plus plus": "c++",
    "c sharp": "c#",
    "cs": "c#",
    "py": "python",
    "golang": "go",
    "js": "javascript",
    "ts": "typescript",

    # frameworks / platforms
    "reactjs": "react",
    "react js": "react",
    "node": "node.js",
    "nodejs": "node.js",
    "node js": "node.js",
    "nextjs": "next.js",
    "next js": "next.js",
    "vuejs": "vue.js",
    "vue js": "vue.js",
    "angularjs": "angular",
    "dotnet": ".net",
    "net core": ".net",
    "asp net": "asp.net",
    "aspnet": "asp.net",

    # ai / data
    "ml": "machine learning",
    "dl": "deep learning",
    "nlp": "natural language processing",
    "cv": "computer vision",
    "ai": "artificial intelligence",
    "llm": "large language models",
    "genai": "generative ai",

    # cloud / devops
    "amazon web services": "aws",
    "aws cloud": "aws",
    "google cloud platform": "google cloud",
    "gcp": "google cloud",
    "azure cloud": "azure",
    "ci cd": "ci/cd",
    "cicd": "ci/cd",
    "docker containerization": "docker",

    # databases / backend
    "postgres": "postgresql",
    "mongo": "mongodb",
    "ms sql": "sql",
    "mysql db": "mysql",
    "nosql db": "nosql",

    # engineering variants
    "mat lab": "matlab",
    "pro engineer": "cad",
    "pro-engineer": "cad",
    "cad programming": "cad",
    "assembler": "assembly",
    "assembly language": "assembly",
    "asp.net mvc": "asp.net",
}

# some skills imply broader families
SKILL_FAMILY_MAP: dict[str, set[str]] = {
    "aws": {"cloud"},
    "google cloud": {"cloud"},
    "azure": {"cloud"},
    "docker": {"devops", "containerization"},
    "kubernetes": {"devops", "containerization"},
    "ci/cd": {"devops"},
    "tensorflow": {"machine learning", "deep learning", "ai"},
    "pytorch": {"machine learning", "deep learning", "ai"},
    "scikit-learn": {"machine learning", "ai"},
    "pandas": {"data analysis", "data"},
    "numpy": {"data analysis", "data"},
    "sql": {"databases", "data"},
    "postgresql": {"databases", "data"},
    "mysql": {"databases", "data"},
    "mongodb": {"databases", "nosql"},
    "react": {"frontend", "web development"},
    "angular": {"frontend", "web development"},
    "vue.js": {"frontend", "web development"},
    "node.js": {"backend", "web development"},
    "asp.net": {"backend", "web development"},
    "python": {"backend", "data", "ai"},
    "java": {"backend"},
    "c++": {"systems programming"},
    "assembly": {"embedded systems", "low-level programming"},
    "matlab": {"numerical computing"},
    "cad": {"engineering design"},
}

DESCRIPTION_HINT_PATTERNS: dict[str, tuple[str, ...]] = {
    "aws": (" aws ", "amazon web services"),
    "google cloud": (" google cloud ", "gcp", "google cloud platform"),
    "azure": (" azure ",),
    "docker": (" docker ", "containerization"),
    "kubernetes": (" kubernetes ", "k8s"),
    "react": (" react ", "reactjs"),
    "javascript": (" javascript ", " js "),
    "typescript": (" typescript ", " ts "),
    "python": (" python ",),
    "java": (" java ",),
    "c++": (" c++ ", " cpp "),
    "sql": (" sql ", "postgres", "mysql", "database design"),
    "machine learning": (" machine learning ", " ml "),
    "deep learning": (" deep learning ", " neural network "),
    "natural language processing": (" natural language processing ", " nlp "),
    "computer vision": (" computer vision ",),
    "tensorflow": (" tensorflow ",),
    "pytorch": (" pytorch ",),
    "kafka": (" kafka ",),
    "hadoop": (" hadoop ",),
    "cassandra": (" cassandra ",),
    "etl": (" etl ", " data pipeline ", " data pipelines "),
    "cad": (" cad ", "computer aided design"),
    "matlab": (" matlab ",),
    "assembly": (" assembler ", " assembly "),
}


def normalize_whitespace(value: str) -> str:
    return MULTISPACE_RE.sub(" ", value).strip()


def normalize_skill_surface(raw_skill: str) -> str:
    """
    Normalize a raw skill mention without destroying technical tokens.

    Examples:
    - ' ReactJS '     -> 'reactjs'
    - 'Node JS'       -> 'node js'
    - 'Assembler (...)' -> 'assembler'
    - 'C++'           -> 'c++'
    - 'ASP.Net'       -> 'asp.net'
    """
    if not raw_skill:
        return ""

    value = str(raw_skill).strip().lower()
    value = PARENS_RE.sub(" ", value)
    value = value.replace("_", " ").replace("/", " / ")
    value = value.replace("-", " ")
    value = NON_ALNUM_KEEP_TECH_RE.sub(" ", value)
    value = normalize_whitespace(value)

    # normalize a few common punctuation variants
    value = value.replace("node js", "nodejs")
    value = value.replace("react js", "reactjs")
    value = value.replace("next js", "nextjs")
    value = value.replace("vue js", "vuejs")
    value = value.replace("asp . net", "asp.net")
    value = value.replace("asp net", "aspnet")

    return value


def canonicalize_skill_name(raw_skill: str) -> str:
    """
    Convert any raw skill string into the canonical backend representation.

    This is the most important comparison layer.
    """
    base = normalize_skill_surface(raw_skill)
    if not base:
        return ""

    canonical = SKILL_ALIAS_MAP.get(base, base)

    # final cleanup
    canonical = canonical.strip().lower()

    if canonical in GENERIC_NON_SKILL_TERMS:
        return ""

    return canonical

def canonicalize_skill(raw_skill: str) -> str:
    """
    Backward-compatible alias for older code paths.
    """
    return canonicalize_skill_name(raw_skill)


def normalize_skill_name(skill: str) -> str:
    """
    Backward-compatible normalization entry point.
    """
    return canonicalize_skill_name(skill)


def display_label_for_canonical(canonical_skill: str) -> str:
    """
    Backward-compatible display helper for older code paths.
    """
    return prettify_skill_label(canonical_skill)


def prettify_skill_label(canonical_skill: str) -> str:
    """
    Convert canonical internal values into readable UI labels.

    Internal:
    - c++
    - machine learning
    - node.js

    Display:
    - C++
    - Machine Learning
    - Node.js
    """
    if not canonical_skill:
        return ""

    special = {
        "c++": "C++",
        "c#": "C#",
        "javascript": "JavaScript",
        "typescript": "TypeScript",
        "node.js": "Node.js",
        "react": "React",
        "vue.js": "Vue.js",
        "next.js": "Next.js",
        "asp.net": "ASP.NET",
        ".net": ".NET",
        "sql": "SQL",
        "aws": "AWS",
        "ci/cd": "CI/CD",
        "api": "API",
        "etl": "ETL",
        "nlp": "NLP",
        "ai": "AI",
        "cad": "CAD",
        "matlab": "MATLAB",
        "mongodb": "MongoDB",
        "postgresql": "PostgreSQL",
        "mysql": "MySQL",
        "hadoop": "Hadoop",
        "kafka": "Kafka",
        "cassandra": "Cassandra",
        "tensorflow": "TensorFlow",
        "pytorch": "PyTorch",
        "scikit-learn": "Scikit-learn",
        "google cloud": "Google Cloud",
    }

    if canonical_skill in special:
        return special[canonical_skill]

    return " ".join(word.capitalize() for word in canonical_skill.split())


def parse_core_skills_raw(raw_value: str) -> set[str]:
    """
    Parse the Core Skills column into canonical skill names.

    Supports strings like:
    'Python|SQL|React'
    """
    if raw_value is None or (isinstance(raw_value, float) and math.isnan(raw_value)):
        return set()

    text = str(raw_value).strip()
    if not text:
        return set()

    parts = [part.strip() for part in SKILL_TOKEN_SPLIT_RE.split(text)]
    canonical_skills: set[str] = set()

    for part in parts:
        canonical = canonicalize_skill_name(part)
        if canonical:
            canonical_skills.add(canonical)

    return canonical_skills


def extract_description_skill_hints(description: str) -> set[str]:
    """
    Extract lightweight skill hints directly from job description text.

    This is NOT the main matching engine.
    It only enriches each job profile with obvious description cues.
    """
    if not description:
        return set()

    text = f" {normalize_skill_surface(description)} "
    hints: set[str] = set()

    for canonical_skill, patterns in DESCRIPTION_HINT_PATTERNS.items():
        for pattern in patterns:
            normalized_pattern = f" {normalize_skill_surface(pattern)} "
            if normalized_pattern.strip() and normalized_pattern in text:
                hints.add(canonical_skill)
                break

    return hints


def build_job_skill_profile(
    *,
    job_title: str,
    category: str,
    parsed_skills: dict[str, int],
    core_skills_raw: str,
    description: str,
) -> tuple[set[str], set[str], CanonicalSkillProfile]:
    """
    Build the merged job skill representation used later for better matching.

    Sources merged here:
    1) parsed_skills           -> strongest source (weighted)
    2) Core Skills column      -> medium source
    3) Description skill hints -> weak source
    """
    core_skills_canonical = parse_core_skills_raw(core_skills_raw)
    description_skill_hints = extract_description_skill_hints(description)

    profile = CanonicalSkillProfile()

    # strongest layer: explicit weighted priority skills
    for raw_skill, weight in parsed_skills.items():
        canonical = canonicalize_skill_name(raw_skill)
        if canonical:
            profile.add_skill(
                canonical_skill=canonical,
                weight=int(weight),
                source="job_priority",
                matched_text=raw_skill,
                confidence=1.0,
            )

    # medium layer: core skills
    for canonical in core_skills_canonical:
        # if not already present, add with medium default weight
        existing_weight = profile.weighted_skills.get(canonical, 0)
        inferred_weight = max(existing_weight, 2)
        profile.add_skill(
            canonical_skill=canonical,
            weight=inferred_weight,
            source="job_core",
            matched_text=canonical,
            confidence=0.9,
        )

    # weak layer: description hints
    for canonical in description_skill_hints:
        existing_weight = profile.weighted_skills.get(canonical, 0)
        inferred_weight = max(existing_weight, 1)
        profile.add_skill(
            canonical_skill=canonical,
            weight=inferred_weight,
            source="job_description",
            matched_text=canonical,
            confidence=0.6,
        )

    # attach family relations for future matching upgrades
    for skill in list(profile.weighted_skills.keys()):
        family_values = SKILL_FAMILY_MAP.get(skill, set())
        if family_values:
            profile.families[skill] = set(family_values)

    # lightweight category enrichment
    category_key = normalize_skill_surface(category)
    if category_key == "frontend":
        for implied in ("frontend", "web development"):
            profile.families.setdefault(implied, set())
    elif category_key == "backend":
        for implied in ("backend", "server-side"):
            profile.families.setdefault(implied, set())
    elif category_key == "data":
        for implied in ("data", "data analysis"):
            profile.families.setdefault(implied, set())
    elif category_key == "ai":
        for implied in ("ai", "machine learning"):
            profile.families.setdefault(implied, set())
    elif category_key == "devops":
        for implied in ("devops", "cloud"):
            profile.families.setdefault(implied, set())

    return core_skills_canonical, description_skill_hints, profile

def _priority_weight_to_label(weight: int) -> str:
    return {3: "high", 2: "moderate", 1: "low"}.get(int(weight), "moderate")


def _normalize_profile_fragment(value: str | None) -> str:
    if not value:
        return ""
    return normalize_whitespace(str(value))


def _truncate_profile_text(text: str, max_chars: int = SEMANTIC_TEXT_MAX_CHARS) -> str:
    cleaned = normalize_whitespace(text)
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
    core_skills_text = ", ".join(prettify_skill_label(skill) for skill in sorted(job.core_skills_canonical))
    description_hints_text = ", ".join(prettify_skill_label(skill) for skill in sorted(job.description_skill_hints))
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


def build_cv_profile_text(cv_text: str, extracted_skills: dict[str, int]) -> str:
    skill_summary = ", ".join(
        prettify_skill_label(skill)
        for skill, _weight in sorted(extracted_skills.items(), key=lambda item: (-item[1], item[0]))
    )

    parts: list[str] = []
    if skill_summary:
        parts.append(f"Detected Skills: {skill_summary}")
    if cv_text:
        parts.append(f"CV Content: {_normalize_profile_fragment(cv_text)}")

    return _truncate_profile_text("\n".join(parts))


@lru_cache(maxsize=1)
def get_sentence_transformer_model():
    if SentenceTransformer is None:
        raise RuntimeError(
            "sentence-transformers is not installed. Run: pip install -r requirements.txt"
        )
    return SentenceTransformer(SEMANTIC_MODEL_NAME)


def encode_texts_to_embeddings(texts: list[str]) -> list[list[float]]:
    normalized_texts = [_truncate_profile_text(text) for text in texts if text and text.strip()]
    if not normalized_texts:
        return []

    model = get_sentence_transformer_model()
    vectors = model.encode(
        normalized_texts,
        convert_to_numpy=True,
        normalize_embeddings=True,
        show_progress_bar=False,
    )
    return [vector.astype(float).tolist() for vector in vectors]



def cosine_similarity_embeddings(vec1: list[float], vec2: list[float]) -> float:
    if not vec1 or not vec2:
        return 0.0

    a = np.asarray(vec1, dtype=float)
    b = np.asarray(vec2, dtype=float)
    if a.size == 0 or b.size == 0 or a.shape != b.shape:
        return 0.0

    similarity = float(np.dot(a, b))
    return round(max(0.0, min(1.0, similarity)), 6)

def collect_dataset_skill_vocabulary(jobs: Iterable[JobRecord]) -> set[str]:
    """
    Collect the broadest possible canonical skill vocabulary from loaded jobs.

    This is stronger than relying only on parsed_skills.
    """
    vocabulary: set[str] = set()

    for job in jobs:
        vocabulary.update(job.parsed_skills.keys())
        vocabulary.update(job.core_skills_canonical)
        vocabulary.update(job.description_skill_hints)
        vocabulary.update(job.effective_skill_keys())

    return {skill for skill in vocabulary if skill}



# --- skill_normalization (merged) ---

_PAREN: Final[re.Pattern[str]] = re.compile(r"\([^)]*\)")



_CANONICAL_DISPLAY: Final[dict[str, str]] = {
    "c++": "C++",
    "c#": "C#",
    ".net": ".NET",
    "node.js": "Node.js",
    "asp.net": "ASP.NET",
    "vue.js": "Vue.js",
    "machine learning": "Machine Learning",
    "artificial intelligence": "Artificial Intelligence",
    "natural language processing": "Natural Language Processing",
    "javascript": "JavaScript",
    "typescript": "TypeScript",
    "python": "Python",
    "sql": "SQL",
    "aws": "AWS",
    "gcp": "GCP",
    "azure": "Azure",
    "google cloud": "GCP",
    "postgresql": "PostgreSQL",
    "mongodb": "MongoDB",
    "tensorflow": "TensorFlow",
    "pytorch": "PyTorch",
    "kubernetes": "Kubernetes",
    "docker": "Docker",
    "git": "Git",
    "linux": "Linux",
    "html": "HTML",
    "css": "CSS",
    "react": "React",
    "angular": "Angular",
    "java": "Java",
    "go": "Go",
    "php": "PHP",
    "ruby": "Ruby",
    "scala": "Scala",
    "swift": "Swift",
    "kotlin": "Kotlin",
    "rust": "Rust",
    "kafka": "Kafka",
    "redis": "Redis",
    "spark": "Spark",
    "hadoop": "Hadoop",
    "webpack": "Webpack",
    "sass": "Sass",
    "microservices": "Microservices",
    "ci/cd": "CI/CD",
}


def preprocess_skill_text(raw: str) -> str:
    """
    Lowercase, trim, collapse whitespace, normalize separators, strip parenthetical noise.

    Preserves meaningful tokens (C++, C#, .NET, Node.js, Vue.js, ASP.NET) before
    generic punctuation removal.
    """
    s = clean_optional_text(raw)
    if not s:
        return ""
    while True:
        n = _PAREN.sub("", s)
        n = re.sub(r"\s+", " ", n).strip()
        if n == s:
            break
        s = n
    s = s.lower().strip()
    s = re.sub(r"(?<=[a-z0-9])/(?=[a-z0-9])", " ", s)
    s = s.replace("node.js", "\x01N\x01")
    s = s.replace("vue.js", "\x01V\x01")
    s = s.replace("asp.net", "\x01A\x01")
    s = s.replace(".net", "\x01D\x01")
    s = re.sub(r"(?<=[a-z0-9])\.(?=[a-z0-9])", "", s)
    s = s.replace("\x01N\x01", "node.js")
    s = s.replace("\x01V\x01", "vue.js")
    s = s.replace("\x01A\x01", "asp.net")
    s = s.replace("\x01D\x01", ".net")
    s = re.sub(r"[-_]+", " ", s)
    s = re.sub(r"[^a-z0-9\s+#.+]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s






def aliases_for_canonical_key(canon: str) -> frozenset[str]:
    """Lowercase search phrases for CV regex matching for a canonical key."""
    ck = canon.strip().lower()
    if not ck:
        return frozenset()
    out: set[str] = {ck}
    for alias, target in SKILL_ALIAS_MAP.items():
        if target == ck:
            out.add(alias.lower().strip())
    if " " in ck:
        out.add(ck.replace(" ", "-"))
        out.add(ck.replace(" ", ""))
    if "/" in ck:
        out.add(ck.replace("/", " "))
    return frozenset(p for p in out if p)


def apply_skill_display_to_analysis_payload(payload: dict) -> dict:
    """Map canonical skill keys in an analyze response dict to display labels."""
    out = dict(payload)
    skills = payload.get("skills")
    if isinstance(skills, dict):
        out["skills"] = {display_label_for_canonical(k): v for k, v in skills.items()}
    gaps = payload.get("gaps")
    if isinstance(gaps, list):
        out["gaps"] = [{**row, "skill": display_label_for_canonical(str(row.get("skill", "")))} for row in gaps]
    top_jobs = payload.get("top_jobs")
    if isinstance(top_jobs, list):
        out["top_jobs"] = [_display_top_job_row(j) for j in top_jobs]
    return out


def _display_top_job_row(job: dict) -> dict:
    j = dict(job)
    ps = job.get("parsed_skills")
    if isinstance(ps, dict):
        j["parsed_skills"] = {display_label_for_canonical(k): v for k, v in ps.items()}
    ga = job.get("gap_analysis")
    if isinstance(ga, dict):

        def rows(xs: list) -> list:
            return [{**e, "skill": display_label_for_canonical(str(e.get("skill", "")))} for e in xs]

        j["gap_analysis"] = {
            "strong": rows(ga.get("strong", [])),
            "partial": rows(ga.get("partial", [])),
            "missing": rows(ga.get("missing", [])),
        }
    return j


skill_alias_map = SKILL_ALIAS_MAP

# --- skill_parser (merged) ---

def priority_label_to_weight(label: str) -> int:
    """
    Map a priority label to its numeric weight.

    Raises:
        ValueError: If the label is empty or not one of High, Moderate, Low
            (case-insensitive).
    """
    raw = clean_optional_text(label)
    if not raw:
        raise ValueError("Empty priority label")
    normalized = raw.strip().lower()
    for name, weight in SKILL_PRIORITY_WEIGHTS.items():
        if name.lower() == normalized:
            return weight
    raise ValueError(f"Unknown priority label: {label!r}")


def parse_skill_priority_pairs(raw_value: str) -> dict[str, int]:
    """
    Parse strings like ``Python:High|SQL:High|React:Moderate`` into a skill→weight map.

    Malformed segments are skipped. Duplicate skills keep the highest weight.
    Keys are :func:`~services.skill_normalization.canonicalize_skill` values so they
    align with CV-extracted skills.
    """
    text = clean_optional_text(raw_value)
    if not text:
        return {}

    result: dict[str, int] = {}
    for chunk in split_pipe_values(text):
        if ":" not in chunk:
            continue
        skill_part, priority_part = chunk.split(":", 1)
        skill_name = canonicalize_skill(skill_part)
        if not skill_name:
            continue
        try:
            weight = priority_label_to_weight(priority_part)
        except ValueError:
            continue
        prev = result.get(skill_name)
        if prev is None or weight > prev:
            result[skill_name] = weight
    return result


def extract_skill_names(parsed_skills: dict[str, int]) -> list[str]:
    """Return sorted unique skill names for stable downstream use."""
    return sorted(parsed_skills.keys())

# --- dataset_validator (merged) ---

class DatasetValidationError(RuntimeError):
    """Raised when the dataset cannot be safely loaded or fails structural checks."""


@dataclass
class ValidationResult:
    """Outcome of validation: the frame plus non-fatal warnings and column resolution."""

    dataframe: pd.DataFrame
    column_map: dict[str, str]
    warnings: list[str] = field(default_factory=list)


def _ensure_file_exists(path: Path) -> None:
    if not path.exists():
        raise DatasetValidationError(f"Dataset file does not exist: {path}")
    if not path.is_file():
        raise DatasetValidationError(f"Dataset path is not a file: {path}")


def _final_skill_count_coercible(value: object) -> bool:
    text = clean_optional_text(value)
    if not text:
        return True
    try:
        float(text.replace(",", ""))
    except ValueError:
        return False
    return True


def validate_jobs_dataset(path: Path) -> ValidationResult:
    """
    Validate dataset presence, resolvable columns, and soft row-level rules.

    Fatal problems raise ``DatasetValidationError``. Recoverable row issues
    are appended to ``warnings`` and processing may continue.
    """
    _ensure_file_exists(path)
    warnings: list[str] = []

    try:
        df = pd.read_csv(path, dtype=str, keep_default_na=True)
    except Exception as exc:  # pragma: no cover - pandas IO errors
        raise DatasetValidationError(f"Failed to read CSV: {exc}") from exc

    if df.empty:
        raise DatasetValidationError("Dataset is empty (no rows).")

    try:
        column_map = resolve_column_mapping(df)
    except ValueError as exc:
        raise DatasetValidationError(str(exc)) from exc

    col = column_map

    for idx, row in df.iterrows():
        row_num = int(idx) + 2
        category = clean_optional_text(row.get(col["Category"], ""))
        if category and category not in ALLOWED_CATEGORIES:
            warnings.append(
                f"Row {row_num}: category {category!r} is not in the allowed set."
            )

        sp_raw = clean_optional_text(row.get(col["Skill Priority Level"], ""))
        if sp_raw:
            parsed = parse_skill_priority_pairs(sp_raw)
            if not parsed:
                warnings.append(
                    f"Row {row_num}: skill priority field is present but produced no parseable skill:weight pairs."
                )

        fsc = row.get(col["Final Skill Count"])
        if not _final_skill_count_coercible(fsc):
            warnings.append(
                f"Row {row_num}: final skill count value {fsc!r} is not numeric."
            )

    return ValidationResult(dataframe=df, column_map=column_map, warnings=warnings)


def required_logical_columns() -> tuple[str, ...]:
    """Public list of canonical column keys expected after resolution."""
    return REQUIRED_LOGICAL_COLUMNS


SEMANTIC_MODEL_NAME = "all-MiniLM-L6-v2"

SEMANTIC_WEIGHT = 0.50
WEIGHTED_SKILL_WEIGHT = 0.30
EXACT_OVERLAP_WEIGHT = 0.20


from functools import lru_cache

@lru_cache(maxsize=1)
def get_embedding_model():
    return SentenceTransformer("all-MiniLM-L6-v2")


def _safe_join(parts: list[str]) -> str:
    cleaned = []
    for part in parts:
        if part is None:
            continue
        value = str(part).strip()
        if value:
            cleaned.append(value)
    return "\n".join(cleaned)


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


def _normalize_to_unit_interval(value: float) -> float:
    # cosine similarity from [-1, 1] -> [0, 1]
    return max(0.0, min(1.0, (value + 1.0) / 2.0))


def build_job_profile_text(job: Any) -> str:
    parsed_skills = getattr(job, "parsed_skills", {}) or {}
    core_skills = list(parsed_skills.keys())

    priority_lines = [
        f"{skill} ({parsed_skills[skill]})"
        for skill in core_skills
    ]

    description = getattr(job, "job_description", None) or getattr(job, "description", None) or ""
    category = getattr(job, "category", "") or ""
    title = getattr(job, "job_title", "") or ""

    description_hints = getattr(job, "description_skill_hints", None) or []
    if isinstance(description_hints, dict):
        description_hints = list(description_hints.keys())

    return _safe_join(
        [
            f"Job Title: {title}",
            f"Category: {category}",
            f"Description: {description}",
            "Core Skills: " + ", ".join(core_skills) if core_skills else "",
            "Priority Skills: " + ", ".join(priority_lines) if priority_lines else "",
            "Related Concepts: " + ", ".join(description_hints) if description_hints else "",
        ]
    )


def build_cv_profile_text(cv_text: str | None, extracted_skills: list[str] | None) -> str:
    extracted_skills = extracted_skills or []
    return _safe_join(
        [
            "CV Text:",
            cv_text or "",
            "Extracted Skills: " + ", ".join(extracted_skills) if extracted_skills else "",
        ]
    )


def get_text_embedding(text: str) -> np.ndarray:
    if not text or not text.strip():
        return np.zeros(384, dtype=np.float32)

    model = get_embedding_model()
    vector = model.encode(
        text,
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=False,
    )
    return np.asarray(vector, dtype=np.float32)


def cosine_similarity_embeddings(vec1: np.ndarray, vec2: np.ndarray) -> float:
    if vec1 is None or vec2 is None:
        return 0.0
    if vec1.size == 0 or vec2.size == 0:
        return 0.0

    denom = float(np.linalg.norm(vec1) * np.linalg.norm(vec2))
    if denom == 0.0:
        return 0.0

    cosine = float(np.dot(vec1, vec2) / denom)
    return _normalize_to_unit_interval(cosine)


def calculate_semantic_match_score(
    cv_text: str | None,
    extracted_skills: list[str],
    job: Any,
    job_embedding_lookup: dict[int, np.ndarray] | None,
) -> float:
    if not cv_text and not extracted_skills:
        return 0.0

    cv_profile_text = build_cv_profile_text(cv_text, extracted_skills)
    cv_embedding = get_text_embedding(cv_profile_text)

    job_embedding = None
    if job_embedding_lookup:
        job_embedding = job_embedding_lookup.get(id(job))

    if job_embedding is None:
        job_profile_text = build_job_profile_text(job)
        job_embedding = get_text_embedding(job_profile_text)

    return cosine_similarity_embeddings(cv_embedding, job_embedding)

def calculate_weighted_skill_match(
    user_skill_weights: dict[str, float],
    job_skill_weights: dict[str, float],
) -> float:
    if not job_skill_weights:
        return 0.0

    total_required_weight = sum(job_skill_weights.values())
    if total_required_weight == 0:
        return 0.0

    matched_weight = 0.0
    for skill, required_weight in job_skill_weights.items():
        user_weight = user_skill_weights.get(skill, 0.0)
        if user_weight > 0:
            matched_weight += min(user_weight, required_weight)

    score = matched_weight / total_required_weight
    return max(0.0, min(1.0, score))


def calculate_exact_overlap_score(
    user_skill_weights: dict[str, float],
    job_skill_weights: dict[str, float],
) -> float:
    if not job_skill_weights:
        return 0.0

    job_skills = set(job_skill_weights.keys())
    user_skills = set(user_skill_weights.keys())

    if not job_skills:
        return 0.0

    overlap_count = len(job_skills & user_skills)
    return overlap_count / len(job_skills)


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
        result[canonical] = _coerce_weight(raw_weight)

    return result


def _build_user_skill_weights(user_skills: dict[str, Any]) -> dict[str, float]:
    result: dict[str, float] = {}

    for raw_skill, raw_weight in (user_skills or {}).items():
        canonical = canonicalize_skill(raw_skill)
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


def _build_recommendations_from_top_jobs(top_jobs: list[dict[str, Any]]) -> list[str]:
    if not top_jobs:
        return [
            "Add more technical skills to your CV.",
            "Include clearer project descriptions with measurable outcomes.",
            "Use explicit role-related keywords that match target jobs.",
        ]

    missing_counter: Counter[str] = Counter()
    for job in top_jobs[:5]:
        for skill in job.get("missing_skills", [])[:5]:
            missing_counter[skill] += 1

    recommendations: list[str] = []

    best_job = top_jobs[0]
    recommendations.append(
        f"Your strongest current direction is {best_job.get('job_title', 'a relevant role')}."
    )

    for skill, _ in missing_counter.most_common(3):
        recommendations.append(
            f"Improve your profile by strengthening {display_label_for_canonical(skill)}."
        )

    recommendations.append(
        "Make your CV describe projects using outcomes, tools, and responsibilities more explicitly."
    )

    return recommendations[:5]


def _calculate_career_score_from_top_jobs(top_jobs: list[dict[str, Any]]) -> float:
    if not top_jobs:
        return 0.0

    top_scores = [float(job.get("match_percent", 0.0)) for job in top_jobs[:5]]
    if not top_scores:
        return 0.0

    return round(sum(top_scores) / len(top_scores), 2)

# --- data_loader (merged) ---

class JobDatasetService:
    """Loads and caches ``JobRecord`` instances built from the validated CSV."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._jobs: list[JobRecord] | None = None
        self._summary: DatasetSummary | None = None
        self._resolved_dataset_path: Path | None = None
        self._validation_warnings: list[str] = []
        self._column_map: dict[str, str] | None = None
        self._job_profile_text_by_row: dict[int, str] = {}
        self._job_embedding_by_row: dict[int, list[float]] = {}
        self._job_embedding_lookup: dict[int, np.ndarray] = {}

    def _backend_root(self) -> Path:
        return Path(__file__).resolve().parent

    def _resolve_dataset_path(self) -> Path:
        configured = self._settings.DATASET_PATH
        if configured.is_absolute():
            return configured.resolve()
        return (self._backend_root() / configured).resolve()
    
    def _build_job_embedding_cache(self) -> None:
        lookup: dict[int, np.ndarray] = {}

        for job in self.get_all_jobs():
            profile_text = build_job_profile_text(job)
            lookup[id(job)] = get_text_embedding(profile_text)

        self._job_embedding_lookup = lookup


    def get_job_embedding_lookup(self) -> dict[int, np.ndarray]:
        return self._job_embedding_lookup

    
    def is_loaded(self) -> bool:
        """Return True after ``load_dataset`` has completed successfully."""
        return self._jobs is not None

    @property
    def resolved_dataset_path(self) -> Path | None:
        """Absolute path used for the last successful or attempted load."""
        return self._resolved_dataset_path

    @property
    def column_map(self) -> dict[str, str] | None:
        """Logical column name → actual CSV header from the last successful load."""
        return self._column_map

    def load_dataset(self) -> list[JobRecord]:
        """
        Read CSV from disk, validate, parse rows into ``JobRecord``, and cache.

        Returns:
            The list of processed job records.

        Raises:
            DatasetValidationError: If structural validation fails.
        """
        path = self._resolve_dataset_path()
        self._resolved_dataset_path = path

        validation = validate_jobs_dataset(path)
        self._validation_warnings = list(validation.warnings)
        self._column_map = dict(validation.column_map)
        df = validation.dataframe
        col = validation.column_map

        jobs: list[JobRecord] = []

        for row_index, (_, row) in enumerate(df.iterrows()):
            sp_raw = clean_optional_text(row.get(col["Skill Priority Level"], ""))
            parsed = parse_skill_priority_pairs(sp_raw)

            soft_cell = clean_optional_text(row.get(col["Soft Skills"], ""))
            soft_list = split_pipe_values(soft_cell) if soft_cell else []

            fsc_raw = clean_optional_text(row.get(col["Final Skill Count"], ""))
            final_count: int | None
            if not fsc_raw:
                final_count = None
            else:
                try:
                    final_count = int(float(fsc_raw.replace(",", "")))
                except ValueError:
                    final_count = None

            job_title = clean_optional_text(row.get(col["Job Title"], ""))
            category = clean_optional_text(row.get(col["Category"], ""))
            description = clean_optional_text(row.get(col["Description"], ""))
            ui_description = clean_optional_text(row.get(col["UI Description"], ""))
            core_skills_raw = clean_optional_text(row.get(col["Core Skills"], ""))
            skill_priority_raw = sp_raw
            education = clean_optional_text(row.get(col["Education"], ""))
            experience = clean_optional_text(row.get(col["Experience"], ""))
            salary_range = clean_optional_text(row.get(col["Salary Range"], ""))
            job_trend = clean_optional_text(row.get(col["Job Trend"], ""))

            core_skills_canonical, description_skill_hints, merged_skill_profile = build_job_skill_profile(
                job_title=job_title,
                category=category,
                parsed_skills=parsed,
                core_skills_raw=core_skills_raw,
                description=description,
            )

            record = JobRecord(
                job_title=job_title,
                category=category,
                description=description,
                ui_description=ui_description,
                core_skills_raw=core_skills_raw,
                skill_priority_raw=skill_priority_raw,
                parsed_skills=dict(merged_skill_profile.weighted_skills),
                soft_skills=soft_list,
                education=education,
                experience=experience,
                salary_range=salary_range,
                job_trend=job_trend,
                final_skill_count=final_count,
                source_row_index=row_index,
                core_skills_canonical=core_skills_canonical,
                description_skill_hints=description_skill_hints,
                merged_skill_profile=merged_skill_profile,
            )
            jobs.append(record)

        self._jobs = jobs
        self._build_semantic_cache(jobs)
        self._summary = self._compute_summary(path)
        self._build_job_embedding_cache()
        return jobs

    def _build_semantic_cache(self, jobs: list[JobRecord]) -> None:
        self._job_profile_text_by_row = {}
        self._job_embedding_by_row = {}

        if not jobs:
            return

        row_indexes: list[int] = []
        profile_texts: list[str] = []

        for job in jobs:
            profile_text = build_job_profile_text(job)
            self._job_profile_text_by_row[job.source_row_index] = profile_text
            row_indexes.append(job.source_row_index)
            profile_texts.append(profile_text)

        embeddings = encode_texts_to_embeddings(profile_texts)
        self._job_embedding_by_row = {
            row_index: embedding
            for row_index, embedding in zip(row_indexes, embeddings, strict=False)
        }

    def _compute_summary(self, path: Path) -> DatasetSummary:
        assert self._jobs is not None
        jobs = self._jobs
        total = len(jobs)
        category_distribution = dict(Counter(j.category for j in jobs if j.category))
        all_skills: set[str] = set()
        skill_counts: list[int] = []
        for job in jobs:
            all_skills.update(job.parsed_skills.keys())
            skill_counts.append(len(job.parsed_skills))
        avg_skills = sum(skill_counts) / total if total else 0.0
        return DatasetSummary(
            total_jobs=total,
            category_distribution=category_distribution,
            unique_skill_count=len(all_skills),
            average_skill_count=round(avg_skills, 4),
            warnings_count=len(self._validation_warnings),
            dataset_path=path,
            validation_warnings=list(self._validation_warnings),
        )

    def get_all_jobs(self) -> list[JobRecord]:
        """Return every cached job record (copy of the list container)."""
        if self._jobs is None:
            raise RuntimeError("Dataset has not been loaded yet.")
        return list(self._jobs)

    def get_dataset_summary(self) -> DatasetSummary:
        """Return aggregate statistics for the loaded jobs dataset."""
        if self._summary is None:
            raise RuntimeError("Dataset has not been loaded yet.")
        return self._summary

    def get_job_previews(self, limit: int = 5) -> list[JobRecord]:
        """Return up to ``limit`` jobs from the start of the cached list."""
        if self._jobs is None:
            raise RuntimeError("Dataset has not been loaded yet.")
        cap = max(0, min(limit, len(self._jobs)))
        return list(self._jobs[:cap])

    def get_job_embedding_lookup(self) -> dict[int, list[float]]:
        if self._jobs is None:
            raise RuntimeError("Dataset has not been loaded yet.")
        return dict(self._job_embedding_by_row)

    def get_job_profile_text_lookup(self) -> dict[int, str]:
        if self._jobs is None:
            raise RuntimeError("Dataset has not been loaded yet.")
        return dict(self._job_profile_text_by_row)

# --- gap_analyzer (merged) ---

class SkillGapEntry(TypedDict):
    """One skill in a gap report with job-side importance and optional user weight."""

    skill: str
    job_weight: int
    user_weight: int


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

# --- matcher (merged) ---

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
                "message": f"Add or strengthen “{label}” (importance weight {weight} in target roles).",
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
                    f"{sj.match_percent:.1f}% weighted coverage—consider as a related path."
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

# --- text_cleaner (merged) ---

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

# --- cv_parser (merged) ---

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

# --- skill_extractor (merged) ---

def collect_canonical_vocabulary(jobs: Iterable[JobRecord]) -> set[str]:
    """
    Build a broad canonical vocabulary for CV extraction.

    Old behavior:
    - only used parsed_skills keys

    New behavior:
    - parsed skills
    - canonical core skills
    - description hints
    - effective merged skill keys
    """
    vocabulary: set[str] = set()

    for job in jobs:
        vocabulary.update(job.parsed_skills.keys())
        vocabulary.update(job.core_skills_canonical)
        vocabulary.update(job.description_skill_hints)
        vocabulary.update(job.effective_skill_keys())

    return {skill for skill in vocabulary if skill}

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

def vocabulary_for_cv_extraction(jobs: list[JobRecord]) -> frozenset[str]:
    """Dataset skill keys used when scanning CVs (drops extraction blocklist noise)."""
    return frozenset(s for s in collect_canonical_vocabulary(jobs) if s not in SKILL_EXTRACTION_BLOCKLIST_LOWER)


def build_global_skill_vocabulary(jobs: list[JobRecord]) -> frozenset[str]:
    """Alias: full dataset skill lexicon from ``parsed_skills`` keys (lowercased matching elsewhere)."""
    return collect_canonical_vocabulary(jobs)


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

REVERSE_SKILL_ALIAS_MAP: dict[str, set[str]] = {}
for alias, canonical in SKILL_ALIAS_MAP.items():
    REVERSE_SKILL_ALIAS_MAP.setdefault(canonical, set()).add(alias)


def _skill_surface_forms(canonical_skill: str) -> set[str]:
    """
    Build likely written forms for one canonical skill.
    """
    if not canonical_skill:
        return set()

    forms: set[str] = {
        canonical_skill,
        normalize_skill_surface(canonical_skill),
        normalize_skill_surface(prettify_skill_label(canonical_skill)),
    }

    for alias in REVERSE_SKILL_ALIAS_MAP.get(canonical_skill, set()):
        forms.add(normalize_skill_surface(alias))

    if canonical_skill == "c++":
        forms.update({"cpp", "c plus plus", "c++"})
    elif canonical_skill == "c#":
        forms.update({"c sharp", "c#"})
    elif canonical_skill == ".net":
        forms.update({"dotnet", ".net", "net core"})
    elif canonical_skill == "node.js":
        forms.update({"node", "nodejs", "node js", "node.js"})
    elif canonical_skill == "react":
        forms.update({"react", "reactjs", "react js"})
    elif canonical_skill == "javascript":
        forms.update({"javascript", "js"})
    elif canonical_skill == "typescript":
        forms.update({"typescript", "ts"})
    elif canonical_skill == "machine learning":
        forms.update({"machine learning", "ml"})
    elif canonical_skill == "artificial intelligence":
        forms.update({"artificial intelligence", "ai"})
    elif canonical_skill == "natural language processing":
        forms.update({"natural language processing", "nlp"})
    elif canonical_skill == "google cloud":
        forms.update({"gcp", "google cloud", "google cloud platform"})
    elif canonical_skill == "aws":
        forms.update({"aws", "amazon web services", "aws cloud"})
    elif canonical_skill == "asp.net":
        forms.update({"asp.net", "aspnet", "asp net", "asp.net mvc"})

    clean_forms = {normalize_skill_surface(form) for form in forms if normalize_skill_surface(form)}
    return clean_forms






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

def extract_skills_from_cv_text(text: str, jobs: list[JobRecord]) -> dict[str, int]:
    if not text or not jobs:
        return {}

    normalized_text = normalize_cv_text_for_skill_extraction(text)

    # 1) build vocabulary من dataset (أهم خطوة)
    vocabulary = collect_canonical_vocabulary(jobs)

    detected: dict[str, int] = {}

    for skill in vocabulary:
        surfaces = _skill_surface_forms(skill)

        for surface in surfaces:
            if _surface_exists_in_text(normalized_text, surface):
                detected[skill] = max(detected.get(skill, 0), DEFAULT_USER_SKILL_WEIGHT)
                break

    # 2) context enrichment
    context_patterns = {
        "machine learning": ["model training", "predictive model"],
        "data analysis": ["data cleaning", "data wrangling"],
        "deep learning": ["neural network", "cnn", "rnn"],
        "aws": ["ec2", "s3", "lambda"],
        "docker": ["containerization", "containers"],
    }

    for skill, hints in context_patterns.items():
        for hint in hints:
            if hint in normalized_text:
                detected[skill] = max(detected.get(skill, 0), DEFAULT_USER_SKILL_WEIGHT)

    return detected

def vocabulary_sample_for_debug(vocabulary: frozenset[str], limit: int = 80) -> list[str]:
    """Sorted slice of canonical skills for debug endpoints."""
    return sorted(vocabulary)[:limit]

# --- analyze_service (merged) ---

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


def analyze_cv_skills(
    user_skills: dict[str, Any],
    jobs: list[Any],
    top_k: int = 10,
    cv_text: str | None = None,
    job_embedding_lookup: dict[int, np.ndarray] | None = None,
) -> dict[str, Any]:

    user_skill_weights = _build_user_skill_weights(user_skills)
    extracted_skill_list = list(user_skill_weights.keys())

    ranked_jobs: list[dict[str, Any]] = []

    # 🔥 أهم تحسين: نحسب embedding مرة واحدة فقط
    cv_embedding = None
    if cv_text or extracted_skill_list:
        cv_embedding = get_text_embedding(
            build_cv_profile_text(cv_text, extracted_skill_list)
        )

    for job in jobs:
        job_skill_weights = _build_job_skill_weights(job)

        # ✅ semantic (سريع)
        job_embedding = None
        if job_embedding_lookup:
            job_embedding = job_embedding_lookup.get(id(job))

        if job_embedding is None:
            job_embedding = get_text_embedding(build_job_profile_text(job))

        if cv_embedding is not None:
            semantic_score = cosine_similarity_embeddings(cv_embedding, job_embedding)
        else:
            semantic_score = 0.0

        # ✅ skills
        weighted_skill_score = calculate_weighted_skill_match(
            user_skill_weights,
            job_skill_weights,
        )

        exact_overlap_score = calculate_exact_overlap_score(
            user_skill_weights,
            job_skill_weights,
        )

        # ✅ hybrid
        final_score = calculate_hybrid_match_score(
            semantic_score,
            weighted_skill_score,
            exact_overlap_score,
        )

        strong_skills, partial_skills, missing_skills = _split_skill_strengths(
            user_skill_weights,
            job_skill_weights,
        )

        ranked_jobs.append(
            {
                "job_title": getattr(job, "job_title", "Unknown Role"),
                "category": getattr(job, "category", "Unknown"),
                "match_percent": round(final_score * 100.0, 2),
                "strong_skills": strong_skills[:10],
                "partial_skills": partial_skills[:10],
                "missing_skills": missing_skills[:10],
            }
        )

    ranked_jobs.sort(key=lambda item: item["match_percent"], reverse=True)
    top_jobs = ranked_jobs[:top_k]

    gaps = [
        {
            "job_title": job["job_title"],
            "category": job["category"],
            "missing_skills": job["missing_skills"],
        }
        for job in top_jobs[:5]
        if job["missing_skills"]
    ]

    recommendations = _build_recommendations_from_top_jobs(top_jobs)
    career_score = _calculate_career_score_from_top_jobs(top_jobs)

    return {
        "skills": user_skill_weights,
        "gaps": gaps,
        "top_jobs": top_jobs,
        "recommendations": recommendations,
        "career_score": career_score,
    }
    