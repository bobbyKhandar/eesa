"""
Reprocess Error Files Through AWS Bedrock Pipeline

This script processes files that failed during the initial parsing or enrichment phases:
1. parsedQuestions/errors/*.txt.error.txt - Failed during initial OCR parsing
2. enrichedQuestions/errors/*.json_bloom.error.txt - Failed during Bloom's taxonomy enrichment

Accepted enrichment error formats:
- `{subject}_{timestamp}.json_bloom.error.txt` (documented) recovers the
  parsed source `{subject}_{timestamp}.json`, keeping the original filename.
- `{subject}_bloom.error.txt` (legacy extensionless) recovers `{subject}.json`.
Any other enrichment error filename is reported instead of guessed.

It resends these files through the appropriate AWS Bedrock pipeline to attempt recovery.
"""

import os
import json
import sys
import boto3
import time
import re
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Tuple, Optional
import concurrent.futures
from botocore.config import Config

# Add src to path for the shared chunking and merge helpers
sys.path.insert(0, str(Path(__file__).parent))

from intelligent_chunking import chunk_ocr_text
from chunk_merger import merge_chunk_exams

# AWS Bedrock Configuration
BEDROCK_MODEL_ID = "google.gemma-3-27b-it"
REGION = "us-east-1"

# Recovery input bounds. A document or question set larger than these is
# processed in bounded chunks/batches that merge only after full coverage,
# so no source content past the first chunk is silently dropped.
RECOVERY_CHUNK_MAX_CHARS = 6000
RECOVERY_ENRICH_BATCH_SIZE = 10
RECOVERY_ENRICH_MAX_CHARS = 6000

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
    Strip markdown fences and return the complete JSON root.

    The root is the first JSON value in the response. An exams object stays
    intact instead of collapsing to its nested array, and an enrichment
    response stays a JSON array.
    """
    response_text = re.sub(r'```json\s*', '', response_text)
    response_text = re.sub(r'```\s*', '', response_text)
    text = response_text.strip()
    start = _json_root_start(text)
    if start is None:
        return text

    try:
        _value, end = json.JSONDecoder().raw_decode(text, start)
        return text[start:end].strip()
    except json.JSONDecodeError:
        # Keep the root span so validate_and_fix_json can repair it.
        closer = '}' if text[start] == '{' else ']'
        end = text.rfind(closer)
        if end > start:
            return text[start:end + 1]
        return text[start:].strip()


def _json_root_start(text: str) -> Optional[int]:
    """Index of the first object or array, whichever begins the JSON root."""
    object_at = text.find('{')
    array_at = text.find('[')
    if object_at == -1 and array_at == -1:
        return None
    if object_at == -1:
        return array_at
    if array_at == -1:
        return object_at
    return min(object_at, array_at)


def stage_schema_error(payload, stage: str) -> Optional[str]:
    """Return why this root is unusable for the recovery stage, or None."""
    if stage == "parsing":
        if isinstance(payload, dict) and isinstance(payload.get("exams"), list):
            return None
        return "invalid parsing schema: expected an object with an exams list"
    if stage == "enrichment":
        if isinstance(payload, list):
            return None
        return "invalid enrichment schema: expected a JSON array"
    return f"unknown recovery stage: {stage}"


def extract_stage_payload(response_text: str, stage: str) -> Tuple[Optional[object], Optional[str]]:
    """
    Parse the JSON root and validate it for one recovery stage.

    Parsing requires an object with an exams list. Enrichment requires a
    JSON array. Invalid schema is an error so the caller does not save it.
    """
    cleaned = clean_json_response(response_text)
    validated, error = validate_and_fix_json(cleaned)
    if error or validated is None:
        return None, error or "JSON validation failed"
    try:
        payload = json.loads(validated)
    except json.JSONDecodeError as exc:
        return None, f"JSON validation failed: {exc}"
    schema_error = stage_schema_error(payload, stage)
    if schema_error:
        return None, schema_error
    return payload, None


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


# A recovery batch is successful only when every question in it has a
# usable classification. Fewer entries, extra entries, and invalid fields
# leave questions unclassified and are reported instead of saved.
VALID_BLOOM_LEVELS = frozenset({
    "Recall", "Understand", "Apply", "Analyze", "Evaluate", "Create",
})
VALID_DIFFICULTIES = frozenset({"Easy", "Medium", "Hard"})


def _classification_problem(entry) -> str:
    """Return why an enrichment entry is unusable, or an empty string."""
    if not isinstance(entry, dict):
        return "entry must be an object"
    if entry.get("bloomLevel") not in VALID_BLOOM_LEVELS:
        return (
            "bloomLevel must be one of Recall, Understand, Apply, Analyze, "
            "Evaluate, Create"
        )
    if entry.get("difficulty") not in VALID_DIFFICULTIES:
        return "difficulty must be Easy, Medium, or Hard"
    for field in ("keywords", "topicsCovered"):
        values = entry.get(field)
        if not isinstance(values, list) or not all(
            isinstance(item, str) and item.strip() for item in values
        ):
            return f"{field} must be a list of non-empty strings"
    return ""


def _require_complete_batch(expected: int, entries, expected_indexes: set) -> None:
    """Reject a model payload that does not classify the whole batch."""
    if not isinstance(entries, list):
        raise ValueError(
            f"expected {expected} enrichment entries, got 0: "
            "response was not a JSON array"
        )
    if len(entries) != expected:
        raise ValueError(
            f"expected {expected} enrichment entries, got {len(entries)}"
        )
    returned = set()
    for index, entry in enumerate(entries):
        problem = _classification_problem(entry)
        if problem:
            raise ValueError(
                f"expected {expected} enrichment entries, got {len(entries)}: "
                f"invalid entry at index {index} ({problem})"
            )
        question_index = entry.get("questionIndex")
        if question_index not in expected_indexes:
            raise ValueError(
                f"expected {expected} enrichment entries, got {len(entries)}: "
                f"entry at index {index} has questionIndex {question_index!r} "
                "outside this batch"
            )
        returned.add(question_index)
    missing = sorted(expected_indexes - returned)
    if missing:
        raise ValueError(
            f"expected {expected} enrichment entries, got {len(entries)}: "
            f"missing classifications for questions {missing}"
        )


# Enrichment errors carry the parsed source name inside the error filename.
# The documented format keeps the source extension:
# `{subject}_{timestamp}.json_bloom.error.txt` -> `{subject}_{timestamp}.json`.
# The older extensionless format is still accepted:
# `{subject}_bloom.error.txt` -> `{subject}.json`.
ENRICHMENT_ERROR_SUFFIX = "_bloom.error.txt"


def _parsed_source_name(error_file_name: str) -> Optional[str]:
    """Parsed source filename encoded in an enrichment error filename.

    The exact error suffix is removed and the original filename is
    preserved, so `paper.json_bloom.error.txt` maps to `paper.json`
    instead of `paper.json.json`. A legacy extensionless name such as
    `paper_bloom.error.txt` still gains the `.json` extension. Returns
    None for a name that is not a supported enrichment error.
    """
    if not error_file_name.endswith(ENRICHMENT_ERROR_SUFFIX):
        return None
    source = error_file_name[: -len(ENRICHMENT_ERROR_SUFFIX)]
    if not source:
        return None
    if not source.endswith(".json"):
        source = f"{source}.json"
    return source


def _question_block(question: Dict, index: int) -> str:
    """Render one question for the enrichment prompt, keeping its index."""
    marks = question.get('marks', 'N/A')
    q_type = question.get('questionType', 'text')
    block = f"\n[Question {index}] ({marks} marks, {q_type})\n{question.get('question_text', '')}\n"
    if question.get('options'):
        block += "Options: " + ", ".join(question['options']) + "\n"
    return block


def _enrichment_batches(questions: List[Dict], max_batch: int, max_chars: int) -> List[List[int]]:
    """Group question indexes into bounded batches.

    A batch stops at the question count or the character budget so every
    prompt stays within the model input limit. A single question longer
    than the budget still gets its own batch instead of being dropped.
    """
    batches = []
    current: List[int] = []
    current_chars = 0
    for index, question in enumerate(questions):
        block = _question_block(question, index)
        if current and (len(current) >= max_batch or current_chars + len(block) > max_chars):
            batches.append(current)
            current = []
            current_chars = 0
        current.append(index)
        current_chars += len(block)
    if current:
        batches.append(current)
    return batches


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

    The full text is parsed in bounded chunks. The chunks are merged and
    saved only when every chunk parsed, so a tail the model could not
    handle is reported as unprocessed instead of saved as a complete
    recovery.
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
        
        chunks = chunk_ocr_text(ocr_text, max_chars_per_chunk=RECOVERY_CHUNK_MAX_CHARS)
        parsed_chunks = []
        failed_chunks = []
        
        for chunk in chunks:
            prompt = f"""Extract all questions from this exam paper text. Preserve all question numbers, text, and marks.

TEXT:
{chunk['text']}

Return only valid JSON, no explanations."""
            
            # Call Bedrock
            response = call_bedrock_api(prompt, system_prompt)
            
            if not response:
                print(f"   ❌ No response from Bedrock")
                failed_chunks.append((chunk, "no response from Bedrock"))
                continue
            
            # Parse the full JSON root and require the exams envelope.
            parsed_data, error = extract_stage_payload(response, "parsing")
            
            if error:
                print(f"   ❌ JSON validation error: {error}")
                # Save failed response for debugging
                failed_path = REPROCESSED_DIR / "failed" / f"{original_name}_parse_failed.txt"
                cleaned_json = clean_json_response(response)
                with open(failed_path, 'w', encoding='utf-8') as f:
                    f.write(f"=== RAW RESPONSE ===\n{response}\n\n")
                    f.write(f"=== CLEANED ===\n{cleaned_json}\n\n")
                    f.write(f"=== ERROR ===\n{error}")
                failed_chunks.append((chunk, error))
                continue
            
            # Keep the continuation marker so exams merge across chunks.
            parsed_data['is_continuation'] = chunk.get('is_continuation', False) is True
            parsed_chunks.append(parsed_data)
        
        if failed_chunks:
            unprocessed = sum(
                chunk.get('char_count', len(chunk.get('text', '')))
                for chunk, _ in failed_chunks
            )
            print(
                f"   ❌ Incomplete recovery: {len(failed_chunks)} of {len(chunks)} "
                f"chunks unprocessed ({unprocessed} characters)"
            )
            for chunk, error in failed_chunks:
                print(f"      chunk {chunk.get('chunk_id')}: {error}")
            return False
        
        # Merge the whole document only after every chunk parsed
        merged = merge_chunk_exams(parsed_chunks)
        
        # Save the recovered parsing envelope
        output_path = REPROCESSED_DIR / "parsed" / f"{original_name}.json"
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(merged, f, indent=2, ensure_ascii=False)
        
        print(f"   ✅ Successfully reparsed to: {output_path.name}")
        return True
        
    except Exception as e:
        print(f"   ❌ Error reprocessing: {str(e)}")
        return False


def reprocess_enriched_error(error_file_path: Path) -> bool:
    """
    Reprocess a file that failed during Bloom's taxonomy enrichment.
    The error file contains the raw Bedrock response that failed JSON parsing.

    Every question is classified in bounded batches. The enriched file is
    saved only when each batch classifies all of its questions with valid
    fields, so questions past the first batch are reported as unclassified
    instead of being silently skipped.
    """
    print(f"🌸 Reprocessing enriched error: {error_file_path.name}")
    
    try:
        # Extract original JSON filename. The documented error name keeps
        # the source extension, so only legacy extensionless names get .json.
        source_name = _parsed_source_name(error_file_path.name)
        if source_name is None:
            print(
                f"   ⚠️  Unsupported enriched error filename: {error_file_path.name} "
                f"(expected *{ENRICHMENT_ERROR_SUFFIX})"
            )
            return False
        original_json_path = PARSED_QUESTIONS_DIR / source_name
        original_name = Path(source_name).stem
        
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
        
        classifications: List[Optional[Dict]] = [None] * len(all_questions)
        failed_batches = []
        
        for batch in _enrichment_batches(
            all_questions, RECOVERY_ENRICH_BATCH_SIZE, RECOVERY_ENRICH_MAX_CHARS
        ):
            expected_indexes = set(batch)
            questions_text = "".join(
                _question_block(all_questions[index], index) for index in batch
            )
            
            prompt = f"""Classify each question using Bloom's Taxonomy.

QUESTIONS:
{questions_text}

Return only valid JSON array, no explanations."""
            
            # Call Bedrock
            response = call_bedrock_api(prompt, system_prompt)
            
            if not response:
                print(f"   ❌ No response from Bedrock")
                failed_batches.append((batch, "no response from Bedrock"))
                continue
            
            # Parse the full JSON root and require an enrichment array that
            # covers every question in the batch with valid fields.
            bloom_classifications, error = extract_stage_payload(response, "enrichment")
            
            if not error:
                try:
                    _require_complete_batch(
                        len(batch), bloom_classifications, expected_indexes
                    )
                except ValueError as exc:
                    bloom_classifications, error = None, str(exc)
            
            if error:
                print(f"   ❌ JSON validation error: {error}")
                # Save failed response for debugging
                failed_path = REPROCESSED_DIR / "failed" / f"{original_name}_bloom_failed.txt"
                cleaned_json = clean_json_response(response)
                with open(failed_path, 'w', encoding='utf-8') as f:
                    f.write(f"=== RAW RESPONSE ===\n{response}\n\n")
                    f.write(f"=== CLEANED ===\n{cleaned_json}\n\n")
                    f.write(f"=== ERROR ===\n{error}")
                failed_batches.append((batch, error))
                continue
            
            for classification in bloom_classifications:
                classifications[classification['questionIndex']] = classification
        
        if failed_batches:
            unclassified = sum(len(batch) for batch, _ in failed_batches)
            message = (
                f"Incomplete enrichment: {unclassified} of {len(all_questions)} "
                f"questions unclassified"
            )
            print(f"   ❌ {message}")
            for batch, error in failed_batches:
                print(f"      questions {batch[0]}-{batch[-1]}: {error}")
            return False
        
        # Merge Bloom's data back into questions
        for index, classification in enumerate(classifications):
            question = all_questions[index]
            question['bloomLevel'] = classification.get('bloomLevel')
            question['bloomJustification'] = classification.get('bloomJustification')
            question['confidence'] = classification.get('confidence')
            question['difficulty'] = classification.get('difficulty')
            question['keywords'] = classification.get('keywords', [])
            question['topicsCovered'] = classification.get('topicsCovered', [])
        
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
