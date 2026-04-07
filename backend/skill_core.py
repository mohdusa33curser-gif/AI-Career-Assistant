"""Canonical skill knowledge base: vocabulary, alias maps, normalization, and parsing."""

from __future__ import annotations

import math
import re
from functools import lru_cache
from typing import Final

from utils import clean_optional_text, split_pipe_values


# ---------------------------------------------------------------------------
# Regex / text constants
# ---------------------------------------------------------------------------

SKILL_TOKEN_SPLIT_RE = re.compile(r"[|,/;]+")
MULTISPACE_RE = re.compile(r"\s+")
PARENS_RE = re.compile(r"\([^)]*\)")
NON_ALNUM_KEEP_TECH_RE = re.compile(r"[^a-zA-Z0-9\s\+\#\.\-]")

_PAREN: Final[re.Pattern[str]] = re.compile(r"\([^)]*\)")


# ---------------------------------------------------------------------------
# Skill app constants
# ---------------------------------------------------------------------------

SKILL_PRIORITY_WEIGHTS: Final[dict[str, int]] = {
    "High": 3,
    "Moderate": 2,
    "Low": 1,
}

"""Default weight for user-supplied skills when no job-specific priority is known."""
DEFAULT_USER_SKILL_WEIGHT: Final[int] = SKILL_PRIORITY_WEIGHTS["Moderate"]

SKILL_EXTRACTION_BLOCKLIST_LOWER: Final[frozenset[str]] = frozenset()


# ---------------------------------------------------------------------------
# Data dictionaries
# ---------------------------------------------------------------------------

GENERIC_NON_SKILL_TERMS = {
    "documentation",
    "technical documentation",
    "system",
    "systems",
    "project",
    "projects",
    "analysis",
    "development",
    "software development",
    "application development",
    "technical support",
    "communication",
    "teamwork",
    "leadership",
    "problem solving",
    "critical thinking",
}

# canonical form = what the backend should compare internally
SKILL_ALIAS_MAP: dict[str, str] = {
    # programming languages
    "cpp": "c++",
    "c plus plus": "c++",
    "c sharp": "c#",
    "cs": "c#",
    "py": "python",
    "golang": "go",
    "js": "javascript",
    "ts": "typescript",

    # frameworks / platforms
    "reactjs": "react",
    "react js": "react",
    "node": "node.js",
    "nodejs": "node.js",
    "node js": "node.js",
    "nextjs": "next.js",
    "next js": "next.js",
    "vuejs": "vue.js",
    "vue js": "vue.js",
    "angularjs": "angular",
    "dotnet": ".net",
    "net core": ".net",
    "asp net": "asp.net",
    "aspnet": "asp.net",

    # ai / data
    "ml": "machine learning",
    "dl": "deep learning",
    "nlp": "natural language processing",
    "cv": "computer vision",
    "ai": "artificial intelligence",
    "llm": "large language models",
    "genai": "generative ai",

    # cloud / devops
    "amazon web services": "aws",
    "aws cloud": "aws",
    "google cloud platform": "google cloud",
    "gcp": "google cloud",
    "azure cloud": "azure",
    "ci cd": "ci/cd",
    "cicd": "ci/cd",
    "docker containerization": "docker",

    # databases / backend
    "postgres": "postgresql",
    "mongo": "mongodb",
    "ms sql": "sql",
    "mysql db": "mysql",
    "nosql db": "nosql",

    # engineering variants
    "mat lab": "matlab",
    "pro engineer": "cad",
    "pro-engineer": "cad",
    "cad programming": "cad",
    "assembler": "assembly",
    "assembly language": "assembly",
    "asp.net mvc": "asp.net",
}

# some skills imply broader families
SKILL_FAMILY_MAP: dict[str, set[str]] = {
    "aws": {"cloud"},
    "google cloud": {"cloud"},
    "azure": {"cloud"},
    "docker": {"devops", "containerization"},
    "kubernetes": {"devops", "containerization"},
    "ci/cd": {"devops"},
    "tensorflow": {"machine learning", "deep learning", "ai"},
    "pytorch": {"machine learning", "deep learning", "ai"},
    "scikit-learn": {"machine learning", "ai"},
    "pandas": {"data analysis", "data"},
    "numpy": {"data analysis", "data"},
    "sql": {"databases", "data"},
    "postgresql": {"databases", "data"},
    "mysql": {"databases", "data"},
    "mongodb": {"databases", "nosql"},
    "react": {"frontend", "web development"},
    "angular": {"frontend", "web development"},
    "vue.js": {"frontend", "web development"},
    "node.js": {"backend", "web development"},
    "asp.net": {"backend", "web development"},
    "python": {"backend", "data", "ai"},
    "java": {"backend"},
    "c++": {"systems programming"},
    "assembly": {"embedded systems", "low-level programming"},
    "matlab": {"numerical computing"},
    "cad": {"engineering design"},
}

DESCRIPTION_HINT_PATTERNS: dict[str, tuple[str, ...]] = {
    "aws": (" aws ", "amazon web services"),
    "google cloud": (" google cloud ", "gcp", "google cloud platform"),
    "azure": (" azure ",),
    "docker": (" docker ", "containerization"),
    "kubernetes": (" kubernetes ", "k8s"),
    "react": (" react ", "reactjs"),
    "javascript": (" javascript ", " js "),
    "typescript": (" typescript ", " ts "),
    "python": (" python ",),
    "java": (" java ",),
    "c++": (" c++ ", " cpp "),
    "sql": (" sql ", "postgres", "mysql", "database design"),
    "machine learning": (" machine learning ", " ml "),
    "deep learning": (" deep learning ", " neural network "),
    "natural language processing": (" natural language processing ", " nlp "),
    "computer vision": (" computer vision ",),
    "tensorflow": (" tensorflow ",),
    "pytorch": (" pytorch ",),
    "kafka": (" kafka ",),
    "hadoop": (" hadoop ",),
    "cassandra": (" cassandra ",),
    "etl": (" etl ", " data pipeline ", " data pipelines "),
    "cad": (" cad ", "computer aided design"),
    "matlab": (" matlab ",),
    "assembly": (" assembler ", " assembly "),
}

SKILL_INFERENCE_RULES: dict[str, tuple[str, ...]] = {
    "machine learning": (
        "recommendation system",
        "recommendation engine",
        "predictive model",
        "classification model",
        "regression model",
        "model training",
        "feature engineering",
        "supervised learning",
        "unsupervised learning",
        "personalization",
        "ranking model",
    ),
    "data science": (
        "data mining",
        "statistical modeling",
        "predictive analytics",
        "experimentation",
        "ab testing",
        "a b testing",
        "forecasting",
    ),
    "data analysis": (
        "data cleaning",
        "data wrangling",
        "exploratory data analysis",
        "business insights",
        "analytics reporting",
        "trend analysis",
        "reporting dashboard",
    ),
    "data visualization": (
        "dashboard",
        "reporting dashboard",
        "interactive dashboard",
        "visual analytics",
        "data storytelling",
    ),
    "data pipelines": (
        "data pipeline",
        "etl pipeline",
        "data ingestion",
        "batch processing",
        "stream processing",
        "pipeline orchestration",
    ),
    "deep learning": (
        "neural network",
        "cnn",
        "convolutional neural network",
        "rnn",
        "lstm",
        "transformer model",
    ),
    "natural language processing": (
        "text classification",
        "text processing",
        "language model",
        "sentiment analysis",
        "named entity recognition",
        "chatbot",
    ),
    "computer vision": (
        "image classification",
        "object detection",
        "image segmentation",
        "video analytics",
    ),
    "aws": (
        "ec2",
        "s3",
        "lambda",
        "cloudwatch",
        "redshift",
        "iam",
        "amazon web services",
    ),
    "docker": (
        "containerization",
        "containerized",
        "dockerized",
        "containers",
    ),
    "kubernetes": (
        "cluster orchestration",
        "pods",
        "deployments",
        "helm",
        "k8s",
    ),
    "kafka": (
        "event streaming",
        "streaming platform",
        "message broker",
        "real time streaming",
    ),
    "spark": (
        "distributed processing",
        "distributed data processing",
        "big data processing",
    ),
    "sql": (
        "query optimization",
        "relational database",
        "database querying",
        "schema design",
    ),
    "etl": (
        "extract transform load",
        "data integration",
        "data transformation",
    ),
    "backend": (
        "rest api",
        "api development",
        "server side",
        "microservices",
        "backend services",
    ),
    "frontend": (
        "responsive ui",
        "user interface",
        "web interface",
        "frontend development",
    ),
}


# ---------------------------------------------------------------------------
# More constants
# ---------------------------------------------------------------------------

GENERIC_FAMILY_SKILLS: Final[frozenset[str]] = frozenset(
    {
        "frontend",
        "backend",
        "cloud",
        "devops",
        "data",
        "web development",
        "databases",
        "containerization",
        "server-side",
        "systems programming",
        "nosql",
    }
)

DISPLAY_HIDDEN_GENERIC_SKILLS: Final[frozenset[str]] = frozenset(
    {
        "frontend",
        "backend",
        "cloud",
        "devops",
        "data",
        "web development",
        "databases",
        "containerization",
        "server-side",
        "systems programming",
        "nosql",
        "engineering design",
        "numerical computing",
    }
)

CATEGORY_SIGNATURE_SKILLS: Final[dict[str, frozenset[str]]] = {
    "frontend": frozenset(
        {
            "react",
            "angular",
            "vue.js",
            "javascript",
            "typescript",
            "html",
            "css",
            "frontend",
            "web development",
            "next.js",
        }
    ),
    "backend": frozenset(
        {
            "python",
            "java",
            "node.js",
            "sql",
            "api",
            "microservices",
            "backend",
            "docker",
            "aws",
        }
    ),
    "full stack": frozenset(
        {
            "react",
            "javascript",
            "typescript",
            "node.js",
            "python",
            "sql",
            "frontend",
            "backend",
            "web development",
        }
    ),
    "data": frozenset(
        {
            "python",
            "sql",
            "data analysis",
            "data science",
            "etl",
            "spark",
            "hadoop",
            "kafka",
            "statistics",
            "data pipelines",
            "data visualization",
            "redshift",
        }
    ),
    "ai": frozenset(
        {
            "machine learning",
            "deep learning",
            "data science",
            "natural language processing",
            "computer vision",
            "tensorflow",
            "pytorch",
            "artificial intelligence",
            "python",
        }
    ),
    "devops": frozenset(
        {
            "aws",
            "docker",
            "kubernetes",
            "ci/cd",
            "linux",
            "cloud",
            "devops",
            "terraform",
        }
    ),
    "mobile": frozenset(
        {
            "kotlin",
            "swift",
            "react native",
            "flutter",
            "mobile",
        }
    ),
    "cybersecurity": frozenset(
        {
            "linux",
            "network security",
            "penetration testing",
            "cybersecurity",
            "python",
        }
    ),
}

_CANONICAL_DISPLAY: Final[dict[str, str]] = {
    "c++": "C++",
    "c#": "C#",
    ".net": ".NET",
    "node.js": "Node.js",
    "asp.net": "ASP.NET",
    "vue.js": "Vue.js",
    "machine learning": "Machine Learning",
    "artificial intelligence": "Artificial Intelligence",
    "natural language processing": "Natural Language Processing",
    "javascript": "JavaScript",
    "typescript": "TypeScript",
    "python": "Python",
    "sql": "SQL",
    "aws": "AWS",
    "gcp": "GCP",
    "azure": "Azure",
    "google cloud": "GCP",
    "postgresql": "PostgreSQL",
    "mongodb": "MongoDB",
    "tensorflow": "TensorFlow",
    "pytorch": "PyTorch",
    "kubernetes": "Kubernetes",
    "docker": "Docker",
    "git": "Git",
    "linux": "Linux",
    "html": "HTML",
    "css": "CSS",
    "react": "React",
    "angular": "Angular",
    "java": "Java",
    "go": "Go",
    "php": "PHP",
    "ruby": "Ruby",
    "scala": "Scala",
    "swift": "Swift",
    "kotlin": "Kotlin",
    "rust": "Rust",
    "kafka": "Kafka",
    "redis": "Redis",
    "spark": "Spark",
    "hadoop": "Hadoop",
    "webpack": "Webpack",
    "sass": "Sass",
    "microservices": "Microservices",
    "ci/cd": "CI/CD",
}

# Built from SKILL_ALIAS_MAP
REVERSE_SKILL_ALIAS_MAP: dict[str, set[str]] = {}
for alias, canonical in SKILL_ALIAS_MAP.items():
    REVERSE_SKILL_ALIAS_MAP.setdefault(canonical, set()).add(alias)

skill_alias_map = SKILL_ALIAS_MAP


# ---------------------------------------------------------------------------
# Functions
# ---------------------------------------------------------------------------

def normalize_whitespace(value: str) -> str:
    return MULTISPACE_RE.sub(" ", value).strip()


def normalize_skill_surface(raw_skill: str) -> str:
    """
    Normalize a raw skill mention without destroying technical tokens.

    Examples:
    - ' ReactJS '     -> 'reactjs'
    - 'Node JS'       -> 'node js'
    - 'Assembler (...)' -> 'assembler'
    - 'C++'           -> 'c++'
    - 'ASP.Net'       -> 'asp.net'
    """
    if not raw_skill:
        return ""

    value = str(raw_skill).strip().lower()
    value = PARENS_RE.sub(" ", value)
    value = value.replace("_", " ").replace("/", " / ")
    value = value.replace("-", " ")
    value = NON_ALNUM_KEEP_TECH_RE.sub(" ", value)
    value = normalize_whitespace(value)

    # normalize a few common punctuation variants
    value = value.replace("node js", "nodejs")
    value = value.replace("react js", "reactjs")
    value = value.replace("next js", "nextjs")
    value = value.replace("vue js", "vuejs")
    value = value.replace("asp . net", "asp.net")
    value = value.replace("asp net", "aspnet")

    return value


def canonicalize_skill_name(raw_skill: str) -> str:
    """
    Convert any raw skill string into the canonical backend representation.

    This is the most important comparison layer.
    """
    base = normalize_skill_surface(raw_skill)
    if not base:
        return ""

    canonical = SKILL_ALIAS_MAP.get(base, base)

    # final cleanup
    canonical = canonical.strip().lower()

    if canonical in GENERIC_NON_SKILL_TERMS:
        return ""

    return canonical

def canonicalize_skill(raw_skill: str) -> str:
    """
    Backward-compatible alias for older code paths.
    """
    return canonicalize_skill_name(raw_skill)


def normalize_skill_name(skill: str) -> str:
    """
    Backward-compatible normalization entry point.
    """
    return canonicalize_skill_name(skill)


def display_label_for_canonical(canonical_skill: str) -> str:
    """
    Backward-compatible display helper for older code paths.
    """
    return prettify_skill_label(canonical_skill)


def prettify_skill_label(canonical_skill: str) -> str:
    """
    Convert canonical internal values into readable UI labels.

    Internal:
    - c++
    - machine learning
    - node.js

    Display:
    - C++
    - Machine Learning
    - Node.js
    """
    if not canonical_skill:
        return ""

    special = {
        "c++": "C++",
        "c#": "C#",
        "javascript": "JavaScript",
        "typescript": "TypeScript",
        "node.js": "Node.js",
        "react": "React",
        "vue.js": "Vue.js",
        "next.js": "Next.js",
        "asp.net": "ASP.NET",
        ".net": ".NET",
        "sql": "SQL",
        "aws": "AWS",
        "ci/cd": "CI/CD",
        "api": "API",
        "etl": "ETL",
        "nlp": "NLP",
        "ai": "AI",
        "cad": "CAD",
        "matlab": "MATLAB",
        "mongodb": "MongoDB",
        "postgresql": "PostgreSQL",
        "mysql": "MySQL",
        "hadoop": "Hadoop",
        "kafka": "Kafka",
        "cassandra": "Cassandra",
        "tensorflow": "TensorFlow",
        "pytorch": "PyTorch",
        "scikit-learn": "Scikit-learn",
        "google cloud": "Google Cloud",
    }

    if canonical_skill in special:
        return special[canonical_skill]

    return " ".join(word.capitalize() for word in canonical_skill.split())


def preprocess_skill_text(raw: str) -> str:
    """
    Lowercase, trim, collapse whitespace, normalize separators, strip parenthetical noise.

    Preserves meaningful tokens (C++, C#, .NET, Node.js, Vue.js, ASP.NET) before
    generic punctuation removal.
    """
    s = clean_optional_text(raw)
    if not s:
        return ""
    while True:
        n = _PAREN.sub("", s)
        n = re.sub(r"\s+", " ", n).strip()
        if n == s:
            break
        s = n
    s = s.lower().strip()
    s = re.sub(r"(?<=[a-z0-9])/(?=[a-z0-9])", " ", s)
    s = s.replace("node.js", "\x01N\x01")
    s = s.replace("vue.js", "\x01V\x01")
    s = s.replace("asp.net", "\x01A\x01")
    s = s.replace(".net", "\x01D\x01")
    s = re.sub(r"(?<=[a-z0-9])\.(?=[a-z0-9])", "", s)
    s = s.replace("\x01N\x01", "node.js")
    s = s.replace("\x01V\x01", "vue.js")
    s = s.replace("\x01A\x01", "asp.net")
    s = s.replace("\x01D\x01", ".net")
    s = re.sub(r"[-_]+", " ", s)
    s = re.sub(r"[^a-z0-9\s+#.+]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def parse_core_skills_raw(raw_value: str) -> set[str]:
    """
    Parse the Core Skills column into canonical skill names.

    Supports strings like:
    'Python|SQL|React'
    """
    if raw_value is None or (isinstance(raw_value, float) and math.isnan(raw_value)):
        return set()

    text = str(raw_value).strip()
    if not text:
        return set()

    parts = [part.strip() for part in SKILL_TOKEN_SPLIT_RE.split(text)]
    canonical_skills: set[str] = set()

    for part in parts:
        canonical = canonicalize_skill_name(part)
        if canonical:
            canonical_skills.add(canonical)

    return canonical_skills


def priority_label_to_weight(label: str) -> int:
    """
    Map a priority label to its numeric weight.

    Raises:
        ValueError: If the label is empty or not one of High, Moderate, Low
            (case-insensitive).
    """
    raw = clean_optional_text(label)
    if not raw:
        raise ValueError("Empty priority label")
    normalized = raw.strip().lower()
    for name, weight in SKILL_PRIORITY_WEIGHTS.items():
        if name.lower() == normalized:
            return weight
    raise ValueError(f"Unknown priority label: {label!r}")


def parse_skill_priority_pairs(raw_value: str) -> dict[str, int]:
    """
    Parse strings like ``Python:High|SQL:High|React:Moderate`` into a skill→weight map.

    Malformed segments are skipped. Duplicate skills keep the highest weight.
    Keys are :func:`~services.skill_normalization.canonicalize_skill` values so they
    align with CV-extracted skills.
    """
    text = clean_optional_text(raw_value)
    if not text:
        return {}

    result: dict[str, int] = {}
    for chunk in split_pipe_values(text):
        if ":" not in chunk:
            continue
        skill_part, priority_part = chunk.split(":", 1)
        skill_name = canonicalize_skill(skill_part)
        if not skill_name:
            continue
        try:
            weight = priority_label_to_weight(priority_part)
        except ValueError:
            continue
        prev = result.get(skill_name)
        if prev is None or weight > prev:
            result[skill_name] = weight
    return result


def extract_skill_names(parsed_skills: dict[str, int]) -> list[str]:
    """Return sorted unique skill names for stable downstream use."""
    return sorted(parsed_skills.keys())


def aliases_for_canonical_key(canon: str) -> frozenset[str]:
    """Lowercase search phrases for CV regex matching for a canonical key."""
    ck = canon.strip().lower()
    if not ck:
        return frozenset()
    out: set[str] = {ck}
    for alias, target in SKILL_ALIAS_MAP.items():
        if target == ck:
            out.add(alias.lower().strip())
    if " " in ck:
        out.add(ck.replace(" ", "-"))
        out.add(ck.replace(" ", ""))
    if "/" in ck:
        out.add(ck.replace("/", " "))
    return frozenset(p for p in out if p)


def _skill_surface_forms(canonical_skill: str) -> set[str]:
    """
    Build likely written forms for one canonical skill.
    """
    if not canonical_skill:
        return set()

    forms: set[str] = {
        canonical_skill,
        normalize_skill_surface(canonical_skill),
        normalize_skill_surface(prettify_skill_label(canonical_skill)),
    }

    for alias in REVERSE_SKILL_ALIAS_MAP.get(canonical_skill, set()):
        forms.add(normalize_skill_surface(alias))

    if canonical_skill == "c++":
        forms.update({"cpp", "c plus plus", "c++"})
    elif canonical_skill == "c#":
        forms.update({"c sharp", "c#"})
    elif canonical_skill == ".net":
        forms.update({"dotnet", ".net", "net core"})
    elif canonical_skill == "node.js":
        forms.update({"node", "nodejs", "node js", "node.js"})
    elif canonical_skill == "react":
        forms.update({"react", "reactjs", "react js"})
    elif canonical_skill == "javascript":
        forms.update({"javascript", "js"})
    elif canonical_skill == "typescript":
        forms.update({"typescript", "ts"})
    elif canonical_skill == "machine learning":
        forms.update({"machine learning", "ml"})
    elif canonical_skill == "artificial intelligence":
        forms.update({"artificial intelligence", "ai"})
    elif canonical_skill == "natural language processing":
        forms.update({"natural language processing", "nlp"})
    elif canonical_skill == "google cloud":
        forms.update({"gcp", "google cloud", "google cloud platform"})
    elif canonical_skill == "aws":
        forms.update({"aws", "amazon web services", "aws cloud"})
    elif canonical_skill == "asp.net":
        forms.update({"asp.net", "aspnet", "asp net", "asp.net mvc"})

    clean_forms = {normalize_skill_surface(form) for form in forms if normalize_skill_surface(form)}
    return clean_forms


def _priority_weight_to_label(weight: int) -> str:
    return {3: "high", 2: "moderate", 1: "low"}.get(int(weight), "moderate")


def apply_skill_display_to_analysis_payload(payload: dict) -> dict:
    """Map canonical skill keys in an analyze response dict to display labels."""
    out = dict(payload)
    skills = payload.get("skills")
    if isinstance(skills, dict):
        out["skills"] = {display_label_for_canonical(k): v for k, v in skills.items()}
    gaps = payload.get("gaps")
    if isinstance(gaps, list):
        out["gaps"] = [{**row, "skill": display_label_for_canonical(str(row.get("skill", "")))} for row in gaps]
    top_jobs = payload.get("top_jobs")
    if isinstance(top_jobs, list):
        out["top_jobs"] = [_display_top_job_row(j) for j in top_jobs]
    return out


def _display_top_job_row(job: dict) -> dict:
    j = dict(job)
    ps = job.get("parsed_skills")
    if isinstance(ps, dict):
        j["parsed_skills"] = {display_label_for_canonical(k): v for k, v in ps.items()}
    ga = job.get("gap_analysis")
    if isinstance(ga, dict):

        def rows(xs: list) -> list:
            return [{**e, "skill": display_label_for_canonical(str(e.get("skill", "")))} for e in xs]

        j["gap_analysis"] = {
            "strong": rows(ga.get("strong", [])),
            "partial": rows(ga.get("partial", [])),
            "missing": rows(ga.get("missing", [])),
        }
    return j


__all__ = [
    # regex / text constants
    "SKILL_TOKEN_SPLIT_RE",
    "MULTISPACE_RE",
    "PARENS_RE",
    "NON_ALNUM_KEEP_TECH_RE",
    "_PAREN",
    # skill app constants
    "SKILL_PRIORITY_WEIGHTS",
    "DEFAULT_USER_SKILL_WEIGHT",
    "SKILL_EXTRACTION_BLOCKLIST_LOWER",
    # data dictionaries
    "GENERIC_NON_SKILL_TERMS",
    "SKILL_ALIAS_MAP",
    "SKILL_FAMILY_MAP",
    "DESCRIPTION_HINT_PATTERNS",
    "SKILL_INFERENCE_RULES",
    # more constants
    "GENERIC_FAMILY_SKILLS",
    "DISPLAY_HIDDEN_GENERIC_SKILLS",
    "CATEGORY_SIGNATURE_SKILLS",
    "_CANONICAL_DISPLAY",
    # built from SKILL_ALIAS_MAP
    "REVERSE_SKILL_ALIAS_MAP",
    "skill_alias_map",
    # functions
    "normalize_whitespace",
    "normalize_skill_surface",
    "canonicalize_skill_name",
    "canonicalize_skill",
    "normalize_skill_name",
    "display_label_for_canonical",
    "prettify_skill_label",
    "preprocess_skill_text",
    "parse_core_skills_raw",
    "priority_label_to_weight",
    "parse_skill_priority_pairs",
    "extract_skill_names",
    "aliases_for_canonical_key",
    "_skill_surface_forms",
    "_priority_weight_to_label",
    "apply_skill_display_to_analysis_payload",
    "_display_top_job_row",
]
