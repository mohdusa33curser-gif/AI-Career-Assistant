from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from db.connection import Base


class Job(Base):
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String)
    description = Column(Text)
    category = Column(String)

    experience_level = Column(String)   # Junior / Mid / Senior
    demand_level = Column(String)       # High / Medium / Low
    salary_level = Column(String)       # High / Medium / Low
    salary_min = Column(Integer, nullable=True)
    salary_max = Column(Integer, nullable=True)

    source = Column(String, nullable=True)
    created_at = Column(DateTime)
    updated_at = Column(DateTime)
    is_active = Column(Boolean)

    job_skills = relationship("JobSkill", back_populates="job")

    def __repr__(self):
        return f"<Job(id={self.id}, title='{self.title}', category='{self.category}')>"


class Skill(Base):
    __tablename__ = "skills"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)

    jobs = relationship("JobSkill", back_populates="skill")

    def __repr__(self):
        return f"<Skill(id={self.id}, name='{self.name}')>"


class JobSkill(Base):
    __tablename__ = "job_skills"

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(Integer, ForeignKey("jobs.id"), nullable=False)
    skill_id = Column(Integer, ForeignKey("skills.id"), nullable=False)
    priority_level = Column(String(32), nullable=False)

    job = relationship("Job", back_populates="job_skills")
    skill = relationship("Skill", back_populates="jobs")

    def __repr__(self):
        return f"<JobSkill(job_id={self.job_id}, skill_id={self.skill_id}, priority='{self.priority_level}')>"