"""Backward-compatible re-export shim.

Business logic lives in:
  - skill_core.py   – canonical skill knowledge base
  - dataset.py      – settings, dataset loading, validation
  - matching.py     – scoring and gap analysis algorithms
  - cv_analysis.py  – CV text processing and analysis service
"""
from __future__ import annotations

# noqa: F401,F403 – all imports are intentional re-exports
from skill_core import *  # noqa: F401,F403
from dataset import *     # noqa: F401,F403
from matching import *    # noqa: F401,F403
from cv_analysis import * # noqa: F401,F403
