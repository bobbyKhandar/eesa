"""
Question Parsing Pipeline

This pipeline converts OCR text output into structured JSON with exam questions.
Handles multi-exam documents and extracts metadata.

Stage: OCR → Parsed Questions
Input: Text files from Textract OCR
Output: Structured JSON with questions, metadata
"""

import boto3
import os
import json
import time
from datetime import datetime
from typing import Dict, Optional, List
import re

from botocore.config import Config

# AWS Client with timeout configuration
boto_config = Config(
    read_timeout=300,  # 5 minutes for large document processing
    connect_timeout=60,
    retries={'max_attempts': 3, 'mode': 'adaptive'}
)
bedrock_client = boto3.client('bedrock-runtime', region_name='ap-south-1', config=boto_config)
s3_client = boto3.client('s3', config=boto_config)

# Configuration
S3_BUCKET = os.getenv('S3_BUCKET', 'eesa-pipeline-storage')
S3_JOBS_PREFIX = 'jobs/'
MODEL_ID = "google.gemma-3-27b-it"
MAX_RETRIES = 3
COST_PER_1K_INPUT_TOKENS = 0.0008  # Bedrock pricing
COST_PER_1K_OUTPUT_TOKENS = 0.0024

# System instructions for parsing
PARSING_SYSTEM_INSTRUCTIONS = """
You are an expert parsing AI. Your sole task is to convert a messy text blob containing one or more exam papers into a single, clean JSON structure.

**CRITICAL OUTPUT REQUIREMENTS:**
1.  **LANGUAGE:** Your entire response MUST be in **English only**.
2.  **FORMAT:** Your entire response MUST be **only a single, valid JSON object** starting with `{` and ending with `}`. Use standard English characters and JSON syntax. Do not add any text before or after the JSON.
3.  **NO NESTING:** The `questions` array MUST be a flat list. **NEVER** nest question objects inside other question objects (e.g., inside an `options` array).

**CONTINUATION DETECTION (CRITICAL):**
Before parsing, check if this text is a continuation from a previous chunk:
- Does it start WITHOUT header/metadata (university name, subject, year)?
- Do questions NOT start from Q1/Question 1 (e.g., starts from Q5 or mid-question)?
- Does text begin mid-sentence or incomplete?

If YES to any of the above, return:
{
  "is_continuation": true,
  "starts_at_question": <first question number found, or null if mid-question>,
  "exams": [...],  // Parse as usual but metadata may be incomplete
  "subjectsCreated": []
}

If NO (normal start), return normal format without "is_continuation" key.

**CRITICAL PARSING RULES:**
1.  **FLATTEN GROUP QUESTIONS:** If a question (e.g., 'Q3') is a "group question" (like 'MULTIPLE CHOICE QUESTIONS') followed by sub-items (i, ii, iii), you **MUST** create a *separate JSON object for each sub-item*. Prepend the group title to the sub-item's `question_text`.

**PROCESSING STEPS:**
1.  **Check for Continuation First** - Apply continuation detection logic above
2.  **Split Exams:** The text may contain multiple exams. Identify each one (often starting with 'K.J. Somaiya College') and create one JSON object for each under the `exams` key.
3.  **Extract and Normalize Metadata:** For each exam, extract:
    * `subject`: Find the "Name of the Course" or subject name from the exam paper. Use the exact name as written in the document. Add all extracted subject names to the `subjectsCreated` list at the root level.
    * `max_marks`: Extract maximum marks
    * `year`: Extract year
    * `semester`: Extract semester
    * `branch`: Extract branch/department
    * `examType`: "main" or "kt" (KT = backlog exam)
4.  **Extract Questions:** For each question in an exam, create an object with:
    * `question_number`: (e.g., "Q1 (a)" or "Q6 i.")
    * `question_text`: The full, re-assembled text, including any inherited group title.
    * `marks`: Find the standalone number associated with the question.
    * `questionType`: Set to "text" or "mcq".
    * `options`: If `questionType` is "mcq", create an array of strings for the choices. If "text", this key must not exist.
5.  **Special Handling:**
    * **"OR" Blocks:** Treat "OR" choices as distinct question objects with `question_number` set to "OR".
    * **Mixed Types:** Acknowledge that exams can contain both "text" and "mcq" types.
6.  **Handle Missing Data:** If any *metadata* or the `marks` field cannot be found, set its value to an empty string (`""`). Do not omit the key.

**FINAL JSON OUTPUT STRUCTURE:**
{
  "is_continuation": false,  // or true if continuation detected
  "starts_at_question": null,  // or question number if continuation
  "exams": [
    {
      "subject": "Database Management Systems",
      "max_marks": "100",
      "year": "2019",
      "semester": "III",
      "branch": "IT",
      "examType": "main",
      "questions": [
        {
          "question_number": "Q1 (a)",
          "question_text": "What are the features of database system?",
          "questionType": "text",
          "marks": "10"
        }
      ]
    }
  ],
  "subjectsCreated": ["Database Management Systems"]
}

**IMPORTANT:** If the text is too big or you run out of tokens, output exactly: "too big text"
"""


def clean_json_response(response_text: str) -> str:
    """Remove markdown code blocks and extract valid JSON"""
    response_text = re.sub(r'```json\s*', '', response_text)
    response_text = re.sub(r'```\s*', '', response_text)
    
    # Try JSON object first
    obj_start = response_text.find('{')
    obj_end = response_text.rfind('}')
    
    if obj_start != -1 and obj_end != -1 and obj_start < obj_end:
        return response_text[obj_start:obj_end+1]
    
    return response_text


def validate_and_fix_json(json_str: str) -> Optional[Dict]:
    """Validate JSON and attempt to fix common issues"""
    try:
        return json.loads(json_str)
    except json.JSONDecodeError as e:
        print(f"   ⚠ JSON parsing error: {e}")
        print(f"   🔧 Attempting to fix...")
        
        # Extract JSON boundaries
        obj_start = json_str.find('{')
        obj_end = json_str.rfind('}')
        if obj_start != -1 and obj_end != -1:
            json_str = json_str[obj_start:obj_end+1]
        
        # Fix common issues
        json_str = re.sub(r',\s*}', '}', json_str)
        json_str = re.sub(r',\s*]', ']', json_str)
        json_str = re.sub(r'//.*?(\n|$)', '', json_str)
        json_str = re.sub(r'/\*.*?\*/', '', json_str, flags=re.DOTALL)
        
        try:
            return json.loads(json_str)
        except json.JSONDecodeError as e2:
            print(f"   ✗ Could not fix JSON: {e2}")
            return None


def call_bedrock_for_parsing(text_content: str) -> str:
    """Call AWS Bedrock to parse OCR text into structured questions"""
    request_body = {
        "modelId": MODEL_ID,
        "messages": [{
            "role": "user",
            "content": [{"text": text_content}]
        }],
        "system": [{"text": PARSING_SYSTEM_INSTRUCTIONS}],
        "inferenceConfig": {
            "maxTokens": 8192,
            "temperature": 0.1,
            "topP": 0.9
        }
    }
    
    print(f"   📤 Sending to Bedrock ({MODEL_ID})...")
    
    response = bedrock_client.converse(**request_body)
    
    # Extract text from response
    content = response['output']['message']['content']
    response_text = ""
    for item in content:
        if isinstance(item, dict) and 'text' in item:
            response_text += item['text']
    
    if not response_text:
        raise ValueError("No text content in Bedrock response")
    
    return response_text


def load_ocr_from_s3(job_id: str, filename: str) -> Optional[str]:
    """Load OCR text from S3"""
    try:
        base_name = os.path.splitext(filename)[0]
        s3_key = f"{S3_JOBS_PREFIX}{job_id}/ocr_output/{base_name}_ocr.json"
        
        print(f"   📥 Loading OCR from s3://{S3_BUCKET}/{s3_key}")
        
        response = s3_client.get_object(Bucket=S3_BUCKET, Key=s3_key)
        ocr_data = json.loads(response['Body'].read().decode('utf-8'))
        
        return ocr_data.get('extracted_text', '')
    
    except Exception as e:
        print(f"   ✗ Error loading OCR from S3: {e}")
        return None


def save_parsed_to_s3(parsed_data: Dict, job_id: str, filename: str) -> bool:
    """Save parsed questions to S3"""
    try:
        base_name = os.path.splitext(filename)[0]
        output_filename = f"{base_name}_parsed.json"
        s3_key = f"{S3_JOBS_PREFIX}{job_id}/parsed_output/{output_filename}"
        
        # Add metadata
        parsed_data['job_id'] = job_id
        parsed_data['original_filename'] = filename
        parsed_data['parsed_at'] = datetime.now().isoformat()
        
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=s3_key,
            Body=json.dumps(parsed_data, indent=2, ensure_ascii=False),
            ContentType='application/json'
        )
        
        print(f"   📤 Uploaded to s3://{S3_BUCKET}/{s3_key}")
        return True
    
    except Exception as e:
        print(f"   ✗ Error saving to S3: {e}")
        return False


def parse_questions_for_job(job_id: str, filename: str, retry_count: int = 0) -> Optional[Dict]:
    """
    Parse OCR text into structured questions using Bedrock.
    
    Args:
        job_id: Unique job identifier
        filename: Original PDF filename
        retry_count: Current retry attempt
        
    Returns:
        dict: Metadata about parsing results, or None if failed
    """
    attempt_label = f" (Retry {retry_count}/{MAX_RETRIES})" if retry_count > 0 else ""
    
    print(f"\n{'='*60}")
    print(f"Parsing Questions: {filename}{attempt_label}")
    print(f"Job ID: {job_id}")
    print(f"{'='*60}\n")
    
    try:
        # Step 1: Load OCR text from S3
        ocr_text = load_ocr_from_s3(job_id, filename)
        if not ocr_text:
            if retry_count < MAX_RETRIES:
                print(f"\n🔄 Retrying OCR load... (Attempt {retry_count + 2}/{MAX_RETRIES + 1})")
                time.sleep(2)
                return parse_questions_for_job(job_id, filename, retry_count + 1)
            return None
        
        print(f"   ✓ Loaded OCR text ({len(ocr_text)} chars)")
        
        # Step 2: Call Bedrock for parsing
        raw_response = call_bedrock_for_parsing(ocr_text)
        print(f"   ✓ Received response ({len(raw_response)} chars)")
        
        # Check for "too big text" response
        if "too big text" in raw_response.lower():
            print(f"   ⚠ Text exceeds token limit - cannot process")
            return {
                'success': False,
                'error': 'Text exceeds token limit - PDF is too large to process. Please split into smaller parts.',
                'error_type': 'token_limit_exceeded'
            }
        
        # Step 3: Clean and validate JSON
        cleaned_json = clean_json_response(raw_response)
        parsed_data = validate_and_fix_json(cleaned_json)
        
        if parsed_data is None:
            if retry_count < MAX_RETRIES:
                print(f"\n🔄 Retrying parse... (Attempt {retry_count + 2}/{MAX_RETRIES + 1})")
                time.sleep(3)
                return parse_questions_for_job(job_id, filename, retry_count + 1)
            return None
        
        # Handle array response (wrap it)
        if isinstance(parsed_data, list):
            subjects = list(set(exam.get('subject', '') for exam in parsed_data if exam.get('subject')))
            parsed_data = {
                'exams': parsed_data,
                'subjectsCreated': subjects
            }
        
        # Validate structure
        if 'exams' not in parsed_data:
            parsed_data = {'exams': [], 'subjectsCreated': []}
        
        total_exams = len(parsed_data.get('exams', []))
        total_questions = sum(len(exam.get('questions', [])) for exam in parsed_data.get('exams', []))
        
        print(f"   ✓ Parsed {total_exams} exam(s), {total_questions} questions")
        print(f"   📚 Subjects: {parsed_data.get('subjectsCreated', [])}")
        
        # Step 4: Save to S3
        success = save_parsed_to_s3(parsed_data, job_id, filename)
        
        if not success:
            if retry_count < MAX_RETRIES:
                print(f"\n🔄 Retrying S3 save... (Attempt {retry_count + 2}/{MAX_RETRIES + 1})")
                time.sleep(2)
                return parse_questions_for_job(job_id, filename, retry_count + 1)
            return None
        
        # Estimate cost (rough approximation)
        input_tokens = len(ocr_text) / 4  # ~4 chars per token
        output_tokens = len(raw_response) / 4
        cost = (input_tokens / 1000 * COST_PER_1K_INPUT_TOKENS) + \
               (output_tokens / 1000 * COST_PER_1K_OUTPUT_TOKENS)
        
        print(f"\n✓ Parsing complete!")
        print(f"   Cost: ${cost:.4f}")
        if retry_count > 0:
            print(f"   ⚠ Succeeded after {retry_count} retry/retries")
        
        return {
            'job_id': job_id,
            'filename': filename,
            'total_exams': total_exams,
            'total_questions': total_questions,
            'subjects': parsed_data.get('subjectsCreated', []),
            'processing_cost': cost,
            'retry_count': retry_count
        }
    
    except Exception as e:
        print(f"   ✗ Error: {e}")
        if retry_count < MAX_RETRIES:
            print(f"\n🔄 Retrying... (Attempt {retry_count + 2}/{MAX_RETRIES + 1})")
            time.sleep(3)
            return parse_questions_for_job(job_id, filename, retry_count + 1)
        return None


def parse_chunk(chunk_text: str, chunk_metadata: Dict, retry_count: int = 0) -> Optional[Dict]:
    """
    Parse a single chunk of OCR text
    
    Args:
        chunk_text: The OCR text for this chunk
        chunk_metadata: Metadata about the chunk (chunk_id, is_continuation, etc.)
        retry_count: Current retry attempt
    
    Returns:
        Parsed JSON or None if failed
    """
    print(f"\n📝 Parsing chunk {chunk_metadata.get('chunk_id', '?')}...")
    
    try:
        # Prepare the Bedrock API request
        conversation = [
            {
                "role": "user",
                "content": [{"text": chunk_text}],
            }
        ]
        
        inference_config = {
            "maxTokens": 16384,  # 16k tokens: enough for ~25 questions with full metadata
            "temperature": 0.05,
        }
        
        # Call Bedrock API
        start_time = time.time()
        response = bedrock_client.converse(
            modelId=MODEL_ID,
            messages=conversation,
            system=[{"text": PARSING_SYSTEM_INSTRUCTIONS}],
            inferenceConfig=inference_config
        )
        
        duration = time.time() - start_time
        
        # Extract response text
        response_text = response['output']['message']['content'][0]['text']
        response_text = clean_json_response(response_text)
        
        # Calculate cost
        usage = response.get('usage', {})
        input_tokens = usage.get('inputTokens', 0)
        output_tokens = usage.get('outputTokens', 0)
        cost = (input_tokens / 1000 * COST_PER_1K_INPUT_TOKENS) + \
               (output_tokens / 1000 * COST_PER_1K_OUTPUT_TOKENS)
        
        print(f"   LLM Response received ({duration:.1f}s)")
        print(f"   Input tokens: {input_tokens}, Output tokens: {output_tokens}")
        print(f"   Cost: ${cost:.4f}")
        
        # Check for "too big" response
        if "too big" in response_text.lower():
            print(f"   ⚠ Chunk still too big!")
            return {
                'error': 'Chunk exceeds token limit',
                'chunk_id': chunk_metadata.get('chunk_id'),
                'cost': cost
            }
        
        # Parse JSON
        parsed_data = validate_and_fix_json(response_text)
        
        if not parsed_data:
            if retry_count < MAX_RETRIES:
                print(f"\n🔄 Retrying chunk parse... (Attempt {retry_count + 2}/{MAX_RETRIES + 1})")
                time.sleep(2)
                return parse_chunk(chunk_text, chunk_metadata, retry_count + 1)
            return None
        
        # Add chunk metadata to result
        parsed_data['chunk_id'] = chunk_metadata.get('chunk_id')
        parsed_data['chunk_metadata'] = chunk_metadata
        parsed_data['parsing_cost'] = cost
        
        # Count questions
        total_questions = sum(len(exam.get('questions', [])) for exam in parsed_data.get('exams', []))
        print(f"   ✓ Parsed {total_questions} questions from chunk")
        
        return parsed_data
        
    except Exception as e:
        print(f"   ✗ Error parsing chunk: {e}")
        if retry_count < MAX_RETRIES:
            print(f"\n🔄 Retrying... (Attempt {retry_count + 2}/{MAX_RETRIES + 1})")
            time.sleep(3)
            return parse_chunk(chunk_text, chunk_metadata, retry_count + 1)
        return None


def parse_chunked_document(chunks: List[Dict], job_id: str, filename: str) -> Optional[Dict]:
    """
    Parse a document that has been split into chunks
    
    Args:
        chunks: List of chunks from intelligent_chunking module
        job_id: Job ID for S3 storage
        filename: Original filename
    
    Returns:
        Merged parsing result or None
    """
    print(f"\n{'='*60}")
    print(f"Parsing Chunked Document: {filename}")
    print(f"Total Chunks: {len(chunks)}")
    print(f"{'='*60}")
    
    parsed_chunks = []
    total_cost = 0
    
    # Parse each chunk
    for chunk in chunks:
        chunk_result = parse_chunk(chunk['text'], chunk)
        
        if chunk_result and not chunk_result.get('error'):
            parsed_chunks.append(chunk_result)
            total_cost += chunk_result.get('parsing_cost', 0)
        else:
            print(f"⚠ Chunk {chunk.get('chunk_id')} failed to parse")
            # Continue with other chunks
    
    if not parsed_chunks:
        print("✗ All chunks failed to parse")
        return None
    
    print(f"\n� Saving {len(parsed_chunks)} parsed chunks individually...")
    
    # Save each parsed chunk to S3 (DON'T merge yet - enrichment needs to process chunks separately)
    base_name = os.path.splitext(filename)[0]
    chunk_keys = []
    
    for idx, chunk_result in enumerate(parsed_chunks):
        try:
            chunk_key = f"{S3_JOBS_PREFIX}{job_id}/parsed_chunks/chunk_{idx}_{base_name}.json"
            s3_client.put_object(
                Bucket=S3_BUCKET,
                Key=chunk_key,
                Body=json.dumps(chunk_result, indent=2),
                ContentType='application/json'
            )
            chunk_keys.append(chunk_key)
            print(f"   ✓ Saved chunk {idx} to S3")
        except Exception as e:
            print(f"   ⚠ Failed to save chunk {idx}: {e}")
    
    # Save chunk metadata for enrichment stage
    chunk_metadata = {
        'total_chunks': len(parsed_chunks),
        'chunk_keys': chunk_keys,
        'filename': filename,
        'job_id': job_id
    }
    
    metadata_key = f"{S3_JOBS_PREFIX}{job_id}/parsed_chunks/_metadata.json"
    s3_client.put_object(
        Bucket=S3_BUCKET,
        Key=metadata_key,
        Body=json.dumps(chunk_metadata, indent=2),
        ContentType='application/json'
    )
    
    # Count totals from chunks
    total_exams = sum(len(chunk.get('exams', [])) for chunk in parsed_chunks)
    total_questions = sum(
        sum(len(exam.get('questions', [])) for exam in chunk.get('exams', []))
        for chunk in parsed_chunks
    )
    
    print(f"\n📊 Chunked Parsing Complete:")
    print(f"   Chunks: {len(parsed_chunks)}")
    print(f"   Total Questions: {total_questions}")
    print(f"   ⚠ Merge will happen AFTER enrichment")
    
    return {
        'job_id': job_id,
        'filename': filename,
        'total_exams': total_exams,
        'total_questions': total_questions,
        'processing_cost': total_cost,
        'chunks_processed': len(parsed_chunks),
        'is_chunked': True,
        'chunk_metadata_key': metadata_key
    }


if __name__ == "__main__":
    # Test example
    result = parse_questions_for_job(
        job_id="test-123",
        filename="sample_exam.pdf"
    )
    
    if result:
        print(f"\n✅ Success: {result}")
    else:
        print(f"\n❌ Failed")

