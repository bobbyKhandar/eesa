"""
Question Retrieval - Loads processed questions from S3 with 3-level fallback.

Attempts organized output first, falls back to enriched, then parsed.
Normalizes fields to match database schema and computes Bloom's taxonomy stats.
"""

import json
import os
from typing import Dict, List, Optional, Any


# Reserved organization metadata basenames. Exam payloads live alongside these
# files and may contain "index" in the subject folder or filename (for example
# "Index Numbers" or "Database Indexing"), so only these exact basenames are
# treated as index metadata.
INDEX_METADATA_BASENAMES = frozenset({"_index.json", "_master_index.json"})


# Shared output contract for processed-question retrieval.
# Parsing (packages/ai-pipeline/src/parsing_pipeline.py) emits ``questionType``
# as "text" or "mcq" with ``options`` (array of choice strings) only for MCQs.
# Enrichment and organization preserve the whole question object, so the
# retriever must preserve both fields while normalizing names/types.
QUESTION_TYPE_TEXT = "text"
QUESTION_TYPE_MCQ = "mcq"
QUESTION_TYPES = frozenset({QUESTION_TYPE_TEXT, QUESTION_TYPE_MCQ})

_MCQ_TYPE_ALIASES = frozenset({
    "mcq",
    "multiple_choice",
    "multiple choice",
    "single_choice",
    "single choice",
    "objective",
})


def _normalize_question_type(question: Dict) -> str:
    """Return the canonical ``questionType`` ("mcq" or "text")."""
    raw = question.get("questionType", question.get("question_type", question.get("type")))
    if raw is None:
        # A question carrying choices without an explicit type is an MCQ;
        # otherwise default to text so no choice payload is dropped silently.
        options_raw = question.get("options")
        if options_raw is None:
            options_raw = question.get("choices")
        if isinstance(options_raw, (list, tuple)) and len(options_raw) > 0:
            return QUESTION_TYPE_MCQ
        return QUESTION_TYPE_TEXT
    normalized = str(raw).strip().lower().replace("-", " ").replace("_", " ")
    normalized = " ".join(normalized.split())
    if normalized in _MCQ_TYPE_ALIASES:
        return QUESTION_TYPE_MCQ
    return QUESTION_TYPE_TEXT


def _normalize_question_options(question: Dict) -> List[str]:
    """Return the complete MCQ choices as a list of non-empty strings."""
    raw = question.get("options")
    if raw is None:
        raw = question.get("choices")
    if raw is None:
        return []
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, (list, tuple)):
        return []
    normalized: List[str] = []
    for option in raw:
        if option is None:
            continue
        text = option if isinstance(option, str) else str(option)
        text = text.strip()
        if text:
            normalized.append(text)
    return normalized


def is_index_metadata_key(key: str) -> bool:
    """Return True only for the organization's reserved index metadata files."""
    return os.path.basename(key).lower() in INDEX_METADATA_BASENAMES


def is_organized_exam_key(key: str) -> bool:
    """Return True for organized exam payloads, including index-named subjects."""
    return key.endswith(".json") and not is_index_metadata_key(key)


def _master_index_key(s3_jobs_prefix: str, job_id: str) -> str:
    return f"{s3_jobs_prefix}{job_id}/organized_output/_master_index.json"


def _load_organized_manifest(s3_client: Any, s3_bucket: str, s3_jobs_prefix: str,
                             job_id: str) -> Optional[Dict]:
    """Load the organization master manifest, or None when unavailable."""
    try:
        obj_response = s3_client.get_object(
            Bucket=s3_bucket, Key=_master_index_key(s3_jobs_prefix, job_id)
        )
        data = json.loads(obj_response["Body"].read().decode("utf-8"))
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    if "subjects" not in data and "total_exams" not in data:
        return None
    return data


def _manifest_expected_exam_count(manifest: Optional[Dict]) -> Optional[int]:
    if not isinstance(manifest, dict):
        return None
    total = manifest.get("total_exams")
    if isinstance(total, int):
        return total
    subjects = manifest.get("subjects")
    if isinstance(subjects, dict):
        count = 0
        for info in subjects.values():
            if isinstance(info, dict) and isinstance(info.get("files"), list):
                count += len(info["files"])
            elif isinstance(info, int):
                count += info
        return count
    return None


def _manifest_exam_keys(manifest: Optional[Dict]) -> List[str]:
    keys: List[str] = []
    if not isinstance(manifest, dict):
        return keys
    subjects = manifest.get("subjects")
    if not isinstance(subjects, dict):
        return keys
    for info in subjects.values():
        if not isinstance(info, dict):
            continue
        for entry in info.get("files") or []:
            if isinstance(entry, dict) and isinstance(entry.get("s3_key"), str):
                keys.append(entry["s3_key"])
    return keys


def _parsed_filename_stem(metadata: Optional[Dict]) -> Optional[str]:
    """Return the validated parsed-artifact stem from job metadata.

    The parsing producer writes ``parsed_output/{stem}_parsed.json`` where
    ``stem`` is ``os.path.splitext(filename)[0]``. Only the basename is used
    so a metadata filename can never escape the job prefix.
    """
    if not isinstance(metadata, dict):
        return None
    filename = metadata.get("filename")
    if not isinstance(filename, str):
        return None
    filename = filename.strip()
    if not filename:
        return None
    basename = os.path.basename(filename)
    if not basename or basename in (".", ".."):
        return None
    if "/" in basename or "\\" in basename or "\x00" in basename:
        return None
    stem, _ext = os.path.splitext(basename)
    stem = stem.strip()
    if not stem or stem in (".", ".."):
        return None
    if "/" in stem or "\\" in stem or "\x00" in stem:
        return None
    return stem


def _load_exam_payload(s3_client: Any, s3_bucket: str, key: str) -> Optional[List[Dict]]:
    """Load ``exams`` from one S3 JSON key, or None when unavailable."""
    obj_response = s3_client.get_object(Bucket=s3_bucket, Key=key)
    data = json.loads(obj_response["Body"].read().decode("utf-8"))
    if isinstance(data, dict) and isinstance(data.get("exams"), list):
        return data["exams"]
    return None


def _append_normalized_exams(exams: List[Dict], payload: Optional[List[Dict]]) -> None:
    if not payload:
        return
    for exam in payload:
        if isinstance(exam, dict):
            _normalize_exam_questions(exam)
            exams.append(exam)


def _load_parsed_output_exams(s3_client: Any, s3_bucket: str, s3_jobs_prefix: str,
                              job_id: str, metadata: Optional[Dict]) -> List[Dict]:
    """Recover non-chunked parsed exams from the producer's actual key."""
    exams: List[Dict] = []
    parsed_prefix = f"{s3_jobs_prefix}{job_id}/parsed_output/"
    attempted = set()

    stem = _parsed_filename_stem(metadata)
    if stem is not None:
        key = f"{parsed_prefix}{stem}_parsed.json"
        attempted.add(key)
        try:
            _append_normalized_exams(
                exams, _load_exam_payload(s3_client, s3_bucket, key)
            )
            if exams:
                return exams
        except Exception as e:
            print(f"Could not load parsed output {key}: {e}")

    # Filename metadata may be absent (or stale) while parsed artifacts
    # remain, so list the producer's filename-scoped keys as a fallback.
    try:
        response = s3_client.list_objects_v2(Bucket=s3_bucket, Prefix=parsed_prefix)
        if "Contents" in response:
            for obj in sorted(response["Contents"], key=lambda o: o.get("Key", "")):
                key = obj.get("Key", "")
                if not key.endswith("_parsed.json"):
                    continue
                if key in attempted:
                    continue
                try:
                    _append_normalized_exams(
                        exams, _load_exam_payload(s3_client, s3_bucket, key)
                    )
                except Exception as e:
                    print(f"Could not load parsed output {key}: {e}")
    except Exception as e:
        print(f"Could not list parsed output: {e}")
    return exams


def _load_parsed_chunk_exams(s3_client: Any, s3_bucket: str, s3_jobs_prefix: str,
                             job_id: str) -> List[Dict]:
    """Recover chunked parsed exams, each chunk holding its own artifact."""
    exams: List[Dict] = []
    chunks_prefix = f"{s3_jobs_prefix}{job_id}/parsed_chunks/"
    metadata_key = f"{chunks_prefix}_metadata.json"

    try:
        obj_response = s3_client.get_object(Bucket=s3_bucket, Key=metadata_key)
        chunk_metadata = json.loads(obj_response["Body"].read().decode("utf-8"))
    except Exception as e:
        print(f"Could not load parsed chunk metadata: {e}")
        chunk_metadata = None

    chunk_keys: List[str] = []
    if isinstance(chunk_metadata, dict):
        raw_keys = chunk_metadata.get("chunk_keys")
        if isinstance(raw_keys, list):
            chunk_keys = [
                k for k in raw_keys
                if isinstance(k, str) and k.startswith(chunks_prefix)
            ]
    for key in chunk_keys:
        try:
            _append_normalized_exams(
                exams, _load_exam_payload(s3_client, s3_bucket, key)
            )
        except Exception as e:
            print(f"Could not load parsed chunk {key}: {e}")
    if exams:
        return exams

    try:
        response = s3_client.list_objects_v2(Bucket=s3_bucket, Prefix=chunks_prefix)
        if "Contents" in response:
            for obj in sorted(response["Contents"], key=lambda o: o.get("Key", "")):
                key = obj.get("Key", "")
                if key == metadata_key or not key.endswith(".json"):
                    continue
                if key in set(chunk_keys):
                    continue
                try:
                    _append_normalized_exams(
                        exams, _load_exam_payload(s3_client, s3_bucket, key)
                    )
                except Exception as e:
                    print(f"Could not load parsed chunk {key}: {e}")
    except Exception as e:
        print(f"Could not list parsed chunks: {e}")
    return exams


def _exam_identity(exam: Dict) -> tuple:
    questions = exam.get("questions", [])
    first_text = ""
    if questions and isinstance(questions[0], dict):
        first_text = str(
            questions[0].get("question_text", questions[0].get("questionText", ""))
        )[:200]
    return (
        exam.get("subject"),
        exam.get("year"),
        exam.get("semester"),
        exam.get("examType"),
        len(questions) if isinstance(questions, list) else 0,
        first_text,
    )


def get_job_questions(s3_client: Any, s3_bucket: str, s3_jobs_prefix: str, job_id: str,
                      metadata: Optional[Dict] = None) -> Optional[Dict]:
    """
    Retrieve processed questions for a completed job.

    3-level S3 fallback: organized -> enriched -> parsed.
    Returns full exam structure with normalized fields and Bloom's distribution.
    """
    try:
        exams = []

        # Level 1: Organized output (final format, grouped by subject)
        loaded_keys = set()
        try:
            organized_prefix = f"{s3_jobs_prefix}{job_id}/organized_output/"
            response = s3_client.list_objects_v2(Bucket=s3_bucket, Prefix=organized_prefix)
            if 'Contents' in response:
                for obj in response['Contents']:
                    key = obj['Key']
                    if is_organized_exam_key(key):
                        obj_response = s3_client.get_object(Bucket=s3_bucket, Key=key)
                        data = json.loads(obj_response['Body'].read().decode('utf-8'))
                        if isinstance(data, dict) and 'exams' in data:
                            for exam in data['exams']:
                                _normalize_exam_questions(exam)
                                exams.append(exam)
                            loaded_keys.add(key)
        except Exception as e:
            print(f"Could not load organized output: {e}")

        # Reconcile with the organization master manifest so an omitted exam
        # file cannot be reported as a complete result. Manifest-listed exam
        # keys that the prefix listing missed are loaded directly.
        manifest = None
        expected_exam_count: Optional[int] = None
        try:
            manifest = _load_organized_manifest(s3_client, s3_bucket, s3_jobs_prefix, job_id)
            expected_exam_count = _manifest_expected_exam_count(manifest)
            for key in _manifest_exam_keys(manifest):
                if key in loaded_keys or not is_organized_exam_key(key):
                    continue
                try:
                    obj_response = s3_client.get_object(Bucket=s3_bucket, Key=key)
                    data = json.loads(obj_response['Body'].read().decode('utf-8'))
                    if isinstance(data, dict) and 'exams' in data:
                        for exam in data['exams']:
                            _normalize_exam_questions(exam)
                            exams.append(exam)
                        loaded_keys.add(key)
                except Exception as e:
                    print(f"Could not load manifest-listed exam {key}: {e}")
        except Exception as e:
            print(f"Could not reconcile organized output with manifest: {e}")

        organized_incomplete = (
            expected_exam_count is not None and len(exams) < expected_exam_count
        )

        # Level 2: Enriched output (also supplements an incomplete organized set)
        if not exams or organized_incomplete:
            try:
                seen_identities = {_exam_identity(exam) for exam in exams}
                enriched_prefix = f"{s3_jobs_prefix}{job_id}/enriched_output/"
                response = s3_client.list_objects_v2(Bucket=s3_bucket, Prefix=enriched_prefix)
                if 'Contents' in response:
                    for obj in response['Contents']:
                        key = obj['Key']
                        if key.endswith('_enriched.json'):
                            obj_response = s3_client.get_object(Bucket=s3_bucket, Key=key)
                            data = json.loads(obj_response['Body'].read().decode('utf-8'))
                            if isinstance(data, dict) and 'exams' in data:
                                for exam in data['exams']:
                                    identity = _exam_identity(exam)
                                    if organized_incomplete and identity in seen_identities:
                                        continue
                                    _normalize_exam_questions(exam)
                                    exams.append(exam)
                                    seen_identities.add(identity)
            except Exception as e:
                print(f"Could not load enriched output: {e}")

        # Level 3: Parsed output (minimal enrichment). The parsing producer
        # writes filename-scoped keys (parsed_output/{stem}_parsed.json);
        # chunked jobs instead write one artifact per chunk under
        # parsed_chunks/. Both are normalized through the same contract.
        if not exams:
            for parsed_exam in _load_parsed_output_exams(
                s3_client, s3_bucket, s3_jobs_prefix, job_id, metadata
            ):
                exams.append(parsed_exam)
        if not exams:
            for parsed_exam in _load_parsed_chunk_exams(
                s3_client, s3_bucket, s3_jobs_prefix, job_id
            ):
                exams.append(parsed_exam)

        if not exams:
            return None

        # Compute summary
        total_questions = sum(len(exam.get('questions', [])) for exam in exams)
        all_questions = [q for exam in exams for q in exam.get('questions', [])]

        bloom_counts = {
            'Recall': 0, 'Understand': 0, 'Apply': 0,
            'Analyze': 0, 'Evaluate': 0, 'Create': 0
        }
        for q in all_questions:
            level = q.get('bloomLevel', 'Unknown')
            if level in bloom_counts:
                bloom_counts[level] += 1

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

        # Average difficulty
        difficulties = [q.get('difficulty') for q in all_questions if q.get('difficulty')]
        if difficulties:
            diff_map = {'Easy': 1, 'easy': 1, 'Medium': 2, 'medium': 2, 'Hard': 3, 'hard': 3}
            avg = sum(diff_map.get(d, 2) for d in difficulties) / len(difficulties)
            summary['avgDifficulty'] = 'Easy' if avg < 1.5 else 'Hard' if avg > 2.5 else 'Medium'

        return {
            'job_id': job_id,
            'filename': metadata.get('filename') if metadata else None,
            'exams': exams,
            'summary': summary
        }

    except Exception as e:
        print(f"Error loading questions: {e}")
        import traceback
        traceback.print_exc()
        return None


def _normalize_exam_questions(exam: Dict):
    """Normalize question fields in-place to match database schema.

    Preserves the parsing-stage ``questionType`` ("text"/"mcq") and the
    complete MCQ ``options`` while normalizing field names/types.
    """
    if 'questions' not in exam:
        return
    normalized = []
    for q in exam['questions']:
        try:
            marks_value = int(q.get('marks', 0)) if q.get('marks') else 0
        except (ValueError, TypeError):
            marks_value = 0
        try:
            confidence_value = float(q.get('confidence', 0.0)) if q.get('confidence') is not None else 0.0
        except (ValueError, TypeError):
            confidence_value = 0.0

        question_type = _normalize_question_type(q)
        question_options = _normalize_question_options(q)

        entry = {
            'questionNumber': q.get('question_number', q.get('questionNumber', 'N/A')),
            'questionText': q.get('question_text', q.get('questionText', '')),
            'marks': marks_value,
            'questionType': question_type,
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
            'clusterId': q.get('clusterId')
        }
        # Mirror the parsing contract: MCQs carry their complete choices;
        # text questions omit the key unless the source carried choices,
        # in which case the payload is preserved rather than dropped.
        if question_type == QUESTION_TYPE_MCQ or question_options:
            entry['options'] = question_options
        normalized.append(entry)
    exam['questions'] = normalized
