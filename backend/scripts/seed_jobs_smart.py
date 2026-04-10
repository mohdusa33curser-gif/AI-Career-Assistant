import pandas as pd
import re
from datetime import datetime, timezone

from database.connection import SessionLocal
from models.orm import Job, Skill, JobSkill

CSV_PATH = "jobs.csv"

db = SessionLocal()
df = pd.read_csv(CSV_PATH)

print("Columns:", df.columns.tolist())


def parse_experience(text):
    if pd.isna(text) or not text:
        return "Mid"

    text = str(text).lower()

    if "junior" in text or "entry" in text or "0-1" in text or "0–1" in text:
        return "Junior"
    if "senior" in text or "lead" in text or "principal" in text:
        return "Senior"

    numbers = re.findall(r"\d+", text)
    if numbers:
        years = int(numbers[0])
        if years <= 2:
            return "Junior"
        elif years <= 5:
            return "Mid"
        else:
            return "Senior"

    return "Mid"


def parse_demand(text):
    if pd.isna(text) or not text:
        return "Medium"

    text = str(text).lower()

    if "high" in text or "growing" in text or "strong" in text:
        return "High"
    if "low" in text or "declining" in text or "weak" in text:
        return "Low"

    return "Medium"


def parse_salary(text):
    if pd.isna(text) or not text:
        return ("Medium", None, None)

    text = str(text)
    numbers = re.findall(r"\d+", text.replace(",", ""))

    if len(numbers) >= 2:
        salary_min = int(numbers[0])
        salary_max = int(numbers[1])
        avg = (salary_min + salary_max) / 2

        if avg >= 10000:
            level = "High"
        elif avg >= 5000:
            level = "Medium"
        else:
            level = "Low"

        return (level, salary_min, salary_max)

    return ("Medium", None, None)


def parse_skills(skill_text):
    if pd.isna(skill_text) or not skill_text:
        return []

    raw = str(skill_text).replace("|", ",").replace(";", ",").split(",")

    cleaned = []
    seen = set()

    for skill in raw:
        skill = skill.strip().lower()
        if skill and skill not in seen:
            seen.add(skill)
            cleaned.append(skill)

    return cleaned


def parse_priority(priority_text):
    if pd.isna(priority_text) or not priority_text:
        return []

    raw = str(priority_text).lower().replace("|", ",").replace(";", ",").split(",")

    cleaned = []
    for p in raw:
        p = p.strip()
        if "high" in p:
            cleaned.append("High")
        elif "low" in p:
            cleaned.append("Low")
        else:
            cleaned.append("Moderate")

    return cleaned


for _, row in df.iterrows():
    title = str(row.get("Job Title", "") or "").strip()
    description = str(row.get("ML Description", "") or "").strip()
    category = str(row.get("Category", "") or "").strip()

    experience_level = parse_experience(row.get("Experience"))
    demand_level = parse_demand(row.get("Job Trend"))
    salary_level, salary_min, salary_max = parse_salary(row.get("Salary Range"))

    job = Job(
        title=title,
        description=description,
        category=category,
        experience_level=experience_level,
        demand_level=demand_level,
        salary_level=salary_level,
        salary_min=salary_min,
        salary_max=salary_max,
        source="csv_import",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        is_active=True,
    )

    db.add(job)
    db.flush()

    skills = parse_skills(row.get("Core Skills"))
    priorities = parse_priority(row.get("Skill Priority Level"))

    for i, skill_name in enumerate(skills):
        existing_skill = db.query(Skill).filter_by(name=skill_name).first()

        if not existing_skill:
            existing_skill = Skill(name=skill_name)
            db.add(existing_skill)
            db.flush()

        priority = priorities[i] if i < len(priorities) else "Moderate"
        if priority not in ["High", "Moderate", "Low"]:
            priority = "Moderate"

        relation = JobSkill(
            job_id=job.id,
            skill_id=existing_skill.id,
            priority_level=priority,
        )
        db.add(relation)

db.commit()
db.close()

print("Smart data inserted successfully")