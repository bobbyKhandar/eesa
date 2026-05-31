"""
Question Retrieval - Loads processed questions from S3 with 3-level fallback.

Attempts organized output first, falls back to enriched, then parsed.
Normalizes fields to match database schema and computes Bloom's taxonomy stats.
"""

import json
from typing import Dict, List, Optional, Any


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
        try:
            organized_prefix = f"{s3_jobs_prefix}{job_id}/organized_output/"
            response = s3_client.list_objects_v2(Bucket=s3_bucket, Prefix=organized_prefix)
            if 'Contents' in response:
                for obj in response['Contents']:
                    key = obj['Key']
                    if key.endswith('.json') and 'index' not in key.lower():
                        obj_response = s3_client.get_object(Bucket=s3_bucket, Key=key)
                        data = json.loads(obj_response['Body'].read().decode('utf-8'))
                        if isinstance(data, dict) and 'exams' in data:
                            for exam in data['exams']:
                                _normalize_exam_questions(exam)
                                exams.append(exam)
        except Exception as e:
            print(f"Could not load organized output: {e}")

        # Level 2: Enriched output
        if not exams:
            try:
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
                                    _normalize_exam_questions(exam)
                                    exams.append(exam)
            except Exception as e:
                print(f"Could not load enriched output: {e}")

        # Level 3: Parsed output (minimal enrichment)
        if not exams:
            try:
                parsed_key = f"{s3_jobs_prefix}{job_id}/parsed_output.json"
                obj_response = s3_client.get_object(Bucket=s3_bucket, Key=parsed_key)
                data = json.loads(obj_response['Body'].read().decode('utf-8'))
                if isinstance(data, dict) and 'exams' in data:
                    exams = data['exams']
            except Exception as e:
                print(f"Could not load parsed output: {e}")

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
    """Normalize question fields in-place to match database schema."""
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

        normalized.append({
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
            'clusterId': q.get('clusterId')
        })
    exam['questions'] = normalized
