# Redis Client Module

This module provides a centralized interface for all Redis operations in the AI Pipeline system. It implements the standardized naming conventions for Redis keys and provides easy-to-use methods for common Redis operations.

> **IMPORTANT**: Redis server is now required for the AI Pipeline to function. The system will fail to start if Redis is not available.

## Basic Usage

```python
from src import redis_client

# Redis operations will throw exceptions if Redis is unavailable
try:
    redis_client.add_image_to_preprocess_queue("job123")
    print("Job added to queue successfully")
except Exception as e:
    print(f"Redis operation failed: {e}")
```

## Redis Server Requirements

The AI Pipeline now strictly requires a running Redis server. Make sure Redis is properly installed and running before starting the pipeline:

```bash
# On Windows (using PowerShell)
# Check if Redis is running
Get-Service -Name Redis

# Start Redis if needed
Start-Service -Name Redis

# On Linux/macOS
# Check if Redis is running
redis-cli ping

# Start Redis if needed
redis-server
```

## Key Features

1. **Standardized Key Naming**: All Redis keys follow the naming convention documented in REDIS_NAMING_CONVENTION.md
2. **Error Handling**: All methods handle Redis connection errors gracefully
3. **JSON Serialization**: Methods for storing and retrieving JSON data
4. **Specialized Methods**: High-level methods for common AI Pipeline operations

## Available Methods

### Queue Operations
- `queue_push(queue_name, value)`: Add an item to a queue
- `queue_pop(queue_name)`: Get and remove the first item from a queue
- `queue_length(queue_name)`: Get the number of items in a queue
- `are_queues_empty()`: Check if all queues are empty

### Hash Operations
- `hash_set(hash_name, field, value)`: Set a field in a hash
- `hash_set_map(hash_name, mapping)`: Set multiple fields in a hash
- `hash_get(hash_name, field)`: Get a field from a hash
- `hash_get_json(hash_name, field)`: Get a field from a hash and parse it as JSON
- `hash_get_all(hash_name)`: Get all fields from a hash
- `hash_delete(hash_name, field)`: Delete a field from a hash
- `hash_keys(hash_name)`: Get all keys from a hash

### AI Pipeline Specific

### Page Metadata Methods
- `store_page_metadata(page_id, pdf_id, pdf_location, page_no, status, result, retry_count, image_data)`: Store metadata for a page with explicit parameters
- `store_page_metadata_dict(page_id, metadata)`: Legacy method for backward compatibility
- `get_page_metadata(page_id)`: Get metadata for a page
- `update_page_metadata(page_id, field, value)`: Update a specific field in page metadata

### PDF Metadata Methods
- `store_pdf_metadata(pdf_id, file_path, page_count, status, pages_ids)`: Store metadata for a PDF with explicit parameters
- `store_pdf_metadata_dict(pdf_id, metadata)`: Legacy method for backward compatibility
- `get_pdf_metadata(pdf_id)`: Get metadata for a PDF

### Task Metadata Methods
- `store_task_metadata(task_id, total_pages, jobs_ids, processed_pages, processed_jobs_ids, status)`: Store task metadata with explicit parameters
- `store_task_metadata_dict(task_id, metadata)`: Legacy method for backward compatibility

### Queue Operations
- `add_image_to_preprocess_queue(job_id)`: Add a job ID to the image preprocessing queue
- `get_next_image_from_preprocess_queue()`: Get the next job ID from the image preprocessing queue
- `add_to_final_results_queue(job_id)`: Add a job ID to the final results queue
- `get_next_result_from_queue()`: Get the next job ID from the final results queue

### Result Storage
- `store_processed_result(job_id, task_id, text, confidence, status, page_no)`: Store a processed OCR result with explicit parameters
- `store_processed_result_dict(job_id, result_data)`: Legacy method for backward compatibility

## Redis Keys

All Redis keys are defined as constants in the `RedisKeys` class:

```python
class RedisKeys:
    # Queue keys
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
```

## Example: Processing a PDF Page

```python
from src import redis_client
import uuid

# Generate unique IDs
pdf_id = str(uuid.uuid4())
page_id = str(uuid.uuid4())

# Store PDF metadata with explicit parameters
redis_client.store_pdf_metadata(
    pdf_id=pdf_id,
    file_path="/path/to/pdf",
    page_count=10,
    pages_ids=[page_id]
)

# Store page metadata with explicit parameters
redis_client.store_page_metadata(
    page_id=page_id,
    pdf_id=pdf_id,
    pdf_location="/path/to/pdf",
    page_no=1,
    status=redis_client.JobStatus.QUEUED
)

# Add the page ID to the preprocessing queue
redis_client.add_image_to_preprocess_queue(page_id)

# Later, store OCR result
redis_client.store_processed_result(
    job_id=page_id,
    task_id=pdf_id,
    text="Extracted text content from the page...",
    confidence=0.95,
    page_no=1
)
```

## Example: Using Legacy Dictionary Methods

For backward compatibility with existing code:

```python
from src import redis_client
import uuid

# Generate a unique ID for this page
page_id = str(uuid.uuid4())
pdf_id = str(uuid.uuid4())

# Store metadata using dictionary method
page_metadata = {
    "pageId": page_id,
    "pdfLocation": "/path/to/pdf",
    "pdfId": pdf_id,
    "pageNo": 1,
    "status": "queued",
    "retryCount": 0
}
redis_client.store_page_metadata_dict(page_id, page_metadata)
```