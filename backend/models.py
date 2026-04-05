"""Domain models and Pydantic API schemas."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from pydantic import BaseModel, Field


@dataclass(frozen=True)
class SkillWeight:
    """A single skill with its numeric priority weight after parsing."""

    skill: str
    weight: int


@dataclass
class JobRecord:
    """One fully processed row from the jobs dataset."""

    job_title: str
    category: str
    description: str
    ui_description: str
    core_skills_raw: str
    skill_priority_raw: str
    parsed_skills: dict[str, int]
    soft_skills: list[str]
    education: str
    experience: str
    salary_range: str
    job_trend: str
    final_skill_count: int | None
    source_row_index: int = 0


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


class HealthResponse(BaseModel):
    """Service liveness and build metadata."""

    status: str = Field(description="Typically 'ok' when the API process is healthy.")
    app_name: str
    version: str
    dataset_loaded: bool = Field(description="True if the jobs CSV was loaded successfully at startup.")


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
    """Résumé upload pipeline: extracted skills plus the same analysis shape as ``/analyze-skills``."""

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
