"""Database URL from environment with a safe development default."""

from __future__ import annotations

import os

DEFAULT_DATABASE_URL = "postgresql://user:password@localhost:5432/careerlens"


def get_database_url() -> str:
    """Return PostgreSQL connection URL from ``DATABASE_URL`` or the default."""
    return os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL).strip()
