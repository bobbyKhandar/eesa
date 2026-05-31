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
