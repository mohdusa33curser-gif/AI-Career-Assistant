# Smart Career Analysis and Recommendation System — Backend (foundation)

This package is the first backend layer for the graduation project: configuration, CSV ingestion, validation, skill parsing, and minimal HTTP endpoints. It does not include CV upload, matching, or a database.

## What is implemented

- Pydantic-based settings (`APP_NAME`, `APP_VERSION`, `DEBUG`, `DATASET_PATH`)
- Jobs CSV loading with pandas and in-memory caching of `JobRecord` rows
- Structural validation (required columns, categories, parseable skill priorities, numeric final skill counts)
- Skill normalization seed map and `Skill Priority Level` parsing (`Python:High|SQL:Moderate`, and so on)
- Health and debug API routes

## Layout

```
backend/
├── main.py                 # App factory and lifespan (dataset load)
├── requirements.txt
├── README.md
├── .env.example
├── api/                    # Routers
├── core/                   # Settings and constants
├── models/                 # Domain models and response schemas
├── services/               # Loader, validator, skill parser
├── utils/                  # Text helpers
└── data/
    └── jobs.csv            # Final dataset (do not edit in code paths)
```

## Run the server

From the `backend` directory (so `data/jobs.csv` resolves correctly):

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Optional: copy `.env.example` to `.env` and set variables in your process environment (this project reads standard environment variables; use a tool of your choice to load `.env`).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness, app name, version, dataset loaded flag |
| GET | `/debug/dataset-summary` | Totals, category counts, skill stats, validation warnings |
| GET | `/debug/job-previews?limit=5` | Short preview of parsed jobs |

Interactive docs: `http://localhost:8000/docs`

## Dataset

The CSV is treated as read-only. Paths and quirks (synonyms, imbalance) are handled in application code, not by mutating the file.
