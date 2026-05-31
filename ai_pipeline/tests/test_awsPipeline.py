import requests
import time
import json

# CONFIGURATION
SERVER_URL = "http://127.0.0.1:5000"
BUCKET_NAME = "eesa-pipeline-storage"  # Replace with your actual bucket
TEST_FILES = [
    "jobs/SEM. V COMP. AUGUST 2022.DEC 2022. JAN 2023..pdf" # Replace with your actual S3 key
]

def run_test():
    # 1. Check Health
    print("🏥 Checking server health...")
    try:
        resp = requests.get(f"{SERVER_URL}/health")
        print(f"   Status: {resp.status_code}")
        print(f"   Response: {resp.json()}")
    except Exception as e:
        print(f"❌ Server not running? {e}")
        return

    # 2. Submit Job
    print("\n🚀 Submitting AWS Batch Job...")
    payload = {
        "bucket": BUCKET_NAME,
        "files": TEST_FILES,
        "job_id": f"test-job-{int(time.time())}" # Generate unique ID
    }
    
    resp = requests.post(f"{SERVER_URL}/submit-aws", json=payload)
    data = resp.json()
    print(f"   Response: {json.dumps(data, indent=2)}")
    
    if not data.get("success"):
        print("❌ Submission failed")
        return

    job_id = data["job_id"]
    print(f"\n⏳ Tracking Job: {job_id}")

    # 3. Poll Status
    while True:
        status_resp = requests.get(f"{SERVER_URL}/status-aws/{job_id}")
        if status_resp.status_code != 200:
            print("   ❌ Error getting status")
            break
            
        status_data = status_resp.json().get("job", {})
        state = status_data.get("status", "unknown")
        processed = status_data.get("processed_files", 0)
        total = status_data.get("total_files", 0)
        
        # Print file details
        files = status_data.get("files", {})
        file_status_str = " | ".join([f"{f}: {info['stage']}" for f, info in files.items()])
        
        print(f"   Status: {state.upper()} [{processed}/{total}] - {file_status_str}")
        
        if state in ["completed", "failed", "completed_with_errors"]:
            print(f"\n✅ Job Finished with status: {state}")
            break
            
        time.sleep(5)

if __name__ == "__main__":
    run_test()