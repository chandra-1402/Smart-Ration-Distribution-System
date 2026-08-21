from sqlalchemy import Column, Integer, String, Float, DateTime, Enum, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from database import Base

class BeneficiaryStatus(enum.Enum):
    ACTIVE = "Active"
    INACTIVE = "Inactive"

class TransactionStatus(enum.Enum):
    COMPLETED = "Completed"
    FAILED = "Failed"
    PENDING = "Pending"

class DispenseJobStatus(enum.Enum):
    DISPENSING = "DISPENSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    IDLE = "IDLE"

class Beneficiary(Base):
    __tablename__ = "beneficiaries"

    id = Column(Integer, primary_key=True, index=True)
    beneficiary_id = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    family_members = Column(Integer, nullable=False)
    monthly_entitlement = Column(Float, nullable=False)
    collected_quantity = Column(Float, default=0.0)
    status = Column(String, default=BeneficiaryStatus.ACTIVE.value)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    @property
    def remaining_quantity(self):
        return max(0.0, self.monthly_entitlement - self.collected_quantity)

class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(String, unique=True, index=True, nullable=False)
    beneficiary_id = Column(String, ForeignKey("beneficiaries.beneficiary_id"), nullable=False)
    target_quantity = Column(Float, nullable=False)
    actual_quantity = Column(Float, nullable=False)
    status = Column(String, default=TransactionStatus.COMPLETED.value)
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, default=datetime.utcnow)

class Admin(Base):
    __tablename__ = "admins"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="admin")
    created_at = Column(DateTime, default=datetime.utcnow)

class DispenseJob(Base):
    __tablename__ = "dispense_jobs"

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(String, unique=True, index=True, nullable=False)
    beneficiary_id = Column(String, ForeignKey("beneficiaries.beneficiary_id"), nullable=False)
    target_weight = Column(Float, nullable=False)
    current_weight = Column(Float, default=0.0)
    status = Column(String, default=DispenseJobStatus.IDLE.value)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
