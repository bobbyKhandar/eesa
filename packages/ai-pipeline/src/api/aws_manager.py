"""AWS Pipeline Manager - Orchestrates Textract -> Parsing -> Enrichment -> Organization"""

import os
import uuid
import threading
import json
from datetime import datetime
from typing import Dict, Any, Optional, List

import aws_texttract_pipeline
import parsing_pipeline
import enrich_questions_job_based
import organize_by_subject_job_based


class AWSPipelineManager:
    """
    Orchestrator for the AWS-based AI Pipeline.
    Manages the lifecycle: Textract -> Parsing -> Enrichment -> Organization
    """
    def __init__(self):
        self.jobs: Dict[str, Dict] = {}
        self.lock = threading.Lock()
        self.stages = [
            "queued", "ocr_textract", "parsing_bedrock",
            "enrichment_bedrock", "organization_s3", "completed"
        ]

    def submit_job(self, bucket: str, files: List[str], job_id: Optional[str] = None) -> str:
        if not job_id:
            job_id = str(uuid.uuid4())
        with self.lock:
            self.jobs[job_id] = {
                "status": "queued",
                "submitted_at": datetime.now().isoformat(),
                "bucket": bucket,
                "total_files": len(files),
                "processed_files": 0,
                "files": {f: {"status": "queued", "stage": "queued", "error": None} for f in files},
                "summary": {}
            }
        thread = threading.Thread(target=self._process_batch, args=(job_id, bucket, files), daemon=True)
        thread.start()
        return job_id

    def get_job_status(self, job_id: str) -> Optional[Dict]:
        with self.lock:
            return self.jobs.get(job_id)

    def _update_file_status(self, job_id: str, filename: str, stage: str, status: str = "in_progress", error: str = None):
        with self.lock:
            if job_id in self.jobs:
                self.jobs[job_id]["files"][filename]["stage"] = stage
                self.jobs[job_id]["files"][filename]["status"] = status
                if error:
                    self.jobs[job_id]["files"][filename]["error"] = error
                self.jobs[job_id]["last_updated"] = datetime.now().isoformat()

    def _process_batch(self, job_id: str, bucket: str, files: List[str]):
        print(f"Starting AWS Batch Job: {job_id} ({len(files)} files)")
        with self.lock:
            self.jobs[job_id]["status"] = "processing"

        for full_s3_key in files:
            filename = os.path.basename(full_s3_key)
            try:
                self._update_file_status(job_id, full_s3_key, "ocr_textract")
                success = aws_texttract_pipeline.process_document_async(s3_bucket=bucket, s3_key=full_s3_key, job_id=job_id)
                if not success:
                    raise Exception("Textract OCR failed")

                self._update_file_status(job_id, full_s3_key, "parsing_bedrock")
                if not parsing_pipeline.parse_questions_for_job(job_id=job_id, filename=filename):
                    raise Exception("Bedrock Parsing failed")

                self._update_file_status(job_id, full_s3_key, "enrichment_bedrock")
                if not enrich_questions_job_based.enrich_questions_for_job(job_id=job_id, filename=filename):
                    raise Exception("Bedrock Enrichment failed")

                self._update_file_status(job_id, full_s3_key, "organization_s3")
                if not organize_by_subject_job_based.organize_by_subject_for_job(job_id=job_id, filename=filename):
                    raise Exception("Subject Organization failed")

                self._update_file_status(job_id, full_s3_key, "completed", status="success")
                with self.lock:
                    self.jobs[job_id]["processed_files"] += 1
            except Exception as e:
                print(f"Error processing {filename}: {e}")
                self._update_file_status(job_id, full_s3_key, "failed", status="failed", error=str(e))

        with self.lock:
            total = self.jobs[job_id]["total_files"]
            processed = self.jobs[job_id]["processed_files"]
            if processed == total:
                self.jobs[job_id]["status"] = "completed"
            elif processed > 0:
                self.jobs[job_id]["status"] = "completed_with_errors"
            else:
                self.jobs[job_id]["status"] = "failed"
            print(f"Job {job_id} finished. Status: {self.jobs[job_id]['status']}")
