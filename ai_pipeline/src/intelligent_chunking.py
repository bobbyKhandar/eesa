"""
Intelligent PDF Chunking Module

Analyzes OCR text to find natural split points (question boundaries)
and creates manageable chunks for LLM processing.
"""

import re
from typing import List, Dict, Tuple
import json


class QuestionBoundaryDetector:
    """Detects question boundaries in OCR text"""
    
    # Common question patterns in exam papers
    QUESTION_PATTERNS = [
        r'^\s*(?:Question\s+)?(\d+)[.):]\s*',  # Q1. or Question 1: or 1)
        r'^\s*Q\.?\s*(\d+)[.):]\s*',           # Q.1 or Q1:
        r'^\s*\[(\d+)\]\s*',                    # [1]
        r'^\s*(?:QUESTION\s+)?(\d+)[.):]\s*',  # QUESTION 1.
    ]
    
    SECTION_PATTERNS = [
        r'^\s*(?:SECTION|PART)\s+([A-Z])\s*',  # SECTION A
        r'^\s*(?:Section|Part)\s+(\d+)\s*',    # Section 1
    ]
    
    def __init__(self, max_chars_per_chunk: int = 20000):
        """
        Args:
            max_chars_per_chunk: Maximum characters per chunk (conservative estimate for token limit)
        """
        self.max_chars_per_chunk = max_chars_per_chunk
        self.question_regex = [re.compile(pattern, re.MULTILINE | re.IGNORECASE) 
                              for pattern in self.QUESTION_PATTERNS]
        self.section_regex = [re.compile(pattern, re.MULTILINE | re.IGNORECASE) 
                             for pattern in self.SECTION_PATTERNS]
    
    def find_question_boundaries(self, text: str) -> List[Dict]:
        """
        Find all question boundaries in text
        
        Returns:
            List of dicts with {
                'question_number': int,
                'start_pos': int,
                'line_number': int,
                'is_section': bool
            }
        """
        boundaries = []
        lines = text.split('\n')
        current_pos = 0
        
        for line_num, line in enumerate(lines):
            # Check for question patterns
            for regex in self.question_regex:
                match = regex.match(line.strip())
                if match:
                    try:
                        q_num = int(match.group(1))
                        boundaries.append({
                            'question_number': q_num,
                            'start_pos': current_pos,
                            'line_number': line_num,
                            'is_section': False,
                            'text_preview': line.strip()[:100]
                        })
                        break
                    except (ValueError, IndexError):
                        pass
            
            # Check for section markers (also good split points)
            for regex in self.section_regex:
                match = regex.match(line.strip())
                if match:
                    boundaries.append({
                        'question_number': -1,  # Section marker
                        'start_pos': current_pos,
                        'line_number': line_num,
                        'is_section': True,
                        'section_name': match.group(1),
                        'text_preview': line.strip()[:100]
                    })
                    break
            
            current_pos += len(line) + 1  # +1 for newline
        
        return boundaries
    
    def create_intelligent_chunks(self, text: str, metadata: Dict = None) -> List[Dict]:
        """
        Create chunks at natural boundaries
        
        Returns:
            List of chunks with metadata:
            [
                {
                    'text': str,
                    'chunk_id': int,
                    'start_question': int or None,
                    'end_question': int or None,
                    'is_continuation': bool,
                    'char_count': int,
                    'has_metadata': bool
                }
            ]
        """
        boundaries = self.find_question_boundaries(text)
        
        if not boundaries:
            # No questions found - return as single chunk with warning
            return [{
                'text': text,
                'chunk_id': 0,
                'start_question': None,
                'end_question': None,
                'is_continuation': False,
                'char_count': len(text),
                'has_metadata': False,
                'warning': 'No question boundaries detected'
            }]
        
        chunks = []
        current_chunk_start = 0
        chunk_boundaries = []
        
        # Group boundaries into chunks based on size
        for i, boundary in enumerate(boundaries):
            chunk_size = boundary['start_pos'] - current_chunk_start
            
            # If adding this boundary exceeds limit, create chunk with previous boundaries
            if chunk_size > self.max_chars_per_chunk and chunk_boundaries:
                chunks.append(self._create_chunk(
                    text,
                    current_chunk_start,
                    chunk_boundaries[-1]['start_pos'],
                    chunk_boundaries,
                    len(chunks)
                ))
                current_chunk_start = chunk_boundaries[-1]['start_pos']
                chunk_boundaries = []
            
            chunk_boundaries.append(boundary)
        
        # Add final chunk
        if chunk_boundaries:
            chunks.append(self._create_chunk(
                text,
                current_chunk_start,
                len(text),
                chunk_boundaries,
                len(chunks)
            ))
        
        # Mark continuation status
        for i, chunk in enumerate(chunks):
            chunk['is_continuation'] = i > 0 and chunk['start_question'] is not None and chunk['start_question'] > 1
            # First chunk should have metadata from document header
            chunk['has_metadata'] = i == 0
        
        return chunks
    
    def _create_chunk(self, text: str, start_pos: int, end_pos: int, 
                     boundaries: List[Dict], chunk_id: int) -> Dict:
        """Create a chunk dict with metadata"""
        chunk_text = text[start_pos:end_pos]
        
        # Filter out section markers to get actual questions
        question_boundaries = [b for b in boundaries if not b.get('is_section', False)]
        
        start_q = question_boundaries[0]['question_number'] if question_boundaries else None
        end_q = question_boundaries[-1]['question_number'] if question_boundaries else None
        
        return {
            'text': chunk_text,
            'chunk_id': chunk_id,
            'start_question': start_q,
            'end_question': end_q,
            'char_count': len(chunk_text),
            'num_questions': len(question_boundaries),
            'boundaries': boundaries
        }
    
    def needs_chunking(self, text: str) -> bool:
        """Check if text needs to be chunked"""
        return len(text) > self.max_chars_per_chunk


def chunk_ocr_text(ocr_text: str, max_chars_per_chunk: int = 40000) -> List[Dict]:
    """
    Main function to chunk OCR text intelligently
    
    Args:
        ocr_text: The full OCR extracted text
        max_chars_per_chunk: Maximum characters per chunk
    
    Returns:
        List of chunks with metadata
    """
    detector = QuestionBoundaryDetector(max_chars_per_chunk)
    
    if not detector.needs_chunking(ocr_text):
        # Small enough to process as-is
        return [{
            'text': ocr_text,
            'chunk_id': 0,
            'start_question': 1,
            'end_question': None,
            'is_continuation': False,
            'char_count': len(ocr_text),
            'has_metadata': True,
            'single_chunk': True
        }]
    
    return detector.create_intelligent_chunks(ocr_text)


def validate_chunks(chunks: List[Dict]) -> Dict:
    """
    Validate that chunks are reasonable
    
    Returns:
        {
            'valid': bool,
            'warnings': List[str],
            'stats': Dict
        }
    """
    warnings = []
    
    # Check for gaps in question numbers
    question_sequence = []
    for chunk in chunks:
        if chunk.get('start_question'):
            question_sequence.append(chunk['start_question'])
    
    if question_sequence:
        for i in range(len(question_sequence) - 1):
            if question_sequence[i+1] - question_sequence[i] > 10:
                warnings.append(f"Large gap between chunks: Q{question_sequence[i]} to Q{question_sequence[i+1]}")
    
    # Check chunk sizes
    very_large_chunks = [c for c in chunks if c['char_count'] > 50000]
    if very_large_chunks:
        warnings.append(f"{len(very_large_chunks)} chunks exceed recommended size")
    
    stats = {
        'total_chunks': len(chunks),
        'avg_chunk_size': sum(c['char_count'] for c in chunks) / len(chunks),
        'total_questions_detected': sum(c.get('num_questions', 0) for c in chunks),
        'continuation_chunks': sum(1 for c in chunks if c.get('is_continuation'))
    }
    
    return {
        'valid': len(warnings) == 0,
        'warnings': warnings,
        'stats': stats
    }


if __name__ == '__main__':
    # Test with sample text
    sample_text = """
    University Examination Paper
    Subject: Operating Systems
    Year: 2023
    
    SECTION A
    
    Question 1: What is an operating system?
    (5 marks)
    
    Question 2: Explain the difference between process and thread.
    (10 marks)
    
    Question 3: What is deadlock? Describe the necessary conditions.
    (15 marks)
    """
    
    chunks = chunk_ocr_text(sample_text, max_chars_per_chunk=200)  # Small limit for testing
    
    print(f"Created {len(chunks)} chunks:")
    for chunk in chunks:
        print(f"\nChunk {chunk['chunk_id']}:")
        print(f"  Questions: {chunk['start_question']} to {chunk['end_question']}")
        print(f"  Is continuation: {chunk['is_continuation']}")
        print(f"  Has metadata: {chunk['has_metadata']}")
        print(f"  Size: {chunk['char_count']} chars")
        print(f"  Preview: {chunk['text'][:100]}...")
    
    validation = validate_chunks(chunks)
    print(f"\nValidation: {validation}")
