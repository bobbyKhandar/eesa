"""
Unified Pipeline Server - Complete API Handler

This server provides BOTH local and AWS pipeline options:
- Local: EasyOCR-based processing (free, slower)
- AWS: Textract + Bedrock (paid, faster, production-ready)

API Endpoints:
============

AWS Pipeline (Production):
- POST /process - Process single job with AWS
- POST /process/batch - Process multiple jobs with AWS
- GET /job/{job_id}/status - Get AWS job status
- GET /job/{job_id}/metadata - Get complete job metadata
- GET /jobs/active - List all active AWS jobs

Local Pipeline (Development/Testing):
- POST /submit-local - Process with local EasyOCR
- GET /status/{batch_id} - Get local batch status

Shared:
- GET /health - Health check for both pipelines
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import sys
import os
from pathlib import Path
import json
import uuid
import boto3
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Optional
import threading
import time

# Add src directory to path for local pipeline imports
src_dir = Path(__file__).parent / 'src'
sys.path.insert(0, str(src_dir))

# === Import AWS Pipeline Modules ===
try:
    from aws_texttract_pipeline import process_document_async
    from parsing_pipeline import parse_questions_for_job
    from enrich_questions_job_based import enrich_questions_for_job
    from organize_by_subject_job_based import organize_by_subject_for_job
    from intelligent_chunking import chunk_ocr_text, QuestionBoundaryDetector
    from question_clustering import cluster_questions_for_job
    from chunk_merger import merge_chunks, validate_merge_result
    AWS_MODULES_AVAILABLE = True
except ImportError as e:
    print(f"⚠ Warning: AWS pipeline modules not found: {e}")
    print("  AWS endpoints will not work")
    process_document_async = None
    parse_questions_for_job = None
    enrich_questions_for_job = None
    organize_by_subject_for_job = None
    chunk_ocr_text = None
    merge_chunks = None
    AWS_MODULES_AVAILABLE = False

# === Import Local Pipeline Manager ===
try:
    from pipeline_manager import pipeline_manager
    LOCAL_PIPELINE_AVAILABLE = True
except ImportError:
    print("⚠ Warning: Local pipeline_manager not found")
    print("  Local OCR endpoints will not work")
    pipeline_manager = None
    LOCAL_PIPELINE_AVAILABLE = False

# === Flask App Setup ===
app = Flask(__name__)
CORS(app)

# === AWS Configuration ===
try:
    s3_client = boto3.client('s3')
    AWS_AVAILABLE = True
except Exception as e:
    print(f"⚠ Warning: AWS not configured: {e}")
    s3_client = None
    AWS_AVAILABLE = False

S3_BUCKET = os.getenv('S3_BUCKET', 'eesa-pipeline-storage')
S3_JOBS_PREFIX = 'jobs/'
MAX_CONCURRENT_JOBS = int(os.getenv('MAX_CONCURRENT_JOBS', '3'))  # Reduced default for better idle performance

# === AWS Job Tracking (Persistent) ===
aws_jobs_lock = threading.Lock()
aws_active_jobs = {}  # {job_id: job_metadata}

# === Lazy Thread Pool for Async Processing ===
_job_executor = None
_executor_lock = threading.Lock()

def get_job_executor():
    """Lazy initialization of thread pool executor to save resources when idle"""
    global _job_executor
    if _job_executor is None:
        with _executor_lock:
            if _job_executor is None:  # Double-check locking
                _job_executor = ThreadPoolExecutor(
                    max_workers=MAX_CONCURRENT_JOBS,
                    thread_name_prefix='job_worker'
                )
    return _job_executor


# ============================================================================
# AWS Pipeline Functions
# ============================================================================

def save_job_metadata(job_id: str, metadata: Dict) -> bool:
    """Save AWS job metadata to S3 and in-memory cache"""
    if not s3_client:
        return False
    
    try:
        s3_key = f"{S3_JOBS_PREFIX}{job_id}/metadata.json"
        
        # Use more efficient JSON serialization
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=s3_key,
            Body=json.dumps(metadata, separators=(',', ':')),  # Compact JSON
            ContentType='application/json'
        )
        
        # Update in-memory cache
        with aws_jobs_lock:
            aws_active_jobs[job_id] = metadata
            
            # Limit cache size to prevent memory bloat (keep last 100 jobs)
            if len(aws_active_jobs) > 100:
                oldest_keys = sorted(aws_active_jobs.keys())[:20]
                for key in oldest_keys:
                    aws_active_jobs.pop(key, None)
        
        return True
    except Exception as e:
        print(f"⚠ Failed to save metadata: {e}")
        return False


def load_job_metadata(job_id: str) -> Optional[Dict]:
    """Load AWS job metadata from cache or S3"""
    # Check cache first
    with aws_jobs_lock:
        if job_id in aws_active_jobs:
            return aws_active_jobs[job_id]
    
    # Load from S3
    if not s3_client:
        return None
    
    try:
        s3_key = f"{S3_JOBS_PREFIX}{job_id}/metadata.json"
        
        response = s3_client.get_object(
            Bucket=S3_BUCKET,
            Key=s3_key
        )
        
        metadata = json.loads(response['Body'].read().decode('utf-8'))
        
        # Update cache
        with aws_jobs_lock:
            aws_active_jobs[job_id] = metadata
        
        return metadata
    except Exception as e:
        print(f"⚠ Failed to load metadata: {e}")
        return None


def process_ocr_with_chunking(job_id: str, filename: str) -> Dict:
    """
    Load OCR output and chunk it if necessary
    
    Returns:
        {
            'needs_chunking': bool,
            'chunks': List[Dict] or None,
            'ocr_text': str (if no chunking needed)
        }
    """
    try:
        # Load OCR output from S3 (Textract saves as {filename}_ocr.json)
        base_name = os.path.splitext(filename)[0]
        ocr_key = f"{S3_JOBS_PREFIX}{job_id}/ocr_output/{base_name}_ocr.json"
        
        print(f"📥 Loading OCR output from: s3://{S3_BUCKET}/{ocr_key}")
        
        response = s3_client.get_object(Bucket=S3_BUCKET, Key=ocr_key)
        ocr_data = json.loads(response['Body'].read().decode('utf-8'))
        
        # Extract the text from the JSON structure
        ocr_text = ocr_data.get('extracted_text', '')
        page_count = ocr_data.get('page_count', 0)
        
        print(f"📄 OCR loaded: {len(ocr_text)} characters, {page_count} pages")
        
        # Check if chunking is needed (> 20k characters ~ 5k tokens)
        if len(ocr_text) > 20000 and chunk_ocr_text:
            print(f"📊 Large document detected - applying intelligent chunking...")
            chunks = chunk_ocr_text(ocr_text, max_chars_per_chunk=20000)
            
            print(f"✂️ Split into {len(chunks)} chunks:")
            for chunk in chunks:
                continuation_flag = " [CONTINUATION]" if chunk.get('is_continuation') else ""
                q_range = f"Q{chunk.get('start_question', '?')}-Q{chunk.get('end_question', '?')}"
                print(f"   • Chunk {chunk['chunk_id']}: {chunk['char_count']} chars, {q_range}{continuation_flag}")
            
            # Save chunks for debugging
            chunks_key = f"{S3_JOBS_PREFIX}{job_id}/chunks_metadata.json"
            s3_client.put_object(
                Bucket=S3_BUCKET,
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
            print(f"✓ Document size manageable - no chunking needed ({len(ocr_text)} chars)")
            return {
                'needs_chunking': False,
                'ocr_text': ocr_text,
                'page_count': page_count
            }
    
    except Exception as e:
        print(f"⚠ Error in chunking analysis: {e}")
        import traceback
        traceback.print_exc()
        return {
            'needs_chunking': False,
            'ocr_text': '',
            'error': str(e)
        }


def process_aws_job_pipeline(job_id: str, s3_pdf_key: str, filename: str) -> Dict:
    """
    Process a single AWS job through the complete pipeline.
    
    Stages: OCR (Textract) → Parsing → Enrichment (Bedrock) → Organization (S3)
    """
    metadata = {
        'job_id': job_id,
        'filename': filename,
        's3_pdf_key': s3_pdf_key,
        'started_at': datetime.now().isoformat(),
        'status': 'in_progress',
        'stages': {}
    }
    
    save_job_metadata(job_id, metadata)
    
    try:
        # Stage 1: OCR Processing (Textract)
        print(f"\n[{job_id}] Stage 1: OCR Processing")
        metadata['stages']['ocr'] = {
            'status': 'in_progress',
            'started_at': datetime.now().isoformat()
        }
        save_job_metadata(job_id, metadata)
        
        if not process_document_async:
            raise Exception("AWS Textract module not available")
        
        ocr_success = process_document_async(S3_BUCKET, s3_pdf_key, job_id)
        
        if not ocr_success:
            metadata['status'] = 'failed'
            metadata['failed_stage'] = 'ocr'
            metadata['error'] = 'OCR processing failed'
            metadata['stages']['ocr']['status'] = 'failed'
            metadata['stages']['ocr']['completed_at'] = datetime.now().isoformat()
            save_job_metadata(job_id, metadata)
            return metadata
        
        metadata['stages']['ocr'] = {
            'status': 'success',
            'completed_at': datetime.now().isoformat()
        }
        save_job_metadata(job_id, metadata)
        
        # Stage 1.5: Analyze OCR output and chunk if necessary
        print(f"[{job_id}] Stage 1.5: Chunking Analysis")
        chunking_result = process_ocr_with_chunking(job_id, filename)
        
        # Stage 2: Question Parsing (Bedrock)
        print(f"[{job_id}] Stage 2: Question Parsing")
        metadata['stages']['parsing'] = {
            'status': 'in_progress',
            'started_at': datetime.now().isoformat()
        }
        save_job_metadata(job_id, metadata)
        
        if not parse_questions_for_job:
            raise Exception("Parsing module not available")
        
        # Check if we need chunked processing
        if chunking_result.get('needs_chunking'):
            print(f"   📊 Using chunked processing ({chunking_result['total_chunks']} chunks)")
            
            # Import chunked parser
            try:
                from parsing_pipeline import parse_chunked_document
            except ImportError:
                print("   ⚠ Chunked parser not available, falling back to regular parsing")
                parsing_result = parse_questions_for_job(job_id, filename)
            else:
                parsing_result = parse_chunked_document(
                    chunking_result['chunks'],
                    job_id,
                    filename
                )
        else:
            print(f"   📄 Using standard processing (no chunking needed)")
            parsing_result = parse_questions_for_job(job_id, filename)
        
        # Check if parsing returned an error (e.g., token limit exceeded)
        if isinstance(parsing_result, dict) and not parsing_result.get('success', True):
            error_msg = parsing_result.get('error', 'Question parsing failed')
            error_type = parsing_result.get('error_type', 'unknown')
            
            metadata['status'] = 'partial_success'
            metadata['failed_stage'] = 'parsing'
            metadata['error'] = error_msg
            metadata['error_type'] = error_type
            metadata['stages']['parsing']['status'] = 'failed'
            metadata['stages']['parsing']['error'] = error_msg
            metadata['stages']['parsing']['completed_at'] = datetime.now().isoformat()
            save_job_metadata(job_id, metadata)
            return metadata
        
        if not parsing_result:
            metadata['status'] = 'partial_success'
            metadata['failed_stage'] = 'parsing'
            metadata['error'] = 'Question parsing failed'
            metadata['stages']['parsing']['status'] = 'failed'
            metadata['stages']['parsing']['completed_at'] = datetime.now().isoformat()
            save_job_metadata(job_id, metadata)
            return metadata
        
        metadata['stages']['parsing'] = {
            'status': 'success',
            'completed_at': datetime.now().isoformat(),
            'total_questions': parsing_result.get('total_questions', 0),
            'total_exams': parsing_result.get('total_exams', 0),
            'processing_cost': parsing_result.get('processing_cost', 0),
            'is_chunked': parsing_result.get('is_chunked', False)
        }
        save_job_metadata(job_id, metadata)
        
        # Stage 3: Enrichment (Bedrock)
        print(f"[{job_id}] Stage 3: Question Enrichment")
        metadata['stages']['enrichment'] = {
            'status': 'in_progress',
            'started_at': datetime.now().isoformat()
        }
        save_job_metadata(job_id, metadata)
        
        # Check if we need chunked enrichment
        if parsing_result.get('is_chunked') and parsing_result.get('chunk_metadata_key'):
            print(f"   📊 Using chunked enrichment (prevents token limit issues)")
            
            try:
                from enrich_questions_job_based import enrich_chunked_questions
            except ImportError:
                print("   ⚠ Chunked enrichment not available, falling back to regular")
                enrichment_success = enrich_questions_for_job(job_id, filename)
            else:
                enrichment_success = enrich_chunked_questions(
                    job_id,
                    filename,
                    parsing_result['chunk_metadata_key']
                )
        else:
            print(f"   📄 Using standard enrichment")
            if not enrich_questions_for_job:
                raise Exception("Enrichment module not available")
            enrichment_success = enrich_questions_for_job(job_id, filename)
        
        if not enrichment_success:
            metadata['status'] = 'partial_success'
            metadata['failed_stage'] = 'enrichment'
            metadata['error'] = 'Enrichment failed'
            metadata['stages']['enrichment']['status'] = 'failed'
            metadata['stages']['enrichment']['completed_at'] = datetime.now().isoformat()
            save_job_metadata(job_id, metadata)
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
            print(f"[{job_id}] ⚠ Enrichment succeeded after {enrichment_success['retry_count']} retry/retries")
        
        # Stage 4: Organize by Subject
        print(f"[{job_id}] Stage 4: Organize by Subject")
        metadata['stages']['organization'] = {
            'status': 'in_progress',
            'started_at': datetime.now().isoformat()
        }
        save_job_metadata(job_id, metadata)
        
        if not organize_by_subject_for_job:
            raise Exception("Organization module not available")
        
        organization_result = organize_by_subject_for_job(job_id, filename)
        
        if not organization_result:
            metadata['status'] = 'partial_success'
            metadata['failed_stage'] = 'organization'
            metadata['error'] = 'Organization failed'
            metadata['stages']['organization']['status'] = 'failed'
            metadata['stages']['organization']['completed_at'] = datetime.now().isoformat()
            save_job_metadata(job_id, metadata)
            return metadata
        
        metadata['stages']['organization'] = {
            'status': 'success',
            'completed_at': datetime.now().isoformat(),
            'total_subjects': organization_result.get('total_subjects', 0),
            'total_exams': organization_result.get('total_exams', 0),
            'total_questions': organization_result.get('total_questions', 0),
            'subjects': organization_result.get('subjects', {}),
            'master_index_s3_key': organization_result.get('master_index_s3_key')
        }
        
        # Stage 5: Question Clustering (FAISS + HDBSCAN)
        print(f"[{job_id}] Stage 5: Question Clustering & Similarity Analysis")
        metadata['stages']['clustering'] = {
            'status': 'in_progress',
            'started_at': datetime.now().isoformat()
        }
        save_job_metadata(job_id, metadata)
        
        if not cluster_questions_for_job:
            print(f"[{job_id}] ⚠ Clustering module not available, skipping")
            metadata['stages']['clustering'] = {
                'status': 'skipped',
                'completed_at': datetime.now().isoformat(),
                'reason': 'Module not available'
            }
        else:
            clustering_result = cluster_questions_for_job(job_id, filename)
            
            if not clustering_result:
                print(f"[{job_id}] ⚠ Clustering failed, continuing anyway")
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
        
        # Mark as complete
        metadata['status'] = 'success'
        metadata['completed_at'] = datetime.now().isoformat()
        save_job_metadata(job_id, metadata)
        
        print(f"[{job_id}] ✓ Pipeline complete!")
        return metadata
        
    except Exception as e:
        metadata['status'] = 'failed'
        metadata['error'] = str(e)
        metadata['completed_at'] = datetime.now().isoformat()
        save_job_metadata(job_id, metadata)
        print(f"[{job_id}] ✗ Pipeline failed: {e}")
        return metadata


# ============================================================================
# API Routes
# ============================================================================

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    # Check local pipeline status safely
    local_status = False
    try:
        if LOCAL_PIPELINE_AVAILABLE and pipeline_manager:
            local_status = getattr(pipeline_manager, 'is_running', False)
    except Exception:
        pass
    
    return jsonify({
        'status': 'healthy',
        'service': 'Unified Pipeline Server',
        'timestamp': datetime.now().isoformat(),
        'local_pipeline': local_status,
        'aws_pipeline': AWS_AVAILABLE and AWS_MODULES_AVAILABLE
    })


# ============================================================================
# AWS Pipeline Routes (Production)
# ============================================================================

@app.route('/process', methods=['POST'])
def process_single_aws_job():
    """
    Process a single document through AWS pipeline.
    
    Request body:
    {
        "s3_bucket": "eesa-pipeline-storage",
        "s3_key": "jobs/{job_id}/original/file.pdf",
        "job_id": "optional-custom-id",
        "filename": "file.pdf"
    }
    """
    if not AWS_AVAILABLE or not AWS_MODULES_AVAILABLE:
        return jsonify({'error': 'AWS pipeline not configured'}), 503
    
    try:
        data = request.json
        
        # Validate input
        if not data.get('s3_key'):
            return jsonify({'error': 'Missing s3_key'}), 400
        
        s3_key = data['s3_key']
        s3_bucket = data.get('s3_bucket', S3_BUCKET)
        job_id = data.get('job_id') or str(uuid.uuid4())
        filename = data.get('filename') or os.path.basename(s3_key)
        
        # Verify file exists in S3
        try:
            s3_client.head_object(Bucket=s3_bucket, Key=s3_key)
        except Exception as e:
            return jsonify({'error': f'File not found in S3: {s3_key}'}), 404
        
        # Submit job to background processing (non-blocking)
        get_job_executor().submit(process_aws_job_pipeline, job_id, s3_key, filename)
        
        return jsonify({
            'job_id': job_id,
            'status': 'processing',
            'message': 'AWS job started successfully',
            's3_key': s3_key,
            'filename': filename
        }), 202
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/process/batch', methods=['POST'])
def process_batch_aws_jobs():
    """
    Process multiple documents concurrently through AWS pipeline.
    
    Request body:
    {
        "jobs": [
            {
                "s3_key": "jobs/{job_id}/original/file1.pdf",
                "filename": "file1.pdf"
            },
            {
                "s3_key": "jobs/{job_id}/original/file2.pdf",
                "filename": "file2.pdf"
            }
        ],
        "s3_bucket": "optional-bucket-name"
    }
    """
    if not AWS_AVAILABLE or not AWS_MODULES_AVAILABLE:
        return jsonify({'error': 'AWS pipeline not configured'}), 503
    
    try:
        data = request.json
        
        if not data.get('jobs') or not isinstance(data['jobs'], list):
            return jsonify({'error': 'Missing or invalid jobs array'}), 400
        
        s3_bucket = data.get('s3_bucket', S3_BUCKET)
        jobs = data['jobs']
        
        # Generate job IDs and prepare for processing
        job_submissions = []
        for job_data in jobs:
            s3_key = job_data.get('s3_key')
            if not s3_key:
                continue
            
            job_id = job_data.get('job_id') or str(uuid.uuid4())
            filename = job_data.get('filename') or os.path.basename(s3_key)
            
            job_submissions.append({
                'job_id': job_id,
                's3_key': s3_key,
                'filename': filename
            })
        
        if not job_submissions:
            return jsonify({'error': 'No valid jobs provided'}), 400
        
        # Submit all jobs to background processing (non-blocking)
        executor = get_job_executor()
        for job in job_submissions:
            executor.submit(process_aws_job_pipeline, job['job_id'], job['s3_key'], job['filename'])
        
        return jsonify({
            'message': f'AWS batch processing started for {len(job_submissions)} jobs',
            'jobs': [
                {
                    'job_id': job['job_id'],
                    'filename': job['filename'],
                    'status': 'processing'
                }
                for job in job_submissions
            ]
        }), 202
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/job/<job_id>/status', methods=['GET'])
def get_aws_job_status(job_id: str):
    """Get the status of a specific AWS job"""
    try:
        metadata = load_job_metadata(job_id)
        
        if not metadata:
            return jsonify({'error': 'Job not found'}), 404
        
        return jsonify(metadata), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/job/<job_id>/metadata', methods=['GET'])
def get_aws_job_metadata(job_id: str):
    """Get complete metadata for an AWS job"""
    return get_aws_job_status(job_id)


@app.route('/job/<job_id>/questions', methods=['GET'])
def get_job_questions(job_id: str):
    """Get the processed questions for a completed job - returns complete exam structure with all enrichment data"""
    try:
        # First verify the job exists and is completed
        metadata = load_job_metadata(job_id)
        
        if not metadata:
            return jsonify({'error': 'Job not found'}), 404
        
        if metadata.get('status') != 'success':
            return jsonify({
                'error': 'Job not completed yet',
                'status': metadata.get('status'),
                'message': 'Questions are only available after the job completes successfully'
            }), 400
        
        # Try to load organized questions (final output)
        if not s3_client:
            return jsonify({'error': 'S3 not available'}), 503
        
        exams = []
        
        # Try organized output first (best format with subject grouping)
        try:
            organized_prefix = f"{S3_JOBS_PREFIX}{job_id}/organized_output/"
            response = s3_client.list_objects_v2(
                Bucket=S3_BUCKET,
                Prefix=organized_prefix
            )
            
            if 'Contents' in response:
                for obj in response['Contents']:
                    key = obj['Key']
                    # Skip index files, get actual question files
                    if key.endswith('.json') and 'index' not in key.lower():
                        obj_response = s3_client.get_object(Bucket=S3_BUCKET, Key=key)
                        data = json.loads(obj_response['Body'].read().decode('utf-8'))
                        
                        # Handle different formats
                        if isinstance(data, dict) and 'exams' in data:
                            for exam in data['exams']:
                                # Normalize question fields to match database schema
                                if 'questions' in exam:
                                    normalized_questions = []
                                    for q in exam['questions']:
                                        # Ensure marks is an integer
                                        marks_value = q.get('marks', 0)
                                        try:
                                            marks_value = int(marks_value) if marks_value else 0
                                        except (ValueError, TypeError):
                                            marks_value = 0
                                        
                                        # Ensure confidence is a float
                                        confidence_value = q.get('confidence', 0.0)
                                        try:
                                            confidence_value = float(confidence_value) if confidence_value is not None else 0.0
                                        except (ValueError, TypeError):
                                            confidence_value = 0.0
                                        
                                        normalized_q = {
                                            'questionNumber': q.get('question_number', q.get('questionNumber', 'N/A')),
                                            'questionText': q.get('question_text', q.get('questionText', '')),
                                            'marks': marks_value,
                                            # Bloom's taxonomy (from enrichment)
                                            'bloomLevel': q.get('bloomLevel', 'Unknown'),
                                            'bloomJustification': q.get('bloomJustification', ''),
                                            'confidence': confidence_value,
                                            # Syllabus alignment (map topicsCovered to syllabusTopics)
                                            'syllabusTopics': q.get('topicsCovered', q.get('syllabusTopics', [])),
                                            'topicsCovered': q.get('topicsCovered', q.get('syllabusTopics', [])),
                                            'isSyllabusAligned': True,  # Default to true
                                            # Additional metadata
                                            'difficulty': q.get('difficulty', 'Medium'),
                                            'keywords': q.get('keywords', []),
                                            # Fields for future enhancement
                                            'moduleNumber': q.get('moduleNumber'),
                                            'similarQuestionIds': q.get('similarQuestionIds', []),
                                            'appearanceFrequency': q.get('appearanceFrequency'),
                                            'clusterId': q.get('clusterId')  # From clustering pipeline
                                        }
                                        normalized_questions.append(normalized_q)
                                    
                                    exam['questions'] = normalized_questions
                                
                                exams.append(exam)
        except Exception as e:
            print(f"Could not load organized output: {e}")
        
        # Fallback: try enriched output
        if not exams:
            try:
                enriched_prefix = f"{S3_JOBS_PREFIX}{job_id}/enriched_output/"
                response = s3_client.list_objects_v2(
                    Bucket=S3_BUCKET,
                    Prefix=enriched_prefix
                )
                
                if 'Contents' in response:
                    for obj in response['Contents']:
                        key = obj['Key']
                        if key.endswith('_enriched.json'):
                            obj_response = s3_client.get_object(Bucket=S3_BUCKET, Key=key)
                            data = json.loads(obj_response['Body'].read().decode('utf-8'))
                            
                            if isinstance(data, dict) and 'exams' in data:
                                for exam in data['exams']:
                                    # Normalize questions
                                    if 'questions' in exam:
                                        normalized_questions = []
                                        for q in exam['questions']:
                                            # Ensure marks is an integer
                                            marks_value = q.get('marks', 0)
                                            try:
                                                marks_value = int(marks_value) if marks_value else 0
                                            except (ValueError, TypeError):
                                                marks_value = 0
                                            
                                            # Ensure confidence is a float
                                            confidence_value = q.get('confidence', 0.0)
                                            try:
                                                confidence_value = float(confidence_value) if confidence_value is not None else 0.0
                                            except (ValueError, TypeError):
                                                confidence_value = 0.0
                                            
                                            normalized_q = {
                                                'questionNumber': q.get('question_number', q.get('questionNumber', 'N/A')),
                                                'questionText': q.get('question_text', q.get('questionText', '')),
                                                'marks': marks_value,
                                                'bloomLevel': q.get('bloomLevel', 'Unknown'),
                                                'bloomJustification': q.get('bloomJustification', ''),
                                                'confidence': confidence_value,
                                                'syllabusTopics': q.get('topicsCovered', q.get('syllabusTopics', [])),
                                                'topicsCovered': q.get('topicsCovered', q.get('syllabusTopics', [])),
                                                'isSyllabusAligned': True,
                                                'difficulty': q.get('difficulty', 'Medium'),
                                                'keywords': q.get('keywords', []),
                                                'moduleNumber': q.get('moduleNumber'),
                                                'similarQuestionIds': q.get('similarQuestionIds', []),
                                                'appearanceFrequency': q.get('appearanceFrequency'),
                                                'clusterId': q.get('clusterId')  # From clustering pipeline
                                            }
                                            normalized_questions.append(normalized_q)
                                        exam['questions'] = normalized_questions
                                    exams.append(exam)
            except Exception as e:
                print(f"Could not load enriched output: {e}")
        
        # Last fallback: try parsed output (will have minimal enrichment)
        if not exams:
            try:
                parsed_key = f"{S3_JOBS_PREFIX}{job_id}/parsed_output.json"
                obj_response = s3_client.get_object(Bucket=S3_BUCKET, Key=parsed_key)
                data = json.loads(obj_response['Body'].read().decode('utf-8'))
                
                if isinstance(data, dict) and 'exams' in data:
                    exams = data['exams']
            except Exception as e:
                print(f"Could not load parsed output: {e}")
        
        if not exams:
            return jsonify({
                'error': 'No questions found',
                'message': 'The job completed but no questions were extracted'
            }), 404
        
        # Calculate comprehensive summary
        total_questions = sum(len(exam.get('questions', [])) for exam in exams)
        all_questions = []
        for exam in exams:
            all_questions.extend(exam.get('questions', []))
        
        # Calculate Bloom's distribution
        bloom_counts = {
            'Recall': 0, 'Understand': 0, 'Apply': 0,
            'Analyze': 0, 'Evaluate': 0, 'Create': 0
        }
        
        for q in all_questions:
            level = q.get('bloomLevel', 'Unknown')
            if level in bloom_counts:
                bloom_counts[level] += 1
        
        # Calculate percentages
        bloom_distribution = {}
        if total_questions > 0:
            for level, count in bloom_counts.items():
                bloom_distribution[level] = round((count / total_questions) * 100, 1)
        
        summary = {
            'totalQuestions': total_questions,
            'totalExams': len(exams),
            'subjects': list(set(exam.get('subject', 'Unknown') for exam in exams)),
            'totalMarks': sum(q.get('marks', 0) for q in all_questions),
            'bloomDistribution': bloom_distribution
        }
        
        # Calculate average difficulty
        difficulties = [q.get('difficulty') for q in all_questions if q.get('difficulty')]
        if difficulties:
            difficulty_map = {'Easy': 1, 'easy': 1, 'Medium': 2, 'medium': 2, 'Hard': 3, 'hard': 3}
            avg_diff = sum(difficulty_map.get(d, 2) for d in difficulties) / len(difficulties)
            if avg_diff < 1.5:
                summary['avgDifficulty'] = 'Easy'
            elif avg_diff < 2.5:
                summary['avgDifficulty'] = 'Medium'
            else:
                summary['avgDifficulty'] = 'Hard'
        
        return jsonify({
            'job_id': job_id,
            'filename': metadata.get('filename'),
            'exams': exams,  # Now returns full exam structure instead of flat questions
            'summary': summary
        }), 200
        
    except Exception as e:
        print(f"Error loading questions: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/jobs/active', methods=['GET'])
def get_active_aws_jobs():
    """Get all active AWS jobs"""
    with aws_jobs_lock:
        return jsonify({
            'count': len(aws_active_jobs),
            'jobs': list(aws_active_jobs.values())
        }), 200


# ============================================================================
# Local Pipeline Routes (Development/Testing)
# ============================================================================

@app.route('/submit-local', methods=['POST'])
def submit_local_batch():
    """
    Submit files for local EasyOCR processing.
    
    Request body:
    {
        "file_locations": ["path/to/file1.pdf", "path/to/file2.pdf"],
        "options": {}
    }
    """
    if not LOCAL_PIPELINE_AVAILABLE or not pipeline_manager:
        return jsonify({'error': 'Local pipeline not available'}), 503
    
    try:
        data = request.get_json()
        file_locations = data.get('file_locations', [])
        options = data.get('options', {})
        
        if not file_locations:
            return jsonify({'error': 'No file_locations provided'}), 400
        
        batch_id = pipeline_manager.submit_batch(file_locations, options)
        
        return jsonify({
            "success": True,
            "batch_id": batch_id,
            "message": "Local batch submitted successfully",
            "files_queued": len(file_locations)
        }), 202
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/status/<batch_id>', methods=['GET'])
def get_local_batch_status(batch_id: str):
    """Get status of a local batch"""
    if not LOCAL_PIPELINE_AVAILABLE or not pipeline_manager:
        return jsonify({'error': 'Local pipeline not available'}), 503
    
    status = pipeline_manager.get_batch_status(batch_id)
    
    if status is None:
        return jsonify({"error": "Batch not found"}), 404
    
    return jsonify({"success": True, "status": status}), 200


# ============================================================================
# File Upload Routes (Frontend Integration)
# ============================================================================

@app.route('/upload/question-papers', methods=['POST'])
def upload_question_papers():
    """
    Upload question papers from frontend and process them through AWS pipeline.
    
    Accepts multiple PDF files, uploads to S3, and starts OCR processing.
    """
    if not AWS_AVAILABLE or not AWS_MODULES_AVAILABLE:
        return jsonify({'error': 'AWS pipeline not configured'}), 503
    
    try:
        # Check if files are present
        if 'files' not in request.files:
            return jsonify({'error': 'No files provided'}), 400
        
        files = request.files.getlist('files')
        
        if not files or len(files) == 0:
            return jsonify({'error': 'No files selected'}), 400
        
        # Validate file types
        allowed_extensions = {'.pdf', '.PDF'}
        uploaded_jobs = []
        errors = []
        
        for file in files:
            # Check if file is PDF
            filename = file.filename
            if not filename:
                continue
            
            file_ext = os.path.splitext(filename)[1]
            if file_ext not in allowed_extensions:
                errors.append(f"{filename}: Only PDF files are allowed")
                continue
            
            try:
                # Generate unique job ID
                job_id = str(uuid.uuid4())
                
                # Upload to S3
                s3_key = f"{S3_JOBS_PREFIX}{job_id}/original/{filename}"
                
                # Read file content
                file_content = file.read()
                
                # Upload to S3
                s3_client.put_object(
                    Bucket=S3_BUCKET,
                    Key=s3_key,
                    Body=file_content,
                    ContentType='application/pdf'
                )
                
                print(f"✓ Uploaded {filename} to s3://{S3_BUCKET}/{s3_key}")
                
                # Submit job to background processing
                get_job_executor().submit(process_aws_job_pipeline, job_id, s3_key, filename)
                
                uploaded_jobs.append({
                    'job_id': job_id,
                    'filename': filename,
                    's3_key': s3_key,
                    'status': 'processing'
                })
                
            except Exception as e:
                errors.append(f"{filename}: {str(e)}")
                print(f"✗ Failed to upload {filename}: {e}")
        
        # Prepare response
        response = {
            'success': len(uploaded_jobs) > 0,
            'message': f'Uploaded {len(uploaded_jobs)} files successfully',
            'jobs': uploaded_jobs
        }
        
        if errors:
            response['errors'] = errors
            response['message'] += f', {len(errors)} failed'
        
        status_code = 202 if len(uploaded_jobs) > 0 else 400
        return jsonify(response), status_code
        
    except Exception as e:
        print(f"Upload error: {e}")
        return jsonify({'error': str(e)}), 500


# ============================================================================
# Server Lifecycle Management
# ============================================================================

def cleanup_resources():
    """Cleanup resources on shutdown"""
    global _job_executor
    
    print("\n🧹 Cleaning up resources...")
    
    # Shutdown thread pool gracefully
    if _job_executor is not None:
        print("  Shutting down job executor...")
        _job_executor.shutdown(wait=True, cancel_futures=False)
        _job_executor = None
    
    # Stop local pipeline if running
    if LOCAL_PIPELINE_AVAILABLE and pipeline_manager:
        try:
            if hasattr(pipeline_manager, 'stop_server'):
                print("  Stopping local pipeline...")
                pipeline_manager.stop_server()
        except Exception as e:
            print(f"  Warning: Error stopping local pipeline: {e}")
    
    print("✓ Cleanup complete")


import atexit
atexit.register(cleanup_resources)


# ============================================================================
# Server Startup
# ============================================================================

if __name__ == '__main__':
    port = int(os.getenv('PORT', '5000'))
    debug = os.getenv('DEBUG', 'True').lower() == 'true'
    
    # Start local pipeline if available (lazy initialization recommended)
    if LOCAL_PIPELINE_AVAILABLE and pipeline_manager:
        try:
            if hasattr(pipeline_manager, 'start_server'):
                pipeline_manager.start_server()
        except Exception as e:
            print(f"⚠ Warning: Could not start local pipeline: {e}")
    
    print("=" * 80)
    print("UNIFIED PIPELINE SERVER (Optimized)")
    print("=" * 80)
    print(f"Port: {port}")
    print(f"S3 Bucket: {S3_BUCKET}")
    print(f"Max Concurrent Jobs: {MAX_CONCURRENT_JOBS} (lazy-initialized)")
    print(f"Debug Mode: {debug}")
    print(f"\nPipeline Status:")
    print(f"  Local (EasyOCR): {'✓ Available' if LOCAL_PIPELINE_AVAILABLE else '✗ Not Available'}")
    print(f"  AWS (Textract):  {'✓ Available' if AWS_AVAILABLE and AWS_MODULES_AVAILABLE else '✗ Not Available'}")
    print("=" * 80)
    print("\nAWS Pipeline Endpoints (Production):")
    print("  POST   /process              - Process single document")
    print("  POST   /process/batch        - Process multiple documents")
    print("  GET    /job/<id>/status      - Get job status")
    print("  GET    /job/<id>/metadata    - Get job metadata")
    print("  GET    /jobs/active          - List active jobs")
    print("\nLocal Pipeline Endpoints (Development):")
    print("  POST   /submit-local         - Submit local batch")
    print("  GET    /status/<batch_id>    - Get batch status")
    print("\nFrontend Integration:")
    print("  POST   /upload/question-papers  - Upload PDFs from frontend")
    print("\nShared:")
    print("  GET    /health               - Health check")
    print("=" * 80)
    
    app.run(host='0.0.0.0', port=port, debug=debug)
