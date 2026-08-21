import os
from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List, Dict
import asyncio
from datetime import datetime

import models
from database import get_db

app = FastAPI(title="Smart Ration Distribution API")

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory store for active dispenses
active_dispenses: Dict[str, dict] = {}

# Hardware Mode config
HARDWARE_MODE = True
hardware_active_job: dict = None
last_hardware_sync_time = None
hardware_diagnostics: dict = {}

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                pass

manager = ConnectionManager()

# --- Simulation Service ---
async def simulation_task(job_id: str, target_weight: float, beneficiary_id: str):
    current_weight = 0.0
    active_dispenses[job_id] = {"target": target_weight, "current": current_weight, "status": "DISPENSING"}
    
    while current_weight < target_weight:
        # Simulate realistic weight increase (0.25kg every ~300ms)
        await asyncio.sleep(0.3)
        current_weight = round(min(current_weight + 0.25, target_weight), 2)
        active_dispenses[job_id]["current"] = current_weight
        
        # Broadcast update
        await manager.broadcast({
            "type": "weight:update",
            "payload": {
                "jobId": job_id,
                "beneficiaryId": beneficiary_id,
                "currentWeight": current_weight,
                "targetWeight": target_weight,
                "status": "DISPENSING"
            }
        })
        
        if active_dispenses.get(job_id, {}).get("status") == "STOPPED":
            break

    # Once completed
    if active_dispenses.get(job_id, {}).get("status") != "STOPPED":
        active_dispenses[job_id]["status"] = "COMPLETED"
        await manager.broadcast({
            "type": "weight:update",
            "payload": {
                "jobId": job_id,
                "beneficiaryId": beneficiary_id,
                "currentWeight": target_weight,
                "targetWeight": target_weight,
                "status": "COMPLETED"
            }
        })
        
        # Complete the transaction in the database
        db = next(get_db())
        try:
            # Create transaction
            txn = models.Transaction(
                transaction_id=job_id,
                beneficiary_id=beneficiary_id,
                target_quantity=target_weight,
                actual_quantity=target_weight,
                status=models.TransactionStatus.COMPLETED.value
            )
            db.add(txn)
            
            # Update beneficiary collected quantity
            beneficiary = db.query(models.Beneficiary).filter(models.Beneficiary.beneficiary_id == beneficiary_id).first()
            if beneficiary:
                beneficiary.collected_quantity += target_weight
                
            # Update job status
            job = db.query(models.DispenseJob).filter(models.DispenseJob.job_id == job_id).first()
            if job:
                job.status = models.DispenseJobStatus.COMPLETED.value
                job.current_weight = target_weight
                
            db.commit()
        except Exception as e:
            db.rollback()
            print(f"Error finalizing transaction: {e}")
        finally:
            db.close()


# --- Endpoints ---

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

@app.get("/api/dispense/status")
def get_dispense_status():
    return {
        "status": current_machine_status,
        "currentWeight": current_weight_dispensed,
        "targetWeight": current_target_weight,
        "beneficiaryId": current_beneficiary_id,
        "jobId": current_job_id
    }

from pydantic import BaseModel

class VerifyRequest(BaseModel):
    beneficiary_id: str

@app.post("/api/beneficiaries/verify")
def verify_beneficiary(req: VerifyRequest, db: Session = Depends(get_db)):
    beneficiary = db.query(models.Beneficiary).filter(
        models.Beneficiary.beneficiary_id == req.beneficiary_id
    ).first()
    
    if not beneficiary:
        raise HTTPException(status_code=404, detail="BENEFICIARY NOT FOUND")
        
    if beneficiary.status != models.BeneficiaryStatus.ACTIVE.value:
        raise HTTPException(status_code=400, detail="BENEFICIARY INACTIVE")
        
    remaining = beneficiary.remaining_quantity
    
    if remaining <= 0:
        raise HTTPException(status_code=400, detail="QUOTA EXHAUSTED")
        
    return {
        "beneficiary_id": beneficiary.beneficiary_id,
        "name": beneficiary.name,
        "family_members": beneficiary.family_members,
        "monthly_entitlement": beneficiary.monthly_entitlement,
        "collected_quantity": beneficiary.collected_quantity,
        "remaining_quantity": remaining
    }

class StartDispenseRequest(BaseModel):
    beneficiary_id: str

from fastapi import BackgroundTasks

@app.post("/api/dispense/start")
def start_dispensing(req: StartDispenseRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    beneficiary = db.query(models.Beneficiary).filter(
        models.Beneficiary.beneficiary_id == req.beneficiary_id
    ).first()
    
    if not beneficiary or beneficiary.remaining_quantity <= 0:
        raise HTTPException(status_code=400, detail="Cannot start dispense. Invalid beneficiary or quota exhausted.")
        
    target_weight = beneficiary.remaining_quantity
    job_id = f"TXN-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    
    # Create job in db
    new_job = models.DispenseJob(
        job_id=job_id,
        beneficiary_id=req.beneficiary_id,
        target_weight=target_weight,
        status=models.DispenseJobStatus.DISPENSING.value
    )
    db.add(new_job)
    db.commit()
    
    # Start simulation task or hardware handoff
    if not HARDWARE_MODE:
        background_tasks.add_task(simulation_task, job_id, target_weight, req.beneficiary_id)
    else:
        global hardware_active_job
        hardware_active_job = {
            "job_id": job_id,
            "target_weight": target_weight,
            "beneficiary_id": req.beneficiary_id,
            "beneficiary_name": beneficiary.name,
            "status": "DISPENSING"
        }
    
    return {"job_id": job_id, "target_weight": target_weight, "status": "DISPENSING"}

class HardwareSyncRequest(BaseModel):
    device_id: str
    current_weight: float
    sensors: dict = None

@app.post("/api/hardware/sync")
async def hardware_sync(req: HardwareSyncRequest, db: Session = Depends(get_db)):
    global hardware_active_job
    global last_hardware_sync_time
    global hardware_diagnostics
    
    # Update heartbeat timestamp
    last_hardware_sync_time = datetime.now()
    if req.sensors:
        hardware_diagnostics = req.sensors
    
    if not hardware_active_job:
        return {"status": "IDLE"}
        
    job_id = hardware_active_job["job_id"]
    target_weight = hardware_active_job["target_weight"]
    beneficiary_id = hardware_active_job["beneficiary_id"]
    beneficiary_name = hardware_active_job.get("beneficiary_name", "")
    
    # Broadcast current weight to frontend via WebSocket
    await manager.broadcast({
        "type": "weight:update",
        "payload": {
            "jobId": job_id,
            "beneficiaryId": beneficiary_id,
            "currentWeight": req.current_weight,
            "targetWeight": target_weight,
            "status": hardware_active_job["status"]
        }
    })
    
    # Check if job is completed
    if req.current_weight >= target_weight and hardware_active_job["status"] != "COMPLETED":
        hardware_active_job["status"] = "COMPLETED"
        
        # Broadcast final completion
        await manager.broadcast({
            "type": "weight:update",
            "payload": {
                "jobId": job_id,
                "beneficiaryId": beneficiary_id,
                "currentWeight": req.current_weight,
                "targetWeight": target_weight,
                "status": "COMPLETED"
            }
        })
        
        # Save transaction in DB
        try:
            txn = models.Transaction(
                transaction_id=job_id,
                beneficiary_id=beneficiary_id,
                target_quantity=target_weight,
                actual_quantity=req.current_weight,
                status=models.TransactionStatus.COMPLETED.value
            )
            db.add(txn)
            
            beneficiary = db.query(models.Beneficiary).filter(models.Beneficiary.beneficiary_id == beneficiary_id).first()
            if beneficiary:
                beneficiary.collected_quantity += req.current_weight
                
            job = db.query(models.DispenseJob).filter(models.DispenseJob.job_id == job_id).first()
            if job:
                job.status = models.DispenseJobStatus.COMPLETED.value
                job.current_weight = req.current_weight
                
            db.commit()
        except Exception as e:
            db.rollback()
            print(f"Error finalizing hardware transaction: {e}")
            
        # Stop dispensing and reset active job
        response = {"status": "STOP", "target_weight": target_weight, "job_id": job_id, "beneficiary_name": beneficiary_name}
        hardware_active_job = None
        return response
        
    return {
        "status": hardware_active_job["status"],
        "target_weight": target_weight,
        "job_id": job_id,
        "beneficiary_name": beneficiary_name
    }

class LoginRequest(BaseModel):
    email: str
    password: str

import bcrypt

@app.post("/api/auth/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    admin = db.query(models.Admin).filter(models.Admin.email == req.email).first()
    if not admin:
        raise HTTPException(status_code=401, detail="Invalid credentials")
        
    # Check password
    if not bcrypt.checkpw(req.password.encode('utf-8'), admin.password_hash.encode('utf-8')):
        raise HTTPException(status_code=401, detail="Invalid credentials")
        
    # In a real app we would generate a JWT token. For prototype, just return success.
    return {"token": "dummy_token_123", "role": admin.role}

@app.get("/api/dashboard/stats")
def get_dashboard_stats(db: Session = Depends(get_db)):
    total_beneficiaries = db.query(models.Beneficiary).count()
    
    # Transactions today (simplified for SQLite)
    today_txns = db.query(models.Transaction).filter(
        models.Transaction.status == models.TransactionStatus.COMPLETED.value
    ).all()
    
    today_count = len(today_txns)
    total_dispensed = sum(t.actual_quantity for t in today_txns)
    
    # Check Hardware Heartbeat
    machine_status = "ONLINE"
    if HARDWARE_MODE:
        global last_hardware_sync_time
        if last_hardware_sync_time:
            delta = (datetime.now() - last_hardware_sync_time).total_seconds()
            if delta >= 5.0:
                machine_status = "OFFLINE"
        else:
            machine_status = "OFFLINE"
    
    return {
        "total_beneficiaries": total_beneficiaries,
        "today_transactions": today_count,
        "ration_dispensed": total_dispensed,
        "machine_status": machine_status
    }

@app.get("/api/reports")
def get_reports(db: Session = Depends(get_db)):
    total_beneficiaries = db.query(models.Beneficiary).count()
    all_txns = db.query(models.Transaction).all()
    
    total_transactions = len(all_txns)
    successful_txns = len([t for t in all_txns if t.status == models.TransactionStatus.COMPLETED.value])
    rejected_txns = len([t for t in all_txns if t.status == models.TransactionStatus.FAILED.value])
    
    total_quantity = sum(t.actual_quantity for t in all_txns if t.status == models.TransactionStatus.COMPLETED.value)
    
    average_quantity = (total_quantity / successful_txns) if successful_txns > 0 else 0
    
    return {
        "total_beneficiaries": total_beneficiaries,
        "total_transactions": total_transactions,
        "total_quantity_dispensed": total_quantity,
        "successful_transactions": successful_txns,
        "rejected_transactions": rejected_txns,
        "average_quantity_dispensed": average_quantity
    }

@app.get("/api/beneficiaries")
def get_beneficiaries(db: Session = Depends(get_db)):
    beneficiaries = db.query(models.Beneficiary).all()
    return [{
        "id": b.id,
        "beneficiary_id": b.beneficiary_id,
        "name": b.name,
        "family_members": b.family_members,
        "monthly_entitlement": b.monthly_entitlement,
        "collected_quantity": b.collected_quantity,
        "remaining_quantity": b.remaining_quantity,
        "status": b.status
    } for b in beneficiaries]

class BeneficiaryCreateUpdate(BaseModel):
    beneficiary_id: str
    name: str
    family_members: int
    monthly_entitlement: float
    collected_quantity: float
    status: str

@app.post("/api/beneficiaries")
def create_beneficiary(req: BeneficiaryCreateUpdate, db: Session = Depends(get_db)):
    existing = db.query(models.Beneficiary).filter(models.Beneficiary.beneficiary_id == req.beneficiary_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Beneficiary ID already exists")
        
    new_b = models.Beneficiary(
        beneficiary_id=req.beneficiary_id,
        name=req.name,
        family_members=req.family_members,
        monthly_entitlement=req.monthly_entitlement,
        collected_quantity=req.collected_quantity,
        status=req.status
    )
    db.add(new_b)
    db.commit()
    return {"message": "Created successfully"}

@app.put("/api/beneficiaries/{id}")
def update_beneficiary(id: int, req: BeneficiaryCreateUpdate, db: Session = Depends(get_db)):
    b = db.query(models.Beneficiary).filter(models.Beneficiary.id == id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Not found")
        
    b.beneficiary_id = req.beneficiary_id
    b.name = req.name
    b.family_members = req.family_members
    b.monthly_entitlement = req.monthly_entitlement
    b.collected_quantity = req.collected_quantity
    b.status = req.status
    
    db.commit()
    return {"message": "Updated successfully"}

@app.get("/api/transactions")
def get_transactions(db: Session = Depends(get_db)):
    transactions = db.query(models.Transaction).order_by(models.Transaction.created_at.desc()).all()
    return [{
        "transaction_id": t.transaction_id,
        "beneficiary_id": t.beneficiary_id,
        "target_quantity": t.target_quantity,
        "actual_quantity": t.actual_quantity,
        "status": t.status,
        "created_at": t.created_at.isoformat(),
        "completed_at": t.completed_at.isoformat()
    } for t in transactions]

@app.delete("/api/transactions")
def clear_transactions(db: Session = Depends(get_db)):
    db.query(models.Transaction).delete()
    db.query(models.Beneficiary).update({"collected_quantity": 0.0})
    db.commit()
    return {"message": "All transactions cleared successfully"}

@app.get("/api/machine/status")
def get_machine_status():
    if HARDWARE_MODE:
        # Check if ESP32 has pinged in the last 5 seconds
        is_online = False
        if last_hardware_sync_time:
            delta = (datetime.now() - last_hardware_sync_time).total_seconds()
            if delta < 5.0:
                is_online = True
                
        if is_online:
            return {
                "status": "ONLINE",
                "mode": "HARDWARE",
                "components": {
                    "esp32": "Connected",
                    "arduino": "Connected",
                    "load_cell": "Active",
                    "servo": "Active"
                }
            }
        else:
            return {
                "status": "OFFLINE",
                "mode": "HARDWARE",
                "components": {
                    "esp32": "Disconnected",
                    "arduino": "Disconnected",
                    "load_cell": "Offline",
                    "servo": "Offline"
                }
            }
    else:
        return {
            "status": "ONLINE",
            "mode": "SIMULATION",
            "components": {
                "esp32": "Simulation Ready",
                "arduino": "Simulation Ready",
                "load_cell": "Simulation Active",
                "servo": "Simulation Active"
            }
        }

@app.get("/api/hardware/diagnostics")
def get_hardware_diagnostics():
    if not HARDWARE_MODE:
        return {
            "load_cell": {"status": "OK", "value": "Simulation Active"},
            "servo": {"status": "OK", "value": "Simulation Active"},
            "led_red": {"status": "OK", "value": "OFF"},
            "led_yellow": {"status": "OK", "value": "ON"},
            "led_green": {"status": "OK", "value": "OFF"},
            "lcd": {"status": "OK", "value": "Simulation Ready"}
        }
    return hardware_diagnostics

# Mount static files at the end
# Assuming frontend files are in ../frontend relative to backend
static_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/admin/{path:path}")
def serve_admin_app(path: str):
    return FileResponse(os.path.join(static_dir, "admin.html"))

@app.get("/admin")
def serve_admin_base():
    return FileResponse(os.path.join(static_dir, "admin.html"))
@app.get("/user")
def serve_user_app():
    return FileResponse(os.path.join(static_dir, "index.html"))

@app.get("/")
def serve_root():
    return FileResponse(os.path.join(static_dir, "index.html"))
