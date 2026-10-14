"""
Chunk Merge Logic

Handles merging of parsed questions from multiple chunks,
dealing with continuation chunks and incomplete questions.
"""

import json
from typing import List, Dict, Optional
import re


class ChunkMerger:
    """Merges parsed question chunks intelligently"""
    
    def __init__(self):
        self.merged_exams = []
        self.all_subjects = set()
    
    def merge_parsed_chunks(self, parsed_chunks: List[Dict]) -> Dict:
        """
        Merge multiple parsed chunks into a single coherent result
        
        Args:
            parsed_chunks: List of parsed JSON results from LLM
        
        Returns:
            Merged result with all questions combined
        """
        if not parsed_chunks:
            return {
                'exams': [],
                'subjectsCreated': [],
                'error': 'No chunks to merge'
            }
        
        # If only one chunk, return it (might still need metadata repair)
        if len(parsed_chunks) == 1:
            chunk = parsed_chunks[0]
            if not chunk.get('is_continuation'):
                return chunk
            else:
                # Single continuation chunk - needs manual review
                return self._handle_orphan_continuation(chunk)
        
        # Sort chunks by continuation status and question numbers
        sorted_chunks = self._sort_chunks(parsed_chunks)
        
        # Merge chunks sequentially
        result = self._merge_sequential_chunks(sorted_chunks)
        
        # Post-process: fix numbering gaps, deduplicate
        result = self._post_process_merge(result)
        
        return result
    
    def _sort_chunks(self, chunks: List[Dict]) -> List[Dict]:
        """Sort chunks by question sequence"""
        def get_sort_key(chunk):
            # Non-continuation chunks come first
            if not chunk.get('is_continuation'):
                return (0, 0)
            # Continuation chunks sorted by starting question
            start_q = chunk.get('starts_at_question')
            return (1, start_q if start_q else 999)
        
        return sorted(chunks, key=get_sort_key)
    
    def _merge_sequential_chunks(self, chunks: List[Dict]) -> Dict:
        """Merge chunks in sequence"""
        if not chunks:
            return {'exams': [], 'subjectsCreated': []}
        
        # Start with first chunk as base
        base_chunk = chunks[0]
        result = {
            'exams': [],
            'subjectsCreated': list(base_chunk.get('subjectsCreated', []))
        }
        
        # If base is continuation, it's an error case
        if base_chunk.get('is_continuation'):
            result['warning'] = 'First chunk is a continuation - metadata may be incomplete'
            result['manual_review_required'] = True
        
        # Add base chunk exams
        if base_chunk.get('exams'):
            result['exams'].extend(base_chunk['exams'])
        
        # Merge subsequent chunks
        for chunk in chunks[1:]:
            if chunk.get('is_continuation'):
                # This is a continuation - merge its questions with previous exam
                self._merge_continuation_chunk(result, chunk)
            else:
                # This is a new exam - add it separately
                if chunk.get('exams'):
                    result['exams'].extend(chunk['exams'])
                if chunk.get('subjectsCreated'):
                    for subject in chunk['subjectsCreated']:
                        if subject not in result['subjectsCreated']:
                            result['subjectsCreated'].append(subject)
        
        return result
    
    def _merge_continuation_chunk(self, result: Dict, continuation_chunk: Dict):
        """Merge a continuation chunk into the last exam"""
        if not result['exams']:
            # No previous exam to merge into - create placeholder
            result['exams'].append({
                'subject': 'MANUAL_REVIEW_REQUIRED',
                'max_marks': '',
                'year': '',
                'semester': '',
                'branch': '',
                'examType': 'main',
                'questions': [],
                'warning': 'Continuation chunk with no base exam'
            })
        
        last_exam = result['exams'][-1]
        
        # Check if continuation chunk has exams
        if not continuation_chunk.get('exams'):
            return
        
        continuation_exam = continuation_chunk['exams'][0]  # Usually only one exam in continuation
        continuation_questions = continuation_exam.get('questions', [])
        
        # Check for question overlap (possible duplicate)
        if continuation_questions:
            last_merged_questions = last_exam.get('questions', [])
            
            if last_merged_questions:
                # Check if last question from previous chunk matches first from this chunk
                last_q_num = last_merged_questions[-1].get('question_number', '')
                first_cont_q_num = continuation_questions[0].get('question_number', '')
                
                # If same question number, try to merge them
                if self._are_same_question(last_q_num, first_cont_q_num):
                    merged_q = self._merge_questions(
                        last_merged_questions[-1],
                        continuation_questions[0]
                    )
                    last_merged_questions[-1] = merged_q
                    continuation_questions = continuation_questions[1:]  # Skip first
        
        # Add remaining continuation questions
        if 'questions' not in last_exam:
            last_exam['questions'] = []
        last_exam['questions'].extend(continuation_questions)
        
        # Update subjects if continuation has better metadata
        if continuation_exam.get('subject') and continuation_exam['subject'] != '':
            if last_exam.get('subject') == '' or last_exam.get('subject') == 'MANUAL_REVIEW_REQUIRED':
                last_exam['subject'] = continuation_exam['subject']
                if continuation_exam['subject'] not in result['subjectsCreated']:
                    result['subjectsCreated'].append(continuation_exam['subject'])
    
    def _are_same_question(self, q_num1: str, q_num2: str) -> bool:
        """Check if two question numbers refer to the same question"""
        # Extract numeric part
        num1 = re.findall(r'\d+', q_num1)
        num2 = re.findall(r'\d+', q_num2)
        
        if num1 and num2:
            return num1[0] == num2[0]
        
        return q_num1.strip().lower() == q_num2.strip().lower()
    
    def _merge_questions(self, q1: Dict, q2: Dict) -> Dict:
        """Merge two question objects (likely the same question split across chunks)"""
        merged = q1.copy()
        
        # Combine question text (take longer one or concatenate)
        text1 = q1.get('question_text', '').strip()
        text2 = q2.get('question_text', '').strip()
        
        if text2 and len(text2) > len(text1):
            merged['question_text'] = text2
        elif text2 and not text1.endswith(text2[:20]):  # Check if continuation
            merged['question_text'] = text1 + ' ' + text2
        
        # Take non-empty marks
        if not merged.get('marks') and q2.get('marks'):
            merged['marks'] = q2['marks']
        
        # Merge options if MCQ
        if q2.get('options'):
            if not merged.get('options'):
                merged['options'] = []
            for opt in q2['options']:
                if opt not in merged['options']:
                    merged['options'].append(opt)
        
        return merged
    
    def _post_process_merge(self, result: Dict) -> Dict:
        """Post-process merged result to fix issues"""
        for exam in result.get('exams', []):
            questions = exam.get('questions', [])
            
            # Remove duplicate questions
            seen_numbers = set()
            unique_questions = []
            for q in questions:
                q_num = q.get('question_number', '')
                if q_num not in seen_numbers:
                    seen_numbers.add(q_num)
                    unique_questions.append(q)
            
            exam['questions'] = unique_questions
            
            # Add stats
            exam['total_questions'] = len(unique_questions)
            exam['question_sequence'] = self._extract_question_sequence(unique_questions)
        
        return result
    
    def _extract_question_sequence(self, questions: List[Dict]) -> str:
        """Extract question sequence for debugging (e.g., "1-5, 7-10")"""
        numbers = []
        for q in questions:
            q_num = q.get('question_number', '')
            nums = re.findall(r'\d+', q_num)
            if nums:
                try:
                    numbers.append(int(nums[0]))
                except ValueError:
                    pass
        
        if not numbers:
            return "unknown"
        
        numbers = sorted(set(numbers))
        
        # Create range representation
        ranges = []
        start = numbers[0]
        prev = numbers[0]
        
        for num in numbers[1:]:
            if num != prev + 1:
                # Gap detected
                if start == prev:
                    ranges.append(str(start))
                else:
                    ranges.append(f"{start}-{prev}")
                start = num
            prev = num
        
        # Add final range
        if start == prev:
            ranges.append(str(start))
        else:
            ranges.append(f"{start}-{prev}")
        
        return ", ".join(ranges)
    
    def _handle_orphan_continuation(self, chunk: Dict) -> Dict:
        """Handle a single continuation chunk with no base"""
        result = chunk.copy()
        result['warning'] = 'This appears to be a continuation chunk with no preceding data'
        result['manual_review_required'] = True
        
        # Try to salvage what we can
        if result.get('exams'):
            for exam in result['exams']:
                if not exam.get('subject') or exam['subject'] == '':
                    exam['subject'] = 'MANUAL_REVIEW_REQUIRED'
        
        return result


# OCR text and boundary spans are already stored on the parsed chunk.
# Re-copying them onto every enriched chunk only duplicates the payload.
_CHUNK_METADATA_OMIT = ('text', 'boundaries')


def build_enriched_chunk(parsed_chunk: Dict, enriched_exams: List[Dict], chunk_index: int = 0) -> Dict:
    """Shape one enriched chunk so exams can merge across a chunk boundary.

    Parsing stores chunk details under ``chunk_metadata``. ``ChunkMerger``
    reads ``is_continuation`` and ``starts_at_question`` on the chunk itself,
    so those markers (and the related chunk metadata) are copied through.
    A top-level continuation flag is used only when ``chunk_metadata`` does
    not include one.
    """
    raw_metadata = parsed_chunk.get('chunk_metadata')
    if isinstance(raw_metadata, dict):
        chunk_metadata = {
            key: value
            for key, value in raw_metadata.items()
            if key not in _CHUNK_METADATA_OMIT
        }
    else:
        chunk_metadata = {}

    enriched: Dict = {
        'exams': enriched_exams,
        'chunk_id': parsed_chunk.get('chunk_id', chunk_metadata.get('chunk_id', chunk_index)),
        'chunk_metadata': chunk_metadata,
    }

    subjects = parsed_chunk.get('subjectsCreated')
    if isinstance(subjects, list):
        enriched['subjectsCreated'] = list(subjects)

    if 'is_continuation' in chunk_metadata:
        enriched['is_continuation'] = chunk_metadata.get('is_continuation') is True
    elif parsed_chunk.get('is_continuation') is True:
        enriched['is_continuation'] = True
    else:
        enriched['is_continuation'] = False

    if 'starts_at_question' in chunk_metadata:
        enriched['starts_at_question'] = chunk_metadata.get('starts_at_question')
    elif chunk_metadata.get('start_question') is not None:
        enriched['starts_at_question'] = chunk_metadata.get('start_question')
    elif 'starts_at_question' in parsed_chunk:
        enriched['starts_at_question'] = parsed_chunk.get('starts_at_question')

    return enriched


def _chunk_is_continuation(parsed_chunk: Dict) -> bool:
    """Read the continuation flag from the payload or its chunk metadata."""
    if 'is_continuation' in parsed_chunk:
        return parsed_chunk.get('is_continuation') is True
    metadata = parsed_chunk.get('chunk_metadata')
    if isinstance(metadata, dict) and 'is_continuation' in metadata:
        return metadata.get('is_continuation') is True
    return False


def _same_question(first: Dict, second: Dict) -> bool:
    """True when two payloads describe the same numbered question."""
    number = str(first.get('question_number', '') or '').strip().lower()
    return bool(number) and number == str(second.get('question_number', '') or '').strip().lower()


def _merge_split_question(first: Dict, second: Dict) -> Dict:
    """Merge one question that a chunk boundary split in two."""
    merged = dict(first)

    text_first = str(first.get('question_text', '') or '').strip()
    text_second = str(second.get('question_text', '') or '').strip()
    if text_first and text_second:
        if text_first in text_second or text_second in text_first:
            # One payload repeated the question; keep the fuller text.
            merged['question_text'] = (
                first['question_text'] if len(text_first) >= len(text_second)
                else second['question_text']
            )
        else:
            # The boundary cut the question in two; join the pieces.
            merged['question_text'] = f"{text_first} {text_second}".strip()
    elif text_second:
        merged['question_text'] = second['question_text']

    if not merged.get('marks') and second.get('marks'):
        merged['marks'] = second['marks']

    options = second.get('options')
    if options:
        combined = list(merged.get('options') or [])
        for option in options:
            if option not in combined:
                combined.append(option)
        merged['options'] = combined

    return merged


def _continues_last_exam(last_exam: Dict, continuation_exam: Dict) -> bool:
    """True when a continuation chunk's exam belongs to the exam already kept.

    A different subject inside a continuation chunk is a new exam that
    starts mid-document, not the same exam continuing.
    """
    target_subject = str(last_exam.get('subject', '') or '').strip().lower()
    next_subject = str(continuation_exam.get('subject', '') or '').strip().lower()
    if target_subject and next_subject and target_subject != next_subject:
        return False
    return True


def _append_continuation_exam(exams: List[Dict], continuation_exam: Dict) -> None:
    """Merge a continuation chunk's first exam into the exam already kept.

    A question that the chunk boundary split keeps one entry instead of
    becoming two half questions.
    """
    if not exams or not isinstance(continuation_exam, dict):
        if isinstance(continuation_exam, dict):
            exams.append(continuation_exam)
        return

    last_exam = exams[-1]
    questions = continuation_exam.get('questions')
    questions = list(questions) if isinstance(questions, list) else []
    existing = last_exam.get('questions')
    existing = list(existing) if isinstance(existing, list) else []

    if questions and existing and _same_question(existing[-1], questions[0]):
        existing[-1] = _merge_split_question(existing[-1], questions[0])
        questions = questions[1:]

    last_exam['questions'] = existing + questions
    if not last_exam.get('subject') and continuation_exam.get('subject'):
        last_exam['subject'] = continuation_exam['subject']


def merge_chunk_exams(parsed_chunks: List[Dict]) -> Dict:
    """Merge parsed chunk payloads into one exams envelope.

    Each payload holds the exams its chunk produced. A continuation
    payload starts mid-document: its first exam continues the exam already
    collected, and a question split across the boundary is merged instead
    of duplicated. Every other exam in that payload stays its own exam, so
    a chunk that contains more than one exam keeps all of them. Callers
    merge only after every chunk parsed, which keeps the envelope covering
    the whole document.
    """
    exams: List[Dict] = []
    subjects: List[str] = []

    for parsed_chunk in parsed_chunks:
        chunk_exams = parsed_chunk.get('exams')
        if not isinstance(chunk_exams, list):
            continue
        remaining = list(chunk_exams)

        if (
            _chunk_is_continuation(parsed_chunk)
            and remaining
            and exams
            and _continues_last_exam(exams[-1], remaining[0])
        ):
            _append_continuation_exam(exams, remaining.pop(0))

        exams.extend(remaining)

        chunk_subjects = parsed_chunk.get('subjectsCreated')
        if isinstance(chunk_subjects, list):
            for subject in chunk_subjects:
                if subject and subject not in subjects:
                    subjects.append(subject)

    return {'exams': exams, 'subjectsCreated': subjects}


def merge_chunks(parsed_chunks: List[Dict]) -> Dict:
    """
    Main function to merge parsed chunks
    
    Args:
        parsed_chunks: List of parsed results from parsing pipeline
    
    Returns:
        Merged result
    """
    merger = ChunkMerger()
    return merger.merge_parsed_chunks(parsed_chunks)


def validate_merge_result(result: Dict) -> Dict:
    """
    Validate merged result for quality
    
    Returns:
        {
            'valid': bool,
            'warnings': List[str],
            'stats': Dict
        }
    """
    warnings = []
    stats = {}
    
    # Check for manual review flags
    if result.get('manual_review_required'):
        warnings.append("Manual review required - metadata may be incomplete")
    
    # Check each exam
    for i, exam in enumerate(result.get('exams', [])):
        if exam.get('subject') == 'MANUAL_REVIEW_REQUIRED':
            warnings.append(f"Exam {i+1}: Subject needs manual review")
        
        if not exam.get('questions'):
            warnings.append(f"Exam {i+1}: No questions found")
        
        # Check for question sequence gaps
        if 'question_sequence' in exam:
            if ',' in exam['question_sequence']:  # Multiple ranges = gaps
                warnings.append(f"Exam {i+1}: Question sequence has gaps: {exam['question_sequence']}")
    
    stats = {
        'total_exams': len(result.get('exams', [])),
        'total_subjects': len(result.get('subjectsCreated', [])),
        'total_questions': sum(len(e.get('questions', [])) for e in result.get('exams', [])),
        'needs_review': result.get('manual_review_required', False)
    }
    
    return {
        'valid': len(warnings) == 0,
        'warnings': warnings,
        'stats': stats
    }


if __name__ == '__main__':
    # Test merging
    chunk1 = {
        'exams': [{
            'subject': 'Operating Systems',
            'year': '2023',
            'questions': [
                {'question_number': 'Q1', 'question_text': 'What is OS?', 'marks': '5'},
                {'question_number': 'Q2', 'question_text': 'Explain process...', 'marks': '10'}
            ]
        }],
        'subjectsCreated': ['Operating Systems']
    }
    
    chunk2 = {
        'is_continuation': True,
        'starts_at_question': 3,
        'exams': [{
            'subject': '',
            'questions': [
                {'question_number': 'Q3', 'question_text': 'What is deadlock?', 'marks': '10'},
                {'question_number': 'Q4', 'question_text': 'Explain scheduling', 'marks': '15'}
            ]
        }]
    }
    
    result = merge_chunks([chunk1, chunk2])
    print(json.dumps(result, indent=2))
    
    validation = validate_merge_result(result)
    print(f"\nValidation: {json.dumps(validation, indent=2)}")
