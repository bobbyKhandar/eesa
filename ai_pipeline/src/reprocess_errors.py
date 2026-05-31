"""
Reprocess Error Files Through AWS Bedrock Pipeline

This script processes files that failed during the initial parsing or enrichment phases:
1. parsedQuestions/errors/*.txt.error.txt - Failed during initial OCR parsing
2. enrichedQuestions/errors/*.json_bloom.error.txt - Failed during Bloom's taxonomy enrichment

It resends these files through the appropriate AWS Bedrock pipeline to attempt recovery.
"""

import os
import json
import boto3
import time
import re
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Tuple, Optional
import concurrent.futures
from botocore.config import Config

# AWS Bedrock Configuration
BEDROCK_MODEL_ID = "google.gemma-3-27b-it"
REGION = "us-east-1"

# Paths
BASE_DIR = Path(__file__).parent.parent
PARSED_ERRORS_DIR = BASE_DIR / "parsedQuestions" / "errors"
ENRICHED_ERRORS_DIR = BASE_DIR / "enrichedQuestions" / "errors"
PARSED_QUESTIONS_DIR = BASE_DIR / "parsedQuestions"
ENRICHED_QUESTIONS_DIR = BASE_DIR / "enrichedQuestions"
REPROCESSED_DIR = BASE_DIR / "reprocessedFromErrors"

# Ensure output directories exist
REPROCESSED_DIR.mkdir(exist_ok=True)
(REPROCESSED_DIR / "parsed").mkdir(exist_ok=True)
(REPROCESSED_DIR / "enriched").mkdir(exist_ok=True)
(REPROCESSED_DIR / "failed").mkdir(exist_ok=True)

# Initialize Bedrock client
config = Config(
    region_name=REGION,
    read_timeout=300,  # 5 minutes for large documents
    connect_timeout=60,
    retries={'max_attempts': 3, 'mode': 'adaptive'}
)
bedrock_runtime = boto3.client('bedrock-runtime', config=config)


def clean_json_response(response_text: str) -> str:
    """
    Clean Bedrock response to extract valid JSON.
    Prioritizes array extraction over object extraction.
    """
    # Remove markdown code blocks
    response_text = re.sub(r'```json\s*', '', response_text)
    response_text = re.sub(r'```\s*$', '', response_text)
    
    # Try to extract JSON array first (for questions parsing)
    array_match = re.search(r'\[\s*\{.*\}\s*\]', response_text, re.DOTALL)
    if array_match:
        return array_match.group(0)
    
    # Then try JSON object (for exam structure)
    obj_match = re.search(r'\{\s*".*\}', response_text, re.DOTALL)
    if obj_match:
        return obj_match.group(0)
    
    return response_text.strip()


def validate_and_fix_json(json_str: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Validate JSON and attempt to fix common issues.
    Returns: (cleaned_json, error_message)
    """
    try:
        # Try parsing as-is
        json.loads(json_str)
        return json_str, None
    except json.JSONDecodeError as e:
        # Attempt fixes
        
        # 1. Re-extract JSON boundaries
        cleaned = clean_json_response(json_str)
        
        # 2. Remove comments
        cleaned = re.sub(r'//.*?$', '', cleaned, flags=re.MULTILINE)
        cleaned = re.sub(r'/\*.*?\*/', '', cleaned, flags=re.DOTALL)
        
        # 3. Fix common escape issues
        cleaned = cleaned.replace('\\"', '"')
        cleaned = re.sub(r'(?<!\\)"(?=\s*[^:,}\]])', '\\"', cleaned)
        
        # 4. Remove trailing commas
        cleaned = re.sub(r',(\s*[}\]])', r'\1', cleaned)
        
        # 5. Fix unescaped newlines in strings
        cleaned = re.sub(r'(?<!\\)\n(?=[^"]*"[^"]*:)', '\\n', cleaned)
        
        try:
            json.loads(cleaned)
            return cleaned, None
        except json.JSONDecodeError as e2:
            return None, f"JSON validation failed: {str(e2)}"


def call_bedrock_api(prompt: str, system_prompt: str = "") -> Optional[str]:
    """
    Call AWS Bedrock API with the given prompt.
    Returns the response text or None on failure.
    """
    try:
        request_body = {
            "messages": [
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            "max_tokens": 8000,
            "temperature": 0.3,
            "top_p": 0.9
        }
        
        if system_prompt:
            request_body["system"] = system_prompt
        
        response = bedrock_runtime.invoke_model(
            modelId=BEDROCK_MODEL_ID,
            contentType='application/json',
            accept='application/json',
            body=json.dumps(request_body)
        )
        
        response_body = json.loads(response['body'].read())
        
        if 'content' in response_body and len(response_body['content']) > 0:
            return response_body['content'][0].get('text', '')
        
        return None
        
    except Exception as e:
        print(f"❌ Bedrock API error: {str(e)}")
        return None


def reprocess_parsed_error(error_file_path: Path) -> bool:
    """
    Reprocess a file that failed during initial OCR parsing.
    The error file contains the raw OCR text that needs to be parsed.
    """
    print(f"📝 Reprocessing parsed error: {error_file_path.name}")
    
    try:
        # Read the error file (contains raw OCR text)
        with open(error_file_path, 'r', encoding='utf-8') as f:
            ocr_text = f.read()
        
        # Extract original filename (remove .error.txt)
        original_name = error_file_path.stem.replace('.txt.error', '')
        
        # Create prompt for Bedrock to parse the questions
        system_prompt = """You are an expert at extracting structured exam questions from raw text.
Parse the exam paper text and extract all questions with their metadata.
Return a valid JSON object with this structure:
{
  "exams": [{
    "subject": "Subject Name",
    "max_marks": "100",
    "year": "2017",
    "semester": "VI",
    "branch": "Computer/Electronics/IT/Mechanical",
    "questions": [
      {
        "question_number": "Q1(a)",
        "question_text": "Full question text here",
        "questionType": "text/mcq/Short/Long/Numerical",
        "marks": "10",
        "options": ["A) option1", "B) option2"] // if MCQ
      }
    ]
  }]
}
"""
        
        prompt = f"""Extract all questions from this exam paper text. Preserve all question numbers, text, and marks.

TEXT:
{ocr_text[:6000]}  

Return only valid JSON, no explanations."""
        
        # Call Bedrock
        response = call_bedrock_api(prompt, system_prompt)
        
        if not response:
            print(f"   ❌ No response from Bedrock")
            return False
        
        # Clean and validate JSON
        cleaned_json = clean_json_response(response)
        validated_json, error = validate_and_fix_json(cleaned_json)
        
        if error:
            print(f"   ❌ JSON validation error: {error}")
            # Save failed response for debugging
            failed_path = REPROCESSED_DIR / "failed" / f"{original_name}_parse_failed.txt"
            with open(failed_path, 'w', encoding='utf-8') as f:
                f.write(f"=== RAW RESPONSE ===\n{response}\n\n")
                f.write(f"=== CLEANED ===\n{cleaned_json}\n\n")
                f.write(f"=== ERROR ===\n{error}")
            return False
        
        # Save successfully parsed JSON
        output_path = REPROCESSED_DIR / "parsed" / f"{original_name}.json"
        with open(output_path, 'w', encoding='utf-8') as f:
            # Pretty print the JSON
            parsed_data = json.loads(validated_json)
            json.dump(parsed_data, f, indent=2, ensure_ascii=False)
        
        print(f"   ✅ Successfully reparsed to: {output_path.name}")
        return True
        
    except Exception as e:
        print(f"   ❌ Error reprocessing: {str(e)}")
        return False


def reprocess_enriched_error(error_file_path: Path) -> bool:
    """
    Reprocess a file that failed during Bloom's taxonomy enrichment.
    The error file contains the raw Bedrock response that failed JSON parsing.
    """
    print(f"🌸 Reprocessing enriched error: {error_file_path.name}")
    
    try:
        # Extract original JSON filename
        original_name = error_file_path.stem.replace('_bloom.error', '')
        original_json_path = PARSED_QUESTIONS_DIR / f"{original_name}.json"
        
        # Check if original parsed JSON exists
        if not original_json_path.exists():
            print(f"   ⚠️  Original parsed file not found: {original_json_path.name}")
            return False
        
        # Read original parsed questions
        with open(original_json_path, 'r', encoding='utf-8') as f:
            exam_data = json.load(f)
        
        # Extract questions for enrichment
        all_questions = []
        for exam in exam_data.get('exams', []):
            all_questions.extend(exam.get('questions', []))
        
        if not all_questions:
            print(f"   ⚠️  No questions found in original file")
            return False
        
        # Create prompt for Bloom's enrichment
        system_prompt = """You are an educational assessment expert specializing in Bloom's Taxonomy classification.
Analyze each question and assign Bloom's taxonomy level, justification, confidence, difficulty, keywords, and topics.
Return a valid JSON array with this structure:
[
  {
    "questionIndex": 0,
    "bloomLevel": "Recall/Understand/Apply/Analyze/Evaluate/Create",
    "bloomJustification": "Why this level was chosen",
    "confidence": 0.95,
    "difficulty": "Easy/Medium/Hard",
    "keywords": ["keyword1", "keyword2"],
    "topicsCovered": ["topic1", "topic2"]
  }
]
"""
        
        # Prepare questions text
        questions_text = ""
        for idx, q in enumerate(all_questions):
            marks = q.get('marks', 'N/A')
            q_type = q.get('questionType', 'text')
            questions_text += f"\n[Question {idx}] ({marks} marks, {q_type})\n{q.get('question_text', '')}\n"
            if q.get('options'):
                questions_text += "Options: " + ", ".join(q['options']) + "\n"
        
        prompt = f"""Classify each question using Bloom's Taxonomy.

QUESTIONS:
{questions_text[:6000]}

Return only valid JSON array, no explanations."""
        
        # Call Bedrock
        response = call_bedrock_api(prompt, system_prompt)
        
        if not response:
            print(f"   ❌ No response from Bedrock")
            return False
        
        # Clean and validate JSON
        cleaned_json = clean_json_response(response)
        validated_json, error = validate_and_fix_json(cleaned_json)
        
        if error:
            print(f"   ❌ JSON validation error: {error}")
            # Save failed response for debugging
            failed_path = REPROCESSED_DIR / "failed" / f"{original_name}_bloom_failed.txt"
            with open(failed_path, 'w', encoding='utf-8') as f:
                f.write(f"=== RAW RESPONSE ===\n{response}\n\n")
                f.write(f"=== CLEANED ===\n{cleaned_json}\n\n")
                f.write(f"=== ERROR ===\n{error}")
            return False
        
        # Parse Bloom's classifications
        bloom_classifications = json.loads(validated_json)
        
        # Merge Bloom's data back into questions
        for classification in bloom_classifications:
            idx = classification.get('questionIndex', -1)
            if 0 <= idx < len(all_questions):
                all_questions[idx]['bloomLevel'] = classification.get('bloomLevel')
                all_questions[idx]['bloomJustification'] = classification.get('bloomJustification')
                all_questions[idx]['confidence'] = classification.get('confidence')
                all_questions[idx]['difficulty'] = classification.get('difficulty')
                all_questions[idx]['keywords'] = classification.get('keywords', [])
                all_questions[idx]['topicsCovered'] = classification.get('topicsCovered', [])
        
        # Reconstruct exam data with enriched questions
        enriched_data = {
            "exams": exam_data.get('exams', []),
            "metadata": {
                "processingDate": datetime.now().isoformat(),
                "source": "bedrock_reprocessed",
                "model": BEDROCK_MODEL_ID,
                "bloomEnriched": True
            }
        }
        
        # Save enriched JSON
        output_path = REPROCESSED_DIR / "enriched" / f"{original_name}_enriched.json"
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(enriched_data, f, indent=2, ensure_ascii=False)
        
        print(f"   ✅ Successfully enriched: {output_path.name}")
        return True
        
    except Exception as e:
        print(f"   ❌ Error reprocessing: {str(e)}")
        return False


def main():
    """Main function to orchestrate reprocessing of error files."""
    
    print("=" * 80)
    print("🔄 REPROCESSING ERROR FILES THROUGH AWS BEDROCK")
    print("=" * 80)
    
    # Count error files
    parsed_errors = list(PARSED_ERRORS_DIR.glob("*.txt.error.txt"))
    enriched_errors = list(ENRICHED_ERRORS_DIR.glob("*_bloom.error.txt"))
    
    print(f"\n📊 Found {len(parsed_errors)} parsed errors")
    print(f"📊 Found {len(enriched_errors)} enriched errors")
    print(f"📊 Total: {len(parsed_errors) + len(enriched_errors)} error files\n")
    
    if not parsed_errors and not enriched_errors:
        print("✅ No error files to reprocess!")
        return
    
    # Ask user which to process
    print("Which errors would you like to reprocess?")
    print("1. Parsed errors only (failed OCR parsing)")
    print("2. Enriched errors only (failed Bloom's enrichment)")
    print("3. Both")
    choice = input("\nEnter choice (1/2/3): ").strip()
    
    # Statistics
    stats = {
        'parsed_success': 0,
        'parsed_failed': 0,
        'enriched_success': 0,
        'enriched_failed': 0
    }
    
    # Process parsed errors
    if choice in ['1', '3']:
        print(f"\n{'=' * 80}")
        print(f"📝 REPROCESSING {len(parsed_errors)} PARSED ERRORS")
        print(f"{'=' * 80}\n")
        
        for i, error_file in enumerate(parsed_errors, 1):
            print(f"[{i}/{len(parsed_errors)}] ", end='')
            success = reprocess_parsed_error(error_file)
            if success:
                stats['parsed_success'] += 1
            else:
                stats['parsed_failed'] += 1
            
            # Rate limiting
            time.sleep(1)
    
    # Process enriched errors
    if choice in ['2', '3']:
        print(f"\n{'=' * 80}")
        print(f"🌸 REPROCESSING {len(enriched_errors)} ENRICHED ERRORS")
        print(f"{'=' * 80}\n")
        
        for i, error_file in enumerate(enriched_errors, 1):
            print(f"[{i}/{len(enriched_errors)}] ", end='')
            success = reprocess_enriched_error(error_file)
            if success:
                stats['enriched_success'] += 1
            else:
                stats['enriched_failed'] += 1
            
            # Rate limiting
            time.sleep(1)
    
    # Print summary
    print(f"\n{'=' * 80}")
    print("📊 REPROCESSING SUMMARY")
    print(f"{'=' * 80}\n")
    
    if choice in ['1', '3']:
        print(f"📝 Parsed Errors:")
        print(f"   ✅ Success: {stats['parsed_success']}")
        print(f"   ❌ Failed: {stats['parsed_failed']}")
        print(f"   📁 Saved to: {REPROCESSED_DIR / 'parsed'}\n")
    
    if choice in ['2', '3']:
        print(f"🌸 Enriched Errors:")
        print(f"   ✅ Success: {stats['enriched_success']}")
        print(f"   ❌ Failed: {stats['enriched_failed']}")
        print(f"   📁 Saved to: {REPROCESSED_DIR / 'enriched'}\n")
    
    total_success = stats['parsed_success'] + stats['enriched_success']
    total_failed = stats['parsed_failed'] + stats['enriched_failed']
    
    print(f"🎯 Total Success: {total_success}")
    print(f"❌ Total Failed: {total_failed}")
    
    if total_failed > 0:
        print(f"   Failed responses saved to: {REPROCESSED_DIR / 'failed'}")
    
    print(f"\n{'=' * 80}")
    print("✅ REPROCESSING COMPLETE!")
    print(f"{'=' * 80}\n")


if __name__ == "__main__":
    main()
