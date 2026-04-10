from database.connection import Base, engine

# Import all models so they are registered with Base
from models.orm import Job, Skill, JobSkill


def create_tables():
    print("Creating tables...")
    Base.metadata.create_all(bind=engine)
    print("Tables created successfully")


if __name__ == "__main__":
    create_tables()