"""AWS Pipeline Manager - Orchestrates Textract -> Parsing -> Enrichment -> Organization -> Clustering"""

import os
import uuid
import json
import threading
import atexit
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Optional, Any

import boto3

try:
    from aws_texttract_pipeline import process_document_async
    from parsing_pipeline import parse_questions_for_job
    from enrich_questions_job_based import enrich_questions_for_job
    from organize_by_subject_job_based import organize_by_subject_for_job
    from intelligent_chunking import chunk_ocr_text
    from question_clustering import cluster_questions_for_job
    AWS_MODULES_AVAILABLE = True
except ImportError as e:
    print(f"Warning: AWS pipeline modules not fully available: {e}")
    process_document_async = None
    parse_questions_for_job = None
    enrich_questions_for_job = None
    organize_by_subject_for_job = None
    chunk_ocr_text = None
    cluster_questions_for_job = None
    AWS_MODULES_AVAILABLE = False


class AWSPipelineManager:
    """
    Orchestrator for the AWS-based AI Pipeline.

    Manages the full lifecycle: Textract OCR -> Chunking -> Bedrock Parsing ->
    Bedrock Enrichment -> S3 Organization -> FAISS/HDBSCAN Clustering.

    Provides S3-backed job metadata persistence with in-memory LRU cache,
    bounded thread pool for concurrent processing, and graceful cleanup.
    """
    def __init__(self):
        self.s3_client = self._init_s3_client()
        self.s3_bucket = os.getenv('S3_BUCKET', 'eesa-pipeline-storage')
        self.s3_jobs_prefix = 'jobs/'
        self.max_concurrent_jobs = int(os.getenv('MAX_CONCURRENT_JOBS', '3'))

        self.jobs: Dict[str, Dict] = {}
        self.jobs_lock = threading.Lock()

        self._executor: Optional[ThreadPoolExecutor] = None
        self._executor_lock = threading.Lock()

        atexit.register(self.cleanup)

    def _init_s3_client(self):
        try:
            return boto3.client('s3')
        except Exception as e:
            print(f"Warning: S3 client init failed: {e}")
            return None

    def is_aws_available(self) -> bool:
        return self.s3_client is not None and AWS_MODULES_AVAILABLE

    # ------------------------------------------------------------------
    # Thread Pool (lazy, bounded)
    # ------------------------------------------------------------------
    @property
    def executor(self) -> ThreadPoolExecutor:
        if self._executor is None:
            with self._executor_lock:
                if self._executor is None:
                    self._executor = ThreadPoolExecutor(
                        max_workers=self.max_concurrent_jobs,
                        thread_name_prefix='job_worker'
                    )
        return self._executor

    # ------------------------------------------------------------------
    # S3 Metadata Persistence
    # ------------------------------------------------------------------
    def save_job_metadata(self, job_id: str, metadata: Dict) -> bool:
        if not self.s3_client:
            return False
        try:
            s3_key = f"{self.s3_jobs_prefix}{job_id}/metadata.json"
            self.s3_client.put_object(
                Bucket=self.s3_bucket,
                Key=s3_key,
                Body=json.dumps(metadata, separators=(',', ':')),
                ContentType='application/json'
            )
            with self.jobs_lock:
                self.jobs[job_id] = metadata
                if len(self.jobs) > 100:
                    oldest = sorted(self.jobs.keys())[:20]
                    for k in oldest:
                        self.jobs.pop(k, None)
            return True
        except Exception as e:
            print(f"Failed to save metadata: {e}")
            return False

    def load_job_metadata(self, job_id: str) -> Optional[Dict]:
        with self.jobs_lock:
            if job_id in self.jobs:
                return self.jobs[job_id]
        if not self.s3_client:
            return None
        try:
            s3_key = f"{self.s3_jobs_prefix}{job_id}/metadata.json"
            response = self.s3_client.get_object(Bucket=self.s3_bucket, Key=s3_key)
            metadata = json.loads(response['Body'].read().decode('utf-8'))
            with self.jobs_lock:
                self.jobs[job_id] = metadata
            return metadata
        except Exception:
            return None

    # ------------------------------------------------------------------
    # Chunking Analysis
    # ------------------------------------------------------------------
    def process_ocr_with_chunking(self, job_id: str, filename: str) -> Dict:
        try:
            base_name = os.path.splitext(filename)[0]
            ocr_key = f"{self.s3_jobs_prefix}{job_id}/ocr_output/{base_name}_ocr.json"
            print(f"Loading OCR output from: s3://{self.s3_bucket}/{ocr_key}")
            response = self.s3_client.get_object(Bucket=self.s3_bucket, Key=ocr_key)
            ocr_data = json.loads(response['Body'].read().decode('utf-8'))
            ocr_text = ocr_data.get('extracted_text', '')
            page_count = ocr_data.get('page_count', 0)
            print(f"OCR loaded: {len(ocr_text)} characters, {page_count} pages")

            if len(ocr_text) > 20000 and chunk_ocr_text:
                print(f"Large document detected - applying intelligent chunking...")
                chunks = chunk_ocr_text(ocr_text, max_chars_per_chunk=20000)
                print(f"Split into {len(chunks)} chunks")
                chunks_key = f"{self.s3_jobs_prefix}{job_id}/chunks_metadata.json"
                self.s3_client.put_object(
                    Bucket=self.s3_bucket,
                    Key=chunks_key,
                    Body=json.dumps(chunks, indent=2),
                    ContentType='application/json'
                )
                return {
                    'needs_chunking': True,
                    'chunks': chunks,
                    'total_chunks': len(chunks),
                    'page_count': page_count
                }
            else:
                print(f"Document size manageable - no chunking needed ({len(ocr_text)} chars)")
                return {
                    'needs_chunking': False,
                    'ocr_text': ocr_text,
                    'page_count': page_count
                }
        except Exception as e:
            print(f"Error in chunking analysis: {e}")
            import traceback
            traceback.print_exc()
            return {'needs_chunking': False, 'ocr_text': '', 'error': str(e)}

    # ------------------------------------------------------------------
    # Full 5-Stage Pipeline
    # ------------------------------------------------------------------
    def process_aws_job_pipeline(self, job_id: str, s3_pdf_key: str, filename: str) -> Dict:
        metadata = {
            'job_id': job_id,
            'filename': filename,
            's3_pdf_key': s3_pdf_key,
            'started_at': datetime.now().isoformat(),
            'status': 'in_progress',
            'stages': {}
        }
        self.save_job_metadata(job_id, metadata)

        try:
            # Stage 1: OCR
            print(f"[{job_id}] Stage 1: OCR Processing")
            metadata['stages']['ocr'] = {'status': 'in_progress', 'started_at': datetime.now().isoformat()}
            self.save_job_metadata(job_id, metadata)
            if not process_document_async:
                raise Exception("AWS Textract module not available")
            ocr_success = process_document_async(self.s3_bucket, s3_pdf_key, job_id)
            if not ocr_success:
                metadata['status'] = 'failed'
                metadata['failed_stage'] = 'ocr'
                metadata['error'] = 'OCR processing failed'
                metadata['stages']['ocr']['status'] = 'failed'
                metadata['stages']['ocr']['completed_at'] = datetime.now().isoformat()
                self.save_job_metadata(job_id, metadata)
                return metadata
            metadata['stages']['ocr'] = {'status': 'success', 'completed_at': datetime.now().isoformat()}
            self.save_job_metadata(job_id, metadata)

            # Stage 1.5: Chunking Analysis
            print(f"[{job_id}] Stage 1.5: Chunking Analysis")
            chunking_result = self.process_ocr_with_chunking(job_id, filename)

            # Stage 2: Parsing
            print(f"[{job_id}] Stage 2: Question Parsing")
            metadata['stages']['parsing'] = {'status': 'in_progress', 'started_at': datetime.now().isoformat()}
            self.save_job_metadata(job_id, metadata)
            if not parse_questions_for_job:
                raise Exception("Parsing module not available")

            if chunking_result.get('needs_chunking'):
                print(f"   Using chunked processing ({chunking_result['total_chunks']} chunks)")
                try:
                    from parsing_pipeline import parse_chunked_document
                    parsing_result = parse_chunked_document(chunking_result['chunks'], job_id, filename)
                except ImportError:
                    parsing_result = parse_questions_for_job(job_id, filename)
            else:
                print(f"   Using standard processing")
                parsing_result = parse_questions_for_job(job_id, filename)

            if isinstance(parsing_result, dict) and not parsing_result.get('success', True):
                metadata['status'] = 'partial_success'
                metadata['failed_stage'] = 'parsing'
                metadata['error'] = parsing_result.get('error', 'Parsing failed')
                metadata['error_type'] = parsing_result.get('error_type', 'unknown')
                metadata['stages']['parsing']['status'] = 'failed'
                metadata['stages']['parsing']['error'] = parsing_result.get('error')
                metadata['stages']['parsing']['completed_at'] = datetime.now().isoformat()
                self.save_job_metadata(job_id, metadata)
                return metadata

            if not parsing_result:
                metadata['status'] = 'partial_success'
                metadata['failed_stage'] = 'parsing'
                metadata['error'] = 'Parsing returned no result'
                metadata['stages']['parsing']['status'] = 'failed'
                metadata['stages']['parsing']['completed_at'] = datetime.now().isoformat()
                self.save_job_metadata(job_id, metadata)
                return metadata

            metadata['stages']['parsing'] = {
                'status': 'success',
                'completed_at': datetime.now().isoformat(),
                'total_questions': parsing_result.get('total_questions', 0),
                'total_exams': parsing_result.get('total_exams', 0),
                'processing_cost': parsing_result.get('processing_cost', 0),
                'is_chunked': parsing_result.get('is_chunked', False)
            }
            self.save_job_metadata(job_id, metadata)

            # Stage 3: Enrichment
            print(f"[{job_id}] Stage 3: Question Enrichment")
            metadata['stages']['enrichment'] = {'status': 'in_progress', 'started_at': datetime.now().isoformat()}
            self.save_job_metadata(job_id, metadata)

            if parsing_result.get('is_chunked') and parsing_result.get('chunk_metadata_key'):
                print(f"   Using chunked enrichment")
                try:
                    from enrich_questions_job_based import enrich_chunked_questions
                    enrichment_success = enrich_chunked_questions(job_id, filename, parsing_result['chunk_metadata_key'])
                except ImportError:
                    enrichment_success = enrich_questions_for_job(job_id, filename)
            else:
                if not enrich_questions_for_job:
                    raise Exception("Enrichment module not available")
                enrichment_success = enrich_questions_for_job(job_id, filename)

            if not enrichment_success:
                metadata['status'] = 'partial_success'
                metadata['failed_stage'] = 'enrichment'
                metadata['error'] = 'Enrichment failed'
                metadata['stages']['enrichment']['status'] = 'failed'
                metadata['stages']['enrichment']['completed_at'] = datetime.now().isoformat()
                self.save_job_metadata(job_id, metadata)
                return metadata

            metadata['stages']['enrichment'] = {
                'status': 'success',
                'completed_at': datetime.now().isoformat(),
                'total_questions': enrichment_success.get('total_questions', 0),
                'total_enriched': enrichment_success.get('total_enriched', 0),
                'processing_cost': enrichment_success.get('processing_cost', 0),
                'retry_count': enrichment_success.get('retry_count', 0)
            }
            if enrichment_success.get('retry_count', 0) > 0:
                print(f"[{job_id}] Enrichment succeeded after {enrichment_success['retry_count']} retries")
            self.save_job_metadata(job_id, metadata)

            # Stage 4: Organization
            print(f"[{job_id}] Stage 4: Organize by Subject")
            metadata['stages']['organization'] = {'status': 'in_progress', 'started_at': datetime.now().isoformat()}
            self.save_job_metadata(job_id, metadata)
            if not organize_by_subject_for_job:
                raise Exception("Organization module not available")
            org_result = organize_by_subject_for_job(job_id, filename)
            if not org_result:
                metadata['status'] = 'partial_success'
                metadata['failed_stage'] = 'organization'
                metadata['error'] = 'Organization failed'
                metadata['stages']['organization']['status'] = 'failed'
                metadata['stages']['organization']['completed_at'] = datetime.now().isoformat()
                self.save_job_metadata(job_id, metadata)
                return metadata
            metadata['stages']['organization'] = {
                'status': 'success',
                'completed_at': datetime.now().isoformat(),
                'total_subjects': org_result.get('total_subjects', 0),
                'total_exams': org_result.get('total_exams', 0),
                'total_questions': org_result.get('total_questions', 0),
                'subjects': org_result.get('subjects', {}),
                'master_index_s3_key': org_result.get('master_index_s3_key')
            }
            self.save_job_metadata(job_id, metadata)

            # Stage 5: Clustering
            print(f"[{job_id}] Stage 5: Question Clustering")
            metadata['stages']['clustering'] = {'status': 'in_progress', 'started_at': datetime.now().isoformat()}
            self.save_job_metadata(job_id, metadata)
            if not cluster_questions_for_job:
                print(f"[{job_id}] Clustering module not available, skipping")
                metadata['stages']['clustering'] = {
                    'status': 'skipped',
                    'completed_at': datetime.now().isoformat(),
                    'reason': 'Module not available'
                }
            else:
                clustering_result = cluster_questions_for_job(job_id, filename)
                if not clustering_result:
                    print(f"[{job_id}] Clustering failed, continuing")
                    metadata['stages']['clustering'] = {
                        'status': 'failed',
                        'completed_at': datetime.now().isoformat(),
                        'error': 'Clustering analysis failed'
                    }
                else:
                    metadata['stages']['clustering'] = {
                        'status': 'success',
                        'completed_at': datetime.now().isoformat(),
                        'total_questions': clustering_result.get('total_questions', 0),
                        'similar_pairs': clustering_result.get('total_similar_pairs', 0),
                        'n_clusters': clustering_result.get('n_clusters', 0),
                        'embedding_model': clustering_result.get('embedding_model', '')
                    }
            self.save_job_metadata(job_id, metadata)

            metadata['status'] = 'success'
            metadata['completed_at'] = datetime.now().isoformat()
            self.save_job_metadata(job_id, metadata)
            print(f"[{job_id}] Pipeline complete!")
            return metadata

        except Exception as e:
            metadata['status'] = 'failed'
            metadata['error'] = str(e)
            metadata['completed_at'] = datetime.now().isoformat()
            self.save_job_metadata(job_id, metadata)
            print(f"[{job_id}] Pipeline failed: {e}")
            import traceback
            traceback.print_exc()
            return metadata

    # ------------------------------------------------------------------
    # Legacy Interface (backward compatible)
    # ------------------------------------------------------------------
    def submit_job(self, bucket: str, files: List[str], job_id: Optional[str] = None) -> str:
        if not job_id:
            job_id = str(uuid.uuid4())
        with self.jobs_lock:
            self.jobs[job_id] = {
                "status": "queued",
                "submitted_at": datetime.now().isoformat(),
                "bucket": bucket,
                "total_files": len(files),
                "processed_files": 0,
                "files": {f: {"status": "queued", "stage": "queued", "error": None} for f in files},
                "summary": {}
            }
        self.executor.submit(self._process_batch, job_id, bucket, files)
        return job_id

    def get_job_status(self, job_id: str) -> Optional[Dict]:
        result = self.load_job_metadata(job_id)
        if result:
            return result
        with self.jobs_lock:
            return self.jobs.get(job_id)

    def _update_file_status(self, job_id: str, filename: str, stage: str, status: str = "in_progress", error: str = None):
        with self.jobs_lock:
            if job_id in self.jobs:
                self.jobs[job_id]["files"][filename]["stage"] = stage
                self.jobs[job_id]["files"][filename]["status"] = status
                if error:
                    self.jobs[job_id]["files"][filename]["error"] = error
                self.jobs[job_id]["last_updated"] = datetime.now().isoformat()

    def _process_batch(self, job_id: str, bucket: str, files: List[str]):
        print(f"Starting AWS Batch Job: {job_id} ({len(files)} files)")
        with self.jobs_lock:
            self.jobs[job_id]["status"] = "processing"
        for full_s3_key in files:
            filename = os.path.basename(full_s3_key)
            try:
                self._update_file_status(job_id, full_s3_key, "ocr_textract")
                success = process_document_async(s3_bucket=bucket, s3_key=full_s3_key, job_id=job_id)
                if not success:
                    raise Exception("Textract OCR failed")
                self._update_file_status(job_id, full_s3_key, "parsing_bedrock")
                if not parse_questions_for_job(job_id=job_id, filename=filename):
                    raise Exception("Bedrock Parsing failed")
                self._update_file_status(job_id, full_s3_key, "enrichment_bedrock")
                if not enrich_questions_for_job(job_id=job_id, filename=filename):
                    raise Exception("Bedrock Enrichment failed")
                self._update_file_status(job_id, full_s3_key, "organization_s3")
                if not organize_by_subject_for_job(job_id=job_id, filename=filename):
                    raise Exception("Subject Organization failed")
                self._update_file_status(job_id, full_s3_key, "completed", status="success")
                with self.jobs_lock:
                    self.jobs[job_id]["processed_files"] += 1
            except Exception as e:
                print(f"Error processing {filename}: {e}")
                self._update_file_status(job_id, full_s3_key, "failed", status="failed", error=str(e))
        with self.jobs_lock:
            total = self.jobs[job_id]["total_files"]
            processed = self.jobs[job_id]["processed_files"]
            if processed == total:
                self.jobs[job_id]["status"] = "completed"
            elif processed > 0:
                self.jobs[job_id]["status"] = "completed_with_errors"
            else:
                self.jobs[job_id]["status"] = "failed"
            print(f"Job {job_id} finished. Status: {self.jobs[job_id]['status']}")

    # ------------------------------------------------------------------
    # Active Jobs
    # ------------------------------------------------------------------
    def get_active_jobs(self) -> List[Dict]:
        with self.jobs_lock:
            return list(self.jobs.values())

    def get_active_jobs_count(self) -> int:
        with self.jobs_lock:
            return len(self.jobs)

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------
    def cleanup(self):
        print("Cleaning up AWS pipeline manager...")
        if self._executor is not None:
            self._executor.shutdown(wait=True, cancel_futures=False)
            self._executor = None
        print("AWS pipeline manager cleanup complete")
