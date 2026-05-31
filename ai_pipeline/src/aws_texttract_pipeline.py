"""
AWS Textract Asynchronous Processing Pipeline
=============================================

Purpose:
--------
This script provides a robust, fault-tolerant mechanism to process documents stored in AWS S3 
using AWS Textract's asynchronous API. It manages job submission, polling, result pagination, 
error handling, and cost estimation.

Key Features:
-------------
1. Asynchronous Workflow: Handles large multi-page PDFs via `start_document_text_detection`.
2. Double-Layer Retry Logic: 
   - Internal Retry: Retries API calls on timeout/failure.
   - Batch Retry: Re-queues failed files for subsequent processing rounds.
3. Output Management: Saves structured JSON (text + metadata) back to S3.

Environment Variables:
----------------------
- S3_BUCKET: Target bucket name (default: 'eesa-pipeline-storage')
- SNS_TOPIC_ARN: (Optional) SNS Topic for notifications
- SNS_ROLE_ARN: (Required if using SNS) IAM Role for Textract

Usage Examples:
---------------

1. Batch Processing (Recommended for multiple files):
   --------------------------------------------------
   files_to_process = [
       ('my-bucket', 'path/to/file1.pdf', 'job-uuid-1'),
       ('my-bucket', 'path/to/file2.pdf', 'job-uuid-2')
   ]
   # automatically retries failed files up to MAX_BATCH_RETRY_ROUNDS
   summary = process_batch_with_retry(files_to_process)
   print(f"Success rate: {summary['success_rate']}%")

2. Single Document Processing:
   ---------------------------
   # Processes one file, handles polling, and saves output to S3
   success = process_document_async(
       s3_bucket='my-bucket', 
       s3_key='path/to/doc.pdf', 
       job_id='unique-job-id'
   )

3. Low-Level Manual Control (Custom Workflow):
   -------------------------------------------
   # Step A: Start the job
   job_id = start_textract_job('my-bucket', 'path/to/doc.pdf', 'my-ref-id')
   
   # Step B: Poll and retrieve results manually
   if job_id:
       data = get_textract_results(job_id)
       if data:
           print(data['extracted_text'])
"""

import boto3
import os
import json
import time
from datetime import datetime
from typing import Dict, Optional, List, Tuple

# ==========================================
# AWS Client Initialization
# ==========================================
textract = boto3.client('textract')
s3_client = boto3.client('s3')

# ==========================================
# Configuration & Constants
# ==========================================

# S3 Configuration
S3_BUCKET = os.getenv('S3_BUCKET', 'eesa-pipeline-storage')
S3_JOBS_PREFIX = 'jobs/'  # Base prefix for all jobs

# Processing Limits & Toggles
MAX_RETRIES = 3             # Internal retries for API calls (start job/get results)
MAX_BATCH_RETRY_ROUNDS = 3  # How many times to re-loop through the entire failed batch
COST_PER_PAGE_ASYNC = 0.0015 # AWS Textract pricing (us-east-1 standard)

# Notification Config (Optional)
SNS_TOPIC_ARN = os.getenv('SNS_TOPIC_ARN', '') 
SNS_ROLE_ARN = os.getenv('SNS_ROLE_ARN', '')    


def start_textract_job(s3_bucket: str, s3_key: str, job_id: str) -> Optional[str]:
    """
    Start asynchronous Textract job for a document in S3.
    
    Args:
        s3_bucket: S3 bucket name where the PDF is stored
        s3_key: S3 key (path) to the PDF file
        job_id: Unique job identifier for tracking
        
    Returns:
        str: Textract JobId if successful, None otherwise
    """
    try:
        print(f"🚀 Starting Textract job for: s3://{s3_bucket}/{s3_key}")
        
        request_params = {
            'DocumentLocation': {
                'S3Object': {
                    'Bucket': s3_bucket,
                    'Name': s3_key
                }
            },
            'ClientRequestToken': job_id  # Use our job_id as idempotency token
        }
        
        # Add SNS notification if configured
        if SNS_TOPIC_ARN and SNS_ROLE_ARN:
            request_params['NotificationChannel'] = {
                'SNSTopicArn': SNS_TOPIC_ARN,
                'RoleArn': SNS_ROLE_ARN
            }
        
        response = textract.start_document_text_detection(**request_params)
        textract_job_id = response['JobId']
        
        print(f"✓ Textract job started: {textract_job_id}")
        return textract_job_id
        
    except Exception as e:
        print(f"✗ Error starting Textract job: {e}")
        return None

def get_textract_results(textract_job_id: str, max_wait_seconds: int = 600) -> Optional[Dict]:
    """
    Poll Textract job status and retrieve results when complete.
    
    Args:
        textract_job_id: The JobId returned from start_document_text_detection
        max_wait_seconds: Maximum time to wait for job completion (default: 10 minutes)
        
    Returns:
        dict: Extracted text data with metadata, or None if failed
    """
    try:
        print(f"⏳ Waiting for Textract job: {textract_job_id}")
        
        start_time = time.time()
        wait_interval = 5  # Poll every 5 seconds
        
        while True:
            # Check if we've exceeded max wait time
            elapsed = time.time() - start_time
            if elapsed > max_wait_seconds:
                print(f"✗ Timeout: Job took longer than {max_wait_seconds}s")
                return None
            
            # Get job status
            response = textract.get_document_text_detection(JobId=textract_job_id)
            status = response['JobStatus']
            
            print(f"   Status: {status} (elapsed: {int(elapsed)}s)")
            
            if status == 'SUCCEEDED':
                print("✓ Job completed successfully!")
                return _extract_text_from_response(response, textract_job_id)
            
            elif status == 'FAILED':
                error_msg = response.get('StatusMessage', 'Unknown error')
                print(f"✗ Job failed: {error_msg}")
                return None
            
            elif status == 'IN_PROGRESS':
                time.sleep(wait_interval)
                continue
            
            else:
                print(f"✗ Unexpected status: {status}")
                return None
                
    except Exception as e:
        print(f"✗ Error getting Textract results: {e}")
        return None

def _extract_text_from_response(response: Dict, textract_job_id: str) -> Dict:
    """
    Extract text from Textract response and format as structured data.
    Handles pagination for multi-page results.
    
    Args:
        response: Initial response from get_document_text_detection
        textract_job_id: Job ID for pagination
        
    Returns:
        dict: Structured text data with metadata
    """
    all_blocks = response.get('Blocks', [])
    next_token = response.get('NextToken')
    
    # Handle pagination if there are more results
    while next_token:
        print(f"   Fetching next page of results...")
        response = textract.get_document_text_detection(
            JobId=textract_job_id,
            NextToken=next_token
        )
        all_blocks.extend(response.get('Blocks', []))
        next_token = response.get('NextToken')
    
    # Extract LINE blocks (text lines)
    extracted_lines = []
    page_count = 0
    
    for block in all_blocks:
        if block['BlockType'] == 'LINE':
            extracted_lines.append(block['Text'])
        elif block['BlockType'] == 'PAGE':
            page_count += 1
    
    extracted_text = '\n'.join(extracted_lines)
    
    return {
        'extracted_text': extracted_text,
        'page_count': page_count,
        'total_blocks': len(all_blocks),
        'line_count': len(extracted_lines),
        'processing_cost': page_count * COST_PER_PAGE_ASYNC,
        'textract_job_id': textract_job_id
    }

def _save_ocr_output(output_data: Dict, job_id: str, filename: str) -> bool:
    """
    Save OCR output to S3 in the job's ocr_output folder.
    
    Args:
        output_data: Dictionary containing extracted text and metadata
        job_id: Unique job identifier (UUID)
        filename: Original filename (will be converted to .json)
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        # Prepare output filename
        base_name = os.path.splitext(filename)[0]
        output_filename = f"{base_name}_ocr.json"
        
        # Add metadata
        output_data['job_id'] = job_id
        output_data['original_filename'] = filename
        output_data['processed_at'] = datetime.now().isoformat()
        
        # Construct S3 key
        s3_key = f"{S3_JOBS_PREFIX}{job_id}/ocr_output/{output_filename}"
        
        # Upload to S3
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=s3_key,
            Body=json.dumps(output_data, indent=2),
            ContentType='application/json'
        )
        
        print(f"📤 Uploaded: s3://{S3_BUCKET}/{s3_key}")
        return True
        
    except Exception as e:
        print(f"✗ Error saving OCR output: {e}")
        return False

def process_document_async(s3_bucket: str, s3_key: str, job_id: str, retry_count: int = 0) -> bool:
    """
    Main function to process a document asynchronously using Textract.
    Automatically retries failed OCR processing up to MAX_RETRIES.
    
    Args:
        s3_bucket: S3 bucket name containing the document
        s3_key: S3 key (path) to the document (e.g., "jobs/{job_id}/original/file.pdf")
        job_id: Unique job identifier for tracking
        retry_count: Current retry attempt (0 = first attempt)
        
    Returns:
        bool: True if processing succeeded, False otherwise
        
    Example:
        process_document_async(
            s3_bucket="eesa-pipeline-storage",
            s3_key="jobs/abc-123/original/paper.pdf",
            job_id="abc-123"
        )
    """
    # Extract filename from S3 key
    filename = os.path.basename(s3_key)
    attempt_label = f" (Retry {retry_count}/{MAX_RETRIES})" if retry_count > 0 else ""
    
    print(f"\n{'='*60}")
    print(f"Processing: {filename}{attempt_label}")
    print(f"Job ID: {job_id}")
    print(f"S3 Location: s3://{s3_bucket}/{s3_key}")
    print(f"{'='*60}\n")
    
    # Step 1: Start Textract job
    textract_job_id = start_textract_job(s3_bucket, s3_key, job_id)
    if not textract_job_id:
        if retry_count < MAX_RETRIES:
            print(f"\n🔄 Retrying Textract job... (Attempt {retry_count + 2}/{MAX_RETRIES + 1})")
            time.sleep(2)
            return process_document_async(s3_bucket, s3_key, job_id, retry_count + 1)
        return False
    
    # Step 2: Wait for results
    results = get_textract_results(textract_job_id)
    if not results:
        if retry_count < MAX_RETRIES:
            print(f"\n🔄 Retrying to get results... (Attempt {retry_count + 2}/{MAX_RETRIES + 1})")
            time.sleep(5)
            return process_document_async(s3_bucket, s3_key, job_id, retry_count + 1)
        return False
    
    # Step 3: Save output to S3
    success = _save_ocr_output(results, job_id, filename)
    
    if success:
        print(f"\n✓ Processing complete!")
        print(f"   Pages: {results['page_count']}")
        print(f"   Lines: {results['line_count']}")
        print(f"   Cost: ${results['processing_cost']:.4f}")
        if retry_count > 0:
            print(f"   ⚠ Succeeded after {retry_count} retry/retries")
    else:
        # S3 save failed, retry if possible
        if retry_count < MAX_RETRIES:
            print(f"\n🔄 S3 save failed, retrying... (Attempt {retry_count + 2}/{MAX_RETRIES + 1})")
            time.sleep(2)
            return process_document_async(s3_bucket, s3_key, job_id, retry_count + 1)
    
    return success

def process_batch_with_retry(file_locations: List[Tuple[str, str, str]]) -> Dict:
    """
    Process a batch of documents with automatic retry for failed files.
    Tracks failed files and reprocesses them up to MAX_BATCH_RETRY_ROUNDS times.
    
    Args:
        file_locations: List of tuples (s3_bucket, s3_key, job_id)
        
    Returns:
        dict: Processing summary with success/failure counts and final failed files
        
    Example:
        files = [
            ('eesa-pipeline-storage', 'jobs/abc-123/original/file1.pdf', 'abc-123'),
            ('eesa-pipeline-storage', 'jobs/abc-123/original/file2.pdf', 'abc-123'),
        ]
        result = process_batch_with_retry(files)
    """
    total_files = len(file_locations)
    failed_files = []  # Track failed file locations
    retry_round = 0
    
    print(f"\n{'='*80}")
    print(f"TEXTRACT BATCH PROCESSING")
    print(f"Total files: {total_files}")
    print(f"Max retry rounds: {MAX_BATCH_RETRY_ROUNDS}")
    print(f"{'='*80}\n")
    
    # Initial processing of all files
    current_batch = file_locations.copy()
    
    while retry_round <= MAX_BATCH_RETRY_ROUNDS:
        batch_size = len(current_batch)
        
        if retry_round == 0:
            print(f"\n🚀 Processing initial batch ({batch_size} files)...\n")
        else:
            print(f"\n🔄 Retry round {retry_round}/{MAX_BATCH_RETRY_ROUNDS} ({batch_size} files)...\n")
        
        failed_in_round = []
        successful_in_round = 0
        
        # Process each file in current batch
        for idx, (s3_bucket, s3_key, job_id) in enumerate(current_batch, 1):
            filename = os.path.basename(s3_key)
            print(f"[{idx}/{batch_size}] Processing: {filename}")
            
            success = process_document_async(s3_bucket, s3_key, job_id)
            
            if success:
                successful_in_round += 1
            else:
                # Track failed file location for retry
                failed_in_round.append((s3_bucket, s3_key, job_id))
                print(f"⚠️  Failed: {filename} - will retry in next round")
        
        # Round summary
        print(f"\n{'─'*60}")
        print(f"Round {retry_round} Summary:")
        print(f"  ✓ Successful: {successful_in_round}/{batch_size}")
        print(f"  ✗ Failed: {len(failed_in_round)}/{batch_size}")
        print(f"{'─'*60}\n")
        
        # Check if all files succeeded or no more retries left
        if len(failed_in_round) == 0:
            print("✅ All files processed successfully!\n")
            failed_files = []
            break
        
        if retry_round >= MAX_BATCH_RETRY_ROUNDS:
            print(f"⚠️  Reached max retry rounds ({MAX_BATCH_RETRY_ROUNDS})\n")
            failed_files = failed_in_round
            break
        
        # Prepare for next retry round
        current_batch = failed_in_round
        retry_round += 1
        
        # Wait before retry round
        if current_batch:
            wait_time = min(10, 3 * retry_round)  # Exponential backoff: 3s, 6s, 9s
            print(f"⏳ Waiting {wait_time}s before retry round {retry_round}...\n")
            time.sleep(wait_time)
    
    # Final summary
    total_successful = total_files - len(failed_files)
    success_rate = (total_successful / total_files * 100) if total_files > 0 else 0
    
    print(f"\n{'='*80}")
    print(f"FINAL BATCH SUMMARY")
    print(f"{'='*80}")
    print(f"Total files: {total_files}")
    print(f"✓ Successful: {total_successful} ({success_rate:.1f}%)")
    print(f"✗ Failed: {len(failed_files)} ({100-success_rate:.1f}%)")
    print(f"Retry rounds used: {retry_round}/{MAX_BATCH_RETRY_ROUNDS}")
    
    if failed_files:
        print(f"\n⚠️  Failed files after {retry_round} retry rounds:")
        for s3_bucket, s3_key, job_id in failed_files:
            filename = os.path.basename(s3_key)
            print(f"   - {filename} (s3://{s3_bucket}/{s3_key})")
    
    print(f"{'='*80}\n")
    
    return {
        'total_files': total_files,
        'successful': total_successful,
        'failed': len(failed_files),
        'success_rate': success_rate,
        'retry_rounds_used': retry_round,
        'failed_files': [
            {
                's3_bucket': bucket,
                's3_key': key,
                'job_id': jid,
                'filename': os.path.basename(key)
            }
            for bucket, key, jid in failed_files
        ]
    }
