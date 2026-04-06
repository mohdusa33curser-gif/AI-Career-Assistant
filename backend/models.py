"""Domain models and Pydantic API schemas."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Core dataset/domain models
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class SkillWeight:
    """A single skill with its numeric priority weight after parsing."""
    
    skill: str
    weight: int


@dataclass(frozen=True)
class SkillEvidence:
    """
    One detected hint for a skill.

    This will be used later by the smarter CV parsing pipeline so we can
    distinguish between:
    - exact hits from the CV
    - alias-based hits
    - description-derived hints
    """

    canonical_skill: str
    matched_text: str
    source: str  # e.g. "cv_exact", "cv_alias", "job_core", "job_description"
    confidence: float = 1.0


@dataclass
class CanonicalSkillProfile:
    """
    Unified skill representation used internally by the backend.

    Why this exists:
    - current project compares too much on raw strings
    - later we need one merged view for each job and each CV
    - this lets us combine priority skills + core skills + description hints
      without breaking current API shape
    """

    weighted_skills: dict[str, int] = field(default_factory=dict)
    aliases: dict[str, str] = field(default_factory=dict)
    families: dict[str, set[str]] = field(default_factory=dict)
    evidence: list[SkillEvidence] = field(default_factory=list)

    def all_skills(self) -> set[str]:
        return set(self.weighted_skills.keys())

    def max_weight(self) -> int:
        return max(self.weighted_skills.values(), default=0)

    def add_skill(
        self,
        canonical_skill: str,
        weight: int = 1,
        *,
        source: str = "unknown",
        matched_text: str | None = None,
        confidence: float = 1.0,
    ) -> None:
        canonical_skill = canonical_skill.strip()
        if not canonical_skill:
            return

        current = self.weighted_skills.get(canonical_skill, 0)
        if weight > current:
            self.weighted_skills[canonical_skill] = weight

        self.evidence.append(
            SkillEvidence(
                canonical_skill=canonical_skill,
                matched_text=matched_text or canonical_skill,
                source=source,
                confidence=confidence,
            )
        )

    def merge_from(self, other: "CanonicalSkillProfile") -> None:
        for skill, weight in other.weighted_skills.items():
            self.add_skill(skill, weight=weight, source="merged")
        for alias, canonical in other.aliases.items():
            self.aliases[alias] = canonical
        for family, skills in other.families.items():
            if family not in self.families:
                self.families[family] = set()
            self.families[family].update(skills)
        self.evidence.extend(other.evidence)


@dataclass
class JobRecord:
    """One fully processed row from the jobs dataset."""

    job_title: str
    category: str
    description: str
    ui_description: str
    core_skills_raw: str
    skill_priority_raw: str

    # current active field used by the project today
    parsed_skills: dict[str, int]

    soft_skills: list[str]
    education: str
    experience: str
    salary_range: str
    job_trend: str
    final_skill_count: int | None
    source_row_index: int = 0

    # ------------------------------------------------------------------
    # New fields for the next backend intelligence upgrade
    # These all have defaults so existing code will NOT break.
    # ------------------------------------------------------------------
    core_skills_canonical: set[str] = field(default_factory=set)
    description_skill_hints: set[str] = field(default_factory=set)
    merged_skill_profile: CanonicalSkillProfile = field(default_factory=CanonicalSkillProfile)

    def effective_skill_weights(self) -> dict[str, int]:
        """
        Safe merged skill map.

        For now, if merged_skill_profile has data we prefer it.
        Otherwise we fall back to parsed_skills so the current logic keeps working.
        """
        if self.merged_skill_profile.weighted_skills:
            return dict(self.merged_skill_profile.weighted_skills)
        return dict(self.parsed_skills)

    def effective_skill_keys(self) -> set[str]:
        return set(self.effective_skill_weights().keys())


@dataclass
class DatasetSummary:
    """Aggregate statistics for the loaded and validated dataset."""

    total_jobs: int
    category_distribution: dict[str, int]
    unique_skill_count: int
    average_skill_count: float
    warnings_count: int
    dataset_path: Path
    validation_warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# API response / request schemas
# ---------------------------------------------------------------------------

class HealthResponse(BaseModel):
    """Service liveness and build metadata."""

    status: str = Field(description="Typically 'ok' when the API process is healthy.")
    app_name: str
    version: str
    dataset_loaded: bool = Field(
        description="True if the jobs CSV was loaded successfully at startup."
    )


class DatasetSummaryResponse(BaseModel):
    """Public view of dataset aggregates for debugging."""

    total_jobs: int
    category_distribution: dict[str, int]
    unique_skill_count: int
    average_skill_count: float
    warnings_count: int
    dataset_path: str
    validation_warnings: list[str] = Field(default_factory=list)


class DebugJobPreviewResponse(BaseModel):
    """Subset of job fields exposed for pipeline debugging."""

    job_title: str
    category: str
    parsed_skills: dict[str, int]
    final_skill_count: int | None


def summary_to_response(summary: DatasetSummary) -> DatasetSummaryResponse:
    """Map internal DatasetSummary to API schema."""
    return DatasetSummaryResponse(
        total_jobs=summary.total_jobs,
        category_distribution=dict(summary.category_distribution),
        unique_skill_count=summary.unique_skill_count,
        average_skill_count=summary.average_skill_count,
        warnings_count=summary.warnings_count,
        dataset_path=str(summary.dataset_path),
        validation_warnings=list(summary.validation_warnings),
    )


class GapEntryResponse(BaseModel):
    """Aggregated gap across top-matching roles."""

    skill: str
    status: str
    job_weight: int
    user_weight: int


class RecommendationEntryResponse(BaseModel):
    """Human-readable recommendation line."""

    title: str
    description: str
    priority: float


class JobGapSkillRow(BaseModel):
    """Single skill classification inside a job gap block."""

    skill: str
    job_weight: int
    user_weight: int


class TopJobAnalysisResponse(BaseModel):
    """One ranked job with coverage score and per-job gap breakdown."""

    job_title: str
    category: str
    match_percent: float
    parsed_skills: dict[str, int]
    gap_analysis: dict[str, list[JobGapSkillRow]]
    source_row_index: int
    final_skill_count: int | None


class AnalyzeSkillsRequest(BaseModel):
    """Plain skill labels from the client; weights default server-side."""

    skills: list[str]
    top_k: int = Field(default=10, ge=1, le=50, description="Number of top job matches to return.")


class AnalyzeSkillsResponse(BaseModel):
    """Full skill–job intelligence payload."""

    skills: dict[str, int]
    top_jobs: list[TopJobAnalysisResponse]
    gaps: list[GapEntryResponse]
    recommendations: list[RecommendationEntryResponse]
    career_score: float


class AnalyzeCVResponse(BaseModel):
    """Résumé upload pipeline: extracted skills plus the same analysis shape as /analyze-skills."""

    extracted_skills: list[str]
    skills: dict[str, int]
    top_jobs: list[TopJobAnalysisResponse]
    gaps: list[GapEntryResponse]
    recommendations: list[RecommendationEntryResponse]
    career_score: float
    message: str | None = None


class SampleSkillsVocabularyResponse(BaseModel):
    """Debug: dataset-derived skill vocabulary size and a lexicographic sample."""

    total_skills: int
    sample: list[str]