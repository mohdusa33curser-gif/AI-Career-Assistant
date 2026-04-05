"""FastAPI application entrypoint: wiring only, no business logic."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api import analyze_router, cv_router, debug_router, health_router
from services import JobDatasetService, get_settings

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Configure logging once and load the job dataset into memory."""
    settings = get_settings()
    if not logging.getLogger().handlers:
        logging.basicConfig(
            level=logging.DEBUG if settings.DEBUG else logging.INFO,
            format="%(levelname)s %(name)s %(message)s",
        )
    logger.info("Starting %s version %s", settings.APP_NAME, settings.APP_VERSION)
    service = JobDatasetService(settings)
    jobs = service.load_dataset()
    app.state.dataset_service = service
    path_display = service.resolved_dataset_path
    logger.info("Loaded %d job records from %s", len(jobs), path_display)
    yield
    logger.info("Application shutdown complete")


def create_app() -> FastAPI:
    """Build the FastAPI application with routers and metadata from settings."""
    settings = get_settings()
    application = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://127.0.0.1:5173",
            "http://localhost:5173",
            "http://127.0.0.1:3000",
            "http://localhost:3000",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.include_router(health_router)
    application.include_router(debug_router)
    application.include_router(analyze_router)
    application.include_router(cv_router)
    return application


app = create_app()
