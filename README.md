# Smart Ration Distribution & Anti-Diversion System

## 1. Project Overview
This project is a prototype web application designed for a Smart Ration Distribution System. The system digitally verifies a beneficiary using their Aadhaar/Beneficiary ID, automatically calculates their remaining entitlement based on monthly quotas, and simulates the hardware dispensing process via WebSockets.

## 2. Features
- **Strict Entitlement Enforcement**: Beneficiaries cannot manually request quantities. The system automatically computes `Remaining = Monthly Entitlement - Already Collected`.
- **Hardware Simulation Layer**: Simulates real-time weight increments mimicking an ESP32, Load Cell, and Servo motor.
- **Live UI Updates**: Uses WebSockets to broadcast live simulated weight updates to the frontend without page reloads.
- **Admin Dashboard**: Comprehensive portal for monitoring total transactions, beneficiaries, and system status.
- **Reporting**: Tracks total dispensed quantities and transaction statuses.

## 3. Architecture
The architecture is divided into two distinct parts:
- **Frontend**: Vanilla HTML/CSS/JS (No framework).
- **Backend**: Python (FastAPI) handling HTTP REST APIs and WebSockets.
- **Database**: SQLite.
- **Simulation**: Background async tasks in FastAPI broadcast mock load cell data to the frontend.

*Future*: The simulation layer can be swapped out to read incoming data from an actual ESP32/Arduino via Serial or WebSockets without touching the frontend logic.

## 4. Technology Stack
- HTML5, Vanilla CSS, Vanilla JavaScript
- Python 3, FastAPI, Uvicorn, WebSockets
- SQLAlchemy, SQLite
- passlib, bcrypt

## 5. Folder Structure
```
.
├── backend
│   ├── database.py       # Database connection
│   ├── main.py           # FastAPI server and endpoints
│   ├── models.py         # SQLAlchemy DB models
│   └── seed.py           # Seed script for dummy data
├── database
│   └── database.sqlite   # SQLite file
├── frontend
│   ├── admin.css         # Admin styling
│   ├── admin.html        # Admin application
│   ├── admin.js          # Admin logic
│   ├── app.js            # User portal logic
│   ├── index.html        # User application
│   └── style.css         # User portal styling
└── README.md
```

## 6. Installation
1. Clone the repository.
2. Ensure you have Python 3 installed.
3. Open a terminal in the project root:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install fastapi uvicorn websockets sqlalchemy bcrypt
   ```

## 7. Environment Variables
For this prototype, everything is configured out of the box using a local SQLite database. In production, provide a `.env` file for:
- `DATABASE_URL` (e.g., PostgreSQL connection string)
- `JWT_SECRET`
- `ADMIN_SEED_PASSWORD`

## 8. Database Setup
To set up and seed the database with demo accounts:
```bash
cd backend
python seed.py
```

## 9. Running Frontend
The frontend files are automatically served as static files by the FastAPI backend. You do not need to run a separate frontend server.

## 10. Running Backend
From the project root:
```bash
source venv/bin/activate
cd backend
uvicorn main:app --port 3001 --reload
```
Access the application at `http://localhost:3001/` and the admin portal at `http://localhost:3001/admin`.

## 11. Simulation Mode
The backend (`main.py`) implements `simulation_task(job_id, target_weight, beneficiary_id)`. When dispensing is triggered, it artificially increments the current weight and broadcasts it via WebSocket (`/ws`) to the connected frontend clients. The transaction is committed to the database when the simulated weight reaches the target.

## 12. Demo Accounts
**Admin Login**:
- **Email**: `admin@smartration.gov`
- **Password**: `admin123`

## 13. Demo Beneficiary IDs
Use these IDs in the User Portal to simulate verifications:
- `JH1001` - Ramesh Kumar (Has quota remaining)
- `JH1002` - Sita Devi (Has quota remaining)
- `JH1003` - Mohan Das (Quota Exhausted - tests rejection)
- `JH1004` - Sunita Devi (Has quota remaining)
- `JH9999` - Not Found (Tests invalid IDs)

## 14. API Documentation
FastAPI provides automatic API documentation. 
While the server is running, navigate to:
- Swagger UI: `http://localhost:3001/docs`
- ReDoc: `http://localhost:3001/redoc`

## 15. Future ESP32 Integration
To integrate the physical hardware (ESP32/Arduino UNO + Load Cell + Servo):
1. Create a new `HardwareService` in the backend that listens for incoming HTTP POSTs or WebSocket messages from the ESP32.
2. The ESP32 will read from the HX711/Load Cell and broadcast the weight continuously to the backend.
3. The backend will forward these exact weight updates to the frontend over the existing `/ws` channel.
4. The frontend UI remains unchanged as it is already built to consume real-time WebSocket payloads.
