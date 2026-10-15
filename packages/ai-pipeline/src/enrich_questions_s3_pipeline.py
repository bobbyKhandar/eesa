import boto3
import hashlib
import os
import json
import re
import sys
import time
from datetime import datetime
from typing import Dict, List, Optional
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

##config----------

# AWS Clients
from botocore.config import Config

try:
    from aws_region import get_aws_region
except ImportError:  # pragma: no cover - package-relative fallback
    from .aws_region import get_aws_region  # type: ignore[no-redef]

# AWS region: AWS_REGION > AWS_DEFAULT_REGION > aws_location > default.
AWS_REGION = get_aws_region()

boto_config = Config(
    read_timeout=300,  # 5 minutes for large batches
    connect_timeout=60,
    retries={'max_attempts': 3, 'mode': 'adaptive'}
)
bedrock_client = boto3.client('bedrock-runtime', region_name=AWS_REGION, config=boto_config)
s3_client = boto3.client('s3', region_name=AWS_REGION, config=boto_config)

# S3 Configuration
S3_BUCKET = os.getenv('S3_BUCKET', 'eesa-pipeline-storage')
S3_ENRICHED_PREFIX = 'enriched_questions/'  # S3 prefix for enriched outputs
S3_STATE_FILE = 'enrichment_state.json'  # State file in S3

# AWS Bedrock Configuration
BEDROCK_MODEL_ID = "google.gemma-3-27b-it"


# Processing Configuration
MAX_RETRIES = 3
MAX_CONCURRENT_CALLS = 20  # Maximum parallel API calls
COST_PER_REQUEST = 0.001  # Estimated cost per Bedrock request

# Thread-safe state lock
state_lock = threading.Lock()

# State file local path
LOCAL_STATE_FILE = os.path.join(os.path.dirname(__file__), '../processing_state.json')

# Source identity: "{relative_path}__ns{12 hex chars of the input directory}".
# The hash is of the normalized input directory, so two directories that both
# contain questions.json do not share a processed entry or an S3 object key.
NAMESPACE_HASH_LENGTH = 12
_NAMESPACED_IDENTITY_RE = re.compile(rf"^.+__ns[0-9a-f]{{{NAMESPACE_HASH_LENGTH}}}$")


def normalize_input_namespace(input_dir: str) -> str:
    """Absolute input directory used as the enrichment namespace.

    Symlinks are resolved, ``.`` and ``..`` are collapsed, and a trailing
    separator is removed. Windows paths are case-folded.
    """
    if not isinstance(input_dir, str) or not input_dir.strip():
        raise ValueError("input directory is required")
    return os.path.normcase(os.path.normpath(os.path.realpath(input_dir)))


def namespace_hash(input_dir: str) -> str:
    """Short stable hash of the normalized input directory."""
    namespace = normalize_input_namespace(input_dir)
    digest = hashlib.sha256(namespace.encode("utf-8")).hexdigest()
    return digest[:NAMESPACE_HASH_LENGTH]


def relative_source_path(input_dir: str, file_path: str) -> str:
    """POSIX path of a file relative to its input directory."""
    root = normalize_input_namespace(input_dir)
    full = os.path.normcase(os.path.normpath(os.path.realpath(file_path)))
    relative = Path(os.path.relpath(full, root)).as_posix()
    if relative == ".." or relative.startswith("../"):
        raise ValueError(f"File {file_path} is outside input directory {input_dir}")
    return relative


def source_identity(input_dir: str, file_path: str) -> str:
    """Stable id for one input file.

    ``questions.json`` under two different input directories produces two ids.
    The relative path keeps the file readable; the hash keeps the directory.
    """
    relative = relative_source_path(input_dir, file_path)
    return f"{relative}__ns{namespace_hash(input_dir)}"


def enriched_output_key(source_id: str) -> str:
    """S3 key for an enriched file. The source id is part of the key."""
    return f"{S3_ENRICHED_PREFIX}{source_id}_enriched.json"


def _is_namespaced_identity(entry: object) -> bool:
    return isinstance(entry, str) and _NAMESPACED_IDENTITY_RE.fullmatch(entry) is not None


def _is_legacy_basename(entry: object) -> bool:
    """True for pre-namespace state values that stored only the file name."""
    if not isinstance(entry, str) or not entry.strip():
        return False
    if entry in (".", ".."):
        return False
    if "/" in entry or "\\" in entry:
        return False
    return not _is_namespaced_identity(entry)


def _append_unique(items: List[str], entry: str) -> None:
    if entry not in items:
        items.append(entry)


def _unique_paths_by_basename(file_paths: List[str]) -> Dict[str, List[str]]:
    grouped: Dict[str, List[str]] = {}
    seen = set()
    for file_path in file_paths:
        normalized = os.path.normcase(os.path.normpath(os.path.realpath(file_path)))
        if normalized in seen:
            continue
        seen.add(normalized)
        grouped.setdefault(os.path.basename(file_path), []).append(file_path)
    return grouped


def migrate_legacy_enrichment_state(
    state: Dict,
    input_dir: str,
    file_paths: List[str],
) -> Dict:
    """Rewrite basename-only state entries without skipping the wrong file.

    Namespaced identities stay in ``processed``, ``failed``, and
    ``retry_counts`` and still skip only that exact input.

    A bare basename is rewritten to a source identity only when
    ``source_namespace`` normalizes to this input directory and exactly one
    file in ``file_paths`` has that basename. The namespace is never inferred
    from the directory being run. A later run can still adopt entries that an
    earlier run parked, once ``source_namespace`` is set.

    Every other basename stays out of the active lists, in
    ``legacy_unscoped_processed``, ``legacy_unscoped_failed``, and
    ``legacy_unscoped_retry_counts``. Those entries do not skip a new file
    that happens to share the name, including the same name in another
    directory. If two files in the pinned directory share the basename,
    neither one is skipped.
    """
    if state is None:
        state = {}

    recorded = state.get("source_namespace")
    adopt = False
    if isinstance(recorded, str) and recorded.strip():
        adopt = normalize_input_namespace(recorded) == normalize_input_namespace(input_dir)

    by_basename = _unique_paths_by_basename(file_paths)

    def adopted_identity(entry: str) -> Optional[str]:
        if not adopt or not _is_legacy_basename(entry):
            return None
        matches = by_basename.get(entry, [])
        if len(matches) != 1:
            return None
        return source_identity(input_dir, matches[0])

    buckets = {
        "processed": [],
        "failed": [],
        "retry_counts": {},
        "legacy_unscoped_processed": [],
        "legacy_unscoped_failed": [],
        "legacy_unscoped_retry_counts": {},
    }

    def consume(entry: object, status: str) -> None:
        active_key = status
        parked_key = f"legacy_unscoped_{status}"
        if _is_namespaced_identity(entry):
            _append_unique(buckets[active_key], entry)
            return
        if isinstance(entry, str):
            rewritten = adopted_identity(entry)
            if rewritten:
                _append_unique(buckets[active_key], rewritten)
                return
            _append_unique(buckets[parked_key], entry)

    for entry in list(state.get("processed") or []):
        consume(entry, "processed")
    for entry in list(state.get("legacy_unscoped_processed") or []):
        consume(entry, "processed")
    for entry in list(state.get("failed") or []):
        consume(entry, "failed")
    for entry in list(state.get("legacy_unscoped_failed") or []):
        consume(entry, "failed")

    combined_retry: Dict[str, object] = {}
    for key, count in list((state.get("legacy_unscoped_retry_counts") or {}).items()):
        combined_retry[key] = count
    for key, count in list((state.get("retry_counts") or {}).items()):
        combined_retry[key] = count

    for key, count in combined_retry.items():
        if _is_namespaced_identity(key):
            buckets["retry_counts"][key] = count
            continue
        if isinstance(key, str):
            rewritten = adopted_identity(key)
            if rewritten:
                buckets["retry_counts"][rewritten] = count
                continue
            buckets["legacy_unscoped_retry_counts"][key] = count

    state["processed"] = buckets["processed"]
    state["failed"] = buckets["failed"]
    state["retry_counts"] = buckets["retry_counts"]
    state["legacy_unscoped_processed"] = buckets["legacy_unscoped_processed"]
    state["legacy_unscoped_failed"] = buckets["legacy_unscoped_failed"]
    state["legacy_unscoped_retry_counts"] = buckets["legacy_unscoped_retry_counts"]
    return state


def _ensure_s3_bucket_exists() -> bool:
    """
    Check if S3 bucket exists, create it if it doesn't.
    Returns True if bucket is ready, False on error.
    """
    try:
        # Check if bucket exists
        s3_client.head_bucket(Bucket=S3_BUCKET)
        print(f"✓ S3 bucket '{S3_BUCKET}' exists")
        return True
    except Exception as e:
        # Handle 404 (bucket doesn't exist) or 403 (no permission)
        error_code = e.response.get('Error', {}).get('Code', '') if hasattr(e, 'response') else ''
        
        if error_code == '404' or 'Not Found' in str(e) or 'NoSuchBucket' in str(e):
            print(f"ℹ S3 bucket '{S3_BUCKET}' not found, creating...")
            try:
                # Create bucket
                region = s3_client.meta.region_name or AWS_REGION
                if region == 'us-east-1':
                    # us-east-1 doesn't need LocationConstraint
                    s3_client.create_bucket(Bucket=S3_BUCKET)
                else:
                    s3_client.create_bucket(
                        Bucket=S3_BUCKET,
                        CreateBucketConfiguration={'LocationConstraint': region}
                    )
                print(f"✓ Created S3 bucket '{S3_BUCKET}' in region {region}")
                return True
            except Exception as create_error:
                print(f"✗ Failed to create bucket: {create_error}")
                return False
        else:
            print(f"✗ Error checking S3 bucket: {e}")
            return False


def _load_state() -> Dict:
    """
    Load processing state from S3 or local file.
    State tracks: processed files, failed files, retry counts
    """
    try:
        # Try loading from S3 first
        response = s3_client.get_object(
            Bucket=S3_BUCKET,
            Key=S3_STATE_FILE
        )
        state = json.loads(response['Body'].read().decode('utf-8'))
        print(f"✓ Loaded state from S3: {len(state.get('processed', []))} processed, {len(state.get('failed', []))} failed")
        return state
    except Exception as e:
        # Handle both NoSuchKey and other S3 errors (including mock errors)
        error_msg = str(e)
        if 'NoSuchKey' in error_msg or 'Not found' in error_msg:
            print("ℹ No state file found in S3, checking local...")
        else:
            print(f"⚠ Error loading state from S3: {e}")
    
    # Try loading from local file
    if os.path.exists(LOCAL_STATE_FILE):
        try:
            with open(LOCAL_STATE_FILE, 'r', encoding='utf-8') as f:
                state = json.load(f)
                print(f"✓ Loaded state from local file: {len(state.get('processed', []))} processed")
                return state
        except Exception as e:
            print(f"⚠ Error loading local state: {e}")
    
    # Return fresh state
    print("ℹ Starting with fresh state")
    return {
        'processed': [],
        'failed': [],
        'retry_counts': {},
        'last_updated': None
    }


def _save_state(state: Dict) -> bool:
    """
    Save processing state to both S3 and local file for redundancy.
    Thread-safe with locking.
    """
    with state_lock:
        state['last_updated'] = datetime.now().isoformat()
        
        # Save to local file first (fast, guaranteed)
        try:
            os.makedirs(os.path.dirname(LOCAL_STATE_FILE), exist_ok=True)
            with open(LOCAL_STATE_FILE, 'w', encoding='utf-8') as f:
                json.dump(state, f, indent=2)
            print(f"✓ State saved locally")
        except Exception as e:
            print(f"✗ Failed to save state locally: {e}")
            return False
        
        # Save to S3 (durable, accessible from anywhere)
        try:
            s3_client.put_object(
                Bucket=S3_BUCKET,
                Key=S3_STATE_FILE,
                Body=json.dumps(state, indent=2),
                ContentType='application/json'
            )
            print(f"✓ State saved to S3")
            return True
        except Exception as e:
            print(f"✗ Failed to save state to S3: {e}")
            return False


def _get_bloom_enrichment(questions: List[Dict], subject: str, semester: str, branch: str) -> Optional[List[Dict]]:
    """
    Call AWS Bedrock to enrich questions with Bloom's taxonomy analysis.
    Internal function: Not meant to be called directly.
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


def _enrich_single_file(file_path: str, filename: str, use_instructions: bool = True) -> Optional[Dict]:
    """
    Enrich a single parsed question file with Bloom's taxonomy.
    Internal function.
    """
    try:
        print(f"\n📚 Enriching: {filename}")
        
        # Read parsed JSON
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        if 'exams' not in data or not data['exams']:
            print(f"   ⚠ No exams found in file")
            return None
        
        enriched_exams = []
        
        for exam_idx, exam in enumerate(data['exams']):
            print(f"\n   📖 Processing Exam {exam_idx + 1}: {exam.get('subject', 'Unknown')}")
            
            questions = exam.get('questions', [])
            if not questions:
                print(f"      ⚠ No questions found")
                enriched_exams.append(exam)
                continue
            
            print(f"      📝 Analyzing {len(questions)} questions...")
            
            # Get Bloom's enrichment from Bedrock (using internal function)
            bloom_data = _get_bloom_enrichment(
                questions,
                exam.get('subject', 'Unknown'),
                exam.get('semester', 'N/A'),
                exam.get('branch', 'N/A')
            )
            
            if bloom_data is None:
                print(f"      ✗ Failed to get Bloom's classification")
                # Return None to indicate failure for this file
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
            print(f"      ✓ Enrichment complete!")
            print(f"      🎯 Bloom's Distribution:")
            for level, count in bloom_counts.items():
                if count > 0:
                    percentage = (count / total_q) * 100
                    print(f"         {level}: {count} ({percentage:.1f}%)")
        
        # Return enriched data
        return {
            'exams': enriched_exams,
            'subjectsCreated': data.get('subjectsCreated', [])
        }
        
    except Exception as e:
        print(f"   ✗ Error enriching file: {e}")
        import traceback
        traceback.print_exc()
        return None


def _upload_enriched_to_s3(enriched_data: Dict, source_id: str) -> bool:
    """
    Upload enriched JSON to S3 under the source identity.

    The object key includes the input-relative path and namespace hash, so
    two inputs that share a basename do not overwrite each other.
    """
    try:
        # Add metadata
        enriched_data['processed_at'] = datetime.now().isoformat()
        enriched_data['enrichment_version'] = '1.0'
        enriched_data['source_identity'] = source_id
        
        # Construct S3 key
        s3_key = enriched_output_key(source_id)
        
        # Upload to S3
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=s3_key,
            Body=json.dumps(enriched_data, indent=2, ensure_ascii=False),
            ContentType='application/json'
        )
        
        print(f"   📤 Uploaded to: s3://{S3_BUCKET}/{s3_key}")
        return True
        
    except Exception as e:
        print(f"   ✗ S3 upload failed: {e}")
        return False


def ensure_s3_bucket_exists() -> bool:
    """Supported helper: check the enrichment bucket and create it when missing."""
    return _ensure_s3_bucket_exists()


def load_state() -> Dict:
    """Supported helper: load enrichment state from S3, then the local file."""
    return _load_state()


def save_state(state: Dict) -> bool:
    """Supported helper: persist enrichment state locally and to S3."""
    return _save_state(state)


def enrich_single_file(
    file_path: str,
    filename: str,
    use_instructions: bool = True,
) -> Optional[Dict]:
    """Supported helper: enrich one parsed question file."""
    return _enrich_single_file(file_path, filename, use_instructions=use_instructions)


def upload_enriched_to_s3(enriched_data: Dict, source_id: str) -> bool:
    """Supported helper: upload enriched JSON under a source identity.

    ``source_id`` comes from :func:`source_identity`. A bare filename is not
    an identity and would write a different object key.
    """
    return _upload_enriched_to_s3(enriched_data, source_id)


def process_all_questions(input_dir: str, skip_processed: bool = True) -> Dict:
    """
    Main function to process all parsed questions and enrich them.
    This remains public as the entry point for the module.

    Returns a summary of the run:

    - ``input_dir``: the directory that was processed
    - ``total_files``: JSON files found in it
    - ``processed``: files enriched and uploaded in this run
    - ``newly_processed``: files enriched in this run that were not in
      ``state['processed']`` before it started
    - ``failed``: files that failed enrichment or upload in this run
    - ``skipped``: files already processed, or at the retry limit
    - ``total_cost``: estimated Bedrock cost for this run
    - ``incomplete_reasons``: why the run could not finish its work
    - ``success``: no file failed and no reason was recorded
    """
    print("=" * 80)
    print("QUESTION ENRICHMENT PIPELINE - AWS BEDROCK + S3")
    print("=" * 80)
    print(f"Input directory: {input_dir}")
    print(f"S3 Bucket: {S3_BUCKET}")
    print(f"S3 Prefix: {S3_ENRICHED_PREFIX}")
    print(f"Max concurrent API calls: {MAX_CONCURRENT_CALLS}")
    print(f"Max retries per file: {MAX_RETRIES}")
    print(f"Bedrock Model: {BEDROCK_MODEL_ID}")
    print("=" * 80)
    
    # Load processing state
    state = _load_state()
    
    # Get all JSON files
    all_files = list(Path(input_dir).glob('*.json'))

    # Basename-only entries from older runs are not treated as this directory
    # unless source_namespace pins them here. See migrate_legacy_enrichment_state.
    state = migrate_legacy_enrichment_state(
        state,
        input_dir,
        [str(path) for path in all_files],
    )
    
    # Separate into non-error and error files
    non_error_files = [f for f in all_files if 'error' not in f.name.lower()]
    error_files = [f for f in all_files if 'error' in f.name.lower()]
    
    print(f"\n📊 Found {len(all_files)} total files:")
    print(f"   • Non-error files: {len(non_error_files)}")
    print(f"   • Error files: {len(error_files)}")
    print(f"   • Already processed: {len(state['processed'])}")
    print(f"   • Previously failed: {len(state['failed'])}")
    
    # Statistics
    stats = {
        'total_processed': 0,
        'newly_processed': 0,
        'failed': 0,
        'skipped': 0,
        'total_cost': 0.0
    }
    stats_lock = threading.Lock()
    
    def process_file_wrapper(file_path, filename, use_instructions=True, is_retry=False, retry_num=0):
        """Wrapper function for concurrent processing with state updates"""
        source_id = source_identity(input_dir, str(file_path))
        # Skip only an exact source identity. A bare basename left over from
        # an older state file must not skip a different directory's file.
        if skip_processed and source_id in state['processed']:
            with stats_lock:
                stats['skipped'] += 1
            return {
                'filename': filename,
                'source_id': source_id,
                'status': 'skipped',
                'message': 'Already processed'
            }
        
        # For retry files, check retry count
        if is_retry:
            retry_count = state['retry_counts'].get(source_id, 0)
            if retry_count >= MAX_RETRIES:
                with stats_lock:
                    stats['skipped'] += 1
                return {
                    'filename': filename,
                    'source_id': source_id,
                    'status': 'skipped',
                    'message': f'Max retries reached ({MAX_RETRIES})'
                }
        
        # Process file using INTERNAL function
        enriched_data = _enrich_single_file(str(file_path), filename, use_instructions)
        
        if enriched_data:
            # Upload to S3 using INTERNAL function
            if _upload_enriched_to_s3(enriched_data, source_id):
                # Update state safely
                with state_lock:
                    if source_id not in state['processed']:
                        state['processed'].append(source_id)
                    if source_id in state['failed']:
                        state['failed'].remove(source_id)
                    if source_id in state['retry_counts']:
                        del state['retry_counts'][source_id]
                
                with stats_lock:
                    stats['newly_processed'] += 1
                    stats['total_processed'] += 1
                    stats['total_cost'] += COST_PER_REQUEST
                
                # Save state periodically (every 10 successful files)
                if stats['total_processed'] % 10 == 0:
                    _save_state(state)
                
                return {
                    'filename': filename,
                    'status': 'success',
                    'message': f'Success after {retry_num + 1} attempt(s)' if is_retry else 'Success'
                }
            else:
                # Upload failed
                with state_lock:
                    if is_retry:
                        state['retry_counts'][source_id] = state['retry_counts'].get(source_id, 0) + 1
                    if source_id not in state['failed']:
                        state['failed'].append(source_id)
                
                with stats_lock:
                    stats['failed'] += 1
                
                return {
                    'filename': filename,
                    'source_id': source_id,
                    'status': 'failed',
                    'message': 'S3 upload failed'
                }
        else:
            # Enrichment failed
            with state_lock:
                if is_retry:
                    state['retry_counts'][source_id] = state['retry_counts'].get(source_id, 0) + 1
                if source_id not in state['failed']:
                    state['failed'].append(source_id)
            
            with stats_lock:
                stats['failed'] += 1
            
            return {
                'filename': filename,
                'source_id': source_id,
                'status': 'failed',
                'message': 'Enrichment failed'
            }
    
    # Process non-error files with concurrent execution
    print("\n" + "=" * 80)
    print(f"PHASE 1: Processing Non-Error Files ({MAX_CONCURRENT_CALLS} concurrent)")
    print("=" * 80)
    
    files_to_process = [
        (f, f.name, True, False, 0) 
        for f in non_error_files
    ]
    
    with ThreadPoolExecutor(max_workers=MAX_CONCURRENT_CALLS) as executor:
        # Submit all tasks
        futures = {
            executor.submit(process_file_wrapper, *args): args[1]
            for args in files_to_process
        }
        
        # Process results as they complete
        completed = 0
        total = len(futures)
        
        for future in as_completed(futures):
            filename = futures[future]
            completed += 1
            
            try:
                result = future.result()
                
                if result['status'] == 'success':
                    print(f"\n[{completed}/{total}] ✓ {result['filename']}: {result['message']}")
                elif result['status'] == 'failed':
                    print(f"\n[{completed}/{total}] ✗ {result['filename']}: {result['message']}")
                elif result['status'] == 'skipped':
                    print(f"[{completed}/{total}] ⏭ {result['filename']}: {result['message']}")
                    
            except Exception as e:
                print(f"\n[{completed}/{total}] ✗ {filename}: Unexpected error: {e}")
                with stats_lock:
                    stats['failed'] += 1
    
    # Save state after phase 1
    _save_state(state)
    
    # Process error files with retry logic
    print("\n" + "=" * 80)
    print(f"PHASE 2: Processing Error Files with Retries ({MAX_CONCURRENT_CALLS} concurrent)")
    print("=" * 80)
    
    error_files_to_process = []
    for f in error_files:
        filename = f.name
        source_id = source_identity(input_dir, str(f))
        retry_count = state['retry_counts'].get(source_id, 0)
        if retry_count < MAX_RETRIES:
            error_files_to_process.append((f, filename, False, True, retry_count))
    
    print(f"Found {len(error_files_to_process)} error files to process")
    
    with ThreadPoolExecutor(max_workers=MAX_CONCURRENT_CALLS) as executor:
        # Submit all tasks
        futures = {
            executor.submit(process_file_wrapper, *args): args[1]
            for args in error_files_to_process
        }
        
        # Process results as they complete
        completed = 0
        total = len(futures)
        
        for future in as_completed(futures):
            filename = futures[future]
            completed += 1
            
            try:
                result = future.result()
                
                if result['status'] == 'success':
                    print(f"\n[{completed}/{total}] ✓ {result['filename']}: {result['message']}")
                elif result['status'] == 'failed':
                    print(f"\n[{completed}/{total}] ✗ {result['filename']}: {result['message']}")
                elif result['status'] == 'skipped':
                    print(f"[{completed}/{total}] ⏭ {result['filename']}: {result['message']}")
                    
            except Exception as e:
                print(f"\n[{completed}/{total}] ✗ {filename}: Unexpected error: {e}")
                with stats_lock:
                    stats['failed'] += 1
    
    # Final state save
    state_saved = _save_state(state)

    # Final summary
    print("\n" + "=" * 80)
    print("ENRICHMENT SUMMARY")
    print("=" * 80)
    print(f"✓ Total processed: {stats['total_processed']}")
    print(f"🆕 Newly processed: {stats['newly_processed']}")
    print(f"✗ Failed: {stats['failed']}")
    print(f"⏭ Skipped: {stats['skipped']}")
    print(f"💰 Estimated cost: ${stats['total_cost']:.4f}")
    print(f"\n📊 Current state:")
    print(f"   • Total ever processed: {len(state['processed'])}")
    print(f"   • Current failures: {len(state['failed'])}")
    print(f"   • Files pending retry: {len([f for f in state['retry_counts'].values() if f < MAX_RETRIES])}")
    print(f"   • Files at max retries: {len([f for f in state['retry_counts'].values() if f >= MAX_RETRIES])}")
    print("=" * 80)

    incomplete_reasons = incomplete_run_reasons(
        input_dir,
        len(all_files),
        state['retry_counts'],
        state_saved,
    )

    return {
        'input_dir': input_dir,
        'total_files': len(all_files),
        'processed': stats['total_processed'],
        'newly_processed': stats['newly_processed'],
        'failed': stats['failed'],
        'skipped': stats['skipped'],
        'total_cost': stats['total_cost'],
        'incomplete_reasons': incomplete_reasons,
        'success': not incomplete_reasons and stats['failed'] == 0,
    }


def incomplete_run_reasons(
    input_dir: str,
    total_files: int,
    retry_counts: Dict,
    state_saved: bool,
) -> List[str]:
    """Reasons the run could not do the work it was asked to do.

    A failed file is reported separately through the run summary's
    ``failed`` count. These reasons cover work that never happened at all.
    """
    reasons = []
    if not os.path.isdir(input_dir):
        reasons.append(f"input directory does not exist: {input_dir}")
    elif total_files == 0:
        reasons.append(f"no JSON files found in input directory: {input_dir}")

    stuck = len([count for count in retry_counts.values() if count >= MAX_RETRIES])
    if stuck:
        reasons.append(f"{stuck} file(s) exhausted the {MAX_RETRIES} retry limit")

    if not state_saved:
        reasons.append("enrichment state could not be saved")

    return reasons


def main(argv: Optional[List[str]] = None) -> int:
    """CLI entry point.

    Runs the enrichment pipeline and returns a process exit code: 0 on a
    complete run, 1 when any file failed, work was incomplete, or the user
    aborted.
    """
    args = list(sys.argv[1:] if argv is None else argv)

    # Ensure S3 bucket exists before starting
    print("\n🔍 Checking S3 bucket...")
    if not _ensure_s3_bucket_exists():
        print("⚠️  Warning: S3 bucket not available. Pipeline will save to local files only.")
        print("   Enriched outputs will NOT be uploaded to S3.")
        response = input("\nContinue anyway? (y/n): ")
        if response.lower() != 'y':
            print("❌ Aborted by user")
            return 1

    # Default input directory - relative to this script's location
    script_dir = os.path.dirname(os.path.abspath(__file__))
    input_directory = os.path.join(script_dir, '../parsedQuestions')

    # Allow override from command line
    if args:
        input_directory = args[0]

    # Normalize path
    input_directory = os.path.abspath(input_directory)

    print(f"Using input directory: {input_directory}")

    # Run enrichment pipeline
    summary = process_all_questions(input_directory, skip_processed=True)

    print("\n" + "=" * 80)
    print("RUN RESULT")
    print("=" * 80)
    print(
        f"processed={summary['processed']} "
        f"newly_processed={summary['newly_processed']} "
        f"failed={summary['failed']} "
        f"skipped={summary['skipped']} "
        f"total_files={summary['total_files']} "
        f"success={summary['success']}"
    )
    for reason in summary['incomplete_reasons']:
        print(f"   ✗ {reason}")

    if not summary['success']:
        print("❌ Enrichment run did not complete")
        return 1

    print("✅ Enrichment run completed")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
