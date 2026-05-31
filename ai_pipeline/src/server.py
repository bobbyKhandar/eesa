"""
AI Pipeline Server - Unified HTTP server for Local and AWS pipelines
Provides REST API for batch processing requests
"""

import sys
import os
import uuid
import threading
import time
import json
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional, List
from flask import Flask, request, jsonify

# Add current directory to Python path for imports
current_dir = Path(__file__).parent
sys.path.insert(0, str(current_dir))

# --- Import Local Pipeline ---
try:
    from .pipeline_manager import pipeline_manager
except ImportError:
    try:
        from pipeline_manager import pipeline_manager
    except ImportError:
        print("⚠ Warning: Local pipeline_manager not found. Local routes may fail.")
        pipeline_manager = None

# --- Import AWS Pipeline Modules ---
# These imports correspond to the files you uploaded
try:
    import aws_texttract_pipeline
    import parsing_pipeline
    import enrich_questions_job_based
    import organize_by_subject_job_based
except ImportError as e:
    print(f"❌ Error importing AWS pipeline modules: {e}")
    sys.exit(1)


class AWSPipelineManager:
    """
    Orchestrator for the AWS-based AI Pipeline.
    Manages the lifecycle: Textract -> Parsing -> Enrichment -> Organization
    """
    def __init__(self):
        self.jobs: Dict[str, Dict] = {}
        self.lock = threading.Lock()
        
        # Define the pipeline stages in order
        self.stages = [
            "queued",
            "ocr_textract", 
            "parsing_bedrock", 
            "enrichment_bedrock", 
            "organization_s3",
            "completed"
        ]

    def submit_job(self, bucket: str, files: List[str], job_id: Optional[str] = None) -> str:
        """
        Submit a new batch job for AWS processing.
        """
        if not job_id:
            job_id = str(uuid.uuid4())
            
        with self.lock:
            self.jobs[job_id] = {
                "status": "queued",
                "submitted_at": datetime.now().isoformat(),
                "bucket": bucket,
                "total_files": len(files),
                "processed_files": 0,
                "files": {
                    f: {"status": "queued", "stage": "queued", "error": None} 
                    for f in files
                },
                "summary": {}
            }
        
        # Start processing in background thread
        thread = threading.Thread(
            target=self._process_batch,
            args=(job_id, bucket, files),
            daemon=True
        )
        thread.start()
        
        return job_id

    def get_job_status(self, job_id: str) -> Optional[Dict]:
        """Get the current status of a job."""
        with self.lock:
            return self.jobs.get(job_id)

    def _update_file_status(self, job_id: str, filename: str, stage: str, status: str = "in_progress", error: str = None):
        """Helper to update the status of a specific file within a job."""
        with self.lock:
            if job_id in self.jobs:
                self.jobs[job_id]["files"][filename]["stage"] = stage
                self.jobs[job_id]["files"][filename]["status"] = status
                if error:
                    self.jobs[job_id]["files"][filename]["error"] = error
                self.jobs[job_id]["last_updated"] = datetime.now().isoformat()

    def _process_batch(self, job_id: str, bucket: str, files: List[str]):
        """
        Background worker that runs the 4-stage pipeline for each file.
        """
        print(f"🚀 Starting AWS Batch Job: {job_id} ({len(files)} files)")
        
        with self.lock:
            self.jobs[job_id]["status"] = "processing"

        for full_s3_key in files:
            # We use the basename (e.g., "doc1.pdf") for tracking across stages
            # because intermediate scripts expect standard filenames in job folders.
            filename = os.path.basename(full_s3_key)
            
            try:
                # --- STAGE 1: OCR (Textract) ---
                self._update_file_status(job_id, full_s3_key, "ocr_textract")
                
                # Note: Textract script takes full bucket/key and saves to jobs/{job_id}/ocr_output/
                success = aws_texttract_pipeline.process_document_async(
                    s3_bucket=bucket,
                    s3_key=full_s3_key, 
                    job_id=job_id
                )
                
                if not success:
                    raise Exception("Textract OCR failed")

                # --- STAGE 2: Parsing (Bedrock) ---
                self._update_file_status(job_id, full_s3_key, "parsing_bedrock")
                
                # Note: Parsing script reads from jobs/{job_id}/ocr_output/{filename}_ocr.json
                parse_result = parsing_pipeline.parse_questions_for_job(
                    job_id=job_id,
                    filename=filename
                )
                
                if not parse_result:
                    raise Exception("Bedrock Parsing failed")

                # --- STAGE 3: Enrichment (Bedrock) ---
                self._update_file_status(job_id, full_s3_key, "enrichment_bedrock")
                
                # Note: Enrichment reads from jobs/{job_id}/parsed_output/{filename}_parsed.json
                enrich_result = enrich_questions_job_based.enrich_questions_for_job(
                    job_id=job_id,
                    filename=filename
                )
                
                if not enrich_result:
                    raise Exception("Bedrock Enrichment failed")

                # --- STAGE 4: Organization (Subject Sorting) ---
                self._update_file_status(job_id, full_s3_key, "organization_s3")
                
                # Note: Organization reads from jobs/{job_id}/enriched_output/{filename}_enriched.json
                organize_result = organize_by_subject_job_based.organize_by_subject_for_job(
                    job_id=job_id,
                    filename=filename
                )
                
                if not organize_result:
                    raise Exception("Subject Organization failed")

                # --- COMPLETE ---
                self._update_file_status(job_id, full_s3_key, "completed", status="success")
                with self.lock:
                    self.jobs[job_id]["processed_files"] += 1

            except Exception as e:
                print(f"❌ Error processing {filename}: {str(e)}")
                self._update_file_status(job_id, full_s3_key, "failed", status="failed", error=str(e))

        # Final Job Status Update
        with self.lock:
            total = self.jobs[job_id]["total_files"]
            processed = self.jobs[job_id]["processed_files"]
            
            if processed == total:
                self.jobs[job_id]["status"] = "completed"
            elif processed > 0:
                self.jobs[job_id]["status"] = "completed_with_errors"
            else:
                self.jobs[job_id]["status"] = "failed"
            
            print(f"✅ Job {job_id} finished. Status: {self.jobs[job_id]['status']}")


# Initialize the AWS Pipeline Manager
aws_manager = AWSPipelineManager()


class AIServer:
    """
    Simple HTTP server for AI Pipeline integration with Node.js
    """
    
    def __init__(self, host: str = "127.0.0.1", port: int = 5000):
        self.host = host
        self.port = port
        self.app = Flask(__name__)
        self.server_thread = None
        self.is_running = False
        
        self._setup_routes()
        
        # Start local pipeline if available
        if pipeline_manager:
            pipeline_manager.start_server()
    
    def _setup_routes(self):
        
        @self.app.route('/health', methods=['GET'])
        def health_check():
            """Health check endpoint"""
            return jsonify({
                "status": "healthy",
                "timestamp": time.time(),
                "local_pipeline": pipeline_manager.is_running if pipeline_manager else False,
                "aws_pipeline": True
            })
        
        # --- LOCAL PIPELINE ROUTES ---
        def _submit_local_batch():
            if not pipeline_manager:
                return jsonify({"error": "Local pipeline not initialized"}), 501
            try:
                data = request.get_json()
                file_locations = data.get('file_locations', [])
                options = data.get('options', {})
                batch_id = pipeline_manager.submit_batch(file_locations, options)
                return jsonify({"success": True, "batch_id": batch_id})
            except Exception as e:
                return jsonify({"error": str(e)}), 500

        @self.app.route('/submit-local', methods=['POST'])
        def submit_batch_local():
            """Submit files for local OCR processing."""
            return _submit_local_batch()

        @self.app.route('/submit', methods=['POST'])
        def submit_batch_legacy():
            """Backward-compatible alias for local OCR submission."""
            return _submit_local_batch()

        # --- AWS PIPELINE ROUTES ---
        @self.app.route("/submit-aws", methods=["POST"])
        def submit_batch_aws():
            """
            Submit files for AWS Pipeline processing.
            Expects JSON: { "bucket": "...", "files": ["path/to/file1.pdf", ...], "job_id": "optional" }
            """
            try:
                data = request.get_json()
                if not data:
                    return jsonify({"error": "No JSON data provided"}), 400
                
                bucket = data.get("bucket")
                files = data.get("files")
                job_id = data.get("job_id") # Optional, allows client to set ID
                
                if not bucket or not files:
                    return jsonify({"error": "Missing 'bucket' or 'files' list"}), 400
                
                # Submit to AWS Manager
                assigned_job_id = aws_manager.submit_job(bucket, files, job_id)
                
                return jsonify({
                    "success": True, 
                    "job_id": assigned_job_id,
                    "message": "AWS Batch Job submitted successfully",
                    "files_queued": len(files)
                })
                
            except Exception as e:
                print(f"Error in submit-aws: {e}")
                return jsonify({"error": str(e)}), 500

        @self.app.route('/status-aws/<job_id>', methods=['GET'])
        def get_aws_job_status(job_id: str):
            """Get status of a specific AWS job"""
            status = aws_manager.get_job_status(job_id)
            if not status:
                return jsonify({"error": "Job not found"}), 404
            return jsonify({"success": True, "job": status})

        # --- SHARED/LEGACY ROUTES ---
        @self.app.route('/status/<batch_id>', methods=['GET'])
        def get_local_batch_status(batch_id: str):
            if not pipeline_manager:
                 return jsonify({"error": "Local pipeline not initialized"}), 501
            status = pipeline_manager.get_batch_status(batch_id)
            if status is None:
                return jsonify({"error": "Batch not found"}), 404                
            return jsonify({"success": True, "status": status})

        @self.app.route('/result/<batch_id>', methods=['GET'])
        def get_local_batch_result(batch_id: str):
            """Get final local OCR result for a completed batch."""
            if not pipeline_manager:
                return jsonify({"error": "Local pipeline not initialized"}), 501

            result = pipeline_manager.get_batch_result(batch_id)
            if result is None:
                return jsonify({"error": "Batch not found"}), 404

            return jsonify({"success": True, "result": result.to_dict()})
    
    def start(self):
        if self.is_running:
            return
        self.is_running = True
        self.server_thread = threading.Thread(target=self._run_server, daemon=True)
        self.server_thread.start()
        print(f"🚀 AI Pipeline Server starting on http://{self.host}:{self.port}")
    
    def _run_server(self):
        try:
            self.app.run(host=self.host, port=self.port, debug=False, use_reloader=False, threaded=True)
        except Exception as e:
            print(f"❌ Server error: {e}")
        finally:
            self.is_running = False
    
    def stop(self):
        self.is_running = False
        if pipeline_manager:
            pipeline_manager.stop_server()
        print("🛑 AI Pipeline Server stopped")

# Global server instance
server = AIServer()

def start_server(host: str = "127.0.0.1", port: int = 5000):
    global server
    if server.host != host or server.port != port:
        server = AIServer(host, port)
    server.start()
    return server

def stop_server():
    global server
    server.stop()

if __name__ == "__main__":
    host = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1"
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 5000
    server = start_server(host, port)
    try:
        while server.is_running:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n🛑 Shutting down server...")
        stop_server()