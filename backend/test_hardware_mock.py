import requests
import time
import sys

BASE_URL = "http://127.0.0.1:3001"

def simulate_esp32():
    print("ESP32 Hardware Simulator Started")
    print("Polling /api/hardware/sync every 1 second...\n")
    
    current_weight = 0.0
    
    try:
        while True:
            # 1. Send sync request to backend
            payload = {
                "device_id": "ESP32_01",
                "current_weight": current_weight
            }
            
            try:
                response = requests.post(f"{BASE_URL}/api/hardware/sync", json=payload)
                data = response.json()
            except Exception as e:
                print(f"Connection error: {e}")
                time.sleep(2)
                continue
                
            status = data.get("status", "IDLE")
            
            if status == "IDLE":
                print(f"[IDLE] Waiting for job... (Current weight: {current_weight}kg)")
                current_weight = 0.0 # reset scale when idle
                
            elif status == "DISPENSING":
                target = data.get("target_weight")
                job_id = data.get("job_id")
                print(f"[DISPENSING] Job: {job_id} | Target: {target}kg | Current: {current_weight}kg")
                
                # Simulate the load cell filling up (e.g. rice pouring in)
                current_weight += 0.10
                current_weight = round(current_weight, 2)
                
            elif status == "STOP":
                target = data.get("target_weight")
                print(f"[STOP] Target {target}kg reached! Closing Servo.")
                # The backend tells us to stop. We reset our loop.
                
            time.sleep(1) # Poll every 1 second
            
    except KeyboardInterrupt:
        print("\nSimulator stopped.")

if __name__ == "__main__":
    simulate_esp32()
