"""Package ``models``: domain types and SQLAlchemy ORM entities."""

from __future__ import annotations

from .domain import (
    JobRecord,
    DatasetSummary,
    CanonicalSkillProfile,
    SkillWeight,
    SkillEvidence,
    HealthResponse,
    DatasetSummaryResponse,
    DebugJobPreviewResponse,
    GapEntryResponse,
    RecommendationEntryResponse,
    JobGapSkillRow,
    TopJobAnalysisResponse,
    AnalyzeSkillsRequest,
    AnalyzeSkillsResponse,
    AnalyzeCVResponse,
    SampleSkillsVocabularyResponse,
    summary_to_response,
)
from .orm import Job, JobSkill, Skill

__all__ = [
    "JobRecord",
    "DatasetSummary",
    "CanonicalSkillProfile",
    "SkillWeight",
    "SkillEvidence",
    "HealthResponse",
    "DatasetSummaryResponse",
    "DebugJobPreviewResponse",
    "GapEntryResponse",
    "RecommendationEntryResponse",
    "JobGapSkillRow",
    "TopJobAnalysisResponse",
    "AnalyzeSkillsRequest",
    "AnalyzeSkillsResponse",
    "AnalyzeCVResponse",
    "SampleSkillsVocabularyResponse",
    "summary_to_response",
    "Job",
    "JobSkill",
    "Skill",
]
