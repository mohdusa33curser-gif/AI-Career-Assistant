import random
from database.connection import SessionLocal
from models.orm import Job

db = SessionLocal()

jobs = db.query(Job).all()

for job in jobs:

    # -------- EXPERIENCE --------
    r = random.random()
    if r < 0.3:
        job.experience_level = "Junior"
    elif r < 0.7:
        job.experience_level = "Mid"
    else:
        job.experience_level = "Senior"

    # -------- DEMAND --------
    r = random.random()
    if r < 0.4:
        job.demand_level = "High"
    elif r < 0.8:
        job.demand_level = "Medium"
    else:
        job.demand_level = "Low"

    # -------- SALARY --------
    r = random.random()
    if r < 0.3:
        job.salary_level = "High"
    elif r < 0.8:
        job.salary_level = "Medium"
    else:
        job.salary_level = "Low"

db.commit()
db.close()

print("Data rebalanced successfully")