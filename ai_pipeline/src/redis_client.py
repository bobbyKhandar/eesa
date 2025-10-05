"""
Redis client module for the AI Pipeline.
Centralizes all Redis operations with standardized key naming and structured access methods.
"""

import json
import redis
from typing import Dict, List, Any, Optional, Union, TypedDict, Literal
from datetime import datetime

# Data models for type checking and schema validation
class PageMetadata(TypedDict, total=False):
    """Data model for page metadata"""
    pageId: str                # Unique identifier for the page
    pdfId: str                 # ID of the parent PDF
    pdfLocation: str           # Path to the PDF file
    pageNo: int                # Page number in the PDF
    status: str                # Current status of processing
    result: str                # OCR result text or JSON string
    retryCount: int            # Number of retry attempts
    imageData: str             # Processed image data (often as hex string)
    createdAt: str             # Timestamp of creation
    lastUpdated: str           # Timestamp of last update

class PDFMetadata(TypedDict, total=False):
    """Data model for PDF metadata"""
    pdfId: str                 # Unique identifier for the PDF
    filePath: str              # Path to the PDF file
    pageCount: int             # Total number of pages
    status: str                # Current status of processing
    pagesIds: List[str]        # List of page IDs in this PDF
    createdAt: str             # Timestamp of creation

class TaskMetadata(TypedDict, total=False):
    """Data model for task metadata"""
    taskId: str                # Unique identifier for the task
    totalPages: int            # Total number of pages in task
    processedPages: int        # Number of processed pages
    jobsIds: List[str]         # List of job IDs in this task
    processedJobsIds: List[str] # List of processed job IDs
    status: str                # Current status of the task
    createdAt: str             # Timestamp of creation

class OCRResult(TypedDict, total=False):
    """Data model for OCR result data"""
    jobId: str                 # Unique identifier for the job
    taskId: str                # ID of the parent task
    text: str                  # Extracted text content
    confidence: float          # Confidence score (0-1)
    status: str                # Status of the OCR job
    pageNo: int                # Page number in original document
    processedAt: str           # Timestamp of processing

class BatchMetadata(TypedDict, total=False):
    """Data model for batch processing metadata"""
    batch_id: str              # Unique identifier for the batch
    total_jobs: int            # Total number of jobs in batch
    completed_jobs: int        # Number of completed jobs
    failed_jobs: int           # Number of failed jobs
    status: str                # Batch status: 'processing', 'completed', 'failed', 'partial_success'
    start_time: str            # Batch processing start timestamp
    end_time: str              # Batch processing end timestamp
    job_ids: List[str]         # List of job IDs in this batch
    failed_job_ids: List[str]  # List of failed job IDs
    results: Dict[str, Any]    # Results for each job

class BatchResult(TypedDict, total=False):
    """Data model for final batch processing results"""
    batch_id: str              # Unique identifier for the batch
    success: bool              # Overall batch success status
    total_jobs: int            # Total number of jobs processed
    successful_jobs: int       # Number of successfully processed jobs
    failed_jobs: int           # Number of failed jobs
    processing_time: float     # Total processing time in seconds
    status: str                # Final status
    results: Dict[str, Any]    # Detailed results for each job
    errors: List[Dict[str, Any]] # Error details for failed jobs

# Status constants
class JobStatus:
    QUEUED = "queued"          # Job is in the queue
    PENDING = "pending"        # Job is pending processing
    IN_PROGRESS = "in_progress" # Job is being processed
    COMPLETE = "complete"      # Job has completed processing
    ERROR = "error"            # Job encountered an error

# Initialize global Redis connection - Redis is required
try:
    redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)
    redis_client.ping()  # Test connection
    REDIS_AVAILABLE = True
except redis.exceptions.ConnectionError as e:
    # Raise an exception since Redis is required
    raise RuntimeError(f"Redis server is not available. Please ensure Redis is running: {e}")

# Define Redis key patterns as constants
class RedisKeys:
    # Main intake queue
    QUEUE_MAIN_INTAKE = "ai_pipeline_queue"
    
    # Processing queues
    QUEUE_IMAGE_PREPROCESS = "queue:image:preprocess"
    QUEUE_IMAGE_PROCESSED = "queue:image:processed"
    QUEUE_IMAGE_PROCESSING = "queue:image:processing"
    QUEUE_OCR = "queue:ocr"
    QUEUE_MERGE = "queue:merge"
    QUEUE_RESULTS_FINAL = "queue:results:final"
    
    # Metadata keys - use with suffixes
    META_PAGE_PREFIX = "meta:page:"  # Use with page ID
    META_PDF = "meta:pdf"            # Hash with PDF IDs as fields
    
    # Task metadata
    TASK_METADATA = "meta:task"      # Hash with task IDs as fields

    @staticmethod
    def meta_page_key(page_id: str) -> str:
        """Get the full Redis key for page metadata"""
        return f"{RedisKeys.META_PAGE_PREFIX}{page_id}"

# Queue Operations
def queue_push(queue_name: str, value: str) -> bool:
    """Push a value to a Redis queue (List)"""
    try:
        redis_client.rpush(queue_name, value)
        return True
    except Exception as e:
        print(f"Redis error in queue_push: {e}")
        raise

def queue_pop(queue_name: str) -> Optional[str]:
    """Pop a value from a Redis queue (List)"""
    try:
        return redis_client.lpop(queue_name)
    except Exception as e:
        print(f"Redis error in queue_pop: {e}")
        raise

def queue_length(queue_name: str) -> int:
    """Get the length of a Redis queue (List)"""
    try:
        return redis_client.llen(queue_name)
    except Exception as e:
        print(f"Redis error in queue_length: {e}")
        raise

# Hash Operations
def hash_set(hash_name: str, field: str, value: Union[str, dict, list, int, float, bool]) -> bool:
    """Set a field in a Redis hash"""
    try:
        if isinstance(value, (dict, list)):
            # For dictionary and list values, serialize to JSON
            redis_client.hset(hash_name, field, json.dumps(value))
        elif isinstance(value, (int, float, bool)):
            # Convert numbers and booleans to string
            redis_client.hset(hash_name, field, str(value))
        else:
            # Assume string or already serializable
            redis_client.hset(hash_name, field, str(value))
        return True
    except Exception as e:
        print(f"Redis error in hash_set: {e}")
        raise

def hash_set_map(hash_name: str, mapping: dict) -> bool:
    """Set multiple fields in a Redis hash using a mapping"""
    try:
        # Convert all values to strings/JSON for Redis storage
        serialized_mapping = {}
        for key, value in mapping.items():
            if isinstance(value, (dict, list)):
                serialized_mapping[key] = json.dumps(value)
            elif isinstance(value, (int, float, bool)):
                serialized_mapping[key] = str(value)
            else:
                serialized_mapping[key] = str(value)
        
        redis_client.hset(hash_name, mapping=serialized_mapping)
        return True
    except Exception as e:
        print(f"Redis error in hash_set_map: {e}")
        raise

def hash_get(hash_name: str, field: str) -> Optional[str]:
    """Get a field from a Redis hash"""
    try:
        return redis_client.hget(hash_name, field)
    except Exception as e:
        print(f"Redis error in hash_get: {e}")
        raise

def hash_get_json(hash_name: str, field: str) -> Optional[dict]:
    """Get a field from a Redis hash and parse it as JSON"""
    value = hash_get(hash_name, field)
    if value:
        try:
            return json.loads(value)
        except json.JSONDecodeError as e:
            print(f"JSON parsing error in hash_get_json: {e}")
            return None
    return None

def hash_get_all(hash_name: str) -> Dict[str, str]:
    """Get all fields from a Redis hash"""
    try:
        return redis_client.hgetall(hash_name)
    except Exception as e:
        print(f"Redis error in hash_get_all: {e}")
        raise

def hash_delete(hash_name: str, field: str) -> bool:
    """Delete a field from a Redis hash"""
    try:
        redis_client.hdel(hash_name, field)
        return True
    except Exception as e:
        print(f"Redis error in hash_delete: {e}")
        raise

def hash_keys(hash_name: str) -> List[str]:
    """Get all keys from a Redis hash"""
    try:
        return redis_client.hkeys(hash_name)
    except Exception as e:
        print(f"Redis error in hash_keys: {e}")
        raise

# Specialized Methods for AI Pipeline
def store_page_metadata(
    page_id: str, 
    pdf_id: str,
    pdf_location: str,
    page_no: int,
    status: str = JobStatus.QUEUED,
    result: str = "",
    retry_count: int = 0,
    image_data: str = ""
) -> bool:
    """Store metadata for a page with explicit schema parameters"""
    metadata: PageMetadata = {
        "pageId": page_id,
        "pdfId": pdf_id,
        "pdfLocation": pdf_location,
        "pageNo": page_no,
        "status": status,
        "result": result,
        "retryCount": retry_count,
        "imageData": image_data,
        "createdAt": datetime.now().isoformat(),
        "lastUpdated": datetime.now().isoformat()
    }
    return hash_set_map(RedisKeys.meta_page_key(page_id), metadata)

def get_page_metadata(page_id: str) -> Dict[str, str]:
    """Get metadata for a page"""
    return hash_get_all(RedisKeys.meta_page_key(page_id))

def store_page_metadata_dict(page_id: str, metadata: Dict[str, Any]) -> bool:
    """Store metadata for a page using a dictionary (backward compatibility)"""
    if "lastUpdated" not in metadata:
        metadata["lastUpdated"] = datetime.now().isoformat()
    return hash_set_map(RedisKeys.meta_page_key(page_id), metadata)
    
def update_page_metadata(page_id: str, field: str, value: Any) -> bool:
    """Update a specific field in page metadata"""
    # Also update the lastUpdated timestamp
    success = hash_set(RedisKeys.meta_page_key(page_id), field, value)
    if success:
        hash_set(RedisKeys.meta_page_key(page_id), "lastUpdated", datetime.now().isoformat())
    return success

def store_pdf_metadata(
    pdf_id: str, 
    file_path: str,
    page_count: int,
    status: str = JobStatus.QUEUED,
    pages_ids: List[str] = None
) -> bool:
    """Store metadata for a PDF with explicit schema parameters"""
    metadata: PDFMetadata = {
        "pdfId": pdf_id,
        "filePath": file_path,
        "pageCount": page_count,
        "status": status,
        "pagesIds": pages_ids or [],
        "createdAt": datetime.now().isoformat()
    }
    return hash_set(RedisKeys.META_PDF, pdf_id, metadata)
    
def store_pdf_metadata_dict(pdf_id: str, metadata: Dict[str, Any]) -> bool:
    """Store metadata for a PDF using a dictionary (backward compatibility)"""
    return hash_set(RedisKeys.META_PDF, pdf_id, metadata)

def get_pdf_metadata(pdf_id: str) -> Optional[Dict[str, Any]]:
    """Get metadata for a PDF"""
    return hash_get_json(RedisKeys.META_PDF, pdf_id)

def add_image_to_preprocess_queue(job_id: str) -> bool:
    """Add a job ID to the image preprocessing queue"""
    return queue_push(RedisKeys.QUEUE_IMAGE_PREPROCESS, job_id)

def get_next_image_from_preprocess_queue() -> Optional[str]:
    """Get the next job ID from the image preprocessing queue"""
    return queue_pop(RedisKeys.QUEUE_IMAGE_PREPROCESS)

def add_to_final_results_queue(job_id: str) -> bool:
    """Add a job ID to the final results queue"""
    return queue_push(RedisKeys.QUEUE_RESULTS_FINAL, job_id)

def get_next_result_from_queue() -> Optional[str]:
    """Get the next job ID from the final results queue"""
    return queue_pop(RedisKeys.QUEUE_RESULTS_FINAL)

def store_processed_result(
    job_id: str,
    task_id: str,
    text: str,
    confidence: float,
    status: str = JobStatus.COMPLETE,
    page_no: int = 0
) -> bool:
    """Store a processed OCR result with explicit schema parameters"""
    result: OCRResult = {
        "jobId": job_id,
        "taskId": task_id,
        "text": text,
        "confidence": confidence,
        "status": status,
        "pageNo": page_no,
        "processedAt": datetime.now().isoformat()
    }
    return hash_set_map(job_id, result)
    
def store_processed_result_dict(job_id: str, result_data: Dict[str, Any]) -> bool:
    """Store a processed OCR result using a dictionary (backward compatibility)"""
    if "processedAt" not in result_data:
        result_data["processedAt"] = datetime.now().isoformat()
    return hash_set_map(job_id, result_data)

def are_queues_empty() -> bool:
    """Check if all queues are empty"""
    return (queue_length(RedisKeys.QUEUE_OCR) == 0 and 
            queue_length(RedisKeys.QUEUE_IMAGE_PREPROCESS) == 0 and 
            queue_length(RedisKeys.QUEUE_MERGE) == 0)

def get_processing_queue_keys() -> List[str]:
    """Get all keys in the image processing queue"""
    return hash_keys(RedisKeys.QUEUE_IMAGE_PROCESSING)

def get_processing_queue_item(key: str) -> Optional[str]:
    """Get an item from the image processing queue"""
    return hash_get(RedisKeys.QUEUE_IMAGE_PROCESSING, key)

def remove_processing_queue_item(key: str) -> bool:
    """Remove an item from the image processing queue"""
    return hash_delete(RedisKeys.QUEUE_IMAGE_PROCESSING, key)
    
def store_task_metadata(
    task_id: str,
    total_pages: int,
    jobs_ids: List[str],
    processed_pages: int = 0,
    processed_jobs_ids: List[str] = None,
    status: str = JobStatus.IN_PROGRESS
) -> bool:
    """Store task metadata with explicit schema parameters"""
    metadata: TaskMetadata = {
        "taskId": task_id,
        "totalPages": total_pages,
        "processedPages": processed_pages,
        "jobsIds": jobs_ids,
        "processedJobsIds": processed_jobs_ids or [],
        "status": status,
        "createdAt": datetime.now().isoformat()
    }
    return hash_set(RedisKeys.TASK_METADATA, task_id, metadata)
    
def store_task_metadata_dict(task_id: str, metadata: Dict[str, Any]) -> bool:
    """Store task metadata using a dictionary (backward compatibility)"""
    return hash_set(RedisKeys.TASK_METADATA, task_id, metadata)

def is_redis_available() -> bool:
    """Check if Redis is available"""
    try:
        redis_client.ping()
        return True
    except Exception:
        return False

# Batch Processing Functions
def store_batch_metadata(batch_id: str, total_jobs: int, job_ids: List[str], status: str = "processing") -> bool:
    """Store batch processing metadata"""
    try:
        import time
        batch_data: BatchMetadata = {
            "batch_id": batch_id,
            "total_jobs": total_jobs,
            "completed_jobs": 0,
            "failed_jobs": 0,
            "status": status,
            "start_time": str(time.time()),
            "end_time": "",
            "job_ids": job_ids,
            "failed_job_ids": [],
            "results": {}
        }
        return hash_set(f"batch:metadata:{batch_id}", "data", batch_data)
    except Exception as e:
        print(f"Error storing batch metadata: {e}")
        return False

def update_batch_progress(batch_id: str, job_id: str, success: bool, result: Dict[str, Any] = None) -> bool:
    """Update batch processing progress"""
    try:
        batch_data = hash_get_json(f"batch:metadata:{batch_id}", "data")
        if not batch_data:
            return False
        
        if success:
            batch_data["completed_jobs"] += 1
            if result:
                batch_data["results"][job_id] = result
        else:
            batch_data["failed_jobs"] += 1
            batch_data["failed_job_ids"].append(job_id)
            if result:
                batch_data["results"][job_id] = {"error": result}
        
        # Update status
        total_processed = batch_data["completed_jobs"] + batch_data["failed_jobs"]
        if total_processed >= batch_data["total_jobs"]:
            batch_data["status"] = "completed" if batch_data["failed_jobs"] == 0 else "partial_success"
            import time
            batch_data["end_time"] = str(time.time())
        
        return hash_set(f"batch:metadata:{batch_id}", "data", batch_data)
    except Exception as e:
        print(f"Error updating batch progress: {e}")
        return False

def get_batch_result(batch_id: str) -> BatchResult:
    """Get final batch processing result"""
    try:
        batch_data = hash_get_json(f"batch:metadata:{batch_id}", "data")
        if not batch_data:
            return {"error": "Batch not found"}
        
        processing_time = 0.0
        if batch_data.get("end_time") and batch_data.get("start_time"):
            processing_time = float(batch_data["end_time"]) - float(batch_data["start_time"])
        
        result: BatchResult = {
            "batch_id": batch_id,
            "success": batch_data["status"] == "completed",
            "total_jobs": batch_data["total_jobs"],
            "successful_jobs": batch_data["completed_jobs"],
            "failed_jobs": batch_data["failed_jobs"],
            "processing_time": processing_time,
            "status": batch_data["status"],
            "results": batch_data["results"],
            "errors": [batch_data["results"].get(job_id, {}) for job_id in batch_data.get("failed_job_ids", [])]
        }
        
        return result
    except Exception as e:
        print(f"Error getting batch result: {e}")
        return {"error": str(e)}

def process_main_queue_batch(batch_size: int = 10) -> Dict[str, Any]:
    """Process jobs from main intake queue in batches"""
    try:
        import uuid
        
        # Get batch of jobs from main queue
        jobs = []
        for _ in range(batch_size):
            job = queue_pop(RedisKeys.QUEUE_MAIN_INTAKE)
            if job and job != "STOP":
                jobs.append(job)
            else:
                break
        
        if not jobs:
            return {"message": "No jobs in queue", "batch_id": None}
        
        # Create batch
        batch_id = str(uuid.uuid4())
        job_ids = [str(uuid.uuid4()) for _ in jobs]
        
        # Store batch metadata
        store_batch_metadata(batch_id, len(jobs), job_ids)
        
        print(f"Created batch {batch_id} with {len(jobs)} jobs")
        
        return {
            "batch_id": batch_id,
            "jobs": jobs,
            "job_ids": job_ids,
            "total_jobs": len(jobs)
        }
    except Exception as e:
        print(f"Error processing main queue batch: {e}")
        return {"error": str(e)}

def get_batch_status(batch_id: str) -> Dict[str, Any]:
    """Get current status of a batch"""
    try:
        batch_data = hash_get_json(f"batch:metadata:{batch_id}", "data")
        if not batch_data:
            return {"error": "Batch not found"}
        
        return {
            "batch_id": batch_id,
            "status": batch_data["status"],
            "total_jobs": batch_data["total_jobs"],
            "completed_jobs": batch_data["completed_jobs"],
            "failed_jobs": batch_data["failed_jobs"],
            "progress_percentage": (batch_data["completed_jobs"] + batch_data["failed_jobs"]) / batch_data["total_jobs"] * 100
        }
    except Exception as e:
        print(f"Error getting batch status: {e}")
        return {"error": str(e)}