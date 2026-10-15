"""AWS Pipeline Manager - Orchestrates Textract -> Parsing -> Enrichment -> Organization -> Clustering"""

import os
import uuid
import json
import threading
import time
import atexit
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Optional, Any

import boto3

try:
    from aws_region import get_aws_region
except ImportError:  # pragma: no cover - package-relative fallback
    try:
        from ..aws_region import get_aws_region  # type: ignore[no-redef]
    except ImportError:
        def get_aws_region():  # type: ignore[no-redef]
            import os as _os
            return (
                _os.getenv("AWS_REGION")
                or _os.getenv("AWS_DEFAULT_REGION")
                or _os.getenv("aws_location")
                or "ap-south-1"
            ).strip() or "ap-south-1"

try:
    from aws_texttract_pipeline import process_document_async
    from parsing_pipeline import parse_questions_for_job
    from enrich_questions_job_based import enrich_questions_for_job
    from organize_by_subject_job_based import organize_by_subject_for_job
    from intelligent_chunking import chunk_ocr_text
    from question_clustering import cluster_questions_for_job
    AWS_MODULES_AVAILABLE = True
except Exception as e:
    # ImportError covers missing optional deps; other exceptions cover boto3
    # client configuration failures (e.g. NoRegionError/NoCredentialsError)
    # raised while pipeline modules build their module-level AWS clients.
    # Either way the AWS pipeline is unavailable but Flask must still start
    # so /health and the startup diagnostic keep working.
    print(f"Warning: AWS pipeline modules not fully available: {e}")
    process_document_async = None
    parse_questions_for_job = None
    enrich_questions_for_job = None
    organize_by_subject_for_job = None
    chunk_ocr_text = None
    cluster_questions_for_job = None
    AWS_MODULES_AVAILABLE = False


def resolve_s3_bucket(requested: Optional[str], configured: str) -> str:
    """Use a non-blank caller bucket, otherwise the configured bucket."""
    if isinstance(requested, str):
        requested = requested.strip()
        if requested:
            return requested
    return configured


# Job statuses that do not advance again on their own. A retry resets one of
# these back to ``in_progress`` explicitly (see api.job_retry), after which the
# job moves again. These mirror api.job_retry: RETRYABLE plus the batch
# ``completed`` / ``completed_with_errors`` outcomes.
TERMINAL_JOB_STATUSES = frozenset({
    "success",
    "partial_success",
    "failed",
    "completed",
    "completed_with_errors",
})

# How long a terminal metadata record may be served from the in-memory cache
# without re-reading S3. This bounds cross-worker staleness of a terminal row
# (for example after a retry rewrites it) and keeps memory from growing without
# bound. Nonterminal metadata ignores this and is refreshed on every poll.
DEFAULT_METADATA_CACHE_TTL_SECONDS = 5.0


def is_terminal_job_metadata(metadata: Optional[Dict]) -> bool:
    """Return True when a job's stored status is final.

    Terminal metadata does not change until an explicit retry rewrites it, so a
    worker can reuse a cached copy within the freshness window. Any other or
    missing status is treated as still in motion and must be refreshed from S3.
    """
    return isinstance(metadata, dict) and metadata.get("status") in TERMINAL_JOB_STATUSES


def clustering_update_outcome(clustering_result: Optional[Dict]) -> Optional[str]:
    """Classify clustering write-back as ``failed``, ``partial``, or neither.

    A missing result is handled by the caller. A dict is ``failed`` when the
    clustering result says so, and ``partial`` when ``failed_keys`` names
    organized files that were not updated. A clean result returns None.
    """
    if not isinstance(clustering_result, dict):
        return None
    status = clustering_result.get("status")
    failed_keys = clustering_result.get("failed_keys") or []
    if status == "failed":
        return "failed"
    if status == "partial" or failed_keys:
        return "partial"
    return None


def chunked_parsing_outcome(parsing_result: Optional[Dict]) -> Optional[str]:
    """Classify a chunked parse payload as ``failed``, ``partial``, or neither.

    Non-chunked payloads (including a token-limit failure) return None so the
    caller keeps its own status. A chunked payload is ``failed`` when nothing
    parsed, and ``partial`` when ``failed_chunks`` names chunks that were lost.
    """
    if not isinstance(parsing_result, dict) or not parsing_result.get("is_chunked"):
        return None
    status = parsing_result.get("status")
    failed_chunks = parsing_result.get("failed_chunks") or []
    if status == "failed":
        return "failed"
    if status == "partial" or failed_chunks:
        return "partial"
    return None


class AWSPipelineManager:
    """
    Orchestrator for the AWS-based AI Pipeline.

    Manages the full lifecycle: Textract OCR -> Chunking -> Bedrock Parsing ->
    Bedrock Enrichment -> S3 Organization -> FAISS/HDBSCAN Clustering.

    Provides S3-backed job metadata persistence with in-memory LRU cache,
    bounded thread pool for concurrent processing, and graceful cleanup.

    The metadata cache is process-local. With multiple WSGI worker processes a
    poll must not be served a snapshot another worker has since advanced: see
    load_job_metadata, which refreshes nonterminal records from S3 and only
    reuses a cached record while a terminal one is within its TTL.
    """
    def __init__(self):
        self.s3_client = self._init_s3_client()
        self.s3_bucket = os.getenv('S3_BUCKET', 'eesa-pipeline-storage')
        self.s3_jobs_prefix = 'jobs/'
        self.max_concurrent_jobs = int(os.getenv('MAX_CONCURRENT_JOBS', '3'))

        self.jobs: Dict[str, Dict] = {}
        self.jobs_lock = threading.Lock()
        # monotonic() timestamp of when each cached record was last written to
        # S3 (by any worker) or read back from it, used for the terminal TTL.
        self.jobs_cached_at: Dict[str, float] = {}
        self.metadata_cache_ttl = float(
            os.getenv('JOB_METADATA_CACHE_TTL', str(DEFAULT_METADATA_CACHE_TTL_SECONDS))
        )

        self._executor: Optional[ThreadPoolExecutor] = None
        self._executor_lock = threading.Lock()

        atexit.register(self.cleanup)

    def _init_s3_client(self):
        try:
            return boto3.client('s3', region_name=get_aws_region())
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
                self.jobs_cached_at[job_id] = time.monotonic()
                self._evict_job_cache_locked()
            return True
        except Exception as e:
            print(f"Failed to save metadata: {e}")
            return False

    def load_job_metadata(self, job_id: str) -> Optional[Dict]:
        with self.jobs_lock:
            cached = self.jobs.get(job_id)
            cached_at = self.jobs_cached_at.get(job_id)
        # Only a terminal record may be served from cache, and only while it is
        # within its freshness window. Terminal metadata does not change until
        # an explicit retry, so the cache is safe here; the TTL bounds how long
        # that holds. A nonterminal record always falls through to S3 so a poll
        # on this worker sees a state another processing worker has saved, which
        # is the cross-worker staleness this cache previously caused.
        if (
            cached is not None
            and is_terminal_job_metadata(cached)
            and cached_at is not None
            and (time.monotonic() - cached_at) < self.metadata_cache_ttl
        ):
            return cached
        if not self.s3_client:
            with self.jobs_lock:
                return self.jobs.get(job_id)
        try:
            s3_key = f"{self.s3_jobs_prefix}{job_id}/metadata.json"
            response = self.s3_client.get_object(Bucket=self.s3_bucket, Key=s3_key)
            metadata = json.loads(response['Body'].read().decode('utf-8'))
            with self.jobs_lock:
                self.jobs[job_id] = metadata
                self.jobs_cached_at[job_id] = time.monotonic()
            return metadata
        except Exception:
            # S3 unavailable or no such key yet: keep serving the last value we
            # have rather than dropping a job a caller is polling.
            with self.jobs_lock:
                return self.jobs.get(job_id)

    def _evict_job_cache_locked(self) -> None:
        """Bound the in-memory metadata cache. Must be called under jobs_lock."""
        if len(self.jobs) > 100:
            oldest = sorted(self.jobs.keys())[:20]
            for k in oldest:
                self.jobs.pop(k, None)
                self.jobs_cached_at.pop(k, None)

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
    def process_aws_job_pipeline(
        self,
        job_id: str,
        s3_pdf_key: str,
        filename: str,
        s3_bucket: Optional[str] = None,
    ) -> Dict:
        source_bucket = resolve_s3_bucket(s3_bucket, self.s3_bucket)
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
            ocr_success = process_document_async(source_bucket, s3_pdf_key, job_id)
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

            chunk_outcome = chunked_parsing_outcome(parsing_result)
            parsing_partial = chunk_outcome == 'partial'
            if chunk_outcome == 'failed':
                failed_chunks = parsing_result.get('failed_chunks') or []
                metadata['status'] = 'failed'
                metadata['failed_stage'] = 'parsing'
                metadata['error'] = parsing_result.get('error', 'All chunks failed to parse')
                metadata['error_type'] = parsing_result.get('error_type', 'chunk_parse_failed')
                metadata['stages']['parsing']['status'] = 'failed'
                metadata['stages']['parsing']['error'] = metadata['error']
                metadata['stages']['parsing']['failed_chunks'] = failed_chunks
                metadata['stages']['parsing']['completed_at'] = datetime.now().isoformat()
                self.save_job_metadata(job_id, metadata)
                return metadata

            if parsing_partial:
                failed_chunks = parsing_result.get('failed_chunks') or []
                metadata['failed_stage'] = 'parsing'
                metadata['error'] = parsing_result.get(
                    'error',
                    f"{len(failed_chunks)} chunks failed to parse",
                )
                metadata['error_type'] = parsing_result.get('error_type', 'chunk_parse_partial')
                metadata['stages']['parsing'] = {
                    'status': 'partial',
                    'completed_at': datetime.now().isoformat(),
                    'error': metadata['error'],
                    'failed_chunks': failed_chunks,
                    'total_questions': parsing_result.get('total_questions', 0),
                    'total_exams': parsing_result.get('total_exams', 0),
                    'processing_cost': parsing_result.get('processing_cost', 0),
                    'is_chunked': True,
                }
            elif isinstance(parsing_result, dict) and not parsing_result.get('success', True):
                metadata['status'] = 'partial_success'
                metadata['failed_stage'] = 'parsing'
                metadata['error'] = parsing_result.get('error', 'Parsing failed')
                metadata['error_type'] = parsing_result.get('error_type', 'unknown')
                metadata['stages']['parsing']['status'] = 'failed'
                metadata['stages']['parsing']['error'] = parsing_result.get('error')
                metadata['stages']['parsing']['completed_at'] = datetime.now().isoformat()
                self.save_job_metadata(job_id, metadata)
                return metadata

            elif not parsing_result:
                metadata['status'] = 'partial_success'
                metadata['failed_stage'] = 'parsing'
                metadata['error'] = 'Parsing returned no result'
                metadata['stages']['parsing']['status'] = 'failed'
                metadata['stages']['parsing']['completed_at'] = datetime.now().isoformat()
                self.save_job_metadata(job_id, metadata)
                return metadata

            else:
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
            clustering_updates_incomplete = False
            if not cluster_questions_for_job:
                print(f"[{job_id}] Clustering module not available, skipping")
                metadata['stages']['clustering'] = {
                    'status': 'skipped',
                    'completed_at': datetime.now().isoformat(),
                    'reason': 'Module not available'
                }
            else:
                clustering_result = cluster_questions_for_job(job_id, filename)
                update_outcome = clustering_update_outcome(clustering_result)
                if not clustering_result:
                    print(f"[{job_id}] Clustering failed, continuing")
                    metadata['stages']['clustering'] = {
                        'status': 'failed',
                        'completed_at': datetime.now().isoformat(),
                        'error': 'Clustering analysis failed'
                    }
                    if not parsing_partial:
                        metadata['failed_stage'] = 'clustering'
                        metadata['error'] = 'Clustering analysis failed'
                    clustering_updates_incomplete = True
                elif update_outcome:
                    failed_keys = list(clustering_result.get('failed_keys') or [])
                    stage_error = clustering_result.get(
                        'error',
                        'Clustering failed to update organized files',
                    )
                    print(f"[{job_id}] Clustering {update_outcome}: {stage_error}")
                    metadata['stages']['clustering'] = {
                        'status': update_outcome,
                        'completed_at': datetime.now().isoformat(),
                        'error': stage_error,
                        'failed_keys': failed_keys,
                        'file_updates': clustering_result.get('file_updates') or [],
                        'total_questions': clustering_result.get('total_questions', 0),
                        'similar_pairs': clustering_result.get('total_similar_pairs', 0),
                        'n_clusters': clustering_result.get('n_clusters', 0),
                        'embedding_model': clustering_result.get('embedding_model', ''),
                    }
                    if not parsing_partial:
                        metadata['failed_stage'] = 'clustering'
                        metadata['error'] = stage_error
                    clustering_updates_incomplete = True
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

            metadata['status'] = (
                'partial_success'
                if parsing_partial or clustering_updates_incomplete
                else 'success'
            )
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
