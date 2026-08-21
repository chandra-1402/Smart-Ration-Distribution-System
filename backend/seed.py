import os
from database import engine, Base, SessionLocal
import models
import bcrypt

def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

def seed_db():
    print("Creating tables...")
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    
    # Check if admin exists
    admin = db.query(models.Admin).filter(models.Admin.email == "admin@smartration.gov").first()
    if not admin:
        print("Seeding admin...")
        admin = models.Admin(
            email="admin@smartration.gov",
            password_hash=hash_password("admin123"),
            role="admin"
        )
        db.add(admin)
        
    # Seed beneficiaries
    beneficiaries_data = [
        {
            "beneficiary_id": "JH1001",
            "name": "Ramesh Kumar",
            "family_members": 4,
            "monthly_entitlement": 0.5,
            "collected_quantity": 0.0,
            "status": "Active"
        },
        {
            "beneficiary_id": "JH1002",
            "name": "Sita Devi",
            "family_members": 2,
            "monthly_entitlement": 0.5,
            "collected_quantity": 0.0,
            "status": "Active"
        },
        {
            "beneficiary_id": "JH1003",
            "name": "Mohan Das",
            "family_members": 5,
            "monthly_entitlement": 0.5,
            "collected_quantity": 0.0,
            "status": "Active"
        },
        {
            "beneficiary_id": "JH1004",
            "name": "Sunita Devi",
            "family_members": 3,
            "monthly_entitlement": 0.5,
            "collected_quantity": 0.0,
            "status": "Active"
        }
    ]
    
    for b_data in beneficiaries_data:
        existing = db.query(models.Beneficiary).filter(models.Beneficiary.beneficiary_id == b_data["beneficiary_id"]).first()
        if not existing:
            print(f"Seeding beneficiary {b_data['beneficiary_id']}...")
            new_b = models.Beneficiary(**b_data)
            db.add(new_b)
            
    db.commit()
    db.close()
    print("Database seeding complete.")

if __name__ == "__main__":
    seed_db()
