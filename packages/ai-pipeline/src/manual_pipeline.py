"""
Manual Pipeline CLI - Robust PDF Processing with SQLite Tracking

A brutal, reliable pipeline for processing 100k+ question papers with:
- SQLite-based tracking (no MongoDB dependency)
- Manual phase-by-phase control
- Comprehensive error tracking and retry
- Separate error storage for easy recovery
- Batch processing with resume capability

Usage:
    python manual_pipeline.py --help
    python manual_pipeline.py status
    python manual_pipeline.py upload /path/to/pdfs
    python manual_pipeline.py ocr --batch-size 10
    python manual_pipeline.py parse --batch-size 10
    python manual_pipeline.py enrich --batch-size 10
    python manual_pipeline.py organize --batch-size 10
    python manual_pipeline.py retry-errors --phase ocr
    python manual_pipeline.py export-errors
"""

import sqlite3
import os
import sys
import json
import uuid
import argparse
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
from enum import Enum
import traceback
import hashlib

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

import boto3
from botocore.config import Config

# ==========================================
# Configuration
# ==========================================

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "manual_pipeline_data"
DB_PATH = DATA_DIR / "pipeline.db"
ERRORS_DIR = DATA_DIR / "errors"
EXPORTS_DIR = DATA_DIR / "exports"
LOGS_DIR = DATA_DIR / "logs"

# S3 Configuration
S3_BUCKET = os.getenv('S3_BUCKET', 'eesa-pipeline-storage')
S3_MANUAL_PREFIX = 'manual_pipeline/'  # Separate from prod!

# AWS Clients
boto_config = Config(
    read_timeout=300,
    connect_timeout=60,
    retries={'max_attempts': 3, 'mode': 'adaptive'}
)

# ==========================================
# Enums & Data Classes
# ==========================================

class Phase(Enum):
    UPLOAD = "upload"
    OCR = "ocr"
    PARSE = "parse"
    ENRICH = "enrich"
    ORGANIZE = "organize"
    COMPLETE = "complete"

class Status(Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    SUCCESS = "success"
    FAILED = "failed"
    RETRY_PENDING = "retry_pending"

@dataclass
class Job:
    job_id: str
    filename: str
    file_hash: str
    file_size: int
    current_phase: str
    status: str
    s3_original_key: str = ""
    s3_ocr_key: str = ""
    s3_parsed_key: str = ""
    s3_enriched_key: str = ""
    s3_organized_key: str = ""
    error_message: str = ""
    error_phase: str = ""
    retry_count: int = 0
    questions_count: int = 0
    exams_count: int = 0
    created_at: str = ""
    updated_at: str = ""
    completed_at: str = ""
    batch_id: str = ""
    priority: int = 0

# ==========================================
# Database Manager
# ==========================================

class DatabaseManager:
    """SQLite database manager for pipeline tracking"""
    
    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self._ensure_dirs()
        self._init_db()
    
    def _ensure_dirs(self):
        """Create necessary directories"""
        DATA_DIR.mkdir(exist_ok=True)
        ERRORS_DIR.mkdir(exist_ok=True)
        EXPORTS_DIR.mkdir(exist_ok=True)
        LOGS_DIR.mkdir(exist_ok=True)
        for phase in Phase:
            (ERRORS_DIR / phase.value).mkdir(exist_ok=True)
    
    def _init_db(self):
        """Initialize database tables"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS jobs (
                    job_id TEXT PRIMARY KEY,
                    filename TEXT NOT NULL,
                    file_hash TEXT,
                    file_size INTEGER,
                    current_phase TEXT DEFAULT 'upload',
                    status TEXT DEFAULT 'pending',
                    s3_original_key TEXT,
                    s3_ocr_key TEXT,
                    s3_parsed_key TEXT,
                    s3_enriched_key TEXT,
                    s3_organized_key TEXT,
                    error_message TEXT,
                    error_phase TEXT,
                    retry_count INTEGER DEFAULT 0,
                    questions_count INTEGER DEFAULT 0,
                    exams_count INTEGER DEFAULT 0,
                    created_at TEXT,
                    updated_at TEXT,
                    completed_at TEXT,
                    batch_id TEXT,
                    priority INTEGER DEFAULT 0
                )
            """)
            
            conn.execute("""
                CREATE TABLE IF NOT EXISTS error_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL,
                    phase TEXT NOT NULL,
                    error_type TEXT,
                    error_message TEXT,
                    error_traceback TEXT,
                    s3_location TEXT,
                    input_data TEXT,
                    occurred_at TEXT,
                    is_resolved INTEGER DEFAULT 0,
                    resolved_at TEXT,
                    retry_attempt INTEGER DEFAULT 0,
                    FOREIGN KEY (job_id) REFERENCES jobs(job_id)
                )
            """)
            
            conn.execute("""
                CREATE TABLE IF NOT EXISTS batches (
                    batch_id TEXT PRIMARY KEY,
                    name TEXT,
                    total_files INTEGER,
                    processed_files INTEGER DEFAULT 0,
                    failed_files INTEGER DEFAULT 0,
                    started_at TEXT,
                    completed_at TEXT,
                    status TEXT DEFAULT 'active'
                )
            """)
            
            conn.execute("""
                CREATE TABLE IF NOT EXISTS phase_stats (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    phase TEXT NOT NULL,
                    total_processed INTEGER DEFAULT 0,
                    total_success INTEGER DEFAULT 0,
                    total_failed INTEGER DEFAULT 0,
                    avg_duration_seconds REAL,
                    last_run_at TEXT,
                    total_cost REAL DEFAULT 0
                )
            """)
            
            # Create indexes for performance
            conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_phase ON jobs(current_phase)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_batch ON jobs(batch_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_errors_job ON error_log(job_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_errors_phase ON error_log(phase)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_errors_resolved ON error_log(is_resolved)")
            
            conn.commit()
    
    def add_job(self, job: Job) -> bool:
        """Add a new job to the database"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("""
                    INSERT OR REPLACE INTO jobs VALUES (
                        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                    )
                """, (
                    job.job_id, job.filename, job.file_hash, job.file_size,
                    job.current_phase, job.status, job.s3_original_key,
                    job.s3_ocr_key, job.s3_parsed_key, job.s3_enriched_key,
                    job.s3_organized_key, job.error_message, job.error_phase,
                    job.retry_count, job.questions_count, job.exams_count,
                    job.created_at, job.updated_at, job.completed_at,
                    job.batch_id, job.priority
                ))
                conn.commit()
            return True
        except Exception as e:
            print(f"Error adding job: {e}")
            return False
    
    def get_job(self, job_id: str) -> Optional[Job]:
        """Get a job by ID"""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute("SELECT * FROM jobs WHERE job_id = ?", (job_id,))
            row = cursor.fetchone()
            if row:
                return Job(**dict(row))
        return None
    
    def get_jobs_by_phase(self, phase: str, status: str = None, limit: int = None) -> List[Job]:
        """Get jobs by phase and optionally status"""
        query = "SELECT * FROM jobs WHERE current_phase = ?"
        params = [phase]
        
        if status:
            query += " AND status = ?"
            params.append(status)
        
        query += " ORDER BY priority DESC, created_at ASC"
        
        if limit:
            query += f" LIMIT {limit}"
        
        jobs = []
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(query, params)
            for row in cursor.fetchall():
                jobs.append(Job(**dict(row)))
        return jobs
    
    def update_job(self, job_id: str, **kwargs):
        """Update job fields"""
        kwargs['updated_at'] = datetime.now().isoformat()
        
        set_clause = ", ".join(f"{k} = ?" for k in kwargs.keys())
        values = list(kwargs.values()) + [job_id]
        
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(f"UPDATE jobs SET {set_clause} WHERE job_id = ?", values)
            conn.commit()
    
    def log_error(self, job_id: str, phase: str, error_type: str, error_message: str,
                  error_traceback: str = "", s3_location: str = "", input_data: str = "",
                  retry_attempt: int = 0):
        """Log an error to the error_log table"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                INSERT INTO error_log (
                    job_id, phase, error_type, error_message, error_traceback,
                    s3_location, input_data, occurred_at, retry_attempt
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                job_id, phase, error_type, error_message, error_traceback,
                s3_location, input_data, datetime.now().isoformat(), retry_attempt
            ))
            conn.commit()
        
        # Also save error details to file for easy access
        error_file = ERRORS_DIR / phase / f"{job_id}_{retry_attempt}.json"
        error_data = {
            "job_id": job_id,
            "phase": phase,
            "error_type": error_type,
            "error_message": error_message,
            "error_traceback": error_traceback,
            "s3_location": s3_location,
            "occurred_at": datetime.now().isoformat(),
            "retry_attempt": retry_attempt
        }
        with open(error_file, 'w') as f:
            json.dump(error_data, f, indent=2)
    
    def get_failed_jobs(self, phase: str = None, limit: int = None) -> List[Job]:
        """Get all failed jobs, optionally filtered by phase"""
        query = "SELECT * FROM jobs WHERE status = 'failed'"
        params = []
        
        if phase:
            query += " AND error_phase = ?"
            params.append(phase)
        
        query += " ORDER BY retry_count ASC, created_at ASC"
        
        if limit:
            query += f" LIMIT {limit}"
        
        jobs = []
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(query, params)
            for row in cursor.fetchall():
                jobs.append(Job(**dict(row)))
        return jobs
    
    def get_stats(self) -> Dict:
        """Get pipeline statistics"""
        stats = {
            "total_jobs": 0,
            "by_phase": {},
            "by_status": {},
            "errors": {
                "total": 0,
                "unresolved": 0,
                "by_phase": {}
            },
            "questions_total": 0,
            "exams_total": 0
        }
        
        with sqlite3.connect(self.db_path) as conn:
            # Total jobs
            cursor = conn.execute("SELECT COUNT(*) FROM jobs")
            stats["total_jobs"] = cursor.fetchone()[0]
            
            # By phase
            cursor = conn.execute("""
                SELECT current_phase, COUNT(*) as cnt 
                FROM jobs GROUP BY current_phase
            """)
            for row in cursor.fetchall():
                stats["by_phase"][row[0]] = row[1]
            
            # By status
            cursor = conn.execute("""
                SELECT status, COUNT(*) as cnt 
                FROM jobs GROUP BY status
            """)
            for row in cursor.fetchall():
                stats["by_status"][row[0]] = row[1]
            
            # Errors
            cursor = conn.execute("SELECT COUNT(*) FROM error_log")
            stats["errors"]["total"] = cursor.fetchone()[0]
            
            cursor = conn.execute("SELECT COUNT(*) FROM error_log WHERE is_resolved = 0")
            stats["errors"]["unresolved"] = cursor.fetchone()[0]
            
            cursor = conn.execute("""
                SELECT phase, COUNT(*) as cnt 
                FROM error_log WHERE is_resolved = 0 
                GROUP BY phase
            """)
            for row in cursor.fetchall():
                stats["errors"]["by_phase"][row[0]] = row[1]
            
            # Totals
            cursor = conn.execute("SELECT SUM(questions_count), SUM(exams_count) FROM jobs")
            row = cursor.fetchone()
            stats["questions_total"] = row[0] or 0
            stats["exams_total"] = row[1] or 0
        
        return stats
    
    def mark_for_retry(self, job_id: str, phase: str):
        """Mark a failed job for retry"""
        self.update_job(
            job_id,
            status=Status.RETRY_PENDING.value,
            current_phase=phase,
            error_message=""
        )
    
    def bulk_mark_for_retry(self, phase: str) -> int:
        """Mark all failed jobs in a phase for retry"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute("""
                UPDATE jobs 
                SET status = 'retry_pending', current_phase = ?, error_message = ''
                WHERE status = 'failed' AND error_phase = ?
            """, (phase, phase))
            conn.commit()
            return cursor.rowcount

    def clear_db(self):
        """Clear all pipeline data (jobs, errors, batches, stats)."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("DELETE FROM jobs")
            conn.execute("DELETE FROM error_log")
            conn.execute("DELETE FROM batches")
            conn.execute("DELETE FROM phase_stats")
            conn.commit()


class CacheManager:
    """Simple SQLite cache separate from the main pipeline DB.

    Purpose: keep a lightweight cache of file hashes, S3 keys or other
    auxiliary mappings which may diverge from the primary pipeline DB.
    """

    def __init__(self, cache_path: Path = None):
        self.cache_path = cache_path or (DATA_DIR / "pipeline_cache.db")
        # Ensure parent dirs
        DATA_DIR.mkdir(exist_ok=True)
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.cache_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS cache_entries (
                    key TEXT PRIMARY KEY,
                    value TEXT,
                    created_at TEXT,
                    updated_at TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS file_map (
                    file_hash TEXT PRIMARY KEY,
                    stored_name TEXT,
                    s3_key TEXT,
                    created_at TEXT
                )
            """)
            conn.commit()

    def set(self, key: str, value: str):
        now = datetime.now().isoformat()
        with sqlite3.connect(self.cache_path) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO cache_entries (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (key, value, now, now)
            )
            conn.commit()

    def get(self, key: str) -> Optional[str]:
        with sqlite3.connect(self.cache_path) as conn:
            cursor = conn.execute("SELECT value FROM cache_entries WHERE key = ?", (key,))
            row = cursor.fetchone()
            return row[0] if row else None

    def set_file_map(self, file_hash: str, stored_name: str, s3_key: str):
        with sqlite3.connect(self.cache_path) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO file_map (file_hash, stored_name, s3_key, created_at) VALUES (?, ?, ?, ?)",
                (file_hash, stored_name, s3_key, datetime.now().isoformat())
            )
            conn.commit()

    def get_file_map(self, file_hash: str) -> Optional[Tuple[str, str]]:
        with sqlite3.connect(self.cache_path) as conn:
            cursor = conn.execute("SELECT stored_name, s3_key FROM file_map WHERE file_hash = ?", (file_hash,))
            row = cursor.fetchone()
            return (row[0], row[1]) if row else None

    def clear_cache(self):
        """Remove cache DB file if exists or clear tables."""
        try:
            if self.cache_path.exists():
                # try remove file for a full clear
                self.cache_path.unlink()
                return True
        except Exception:
            pass

        # fallback: truncate tables if file still exists or removal failed
        try:
            with sqlite3.connect(self.cache_path) as conn:
                conn.execute("DELETE FROM cache_entries")
                conn.execute("DELETE FROM file_map")
                conn.commit()
            return True
        except Exception:
            return False


# ==========================================
# S3 Manager
# ==========================================

class S3Manager:
    """S3 operations for the manual pipeline"""
    
    def __init__(self):
        self.s3 = boto3.client('s3', config=boto_config)
        self.bucket = S3_BUCKET
        self.prefix = S3_MANUAL_PREFIX
    
    def list_objects(self, prefix: str = None, limit: int = 20) -> List[Dict]:
        """List objects in S3 bucket for debugging"""
        try:
            search_prefix = f"{self.prefix}{prefix}" if prefix else self.prefix
            response = self.s3.list_objects_v2(
                Bucket=self.bucket,
                Prefix=search_prefix,
                MaxKeys=limit
            )
            objects = []
            for obj in response.get('Contents', []):
                objects.append({
                    'Key': obj['Key'],
                    'Size': obj['Size'],
                    'LastModified': obj['LastModified'].isoformat()
                })
            return objects
        except Exception as e:
            return [{"error": str(e)}]
    
    def upload_pdf(self, local_path: Path, job_id: str, stored_name: str = None) -> Tuple[bool, str]:
        """Upload PDF to S3.

        If `stored_name` is provided it will be used (with forward-slashes) as
        the filename/key under the job folder. This preserves the last 3
        directories + filename to avoid collisions across years.
        """
        try:
            # Determine name to store in S3 (use provided stored_name or fallback)
            if stored_name:
                # ensure forward slashes for S3
                safe_name = stored_name.replace('\\', '/').lstrip('/\\')
            else:
                safe_name = local_path.name

            s3_key = f"{self.prefix}{job_id}/original/{safe_name}"

            # Ensure parent path in key is acceptable
            with open(local_path, 'rb') as f:
                self.s3.put_object(
                    Bucket=self.bucket,
                    Key=s3_key,
                    Body=f,
                    ContentType='application/pdf'
                )

            return True, s3_key
        except Exception as e:
            return False, str(e)
    
    def upload_json(self, data: Dict, job_id: str, phase: str, filename: str) -> Tuple[bool, str]:
        """Upload JSON data to S3"""
        try:
            base_name = os.path.splitext(filename)[0]
            s3_key = f"{self.prefix}{job_id}/{phase}_output/{base_name}_{phase}.json"
            
            self.s3.put_object(
                Bucket=self.bucket,
                Key=s3_key,
                Body=json.dumps(data, indent=2, ensure_ascii=False),
                ContentType='application/json'
            )
            
            return True, s3_key
        except Exception as e:
            return False, str(e)
    
    def download_json(self, s3_key: str) -> Tuple[bool, Dict]:
        """Download JSON from S3"""
        try:
            response = self.s3.get_object(Bucket=self.bucket, Key=s3_key)
            data = json.loads(response['Body'].read().decode('utf-8'))
            return True, data
        except Exception as e:
            return False, {"error": str(e)}
    
    def file_exists(self, s3_key: str) -> bool:
        """Check if file exists in S3"""
        try:
            self.s3.head_object(Bucket=self.bucket, Key=s3_key)
            return True
        except:
            return False


# ==========================================
# Phase Processors
# ==========================================

class PhaseProcessor:
    """Base class for phase processors"""
    
    def __init__(self, db: DatabaseManager, s3: S3Manager):
        self.db = db
        self.s3 = s3
        self.phase = Phase.UPLOAD
    
    def process_job(self, job: Job) -> Tuple[bool, str]:
        """Process a single job. Returns (success, message)"""
        raise NotImplementedError
    
    def process_batch(self, batch_size: int = 10, dry_run: bool = False) -> Dict:
        """Process a batch of jobs in the current phase"""
        # Get pending jobs for this phase
        jobs = self.db.get_jobs_by_phase(
            self.phase.value, 
            status=Status.PENDING.value,
            limit=batch_size
        )
        
        # Also get retry-pending jobs
        retry_jobs = self.db.get_jobs_by_phase(
            self.phase.value,
            status=Status.RETRY_PENDING.value,
            limit=batch_size - len(jobs)
        )
        jobs.extend(retry_jobs)
        
        if not jobs:
            print(f"No jobs pending for phase: {self.phase.value}")
            return {"processed": 0, "success": 0, "failed": 0}
        
        results = {
            "processed": 0,
            "success": 0,
            "failed": 0,
            "jobs": []
        }
        
        print(f"\n{'='*60}")
        print(f"Processing {len(jobs)} jobs for phase: {self.phase.value}")
        print(f"{'='*60}\n")
        
        for i, job in enumerate(jobs, 1):
            print(f"\n[{i}/{len(jobs)}] Processing: {job.filename}")
            print(f"  Job ID: {job.job_id}")
            
            if dry_run:
                print("  [DRY RUN] Would process this job")
                continue
            
            # Mark as in progress
            self.db.update_job(job.job_id, status=Status.IN_PROGRESS.value)
            
            start_time = time.time()
            try:
                success, message = self.process_job(job)
                duration = time.time() - start_time
                
                if success:
                    print(f"  ✓ Success ({duration:.1f}s): {message}")
                    results["success"] += 1
                    results["jobs"].append({
                        "job_id": job.job_id,
                        "status": "success",
                        "message": message
                    })
                else:
                    print(f"  ✗ Failed ({duration:.1f}s): {message}")
                    results["failed"] += 1
                    results["jobs"].append({
                        "job_id": job.job_id,
                        "status": "failed",
                        "message": message
                    })
                    
            except Exception as e:
                duration = time.time() - start_time
                error_msg = str(e)
                error_tb = traceback.format_exc()
                
                print(f"  ✗ Exception ({duration:.1f}s): {error_msg}")
                
                # Log error
                self.db.log_error(
                    job.job_id,
                    self.phase.value,
                    type(e).__name__,
                    error_msg,
                    error_tb,
                    retry_attempt=job.retry_count
                )
                
                # Update job
                self.db.update_job(
                    job.job_id,
                    status=Status.FAILED.value,
                    error_message=error_msg,
                    error_phase=self.phase.value,
                    retry_count=job.retry_count + 1
                )
                
                results["failed"] += 1
                results["jobs"].append({
                    "job_id": job.job_id,
                    "status": "error",
                    "message": error_msg
                })
            
            results["processed"] += 1
        
        print(f"\n{'='*60}")
        print(f"Batch Complete: {results['success']} success, {results['failed']} failed")
        print(f"{'='*60}\n")
        
        return results


class UploadProcessor(PhaseProcessor):
    """Process PDF uploads to S3"""
    
    def __init__(self, db: DatabaseManager, s3: S3Manager):
        super().__init__(db, s3)
        self.phase = Phase.UPLOAD
    
    def add_files(self, pdf_paths: List[Path], batch_id: str = None) -> Dict:
        """Add PDF files to the pipeline"""
        if not batch_id:
            batch_id = f"batch_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        results = {
            "batch_id": batch_id,
            "added": 0,
            "skipped": 0,
            "errors": []
        }

        # optional cache to store mappings (doesn't block upload on failure)
        try:
            cache = CacheManager()
        except Exception:
            cache = None
        
        for pdf_path in pdf_paths:
            if not pdf_path.exists():
                results["errors"].append(f"File not found: {pdf_path}")
                continue
            
            if not pdf_path.suffix.lower() == '.pdf':
                results["errors"].append(f"Not a PDF: {pdf_path}")
                continue
            
            # Calculate file hash for duplicate detection
            with open(pdf_path, 'rb') as f:
                file_hash = hashlib.md5(f.read()).hexdigest()
            
            # (duplicate skipping removed - always attempt upload)
            
            # Create job
            job = Job(
                job_id=str(uuid.uuid4()),
                filename=pdf_path.name,
                file_hash=file_hash,
                file_size=pdf_path.stat().st_size,
                current_phase=Phase.UPLOAD.value,
                status=Status.PENDING.value,
                created_at=datetime.now().isoformat(),
                updated_at=datetime.now().isoformat(),
                batch_id=batch_id
            )
            
            # Build stored name using last 3 directories + filename to avoid collisions
            posix_path = pdf_path.as_posix()
            parts = posix_path.split('/')
            tail = parts[-4:] if len(parts) >= 4 else parts
            stored_name = '/'.join(tail)

            # Upload to S3 with stored_name
            success, result = self.s3.upload_pdf(pdf_path, job.job_id, stored_name)

            if success:
                # store the display filename as the last-3-dirs + filename
                job.filename = stored_name
                job.s3_original_key = result
                job.current_phase = Phase.OCR.value  # Move to next phase
                job.status = Status.PENDING.value
                self.db.add_job(job)
                # record mapping in cache if available
                if cache:
                    try:
                        cache.set_file_map(file_hash, stored_name, result)
                    except Exception:
                        pass
                results["added"] += 1
                print(f"  ✓ Added: {stored_name}")
            else:
                results["errors"].append(f"Upload failed for {pdf_path.name}: {result}")
                print(f"  ✗ Failed: {pdf_path.name}")
        
        return results


class OCRProcessor(PhaseProcessor):
    """Process OCR using AWS Textract"""
    
    def __init__(self, db: DatabaseManager, s3: S3Manager):
        super().__init__(db, s3)
        self.phase = Phase.OCR
        self.textract = boto3.client('textract', config=boto_config)
    
    def process_job(self, job: Job) -> Tuple[bool, str]:
        """Run OCR on a single job"""
        
        # Verify S3 original key is present and accessible before starting Textract
        if not job.s3_original_key:
            self.db.update_job(
                job.job_id,
                status=Status.FAILED.value,
                error_message="Missing s3_original_key",
                error_phase=self.phase.value,
                retry_count=job.retry_count + 1
            )
            self.db.log_error(job.job_id, self.phase.value, "MissingS3Key", "s3_original_key is empty")
            return False, "Missing s3_original_key"

        try:
            exists = self.s3.file_exists(job.s3_original_key)
        except Exception as e:
            exists = False

        if not exists:
            msg = f"S3 object not found or inaccessible: {job.s3_original_key}"
            self.db.update_job(
                job.job_id,
                status=Status.FAILED.value,
                error_message=msg,
                error_phase=self.phase.value,
                retry_count=job.retry_count + 1
            )
            self.db.log_error(job.job_id, self.phase.value, "InvalidS3Object", msg)
            return False, msg

        # Start Textract job
        try:
            response = self.textract.start_document_text_detection(
                DocumentLocation={
                    'S3Object': {
                        'Bucket': S3_BUCKET,
                        'Name': job.s3_original_key
                    }
                },
                ClientRequestToken=job.job_id[:64]  # Max 64 chars
            )
            textract_job_id = response['JobId']
        except Exception as e:
            self.db.update_job(
                job.job_id,
                status=Status.FAILED.value,
                error_message=f"Textract start failed: {str(e)}",
                error_phase=self.phase.value,
                retry_count=job.retry_count + 1
            )
            self.db.log_error(job.job_id, self.phase.value, "TextractStartError", str(e))
            return False, f"Textract start failed: {str(e)}"
        
        # Poll for completion
        max_wait = 600  # 10 minutes
        poll_interval = 5
        elapsed = 0
        
        while elapsed < max_wait:
            try:
                status_response = self.textract.get_document_text_detection(JobId=textract_job_id)
                status = status_response['JobStatus']
                
                if status == 'SUCCEEDED':
                    break
                elif status == 'FAILED':
                    error_msg = status_response.get('StatusMessage', 'Unknown error')
                    self.db.update_job(
                        job.job_id,
                        status=Status.FAILED.value,
                        error_message=f"Textract failed: {error_msg}",
                        error_phase=self.phase.value,
                        retry_count=job.retry_count + 1
                    )
                    self.db.log_error(job.job_id, self.phase.value, "TextractJobFailed", error_msg)
                    return False, f"Textract failed: {error_msg}"
                
                time.sleep(poll_interval)
                elapsed += poll_interval
                
            except Exception as e:
                self.db.log_error(job.job_id, self.phase.value, "TextractPollError", str(e))
                return False, f"Textract poll error: {str(e)}"
        
        if elapsed >= max_wait:
            self.db.update_job(
                job.job_id,
                status=Status.FAILED.value,
                error_message="Textract timeout",
                error_phase=self.phase.value,
                retry_count=job.retry_count + 1
            )
            return False, "Textract timeout"
        
        # Collect all pages
        all_blocks = []
        next_token = None
        
        while True:
            try:
                if next_token:
                    response = self.textract.get_document_text_detection(
                        JobId=textract_job_id,
                        NextToken=next_token
                    )
                else:
                    response = self.textract.get_document_text_detection(JobId=textract_job_id)
                
                all_blocks.extend(response.get('Blocks', []))
                next_token = response.get('NextToken')
                
                if not next_token:
                    break
                    
            except Exception as e:
                self.db.log_error(job.job_id, self.phase.value, "TextractResultsError", str(e))
                return False, f"Error getting results: {str(e)}"
        
        # Extract text
        lines = []
        for block in all_blocks:
            if block['BlockType'] == 'LINE':
                lines.append({
                    'text': block.get('Text', ''),
                    'confidence': block.get('Confidence', 0),
                    'page': block.get('Page', 1)
                })
        
        # Build OCR output
        ocr_output = {
            'job_id': job.job_id,
            'filename': job.filename,
            'processed_at': datetime.now().isoformat(),
            'total_pages': max(b.get('Page', 1) for b in all_blocks) if all_blocks else 0,
            'total_lines': len(lines),
            'extracted_text': '\n'.join(l['text'] for l in lines),
            'lines': lines,
            'metadata': {
                'textract_job_id': textract_job_id,
                'blocks_count': len(all_blocks)
            }
        }
        
        # Upload OCR output to S3
        success, s3_key = self.s3.upload_json(ocr_output, job.job_id, "ocr", job.filename)
        
        if not success:
            self.db.update_job(
                job.job_id,
                status=Status.FAILED.value,
                error_message=f"S3 upload failed: {s3_key}",
                error_phase=self.phase.value,
                retry_count=job.retry_count + 1
            )
            return False, f"S3 upload failed: {s3_key}"
        
        # Update job and move to next phase
        self.db.update_job(
            job.job_id,
            s3_ocr_key=s3_key,
            current_phase=Phase.PARSE.value,
            status=Status.PENDING.value,
            error_message="",
            error_phase=""
        )
        
        return True, f"OCR complete: {len(lines)} lines extracted"


class ParseProcessor(PhaseProcessor):
    """Parse OCR text into structured questions"""
    
    def __init__(self, db: DatabaseManager, s3: S3Manager):
        super().__init__(db, s3)
        self.phase = Phase.PARSE
        self.bedrock = boto3.client('bedrock-runtime', region_name='ap-south-1', config=boto_config)
        self.model_id = "google.gemma-3-27b-it"
    
    def process_job(self, job: Job) -> Tuple[bool, str]:
        """Parse OCR output into structured questions"""
        
        # Download OCR output
        success, ocr_data = self.s3.download_json(job.s3_ocr_key)
        if not success:
            self.db.update_job(
                job.job_id,
                status=Status.FAILED.value,
                error_message=f"Failed to download OCR: {ocr_data.get('error')}",
                error_phase=self.phase.value
            )
            return False, f"Failed to download OCR output"
        
        extracted_text = ocr_data.get('extracted_text', '')
        if not extracted_text.strip():
            self.db.update_job(
                job.job_id,
                status=Status.FAILED.value,
                error_message="Empty OCR text",
                error_phase=self.phase.value
            )
            return False, "Empty OCR text"
        
        # Check text size - chunk if too large
        max_chars = 30000  # ~7500 tokens
        if len(extracted_text) > max_chars:
            # For now, truncate and note it
            extracted_text = extracted_text[:max_chars]
            print(f"  ⚠ Text truncated to {max_chars} characters")
        
        # Build prompt (simplified from parsing_pipeline.py)
        prompt = self._build_parsing_prompt(extracted_text)
        
        # Call Bedrock
        try:
            response = self.bedrock.invoke_model(
                modelId=self.model_id,
                contentType='application/json',
                accept='application/json',
                body=json.dumps({
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 8000,
                    "temperature": 0.3
                })
            )
            
            response_body = json.loads(response['body'].read())
            response_text = response_body.get('content', [{}])[0].get('text', '')
            
        except Exception as e:
            self.db.update_job(
                job.job_id,
                status=Status.FAILED.value,
                error_message=f"Bedrock API error: {str(e)}",
                error_phase=self.phase.value,
                retry_count=job.retry_count + 1
            )
            self.db.log_error(job.job_id, self.phase.value, "BedrockAPIError", str(e))
            return False, f"Bedrock API error: {str(e)}"
        
        # Parse JSON response
        try:
            # Clean and parse JSON
            json_str = self._clean_json_response(response_text)
            parsed_data = json.loads(json_str)
        except json.JSONDecodeError as e:
            self.db.update_job(
                job.job_id,
                status=Status.FAILED.value,
                error_message=f"JSON parse error: {str(e)}",
                error_phase=self.phase.value,
                retry_count=job.retry_count + 1
            )
            self.db.log_error(
                job.job_id, self.phase.value, "JSONParseError", str(e),
                input_data=response_text[:2000]
            )
            return False, f"JSON parse error: {str(e)}"
        
        # Validate structure
        exams = parsed_data.get('exams', [])
        total_questions = sum(len(e.get('questions', [])) for e in exams)
        
        if total_questions == 0:
            self.db.update_job(
                job.job_id,
                status=Status.FAILED.value,
                error_message="No questions parsed",
                error_phase=self.phase.value
            )
            return False, "No questions parsed"
        
        # Add metadata
        parsed_data['job_id'] = job.job_id
        parsed_data['filename'] = job.filename
        parsed_data['parsed_at'] = datetime.now().isoformat()
        parsed_data['total_exams'] = len(exams)
        parsed_data['total_questions'] = total_questions
        
        # Upload to S3
        success, s3_key = self.s3.upload_json(parsed_data, job.job_id, "parsed", job.filename)
        
        if not success:
            self.db.update_job(
                job.job_id,
                status=Status.FAILED.value,
                error_message=f"S3 upload failed: {s3_key}",
                error_phase=self.phase.value
            )
            return False, f"S3 upload failed"
        
        # Update job
        self.db.update_job(
            job.job_id,
            s3_parsed_key=s3_key,
            current_phase=Phase.ENRICH.value,
            status=Status.PENDING.value,
            questions_count=total_questions,
            exams_count=len(exams),
            error_message="",
            error_phase=""
        )
        
        return True, f"Parsed {total_questions} questions from {len(exams)} exam(s)"
    
    def _build_parsing_prompt(self, text: str) -> str:
        """Build the parsing prompt"""
        return f"""You are an expert parsing AI. Convert this exam paper text into structured JSON.

TEXT TO PARSE:
{text}

OUTPUT FORMAT (JSON only):
{{
  "exams": [
    {{
      "subject": "Subject Name",
      "max_marks": "100",
      "year": "2023",
      "semester": "III",
      "branch": "IT",
      "examType": "main",
      "questions": [
        {{
          "question_number": "Q1",
          "question_text": "Full question text",
          "marks": "10",
          "questionType": "text"
        }}
      ]
    }}
  ],
  "subjectsCreated": ["Subject Name"]
}}

RULES:
1. Extract ALL questions with their marks
2. Identify subject, year, semester from header
3. Handle "OR" questions as separate entries
4. Return ONLY valid JSON, no other text"""
    
    def _clean_json_response(self, text: str) -> str:
        """Clean markdown and extract JSON"""
        import re
        text = re.sub(r'```json\s*', '', text)
        text = re.sub(r'```\s*', '', text)
        
        start = text.find('{')
        end = text.rfind('}')
        if start != -1 and end != -1:
            return text[start:end+1]
        return text


class EnrichProcessor(PhaseProcessor):
    """Enrich questions with Bloom's taxonomy"""
    
    def __init__(self, db: DatabaseManager, s3: S3Manager):
        super().__init__(db, s3)
        self.phase = Phase.ENRICH
        self.bedrock = boto3.client('bedrock-runtime', region_name='ap-south-1', config=boto_config)
        self.model_id = "google.gemma-3-27b-it"
    
    def process_job(self, job: Job) -> Tuple[bool, str]:
        """Enrich parsed questions with Bloom's taxonomy"""
        
        # Download parsed output
        success, parsed_data = self.s3.download_json(job.s3_parsed_key)
        if not success:
            self.db.update_job(
                job.job_id,
                status=Status.FAILED.value,
                error_message="Failed to download parsed data",
                error_phase=self.phase.value
            )
            return False, "Failed to download parsed data"
        
        exams = parsed_data.get('exams', [])
        total_enriched = 0
        
        # Process each exam
        for exam in exams:
            questions = exam.get('questions', [])
            if not questions:
                continue
            
            subject = exam.get('subject', 'Unknown')
            
            # Enrich in batches of 10
            batch_size = 10
            for i in range(0, len(questions), batch_size):
                batch = questions[i:i+batch_size]
                
                try:
                    enrichments = self._enrich_batch(batch, subject)
                    
                    # Merge enrichments
                    for j, enrichment in enumerate(enrichments):
                        if i + j < len(questions):
                            questions[i + j].update(enrichment)
                            total_enriched += 1
                            
                except Exception as e:
                    print(f"    ⚠ Batch {i//batch_size + 1} enrichment failed: {e}")
                    # Continue with other batches
        
        if total_enriched == 0:
            self.db.update_job(
                job.job_id,
                status=Status.FAILED.value,
                error_message="No questions enriched",
                error_phase=self.phase.value
            )
            return False, "No questions enriched"
        
        # Add enrichment metadata
        parsed_data['enriched_at'] = datetime.now().isoformat()
        parsed_data['total_enriched'] = total_enriched
        
        # Upload to S3
        success, s3_key = self.s3.upload_json(parsed_data, job.job_id, "enriched", job.filename)
        
        if not success:
            self.db.update_job(
                job.job_id,
                status=Status.FAILED.value,
                error_message=f"S3 upload failed",
                error_phase=self.phase.value
            )
            return False, "S3 upload failed"
        
        # Update job
        self.db.update_job(
            job.job_id,
            s3_enriched_key=s3_key,
            current_phase=Phase.ORGANIZE.value,
            status=Status.PENDING.value,
            error_message="",
            error_phase=""
        )
        
        return True, f"Enriched {total_enriched} questions"
    
    def _enrich_batch(self, questions: List[Dict], subject: str) -> List[Dict]:
        """Enrich a batch of questions"""
        questions_text = "\n".join(
            f"{i+1}. {q.get('question_text', '')[:200]}"
            for i, q in enumerate(questions)
        )
        
        prompt = f"""Classify these {subject} exam questions using Bloom's Taxonomy.

QUESTIONS:
{questions_text}

For each question, return JSON array:
[
  {{
    "bloomLevel": "Apply",
    "difficulty": "Medium",
    "keywords": ["keyword1", "keyword2"],
    "topicsCovered": ["topic1", "topic2"]
  }}
]

Bloom's Levels: Recall, Understand, Apply, Analyze, Evaluate, Create
Difficulty: Easy, Medium, Hard

Return ONLY the JSON array."""

        response = self.bedrock.invoke_model(
            modelId=self.model_id,
            contentType='application/json',
            accept='application/json',
            body=json.dumps({
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 4000,
                "temperature": 0.3
            })
        )
        
        response_body = json.loads(response['body'].read())
        response_text = response_body.get('content', [{}])[0].get('text', '')
        
        # Parse response
        import re
        response_text = re.sub(r'```json\s*', '', response_text)
        response_text = re.sub(r'```\s*', '', response_text)
        
        start = response_text.find('[')
        end = response_text.rfind(']')
        if start != -1 and end != -1:
            return json.loads(response_text[start:end+1])
        
        return []


class OrganizeProcessor(PhaseProcessor):
    """Organize questions by subject"""
    
    def __init__(self, db: DatabaseManager, s3: S3Manager):
        super().__init__(db, s3)
        self.phase = Phase.ORGANIZE
    
    def process_job(self, job: Job) -> Tuple[bool, str]:
        """Organize enriched questions by subject"""
        
        # Download enriched output
        success, enriched_data = self.s3.download_json(job.s3_enriched_key)
        if not success:
            self.db.update_job(
                job.job_id,
                status=Status.FAILED.value,
                error_message="Failed to download enriched data",
                error_phase=self.phase.value
            )
            return False, "Failed to download enriched data"
        
        exams = enriched_data.get('exams', [])
        
        # Organize by subject
        organized = {}
        for exam in exams:
            subject = exam.get('subject', 'Unknown_Subject')
            subject_clean = self._sanitize_name(subject)
            
            if subject_clean not in organized:
                organized[subject_clean] = []
            
            organized[subject_clean].append(exam)
        
        # Create master index
        master_index = {
            'job_id': job.job_id,
            'filename': job.filename,
            'organized_at': datetime.now().isoformat(),
            'total_subjects': len(organized),
            'subjects': {}
        }
        
        # Upload each subject
        for subject, subject_exams in organized.items():
            total_questions = sum(len(e.get('questions', [])) for e in subject_exams)
            
            subject_data = {
                'subject': subject,
                'exams': subject_exams,
                'total_exams': len(subject_exams),
                'total_questions': total_questions
            }
            
            # Upload subject file
            s3_key = f"{S3_MANUAL_PREFIX}{job.job_id}/organized_output/{subject}/{subject}.json"
            self.s3.s3.put_object(
                Bucket=S3_BUCKET,
                Key=s3_key,
                Body=json.dumps(subject_data, indent=2, ensure_ascii=False),
                ContentType='application/json'
            )
            
            master_index['subjects'][subject] = {
                'total_exams': len(subject_exams),
                'total_questions': total_questions,
                's3_key': s3_key
            }
        
        # Upload master index
        master_s3_key = f"{S3_MANUAL_PREFIX}{job.job_id}/organized_output/_master_index.json"
        self.s3.s3.put_object(
            Bucket=S3_BUCKET,
            Key=master_s3_key,
            Body=json.dumps(master_index, indent=2),
            ContentType='application/json'
        )
        
        # Update job as complete
        self.db.update_job(
            job.job_id,
            s3_organized_key=master_s3_key,
            current_phase=Phase.COMPLETE.value,
            status=Status.SUCCESS.value,
            completed_at=datetime.now().isoformat(),
            error_message="",
            error_phase=""
        )
        
        return True, f"Organized into {len(organized)} subject(s)"
    
    def _sanitize_name(self, name: str) -> str:
        """Sanitize subject name for use as folder name"""
        import re
        name = re.sub(r'[^\w\s-]', '_', name)
        name = re.sub(r'\s+', '_', name)
        name = re.sub(r'_+', '_', name)
        return name.strip('_')[:100]


# ==========================================
# CLI Commands
# ==========================================

def cmd_status(args):
    """Show pipeline status"""
    db = DatabaseManager()
    stats = db.get_stats()
    
    print("\n" + "="*60)
    print("MANUAL PIPELINE STATUS")
    print("="*60)
    print(f"\nTotal Jobs: {stats['total_jobs']}")
    print(f"Total Questions: {stats['questions_total']}")
    print(f"Total Exams: {stats['exams_total']}")
    
    print("\nBy Phase:")
    for phase, count in stats['by_phase'].items():
        print(f"  {phase}: {count}")
    
    print("\nBy Status:")
    for status, count in stats['by_status'].items():
        print(f"  {status}: {count}")
    
    print("\nErrors:")
    print(f"  Total: {stats['errors']['total']}")
    print(f"  Unresolved: {stats['errors']['unresolved']}")
    if stats['errors']['by_phase']:
        print("  By Phase:")
        for phase, count in stats['errors']['by_phase'].items():
            print(f"    {phase}: {count}")
    
    print("\nData Directory:", DATA_DIR)
    print("="*60 + "\n")


def cmd_upload(args):
    """Upload PDFs to pipeline"""
    db = DatabaseManager()
    s3 = S3Manager()
    processor = UploadProcessor(db, s3)

    # Collect files
    path = Path(args.path)
    if path.is_file():
        pdf_files = [path]
    elif path.is_dir():
        print(f"\nScanning directory: {path}")
        print(f"Recursive search: {args.recursive}")
        
        # Use recursive by default, make it explicit
        if args.recursive:
            print("Using rglob to search all subdirectories...")
            all_files = list(path.rglob("*.pdf"))
        else:
            print("Using glob to search current directory only...")
            all_files = list(path.glob("*.pdf"))
        
        # Filter to only files (not directories)
        pdf_files = [file for file in all_files if file.is_file()]
        
        print(f"\nTotal files found: {len(all_files)}")
        print(f"PDF files found: {len(pdf_files)}")
        
        if len(pdf_files) < len(all_files):
            print("Non-PDF files or directories found:")
            for file in all_files:
                if file not in pdf_files:
                    print(f"  {file} ({'directory' if file.is_dir() else 'file'})")
        
        print("\nPDF files found:")
        for file in pdf_files:
            print(f"  {file}")
    else:
        print(f"Invalid path: {args.path}")
        return

    if not pdf_files:
        print("No PDF files found.")
        return

    print(f"\nFound {len(pdf_files)} PDF file(s)")

    if args.dry_run:
        print("\nDry run: The following files would be uploaded:")
        for pdf in pdf_files:
            print(f"  {pdf}")
        return

    confirm = input(f"\nUpload {len(pdf_files)} files? [y/N]: ")
    if confirm.lower() != 'y':
        print("Upload cancelled.")
        return

    results = processor.add_files(pdf_files, args.batch_id)

    print(f"\n✓ Added: {results['added']}")
    print(f"⊘ Skipped (duplicates): {results['skipped']}")
    if results['errors']:
        print("Errors:")
        for error in results['errors']:
            print(f"  {error}")


def cmd_process(args):
    """Process jobs in a specific phase"""
    db = DatabaseManager()
    s3 = S3Manager()
    
    processors = {
        'ocr': OCRProcessor,
        'parse': ParseProcessor,
        'enrich': EnrichProcessor,
        'organize': OrganizeProcessor
    }
    
    if args.phase not in processors:
        print(f"Unknown phase: {args.phase}")
        print(f"Available: {', '.join(processors.keys())}")
        return
    
    processor = processors[args.phase](db, s3)
    results = processor.process_batch(
        batch_size=args.batch_size,
        dry_run=args.dry_run
    )
    
    print(f"\nProcessed: {results['processed']}")
    print(f"Success: {results['success']}")
    print(f"Failed: {results['failed']}")


def cmd_retry_errors(args):
    """Retry failed jobs"""
    db = DatabaseManager()
    
    if args.all:
        for phase in ['ocr', 'parse', 'enrich', 'organize']:
            count = db.bulk_mark_for_retry(phase)
            print(f"Marked {count} {phase} failures for retry")
    elif args.phase:
        count = db.bulk_mark_for_retry(args.phase)
        print(f"Marked {count} {args.phase} failures for retry")
    elif args.job_id:
        job = db.get_job(args.job_id)
        if job:
            db.mark_for_retry(args.job_id, job.error_phase)
            print(f"Marked job {args.job_id} for retry")
        else:
            print(f"Job not found: {args.job_id}")
    else:
        print("Specify --phase, --job-id, or --all")


def cmd_export_errors(args):
    """Export error summary"""
    db = DatabaseManager()
    
    failed_jobs = db.get_failed_jobs(phase=args.phase)
    
    export_data = {
        'exported_at': datetime.now().isoformat(),
        'total_failures': len(failed_jobs),
        'by_phase': {},
        'jobs': []
    }
    
    for job in failed_jobs:
        phase = job.error_phase or 'unknown'
        if phase not in export_data['by_phase']:
            export_data['by_phase'][phase] = 0
        export_data['by_phase'][phase] += 1
        
        export_data['jobs'].append({
            'job_id': job.job_id,
            'filename': job.filename,
            'phase': phase,
            'error': job.error_message,
            'retry_count': job.retry_count,
            's3_key': job.s3_original_key
        })
    
    # Save to file
    export_file = EXPORTS_DIR / f"errors_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(export_file, 'w') as f:
        json.dump(export_data, f, indent=2)
    
    print(f"\nExported {len(failed_jobs)} failed jobs to:")
    print(f"  {export_file}")
    
    print("\nSummary by phase:")
    for phase, count in export_data['by_phase'].items():
        print(f"  {phase}: {count}")


def cmd_clear_db(args):
    """Clear pipeline or cache databases."""
    which = args.which
    if not args.yes:
        confirm = input(f"Are you sure you want to clear '{which}' DB(s)? This cannot be undone. [y/N]: ")
        if confirm.lower() != 'y':
            print("Cancelled.")
            return

    if which in ("pipeline", "both"):
        db = DatabaseManager()
        try:
            db.clear_db()
            print("Pipeline DB cleared.")
        except Exception as e:
            print(f"Failed to clear pipeline DB: {e}")

    if which in ("cache", "both"):
        try:
            cache = CacheManager()
            ok = cache.clear_cache()
            if ok:
                print("Cache DB cleared.")
            else:
                print("Failed to clear cache DB.")
        except Exception as e:
            print(f"Failed to clear cache DB: {e}")


def cmd_diagnose_s3(args):
    """Diagnose S3 connectivity and objects"""
    db = DatabaseManager()
    s3 = S3Manager()
    
    print("\n" + "="*60)
    print("S3 DIAGNOSTICS")
    print("="*60)
    
    # Test basic S3 access
    print(f"Bucket: {s3.bucket}")
    print(f"Prefix: {s3.prefix}")
    
    try:
        # Check if bucket exists and is accessible
        s3.s3.head_bucket(Bucket=s3.bucket)
        print("✓ Bucket accessible")
    except Exception as e:
        print(f"✗ Bucket access failed: {e}")
        return
    
    # List some objects
    print(f"\nListing up to {args.limit} objects...")
    objects = s3.list_objects(limit=args.limit)
    
    if not objects:
        print("No objects found in bucket")
    elif "error" in objects[0]:
        print(f"✗ Error listing objects: {objects[0]['error']}")
    else:
        print(f"Found {len(objects)} objects:")
        for obj in objects:
            print(f"  {obj['Key']} ({obj['Size']} bytes)")
    
    # Check failed jobs
    failed_jobs = db.get_failed_jobs(phase="ocr", limit=5)
    if failed_jobs:
        print(f"\nChecking {len(failed_jobs)} failed jobs:")
        for job in failed_jobs:
            print(f"\nJob: {job.job_id}")
            print(f"  S3 Key: {job.s3_original_key}")
            if job.s3_original_key:
                exists = s3.file_exists(job.s3_original_key)
                print(f"  Exists: {'✓' if exists else '✗'}")
    
    print("="*60 + "\n")


def cmd_check_job(args):
    """Check details of a specific job"""
    db = DatabaseManager()
    s3 = S3Manager()
    
    job = db.get_job(args.job_id)
    if not job:
        print(f"Job not found: {args.job_id}")
        return
    
    print(f"\nJob Details:")
    print(f"  ID: {job.job_id}")
    print(f"  Filename: {job.filename}")
    print(f"  Phase: {job.current_phase}")
    print(f"  Status: {job.status}")
    print(f"  File Hash: {job.file_hash}")
    print(f"  File Size: {job.file_size}")
    print(f"  S3 Original Key: {job.s3_original_key}")
    
    if job.s3_original_key:
        exists = s3.file_exists(job.s3_original_key)
        print(f"  S3 Object Exists: {'✓' if exists else '✗'}")
        
        if not exists:
            # Check if there are any objects for this job ID
            objects = s3.list_objects(prefix=f"{job.job_id}/", limit=10)
            if objects and "error" not in objects[0]:
                print(f"  Found {len(objects)} objects for this job:")
                for obj in objects:
                    print(f"    {obj['Key']}")
            else:
                print("  No objects found for this job ID")
    
    if job.error_message:
        print(f"  Error: {job.error_message}")


def cmd_list(args):
    """List jobs by phase or status"""
    db = DatabaseManager()
    
    jobs = db.get_jobs_by_phase(
        phase=args.phase,
        status=args.status,
        limit=args.limit
    )
    
    print(f"\nJobs in phase '{args.phase}'" + (f" with status '{args.status}'" if args.status else ""))
    print("-" * 80)
    
    for job in jobs:
        status_icon = "✓" if job.status == "success" else "✗" if job.status == "failed" else "○"
        print(f"{status_icon} {job.job_id[:8]}... | {job.filename[:40]:40} | {job.status}")
        if job.error_message and args.verbose:
            print(f"    Error: {job.error_message[:60]}...")
    
    print(f"\nTotal: {len(jobs)}")


def main():
    parser = argparse.ArgumentParser(
        description="Manual Pipeline CLI - Robust PDF Processing",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    
    subparsers = parser.add_subparsers(dest='command', help='Commands')
    
    # Status command
    status_parser = subparsers.add_parser('status', help='Show pipeline status')
    status_parser.set_defaults(func=cmd_status)
    
    # Upload command
    upload_parser = subparsers.add_parser('upload', help='Upload PDFs to pipeline')
    upload_parser.add_argument('path', help='Path to PDF file or directory')
    upload_parser.add_argument('-r', '--recursive', action='store_true', help='Recursively find PDFs')
    upload_parser.add_argument('--batch-id', help='Custom batch ID')
    upload_parser.add_argument('--dry-run', action='store_true', help='Show what would be uploaded')
    upload_parser.set_defaults(func=cmd_upload)
    
    # Process commands for each phase
    for phase in ['ocr', 'parse', 'enrich', 'organize']:
        phase_parser = subparsers.add_parser(phase, help=f'Process {phase} phase')
        phase_parser.add_argument('--batch-size', type=int, default=10, help='Batch size')
        phase_parser.add_argument('--dry-run', action='store_true', help='Show what would be processed')
        phase_parser.set_defaults(func=cmd_process, phase=phase)
    
    # Retry errors command
    retry_parser = subparsers.add_parser('retry-errors', help='Retry failed jobs')
    retry_parser.add_argument('--phase', help='Retry failures in specific phase')
    retry_parser.add_argument('--job-id', help='Retry specific job')
    retry_parser.add_argument('--all', action='store_true', help='Retry all failures')
    retry_parser.set_defaults(func=cmd_retry_errors)
    
    # Export errors command
    export_parser = subparsers.add_parser('export-errors', help='Export error summary')
    export_parser.add_argument('--phase', help='Filter by phase')
    export_parser.set_defaults(func=cmd_export_errors)

    # Clear DB command
    clear_parser = subparsers.add_parser('clear-db', help='Clear pipeline or cache DBs')
    clear_parser.add_argument('--which', choices=['pipeline', 'cache', 'both'], default='pipeline', help='Which DB to clear')
    clear_parser.add_argument('-y', '--yes', action='store_true', help='Confirm without prompt')
    clear_parser.set_defaults(func=cmd_clear_db)
    
    # S3 Diagnostics command
    s3_parser = subparsers.add_parser('diagnose-s3', help='Diagnose S3 connectivity issues')
    s3_parser.add_argument('--limit', type=int, default=20, help='Max objects to list')
    s3_parser.set_defaults(func=cmd_diagnose_s3)
    
    # Check job command
    check_parser = subparsers.add_parser('check-job', help='Check details of specific job')
    check_parser.add_argument('job_id', help='Job ID to check')
    check_parser.set_defaults(func=cmd_check_job)
    
    # List command
    list_parser = subparsers.add_parser('list', help='List jobs')
    list_parser.add_argument('phase', help='Phase to list')
    list_parser.add_argument('--status', help='Filter by status')
    list_parser.add_argument('--limit', type=int, default=50, help='Max results')
    list_parser.add_argument('-v', '--verbose', action='store_true', help='Show details')
    list_parser.set_defaults(func=cmd_list)
    
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        return
    
    args.func(args)


if __name__ == '__main__':
    main()
