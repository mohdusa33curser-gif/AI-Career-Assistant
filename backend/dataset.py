"""Settings, dataset loading, and validation."""

from __future__ import annotations

import logging
import math
import os
from collections import Counter
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Final, Iterable

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field, field_validator, ConfigDict
from sentence_transformers import SentenceTransformer

from models import DatasetSummary, JobRecord, CanonicalSkillProfile
from utils import clean_optional_text, split_pipe_values
from skill_core import (
    canonicalize_skill_name,
    parse_skill_priority_pairs,
    prettify_skill_label,
    normalize_skill_surface,
    display_label_for_canonical,
    _priority_weight_to_label,
    DESCRIPTION_HINT_PATTERNS,
    SKILL_FAMILY_MAP,
    SKILL_EXTRACTION_BLOCKLIST_LOWER,
    parse_core_skills_raw,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Column mapping
# ---------------------------------------------------------------------------

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
# Dataset validator
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Skill profile building
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Vocabulary
# ---------------------------------------------------------------------------

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


# Alias: both names refer to the same function
collect_dataset_skill_vocabulary = collect_canonical_vocabulary


def build_global_skill_vocabulary(jobs: list[JobRecord]) -> frozenset[str]:
    """Alias: full dataset skill lexicon from ``parsed_skills`` keys (lowercased matching elsewhere)."""
    return collect_canonical_vocabulary(jobs)


def vocabulary_for_cv_extraction(jobs: list[JobRecord]) -> frozenset[str]:
    """Dataset skill keys used when scanning CVs (drops extraction blocklist noise)."""
    return frozenset(s for s in collect_canonical_vocabulary(jobs) if s not in SKILL_EXTRACTION_BLOCKLIST_LOWER)


def _format_db_salary_range(salary_min: int | None, salary_max: int | None) -> str:
    if salary_min is not None and salary_max is not None:
        return f"{salary_min} - {salary_max}"
    if salary_min is not None:
        return str(salary_min)
    if salary_max is not None:
        return str(salary_max)
    return ""


def _orm_job_to_job_record(orm_job: Any) -> JobRecord:
    """Map a persisted ORM ``Job`` (with ``job_skills`` loaded) to a ``JobRecord``."""
    from models.models import JobSkill as OrmJobSkill

    links: list[OrmJobSkill] = sorted(
        orm_job.job_skills,
        key=lambda js: (js.skill_id, js.id),
    )
    core_chunks: list[str] = []
    priority_chunks: list[str] = []
    for js in links:
        skill_name = clean_optional_text(js.skill.name if js.skill is not None else "")
        if not skill_name:
            continue
        core_chunks.append(skill_name)
        pl_raw = clean_optional_text(js.priority_level) or "Moderate"
        priority_chunks.append(f"{skill_name}:{pl_raw}")

    core_skills_raw = "|".join(core_chunks)
    skill_priority_raw = "|".join(priority_chunks)
    parsed = parse_skill_priority_pairs(skill_priority_raw)

    job_title = clean_optional_text(orm_job.title)
    category = clean_optional_text(orm_job.category)
    description = clean_optional_text(orm_job.description)
    ui_description = description
    salary_range = _format_db_salary_range(orm_job.salary_min, orm_job.salary_max)
    job_trend = ""

    core_skills_canonical, description_skill_hints, merged_skill_profile = build_job_skill_profile(
        job_title=job_title,
        category=category,
        parsed_skills=parsed,
        core_skills_raw=core_skills_raw,
        description=description,
    )

    n_merged = len(merged_skill_profile.weighted_skills)
    final_skill_count = n_merged if n_merged else None

    return JobRecord(
        job_title=job_title,
        category=category,
        description=description,
        ui_description=ui_description,
        core_skills_raw=core_skills_raw,
        skill_priority_raw=skill_priority_raw,
        parsed_skills=dict(merged_skill_profile.weighted_skills),
        soft_skills=[],
        education="",
        experience="",
        salary_range=salary_range,
        job_trend=job_trend,
        final_skill_count=final_skill_count,
        source_row_index=int(orm_job.id),
        core_skills_canonical=core_skills_canonical,
        description_skill_hints=description_skill_hints,
        merged_skill_profile=merged_skill_profile,
    )


def load_jobs_from_db() -> list[JobRecord]:
    """
    Load all jobs from PostgreSQL via ``JobService`` and map them to ``JobRecord``.

    Returns an empty list when the database has no jobs or any error occurs.
    """
    from db.connection import SessionLocal
    from services.job_service import JobService

    session = SessionLocal()
    try:
        job_service = JobService()
        orm_jobs: list[Any] = []
        page = 1
        while True:
            batch = job_service.get_jobs_with_skills(session, page=page, limit=100)
            if not batch:
                break
            orm_jobs.extend(batch)
            if len(batch) < 100:
                break
            page += 1
        if not orm_jobs:
            return []
        return [_orm_job_to_job_record(row) for row in orm_jobs]
    except Exception as exc:
        logger.warning("load_jobs_from_db failed: %s", exc)
        return []
    finally:
        session.close()


# ---------------------------------------------------------------------------
# JobDatasetService
# ---------------------------------------------------------------------------

class JobDatasetService:
    """Loads and caches ``JobRecord`` rows from PostgreSQL when available, else the CSV."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._jobs: list[JobRecord] | None = None
        self._summary: DatasetSummary | None = None
        self._resolved_dataset_path: Path | None = None
        self._validation_warnings: list[str] = []
        self._column_map: dict[str, str] | None = None
        self._job_profile_text_by_row: dict[int, str] = {}
        self._job_embedding_by_row: dict[int, np.ndarray] = {}

    def _backend_root(self) -> Path:
        return Path(__file__).resolve().parent

    def _resolve_dataset_path(self) -> Path:
        configured = self._settings.DATASET_PATH
        if configured.is_absolute():
            return configured.resolve()
        return (self._backend_root() / configured).resolve()

    def is_loaded(self) -> bool:
        return self._jobs is not None

    @property
    def resolved_dataset_path(self) -> Path | None:
        return self._resolved_dataset_path

    @property
    def column_map(self) -> dict[str, str] | None:
        return self._column_map

    def _finalize_loaded_jobs(
        self,
        jobs: list[JobRecord],
        *,
        resolved_path: Path,
        validation_warnings: list[str],
        column_map: dict[str, str] | None,
    ) -> list[JobRecord]:
        self._resolved_dataset_path = resolved_path
        self._validation_warnings = list(validation_warnings)
        self._column_map = dict(column_map) if column_map is not None else None
        self._jobs = jobs
        self._build_semantic_cache(jobs)
        self._summary = self._compute_summary(resolved_path)
        return jobs

    def load_dataset(self) -> list[JobRecord]:
        db_jobs = load_jobs_from_db()
        db_marker = self._backend_root() / "database"
        return self._finalize_loaded_jobs(
            db_jobs,
            resolved_path=db_marker,
            validation_warnings=[],
            column_map=None,
        )

    def _build_semantic_cache(self, jobs: list[JobRecord]) -> None:
        from matching import build_job_profile_text, encode_texts_to_embeddings

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
            for row_index, embedding in zip(row_indexes, embeddings)
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
        if self._jobs is None:
            raise RuntimeError("Dataset has not been loaded yet.")
        return list(self._jobs)

    def get_dataset_summary(self) -> DatasetSummary:
        if self._summary is None:
            raise RuntimeError("Dataset has not been loaded yet.")
        return self._summary

    def get_job_previews(self, limit: int = 5) -> list[JobRecord]:
        if self._jobs is None:
            raise RuntimeError("Dataset has not been loaded yet.")
        cap = max(0, min(limit, len(self._jobs)))
        return list(self._jobs[:cap])

    def get_job_embedding_lookup(self) -> dict[int, np.ndarray]:
        if self._jobs is None:
            raise RuntimeError("Dataset has not been loaded yet.")
        return dict(self._job_embedding_by_row)

    def get_job_profile_text_lookup(self) -> dict[int, str]:
        if self._jobs is None:
            raise RuntimeError("Dataset has not been loaded yet.")
        return dict(self._job_profile_text_by_row)


__all__ = [
    # constants
    "ALLOWED_CATEGORIES",
    # settings
    "Settings",
    "_env_bool",
    "_DEFAULT_APP_NAME",
    "_DEFAULT_APP_VERSION",
    "_DEFAULT_DATASET",
    "get_settings",
    # column mapping
    "REQUIRED_LOGICAL_COLUMNS",
    "COLUMN_ALIASES",
    "_strip_lookup",
    "resolve_column_mapping",
    # dataset validator
    "DatasetValidationError",
    "ValidationResult",
    "_ensure_file_exists",
    "_final_skill_count_coercible",
    "validate_jobs_dataset",
    "required_logical_columns",
    # skill profile building
    "extract_description_skill_hints",
    "build_job_skill_profile",
    # vocabulary
    "collect_canonical_vocabulary",
    "collect_dataset_skill_vocabulary",
    "build_global_skill_vocabulary",
    "vocabulary_for_cv_extraction",
    # service
    "JobDatasetService",
    "load_jobs_from_db",
]
