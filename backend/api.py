"""HTTP route definitions."""

from __future__ import annotations

import logging

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile

from models import (
    AnalyzeCVResponse,
    AnalyzeSkillsRequest,
    AnalyzeSkillsResponse,
    DatasetSummaryResponse,
    DebugJobPreviewResponse,
    HealthResponse,
    SampleSkillsVocabularyResponse,
    summary_to_response,
)
from services import (
    JobDatasetService,
    analyze_cv_skills,
    apply_skill_display_to_analysis_payload,
    canonicalize_skill,
    clean_cv_text,
    collect_canonical_vocabulary,
    display_label_for_canonical,
    extract_skills_from_cv_text,
    extract_text_from_pdf_bytes,
    get_settings,
    skill_labels_to_weight_map,
    vocabulary_sample_for_debug,
)

logger = logging.getLogger(__name__)

health_router = APIRouter(tags=["health"])
debug_router = APIRouter(prefix="/debug", tags=["debug"])
analyze_router = APIRouter(tags=["analyze"])
cv_router = APIRouter(tags=["cv"])


@health_router.get("/health", response_model=HealthResponse)
def read_health(request: Request) -> HealthResponse:
    """Return process health and whether the job dataset finished loading."""
    settings = get_settings()
    service: JobDatasetService | None = getattr(request.app.state, "dataset_service", None)
    loaded = bool(service and service.is_loaded())
    return HealthResponse(
        status="ok",
        app_name=settings.APP_NAME,
        version=settings.APP_VERSION,
        dataset_loaded=loaded,
    )


def _get_debug_service(request: Request) -> JobDatasetService:
    service: JobDatasetService | None = getattr(request.app.state, "dataset_service", None)
    if service is None or not service.is_loaded():
        raise HTTPException(status_code=503, detail="Dataset service is not available.")
    return service


@debug_router.get("/dataset-summary", response_model=DatasetSummaryResponse)
def read_dataset_summary(request: Request) -> DatasetSummaryResponse:
    """Return aggregate statistics for the loaded jobs CSV."""
    service = _get_debug_service(request)
    return summary_to_response(service.get_dataset_summary())


@debug_router.get("/sample-skills-vocabulary", response_model=SampleSkillsVocabularyResponse)
def read_sample_skills_vocabulary(request: Request) -> SampleSkillsVocabularyResponse:
    """Return dataset-derived canonical skill count and a sorted sample for CV matching checks."""
    service = _get_debug_service(request)
    vocab = collect_canonical_vocabulary(service.get_all_jobs())
    return SampleSkillsVocabularyResponse(
        total_skills=len(vocab),
        sample=vocabulary_sample_for_debug(vocab, limit=100),
    )


@debug_router.get("/job-previews", response_model=list[DebugJobPreviewResponse])
def read_job_previews(
    request: Request,
    limit: int = Query(default=5, ge=1, le=200, description="Maximum rows to return."),
) -> list[DebugJobPreviewResponse]:
    """Return a short preview of parsed job rows."""
    service = _get_debug_service(request)
    previews = service.get_job_previews(limit=limit)
    return [
        DebugJobPreviewResponse(
            job_title=j.job_title,
            category=j.category,
            parsed_skills=dict(j.parsed_skills),
            final_skill_count=j.final_skill_count,
        )
        for j in previews
    ]


def _dataset_service(request: Request) -> JobDatasetService:
    service: JobDatasetService | None = getattr(request.app.state, "dataset_service", None)
    if service is None or not service.is_loaded():
        raise HTTPException(status_code=503, detail="Job dataset is not loaded.")
    return service


@analyze_router.post("/analyze-skills", response_model=AnalyzeSkillsResponse)
def post_analyze_skills(
    body: AnalyzeSkillsRequest,
    request: Request,
) -> AnalyzeSkillsResponse:
    """
    Normalize skill labels, assign default weights, and run the analysis engine.

    Request body: {"skills": ["Python", "SQL", ...]}.
    """
    service = _dataset_service(request)
    jobs = service.get_all_jobs()
    job_embedding_lookup = service.get_job_embedding_lookup()

    weight_map = skill_labels_to_weight_map(body.skills)

    raw = analyze_cv_skills(
        weight_map,
        jobs,
        top_k=body.top_k,
        job_embedding_lookup=job_embedding_lookup,
    )

    display_payload = {
        **apply_skill_display_to_analysis_payload(
            {
                "skills": raw["skills"],
                "gaps": raw["gaps"],
                "top_jobs": raw["top_jobs"],
            }
        ),
        "recommendations": raw["recommendations"],
        "career_score": raw["career_score"],
    }

    return AnalyzeSkillsResponse.model_validate(display_payload)


@cv_router.post("/analyze-cv", response_model=AnalyzeCVResponse)
async def post_analyze_cv(
    request: Request,
    file: UploadFile = File(..., description="PDF curriculum vitae"),
    top_k: int = Query(10, ge=1, le=50, description="Number of top job matches to return."),
) -> AnalyzeCVResponse:
    """
    Accept a PDF, extract text, detect dataset vocabulary skills, then run the analyzer.
    """
    service = _dataset_service(request)
    jobs = service.get_all_jobs()
    job_embedding_lookup = service.get_job_embedding_lookup()

    name = (file.filename or "").strip()
    if not name.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF.")

    raw = await file.read()
    if not raw.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="Invalid PDF content.")

    try:
        pdf_text = extract_text_from_pdf_bytes(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    cleaned = clean_cv_text(pdf_text)
    extracted_canonical = extract_skills_from_cv_text(cleaned, jobs)
    weight_map = skill_labels_to_weight_map(extracted_canonical)

    result = analyze_cv_skills(
        weight_map,
        jobs,
        top_k=top_k,
        cv_text=cleaned,
        job_embedding_lookup=job_embedding_lookup,
    )

    recommendations = list(result["recommendations"])

    if not extracted_canonical:
        message = (
            "No recognizable technical skills were detected directly, "
            "so semantic CV understanding was used more heavily."
        )
    else:
        message = "Skills were successfully extracted and combined with semantic analysis."

    extracted_display = [display_label_for_canonical(skill) for skill in extracted_canonical]

    mapped = apply_skill_display_to_analysis_payload(
        {
            "skills": result["skills"],
            "gaps": result["gaps"],
            "top_jobs": result["top_jobs"],
        }
    )

    payload = {
        **mapped,
        "extracted_skills": extracted_display,
        "recommendations": recommendations,
        "career_score": result["career_score"],
        "message": message,
    }

    matched_keys = list(result.get("skills", {}).keys())
    logger.info(
        "analyze-cv skill-normalize-debug: raw_vocab_hits=%s canonical=%s matched_vector_keys=%s display=%s",
        extracted_canonical,
        [canonicalize_skill(x) for x in extracted_canonical],
        matched_keys,
        extracted_display,
    )

    top_jobs = result.get("top_jobs", [])
    top3_preview = [
        {
            "title": job.get("job_title"),
            "match_percent": job.get("match_percent"),
        }
        for job in top_jobs[:3]
    ]

    logger.info(
        "analyze-cv: extracted_skills=%s skill_count=%d top_3_job_matches=%s career_score=%.2f",
        extracted_display,
        len(extracted_display),
        top3_preview,
        float(result["career_score"]),
    )

    return AnalyzeCVResponse.model_validate(payload)
    