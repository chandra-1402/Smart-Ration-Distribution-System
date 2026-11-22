from database import SessionLocal
from models import Beneficiary, Transaction

db = SessionLocal()
print("Before update:")
for b in db.query(Beneficiary).all():
    print(f"{b.beneficiary_id}: {b.collected_quantity}")

db.query(Transaction).delete()
db.query(Beneficiary).update({"collected_quantity": 0.0})
db.commit()

print("After update:")
for b in db.query(Beneficiary).all():
    print(f"{b.beneficiary_id}: {b.collected_quantity}")

db.close()
