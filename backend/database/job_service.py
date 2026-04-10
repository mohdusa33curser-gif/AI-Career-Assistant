"""Database-backed job queries (isolated from CSV and matching logic)."""

from __future__ import annotations

from typing import List, Optional

from sqlalchemy import Select, or_, select
from sqlalchemy.orm import Session, selectinload

from models.orm import Job, JobSkill, Skill


class JobService:
    """Read-side operations for persisted ``Job`` rows."""

    _MAX_LIMIT = 100
    _SEARCH_RESULT_CAP = 500

    def _apply_pagination(self, stmt: Select[tuple[Job]], page: int, limit: int) -> Select[tuple[Job]]:
        safe_page = max(page, 1)
        safe_limit = min(max(limit, 1), self._MAX_LIMIT)
        offset = (safe_page - 1) * safe_limit
        return stmt.offset(offset).limit(safe_limit)

    def get_jobs(
        self,
        db: Session,
        category: Optional[str] = None,
        min_salary: Optional[int] = None,
        page: int = 1,
        limit: int = 20,
    ) -> List[Job]:
        stmt = select(Job)
        if category is not None:
            stmt = stmt.where(Job.category == category)
        if min_salary is not None:
            stmt = stmt.where(Job.salary_min >= min_salary)
        stmt = self._apply_pagination(stmt, page, limit)
        stmt = stmt.order_by(Job.id)
        return list(db.scalars(stmt).all())

    def search_jobs(self, db: Session, query: str) -> List[Job]:
        term = query.strip()
        if not term:
            return []
        pattern = f"%{term}%"
        stmt = (
            select(Job)
            .where(
                or_(
                    Job.title.ilike(pattern),
                    Job.description.ilike(pattern),
                )
            )
            .order_by(Job.id)
            .limit(self._SEARCH_RESULT_CAP)
        )
        return list(db.scalars(stmt).all())

    def get_job_by_id(self, db: Session, job_id: int) -> Optional[Job]:
        stmt = (
            select(Job)
            .where(Job.id == job_id)
            .options(
                selectinload(Job.job_skills).selectinload(JobSkill.skill),
            )
        )
        return db.scalars(stmt).first()

    def get_jobs_with_skills(
        self,
        db: Session,
        category: Optional[str] = None,
        min_salary: Optional[int] = None,
        page: int = 1,
        limit: int = 20,
    ) -> List[Job]:
        stmt = select(Job).options(
            selectinload(Job.job_skills).selectinload(JobSkill.skill),
        )
        if category is not None:
            stmt = stmt.where(Job.category == category)
        if min_salary is not None:
            stmt = stmt.where(Job.salary_min >= min_salary)
        stmt = self._apply_pagination(stmt, page, limit)
        stmt = stmt.order_by(Job.id)
        return list(db.scalars(stmt).all())
