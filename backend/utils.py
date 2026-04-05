"""Text normalization helpers safe for pandas nulls and messy CSV fields."""

from __future__ import annotations

import math
import re
from typing import Any


def normalize_whitespace(text: str) -> str:
    """Collapse internal whitespace to single spaces and strip ends."""
    collapsed = re.sub(r"\s+", " ", text)
    return collapsed.strip()


def safe_lower(text: str) -> str:
    """Return lowercase text after whitespace normalization."""
    return normalize_whitespace(text).lower()


def clean_optional_text(value: Any) -> str:
    """
    Convert a cell value to a clean string.

    Treats None, NaN, float('nan'), and empty strings as empty output.
    """
    if value is None:
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    if hasattr(value, "item"):
        try:
            value = value.item()
        except (ValueError, AttributeError):
            pass
    text = str(value).strip()
    if text.lower() in {"", "nan", "none", "<na>"}:
        return ""
    return normalize_whitespace(text)


def split_pipe_values(value: str) -> list[str]:
    """
    Split a pipe-delimited string into trimmed, non-empty parts.

    Empty input or all-empty segments yield an empty list.
    """
    if not value or not str(value).strip():
        return []
    parts: list[str] = []
    for segment in str(value).split("|"):
        cleaned = clean_optional_text(segment)
        if cleaned:
            parts.append(cleaned)
    return parts
