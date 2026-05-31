"""
Master Pipeline Orchestrator

This orchestrator manages the complete document processing workflow:
1. OCR Processing (AWS Textract) - Extract text from PDFs
2. Question Enrichment (AWS Bedrock) - Add Bloom's taxonomy analysis

Both slave pipelines are job-based and work with S3 storage.
"""

import boto3
import os
import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional, List

# Import slave pipeline functions
from aws_texttract_pipeline import process_document_async
from enrich_questions_s3_pipeline import (
    ensure_s3_bucket_exists,
    enrich_single_file,
    upload_enriched_to_s3,
    load_state,
    save_state
)

# AWS Clients
s3_client = boto3.client('s3')

# S3 Configuration
S3_BUCKET = os.getenv('S3_BUCKET', 'eesa-pipeline-storage')
S3_JOBS_PREFIX = 'jobs/'

# Pipeline Statistics
class PipelineStats:
    def __init__(self):
        self.total_jobs = 0
        self.ocr_success = 0
        self.ocr_failed = 0
        self.enrichment_success = 0
        self.enrichment_failed = 0
        self.total_cost = 0.0
        self.start_time = None
        self.end_time = None
    
    def summary(self) -> Dict:
        duration = (self.end_time - self.start_time).total_seconds() if self.end_time and self.start_time else 0
        return {
            'total_jobs': self.total_jobs,
            'ocr': {
                'success': self.ocr_success,
                'failed': self.ocr_failed,
                'success_rate': f"{(self.ocr_success/self.total_jobs*100):.1f}%" if self.total_jobs > 0 else "N/A"
            },
            'enrichment': {
                'success': self.enrichment_success,
                'failed': self.enrichment_failed,
                'success_rate': f"{(self.enrichment_success/self.total_jobs*100):.1f}%" if self.total_jobs > 0 else "N/A"
            },
            'total_cost': f"${self.total_cost:.4f}",
            'duration': f"{duration:.1f}s",
            'throughput': f"{self.total_jobs/duration:.2f} jobs/s" if duration > 0 else "N/A"
        }


def upload_pdf_to_s3(local_pdf_path: str, job_id: str) -> Optional[str]:
    """
    Upload PDF to S3 in the job's original folder.
    
    Args:
        local_pdf_path: Local path to PDF file
        job_id: Unique job identifier
        
    Returns:
        S3 key if successful, None otherwise
    """
    try:
        filename = os.path.basename(local_pdf_path)
        s3_key = f"{S3_JOBS_PREFIX}{job_id}/original/{filename}"
        
        print(f"📤 Uploading PDF to S3...")
        
        with open(local_pdf_path, 'rb') as f:
            s3_client.put_object(
                Bucket=S3_BUCKET,
                Key=s3_key,
                Body=f,
                ContentType='application/pdf'
            )
        
        print(f"   ✓ Uploaded to: s3://{S3_BUCKET}/{s3_key}")
        return s3_key
        
    except Exception as e:
        print(f"   ✗ Upload failed: {e}")
        return None


def download_ocr_output(job_id: str, filename: str) -> Optional[Dict]:
    """
    Download OCR output from S3.
    
    Args:
        job_id: Unique job identifier
        filename: Original PDF filename
        
    Returns:
        OCR data dict, or None if not found
    """
    try:
        base_name = os.path.splitext(filename)[0]
        s3_key = f"{S3_JOBS_PREFIX}{job_id}/ocr_output/{base_name}_ocr.json"
        
        print(f"📥 Downloading OCR output from S3...")
        
        response = s3_client.get_object(
            Bucket=S3_BUCKET,
            Key=s3_key
        )
        
        ocr_data = json.loads(response['Body'].read().decode('utf-8'))
        print(f"   ✓ Downloaded OCR output")
        return ocr_data
        
    except Exception as e:
        print(f"   ✗ Download failed: {e}")
        return None


def save_job_metadata(job_id: str, metadata: Dict) -> bool:
    """
    Save job metadata to S3.
    
    Args:
        job_id: Unique job identifier
        metadata: Job metadata dict
        
    Returns:
        bool: True if successful
    """
    try:
        s3_key = f"{S3_JOBS_PREFIX}{job_id}/metadata.json"
        
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=s3_key,
            Body=json.dumps(metadata, indent=2),
            ContentType='application/json'
        )
        
        return True
    except Exception as e:
        print(f"⚠ Failed to save metadata: {e}")
        return False


def process_single_document(pdf_path: str, job_id: Optional[str] = None) -> Dict:
    """
    Process a single document through the complete pipeline:
    1. Upload PDF to S3
    2. Run OCR (Textract) - Slave Pipeline 1
    3. Parse questions (assumed already done, using parsedQuestions folder)
    4. Enrich with Bloom's taxonomy (Bedrock) - Slave Pipeline 2
    
    Args:
        pdf_path: Local path to PDF file
        job_id: Optional job ID (will generate UUID if not provided)
        
    Returns:
        Dict with job results and metadata
    """
    # Generate job ID if not provided
    if not job_id:
        job_id = str(uuid.uuid4())
    
    filename = os.path.basename(pdf_path)
    
    print("\n" + "=" * 80)
    print("MASTER PIPELINE ORCHESTRATOR")
    print("=" * 80)
    print(f"Job ID: {job_id}")
    print(f"File: {filename}")
    print(f"Timestamp: {datetime.now().isoformat()}")
    print("=" * 80)
    
    # Job metadata
    metadata = {
        'job_id': job_id,
        'filename': filename,
        'started_at': datetime.now().isoformat(),
        'status': 'in_progress',
        'stages': {}
    }
    
    # Stage 1: Upload PDF to S3
    print("\n📋 STAGE 1: Upload to S3")
    print("-" * 80)
    
    s3_key = upload_pdf_to_s3(pdf_path, job_id)
    if not s3_key:
        metadata['status'] = 'failed'
        metadata['failed_stage'] = 'upload'
        metadata['error'] = 'Failed to upload PDF to S3'
        return metadata
    
    metadata['stages']['upload'] = {
        'status': 'success',
        's3_key': s3_key,
        'completed_at': datetime.now().isoformat()
    }
    
    # Stage 2: OCR Processing (Slave Pipeline 1)
    print("\n📋 STAGE 2: OCR Processing (AWS Textract)")
    print("-" * 80)
    
    ocr_success = process_document_async(S3_BUCKET, s3_key, job_id)
    
    if not ocr_success:
        metadata['status'] = 'failed'
        metadata['failed_stage'] = 'ocr'
        metadata['error'] = 'OCR processing failed'
        save_job_metadata(job_id, metadata)
        return metadata
    
    metadata['stages']['ocr'] = {
        'status': 'success',
        'completed_at': datetime.now().isoformat()
    }
    
    # Download OCR output for inspection
    ocr_data = download_ocr_output(job_id, filename)
    if ocr_data:
        metadata['stages']['ocr']['page_count'] = ocr_data.get('page_count', 0)
        metadata['stages']['ocr']['line_count'] = ocr_data.get('line_count', 0)
        metadata['stages']['ocr']['cost'] = ocr_data.get('processing_cost', 0)
    
    # Stage 3: Question Parsing (Manual step - assumed done)
    print("\n📋 STAGE 3: Question Parsing")
    print("-" * 80)
    print("ℹ This stage is manual - expecting parsed JSON in parsedQuestions folder")
    print(f"ℹ Looking for: {os.path.splitext(filename)[0]}.json")
    
    # Check if parsed file exists
    script_dir = os.path.dirname(os.path.abspath(__file__))
    parsed_dir = os.path.join(script_dir, '../parsedQuestions')
    base_name = os.path.splitext(filename)[0]
    parsed_file = os.path.join(parsed_dir, f"{base_name}.json")
    
    if not os.path.exists(parsed_file):
        print(f"⚠ Parsed file not found: {parsed_file}")
        print("⚠ Skipping enrichment stage")
        metadata['status'] = 'partial_success'
        metadata['stages']['parsing'] = {
            'status': 'skipped',
            'reason': 'Parsed file not found'
        }
        save_job_metadata(job_id, metadata)
        return metadata
    
    metadata['stages']['parsing'] = {
        'status': 'success',
        'file': parsed_file,
        'completed_at': datetime.now().isoformat()
    }
    
    # Stage 4: Enrichment (Slave Pipeline 2)
    print("\n📋 STAGE 4: Question Enrichment (AWS Bedrock)")
    print("-" * 80)
    
    enriched_data = enrich_single_file(parsed_file, f"{base_name}.json", use_instructions=True)
    
    if not enriched_data:
        metadata['status'] = 'failed'
        metadata['failed_stage'] = 'enrichment'
        metadata['error'] = 'Bloom\'s taxonomy enrichment failed'
        save_job_metadata(job_id, metadata)
        return metadata
    
    # Upload enriched data to S3
    upload_success = upload_enriched_to_s3(enriched_data, f"{base_name}.json")
    
    if not upload_success:
        metadata['status'] = 'failed'
        metadata['failed_stage'] = 'enrichment_upload'
        metadata['error'] = 'Failed to upload enriched data to S3'
        save_job_metadata(job_id, metadata)
        return metadata
    
    metadata['stages']['enrichment'] = {
        'status': 'success',
        'exam_count': len(enriched_data.get('exams', [])),
        'completed_at': datetime.now().isoformat()
    }
    
    # Final status
    metadata['status'] = 'success'
    metadata['completed_at'] = datetime.now().isoformat()
    
    save_job_metadata(job_id, metadata)
    
    print("\n" + "=" * 80)
    print("✓ PIPELINE COMPLETE")
    print("=" * 80)
    print(f"Job ID: {job_id}")
    print(f"All stages completed successfully!")
    
    return metadata


def process_batch(pdf_directory: str, max_files: Optional[int] = None) -> PipelineStats:
    """
    Process multiple PDFs through the pipeline.
    
    Args:
        pdf_directory: Directory containing PDF files
        max_files: Maximum number of files to process (None = all)
        
    Returns:
        PipelineStats with batch statistics
    """
    print("\n" + "=" * 80)
    print("BATCH PROCESSING MODE")
    print("=" * 80)
    
    # Ensure S3 bucket exists
    print("\n🔍 Checking S3 bucket...")
    if not ensure_s3_bucket_exists():
        print("✗ S3 bucket not available. Cannot proceed.")
        return PipelineStats()
    
    # Get PDF files
    pdf_files = list(Path(pdf_directory).glob('*.pdf'))
    
    if max_files:
        pdf_files = pdf_files[:max_files]
    
    print(f"\n📁 Found {len(pdf_files)} PDF files to process")
    
    stats = PipelineStats()
    stats.total_jobs = len(pdf_files)
    stats.start_time = datetime.now()
    
    # Process each file
    for idx, pdf_file in enumerate(pdf_files, 1):
        print(f"\n{'='*80}")
        print(f"Processing {idx}/{len(pdf_files)}: {pdf_file.name}")
        print(f"{'='*80}")
        
        result = process_single_document(str(pdf_file))
        
        # Update statistics
        if result.get('stages', {}).get('ocr', {}).get('status') == 'success':
            stats.ocr_success += 1
            ocr_cost = result['stages']['ocr'].get('cost', 0)
            stats.total_cost += ocr_cost
        else:
            stats.ocr_failed += 1
        
        if result.get('stages', {}).get('enrichment', {}).get('status') == 'success':
            stats.enrichment_success += 1
            stats.total_cost += 0.001  # Bedrock cost estimate
        else:
            stats.enrichment_failed += 1
    
    stats.end_time = datetime.now()
    
    # Print summary
    print("\n" + "=" * 80)
    print("BATCH PROCESSING SUMMARY")
    print("=" * 80)
    
    summary = stats.summary()
    print(json.dumps(summary, indent=2))
    print("=" * 80)
    
    return stats


def resume_failed_jobs(state_file: Optional[str] = None):
    """
    Resume processing for failed jobs from enrichment state.
    
    Args:
        state_file: Optional path to state file (uses default if not provided)
    """
    print("\n" + "=" * 80)
    print("RESUME FAILED JOBS")
    print("=" * 80)
    
    # Load enrichment state
    state = load_state()
    
    failed_files = state.get('failed', [])
    retry_counts = state.get('retry_counts', {})
    
    print(f"\n📊 Found {len(failed_files)} failed files")
    print(f"   Files pending retry: {len([f for f in retry_counts.values() if f < 3])}")
    
    if not failed_files:
        print("✓ No failed files to process")
        return
    
    # Process failed files
    script_dir = os.path.dirname(os.path.abspath(__file__))
    parsed_dir = os.path.join(script_dir, '../parsedQuestions')
    
    for filename in failed_files:
        retry_count = retry_counts.get(filename, 0)
        
        if retry_count >= 3:
            print(f"\n⏭ Skipping {filename} (max retries reached)")
            continue
        
        print(f"\n🔄 Retrying {filename} (attempt {retry_count + 1}/3)")
        
        parsed_file = os.path.join(parsed_dir, filename)
        
        if not os.path.exists(parsed_file):
            print(f"   ✗ File not found: {parsed_file}")
            continue
        
        # Try enrichment without instructions (retry strategy)
        enriched_data = enrich_single_file(parsed_file, filename, use_instructions=False)
        
        if enriched_data and upload_enriched_to_s3(enriched_data, filename):
            print(f"   ✓ Success!")
            # Update state
            state['processed'].append(filename)
            state['failed'].remove(filename)
            if filename in retry_counts:
                del retry_counts[filename]
        else:
            print(f"   ✗ Failed again")
            retry_counts[filename] = retry_count + 1
    
    # Save updated state
    save_state(state)
    print("\n✓ Resume complete")


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage:")
        print("  Single file:  python pipeline_orchestrator.py <pdf_file>")
        print("  Batch mode:   python pipeline_orchestrator.py batch <pdf_directory> [max_files]")
        print("  Resume fails: python pipeline_orchestrator.py resume")
        sys.exit(1)
    
    mode = sys.argv[1]
    
    if mode == 'batch':
        if len(sys.argv) < 3:
            print("Error: Batch mode requires directory path")
            sys.exit(1)
        
        pdf_dir = sys.argv[2]
        max_files = int(sys.argv[3]) if len(sys.argv) > 3 else None
        
        process_batch(pdf_dir, max_files)
    
    elif mode == 'resume':
        resume_failed_jobs()
    
    elif os.path.isfile(mode):
        # Single file mode
        process_single_document(mode)
    
    else:
        print(f"Error: Invalid mode or file not found: {mode}")
        sys.exit(1)
