"""
AWS Bedrock Question Enrichment Pipeline
========================================

Purpose:
--------
This "slave" pipeline runs AFTER the initial parsing stage. It takes structured exam questions 
(from the `parsed_output` folder in S3) and uses AWS Bedrock (LLMs) to intelligently analyze 
them against Bloom's Taxonomy.

Key Architectures & Features:
-----------------------------
1. Job-Based Continuity:
   - Reads: s3://{bucket}/jobs/{job_id}/parsed_output/{filename}_parsed.json
   - Writes: s3://{bucket}/jobs/{job_id}/enriched_output/{filename}_enriched.json

2. Intelligent Enrichment (Generative AI):
   - Categorizes questions into Bloom's levels (Recall, Understand, Apply, etc.).
   - Assigns difficulty scores and extracts key topics.
   - Calculates a "confidence score" for the AI's classification.

3. Resilience & Cost:
   - Includes retry logic for Bedrock API throttling/failures.
   - Tracks estimated processing costs per request.

Environment Variables:
----------------------
- S3_BUCKET: Target bucket (default: 'eesa-pipeline-storage')
- BEDROCK_MODEL_ID: Model ID to use (e.g., 'anthropic.claude-3-sonnet...', currently set to custom endpoint)
- AWS_REGION: Region for Bedrock client (default: 'ap-south-1')

Usage Examples:
---------------

1. Command Line (Single File Integration):
   ---------------------------------------
   # Useful when triggering this script from an external orchestrator (like Airflow or a shell script)
   $ python enrich_pipeline.py "job-uuid-123" "math_paper_v1.pdf"

2. Python Import (Batch Processing Loop):
   --------------------------------------
   from enrich_pipeline import enrich_questions_for_job
   
   jobs_to_process = [
       ("job_101", "physics.pdf"),
       ("job_102", "chemistry.pdf")
   ]

   for job_id, filename in jobs_to_process:
       result = enrich_questions_for_job(job_id, filename)
       if result:
           print(f"Enriched {filename}: {result['total_enriched']} questions")

"""

import boto3
import os
import json
import time
from datetime import datetime
from typing import Dict, List, Optional
import sys
from botocore.config import Config

# ==========================================
# AWS Client Initialization
# ==========================================
boto_config = Config(
    read_timeout=300,  # 5 minutes for large batches
    connect_timeout=60,
    retries={'max_attempts': 3, 'mode': 'adaptive'}
)
bedrock_client = boto3.client('bedrock-runtime', region_name="ap-south-1", config=boto_config)
s3_client = boto3.client('s3', config=boto_config)

# ==========================================
# Configuration & Constants
# ==========================================

# S3 Structure
S3_BUCKET = os.getenv('S3_BUCKET', 'eesa-pipeline-storage')
S3_JOBS_PREFIX = 'jobs/'  # Base prefix for all jobs

# Bedrock Config
# Note: Ensure this Model ID is enabled in your AWS Bedrock Model Access settings
BEDROCK_MODEL_ID = "google.gemma-3-27b-it" 


# Processing Limits
MAX_RETRIES = 3             # Retry attempts for AI generation failures
COST_PER_REQUEST = 0.001    # Estimated cost tracking

def get_bloom_enrichment(questions: List[Dict], subject: str, semester: str, branch: str) -> Optional[List[Dict]]:
    """
    Constructs a prompt and calls AWS Bedrock to classify questions.
    
    Args:
        questions: List of question objects
        subject: Contextual subject name
        semester: Contextual semester
        branch: Contextual branch
        
    Returns:
        List[Dict]: The AI-generated classification data, or None if failed.
    """
    # Prepare questions text for the prompt
    questions_text = ""
    for idx, q in enumerate(questions):
        questions_text += f"\n{idx + 1}. {q.get('question_number', 'N/A')} ({q.get('marks', '?')} marks)\n"
        questions_text += f"   Type: {q.get('questionType', 'text')}\n"
        questions_text += f"   Text: {q.get('question_text', '')}\n"
        if q.get('options'):
            questions_text += f"   Options: {', '.join(q['options'][:2])}...\n"
    
    bloom_prompt = f"""Analyze these exam questions and classify each using Bloom's Taxonomy.

Subject: {subject}
Semester: {semester}
Branch: {branch}

Questions:
{questions_text}

**Bloom's Taxonomy Levels:**
1. **Recall** - Remember facts, terms, basic concepts (keywords: state, list, define, name, identify, label, what is)
2. **Understand** - Explain ideas, concepts (keywords: explain, describe, summarize, interpret, discuss, clarify)
3. **Apply** - Use information in new situations (keywords: calculate, solve, demonstrate, apply, use, implement)
4. **Analyze** - Draw connections, examine relationships (keywords: analyze, compare, contrast, examine, differentiate)
5. **Evaluate** - Justify decisions, judge value (keywords: evaluate, assess, critique, judge, argue, justify)
6. **Create** - Produce new work, design solutions (keywords: design, construct, develop, formulate, create, plan)

For each question, provide:
- **bloomLevel**: One of "Recall", "Understand", "Apply", "Analyze", "Evaluate", "Create"
- **bloomJustification**: Detailed explanation (2-3 sentences) of why this level was chosen
- **confidence**: Float 0.0-1.0 (how certain you are)
- **difficulty**: "Easy", "Medium", or "Hard"
- **keywords**: 3-5 key terms from the question
- **topicsCovered**: 2-4 main topics/concepts

Return ONLY a JSON array matching the question order:
[
  {{
    "questionIndex": 0,
    "bloomLevel": "Apply",
    "bloomJustification": "This question requires students to use their knowledge...",
    "confidence": 0.88,
    "difficulty": "Medium",
    "keywords": ["algorithm", "complexity", "analysis"],
    "topicsCovered": ["Time Complexity", "Algorithm Analysis"]
  }}
]

CRITICAL: Return ONLY the JSON array, no markdown, no extra text."""

    try:
        print(f"   📤 Requesting Bloom's analysis from Bedrock...")
        
        request_body = {
            "modelId": BEDROCK_MODEL_ID,
            "messages": [{
                "role": "user",
                "content": [{"text": bloom_prompt}]
            }],
            "inferenceConfig": {
                "maxTokens": 8192,
                "temperature": 0.2,
                "topP": 0.9
            }
        }
        
        response = bedrock_client.converse(**request_body)
        content = response['output']['message']['content']
        
        bloom_response = ""
        for item in content:
            if isinstance(item, dict) and 'text' in item:
                bloom_response += item['text']
        
        # Clean response (remove markdown)
        bloom_response = bloom_response.replace('```json', '').replace('```', '').strip()
        
        # Find JSON array
        array_start = bloom_response.find('[')
        array_end = bloom_response.rfind(']')
        
        if array_start != -1 and array_end != -1:
            bloom_response = bloom_response[array_start:array_end+1]
        
        # Parse JSON
        bloom_data = json.loads(bloom_response)
        
        if not isinstance(bloom_data, list):
            print(f"   ✗ Response is not a list")
            return None
        
        print(f"   ✓ Received {len(bloom_data)} enrichment entries")
        return bloom_data
        
    except json.JSONDecodeError as e:
        print(f"   ✗ JSON parsing error: {e}")
        print(f"   📄 Response preview: {bloom_response[:200]}")
        return None
    except Exception as e:
        print(f"   ✗ Bedrock request failed: {e}")
        return None

def load_parsed_from_s3(job_id: str, filename: str) -> Optional[Dict]:
    """Load parsed question JSON from S3 (Input stage)."""
    try:
        base_name = os.path.splitext(filename)[0]
        s3_key = f"{S3_JOBS_PREFIX}{job_id}/parsed_output/{base_name}_parsed.json"
        
        print(f"📥 Loading parsed questions from S3...")
        print(f"   s3://{S3_BUCKET}/{s3_key}")
        
        response = s3_client.get_object(
            Bucket=S3_BUCKET,
            Key=s3_key
        )
        
        data = json.loads(response['Body'].read().decode('utf-8'))
        print(f"   ✓ Loaded parsed data")
        return data
        
    except Exception as e:
        print(f"   ✗ Failed to load parsed data: {e}")
        return None

def save_enriched_output(enriched_data: Dict, job_id: str, filename: str) -> bool:
    """Save final enriched data to S3 (Output stage)."""
    try:
        # Prepare output filename
        base_name = os.path.splitext(filename)[0]
        output_filename = f"{base_name}_enriched.json"
        
        # Add metadata
        enriched_data['job_id'] = job_id
        enriched_data['original_filename'] = filename
        enriched_data['processed_at'] = datetime.now().isoformat()
        enriched_data['enrichment_version'] = '1.0'
        
        # Construct S3 key - matches Textract structure
        s3_key = f"{S3_JOBS_PREFIX}{job_id}/enriched_output/{output_filename}"
        
        # Upload to S3
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=s3_key,
            Body=json.dumps(enriched_data, indent=2, ensure_ascii=False),
            ContentType='application/json'
        )
        
        print(f"📤 Uploaded: s3://{S3_BUCKET}/{s3_key}")
        return True
        
    except Exception as e:
        print(f"✗ Error saving enriched output: {e}")
        return False

def enrich_questions_for_job(job_id: str, filename: str, retry_count: int = 0) -> Optional[Dict]:
    """
    Main Orchestrator: Loads parsed data -> calls Bedrock -> Saves enriched data.
    """
    attempt_label = f" (Retry {retry_count}/{MAX_RETRIES})" if retry_count > 0 else ""
    
    print(f"\n{'='*60}")
    print(f"Enriching Questions: {filename}{attempt_label}")
    print(f"Job ID: {job_id}")
    print(f"{'='*60}\n")
    
    # Step 1: Load parsed questions from S3
    parsed_data = load_parsed_from_s3(job_id, filename)
    if not parsed_data:
        if retry_count < MAX_RETRIES:
            print(f"\n🔄 Retrying... (Attempt {retry_count + 2}/{MAX_RETRIES + 1})")
            return enrich_questions_for_job(job_id, filename, retry_count + 1)
        return None
    
    if 'exams' not in parsed_data or not parsed_data['exams']:
        print(f"⚠ No exams found in parsed data")
        if retry_count < MAX_RETRIES:
            print(f"\n🔄 Retrying... (Attempt {retry_count + 2}/{MAX_RETRIES + 1})")
            return enrich_questions_for_job(job_id, filename, retry_count + 1)
        return None
    
    # Step 2: Enrich each exam
    enriched_exams = []
    total_questions = 0
    total_enriched = 0
    
    for exam_idx, exam in enumerate(parsed_data['exams']):
        print(f"\n📖 Processing Exam {exam_idx + 1}: {exam.get('subject', 'Unknown')}")
        
        questions = exam.get('questions', [])
        if not questions:
            print(f"   ⚠ No questions found")
            enriched_exams.append(exam)
            continue
        
        total_questions += len(questions)
        print(f"   📝 Analyzing {len(questions)} questions...")
        
        # Get Bloom's enrichment from Bedrock
        bloom_data = get_bloom_enrichment(
            questions,
            exam.get('subject', 'Unknown'),
            exam.get('semester', 'N/A'),
            exam.get('branch', 'N/A')
        )
        
        if bloom_data is None:
            print(f"   ✗ Failed to get Bloom's classification")
            if retry_count < MAX_RETRIES:
                print(f"\n🔄 Retrying entire enrichment... (Attempt {retry_count + 2}/{MAX_RETRIES + 1})")
                time.sleep(2)  # Brief delay before retry
                return enrich_questions_for_job(job_id, filename, retry_count + 1)
            return None
        
        # Merge Bloom's data with questions
        enriched_questions = []
        bloom_counts = {
            'Recall': 0, 'Understand': 0, 'Apply': 0,
            'Analyze': 0, 'Evaluate': 0, 'Create': 0
        }
        
        for idx, question in enumerate(questions):
            enriched_q = question.copy()
            
            # Find matching Bloom's entry
            bloom_entry = None
            for entry in bloom_data:
                if entry.get('questionIndex') == idx:
                    bloom_entry = entry
                    break
            
            if bloom_entry:
                enriched_q['bloomLevel'] = bloom_entry.get('bloomLevel', 'Unknown')
                enriched_q['bloomJustification'] = bloom_entry.get('bloomJustification', '')
                enriched_q['confidence'] = bloom_entry.get('confidence', 0.0)
                enriched_q['difficulty'] = bloom_entry.get('difficulty', 'Medium')
                enriched_q['keywords'] = bloom_entry.get('keywords', [])
                enriched_q['topicsCovered'] = bloom_entry.get('topicsCovered', [])
                
                level = enriched_q['bloomLevel']
                if level in bloom_counts:
                    bloom_counts[level] += 1
                total_enriched += 1
            else:
                # Default values if no match found
                enriched_q['bloomLevel'] = 'Unknown'
                enriched_q['bloomJustification'] = 'Classification not available'
                enriched_q['confidence'] = 0.0
                enriched_q['difficulty'] = 'Medium'
                enriched_q['keywords'] = []
                enriched_q['topicsCovered'] = []
            
            enriched_questions.append(enriched_q)
        
        # Update exam with enriched questions
        enriched_exam = exam.copy()
        enriched_exam['questions'] = enriched_questions
        enriched_exams.append(enriched_exam)
        
        # Print Bloom's distribution
        total_q = len(enriched_questions)
        print(f"   ✓ Enrichment complete!")
        print(f"   🎯 Bloom's Distribution:")
        for level, count in bloom_counts.items():
            if count > 0:
                percentage = (count / total_q) * 100
                print(f"      {level}: {count} ({percentage:.1f}%)")
    
    # Step 3: Save enriched output to S3
    enriched_output = {
        'exams': enriched_exams,
        'subjectsCreated': parsed_data.get('subjectsCreated', []),
        'total_questions': total_questions,
        'total_enriched': total_enriched,
        'processing_cost': COST_PER_REQUEST * len(parsed_data['exams'])
    }
    
    success = save_enriched_output(enriched_output, job_id, filename)
    
    if success:
        print(f"\n✓ Enrichment complete!")
        print(f"   Total questions: {total_questions}")
        print(f"   Successfully enriched: {total_enriched}")
        print(f"   Cost: ${enriched_output['processing_cost']:.4f}")
        if retry_count > 0:
            print(f"   ⚠ Succeeded after {retry_count} retry/retries")
        
        # Return metadata (matching organize_by_subject pattern)
        return {
            'job_id': job_id,
            'filename': filename,
            'total_questions': total_questions,
            'total_enriched': total_enriched,
            'processing_cost': enriched_output['processing_cost'],
            'processed_at': enriched_output.get('processed_at'),
            'retry_count': retry_count
        }
    else:
        # S3 upload failed, retry if possible
        if retry_count < MAX_RETRIES:
            print(f"\n🔄 S3 upload failed, retrying... (Attempt {retry_count + 2}/{MAX_RETRIES + 1})")
            time.sleep(2)
            return enrich_questions_for_job(job_id, filename, retry_count + 1)
    
    return None


def enrich_chunked_questions(job_id: str, filename: str, chunk_metadata_key: str) -> Optional[Dict]:
    """
    Enrich questions that were processed in chunks.
    Loads each chunk, enriches separately, then merges enriched results.
    
    This prevents token limit issues by keeping chunks separate through enrichment.
    
    Args:
        job_id: Job ID
        filename: Original filename
        chunk_metadata_key: S3 key to chunk metadata file
        
    Returns:
        Final enriched and merged result
    """
    print(f"\n{'='*60}")
    print(f"Enriching Chunked Document: {filename}")
    print(f"Job ID: {job_id}")
    print(f"{'='*60}\n")
    
    try:
        # Load chunk metadata
        print(f"📥 Loading chunk metadata from S3...")
        response = s3_client.get_object(Bucket=S3_BUCKET, Key=chunk_metadata_key)
        chunk_metadata = json.loads(response['Body'].read().decode('utf-8'))
        
        chunk_keys = chunk_metadata['chunk_keys']
        print(f"   ✓ Found {len(chunk_keys)} chunks to enrich")
        
        enriched_chunks = []
        total_questions = 0
        total_enriched = 0
        
        # Enrich each chunk separately
        for idx, chunk_key in enumerate(chunk_keys):
            print(f"\n📖 Processing Chunk {idx + 1}/{len(chunk_keys)}...")
            
            # Load parsed chunk
            response = s3_client.get_object(Bucket=S3_BUCKET, Key=chunk_key)
            parsed_chunk = json.loads(response['Body'].read().decode('utf-8'))
            
            # Enrich this chunk (same logic as enrich_questions_for_job but for one chunk)
            enriched_exams = []
            
            for exam in parsed_chunk.get('exams', []):
                questions = exam.get('questions', [])
                if not questions:
                    enriched_exams.append(exam)
                    continue
                
                total_questions += len(questions)
                print(f"   📝 Enriching {len(questions)} questions from {exam.get('subject', 'Unknown')}...")
                
                # Get Bloom's enrichment
                bloom_data = get_bloom_enrichment(
                    questions,
                    exam.get('subject', 'Unknown'),
                    exam.get('semester', 'N/A'),
                    exam.get('branch', 'N/A')
                )
                
                if not bloom_data:
                    print(f"   ⚠ Enrichment failed for this exam, keeping original")
                    enriched_exams.append(exam)
                    continue
                
                # Merge Bloom's data
                enriched_questions = []
                for q_idx, question in enumerate(questions):
                    enriched_q = question.copy()
                    
                    bloom_entry = next((e for e in bloom_data if e.get('questionIndex') == q_idx), None)
                    
                    if bloom_entry:
                        enriched_q['bloomLevel'] = bloom_entry.get('bloomLevel', 'Unknown')
                        enriched_q['bloomJustification'] = bloom_entry.get('bloomJustification', '')
                        enriched_q['confidence'] = bloom_entry.get('confidence', 0.0)
                        enriched_q['difficulty'] = bloom_entry.get('difficulty', 'Medium')
                        enriched_q['keywords'] = bloom_entry.get('keywords', [])
                        enriched_q['topicsCovered'] = bloom_entry.get('topicsCovered', [])
                        total_enriched += 1
                    else:
                        enriched_q['bloomLevel'] = 'Unknown'
                        enriched_q['bloomJustification'] = 'Classification not available'
                        enriched_q['confidence'] = 0.0
                        enriched_q['difficulty'] = 'Medium'
                        enriched_q['keywords'] = []
                        enriched_q['topicsCovered'] = []
                    
                    enriched_questions.append(enriched_q)
                
                exam['questions'] = enriched_questions
                enriched_exams.append(exam)
            
            # Save enriched chunk
            enriched_chunk = {
                'exams': enriched_exams,
                'chunk_id': idx,
                'metadata': parsed_chunk.get('metadata', {})
            }
            enriched_chunks.append(enriched_chunk)
            
            # Save to S3
            base_name = os.path.splitext(filename)[0]
            enriched_chunk_key = f"{S3_JOBS_PREFIX}{job_id}/enriched_chunks/chunk_{idx}_{base_name}.json"
            s3_client.put_object(
                Bucket=S3_BUCKET,
                Key=enriched_chunk_key,
                Body=json.dumps(enriched_chunk, indent=2),
                ContentType='application/json'
            )
            print(f"   ✓ Saved enriched chunk {idx}")
        
        # Now merge all enriched chunks
        print(f"\n🔗 Merging {len(enriched_chunks)} enriched chunks...")
        
        try:
            from chunk_merger import merge_chunks, validate_merge_result
        except ImportError:
            print("⚠ chunk_merger not available - concatenating chunks")
            # Simple concatenation fallback
            all_exams = []
            for chunk in enriched_chunks:
                all_exams.extend(chunk.get('exams', []))
            merged_result = {'exams': all_exams}
        else:
            merged_result = merge_chunks(enriched_chunks)
            validation = validate_merge_result(merged_result)
            print(f"\n📊 Merge Statistics:")
            print(f"   Exams: {validation['stats']['total_exams']}")
            print(f"   Questions: {validation['stats']['total_questions']}")
        
        # Add final metadata
        merged_result['job_id'] = job_id
        merged_result['original_filename'] = filename
        merged_result['processed_at'] = datetime.now().isoformat()
        merged_result['enrichment_version'] = '1.0-chunked'
        merged_result['total_questions_processed'] = total_questions
        merged_result['total_questions_enriched'] = total_enriched
        
        # Save final merged enriched output
        base_name = os.path.splitext(filename)[0]
        output_key = f"{S3_JOBS_PREFIX}{job_id}/enriched_output/{base_name}_enriched.json"
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=output_key,
            Body=json.dumps(merged_result, indent=2, ensure_ascii=False),
            ContentType='application/json'
        )
        
        print(f"\n✅ Chunked Enrichment Complete!")
        print(f"   Total Questions: {total_questions}")
        print(f"   Enriched: {total_enriched}")
        print(f"   Success Rate: {(total_enriched/total_questions*100):.1f}%")
        print(f"📤 Uploaded: s3://{S3_BUCKET}/{output_key}")
        
        return merged_result
        
    except Exception as e:
        print(f"✗ Error in chunked enrichment: {e}")
        import traceback
        traceback.print_exc()
        return None


# ==========================================
# Main Execution Entry Point
# ==========================================
if __name__ == "__main__":
    
    # Check if arguments are provided (CLI Mode)
    if len(sys.argv) == 3:
        job_id = sys.argv[1]
        filename = sys.argv[2]
        result = enrich_questions_for_job(job_id, filename)
        sys.exit(0 if result else 1)
        
    # Default/Test Mode (No arguments provided)
    else:
        print("Usage: python enrich_questions_job_based.py <job_id> <filename>")
        print("\n--- No arguments provided. Running TEST MODE ---")
        
        # Define a test job
        test_job_id = "test-job-001"
        test_filename = "sample_paper.pdf"
        
        print(f"Simulating enrichment for Job: {test_job_id}, File: {test_filename}")
        print("Note: This requires a valid 'parsed_output' file in S3 to work.")
        
        # Uncomment to run test:
        # enrich_questions_for_job(test_job_id, test_filename)