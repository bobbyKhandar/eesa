"""
Test Suite for Question Parsing Pipeline

This test file validates the parsing pipeline functionality including:
- Loading OCR text from S3
- Calling Bedrock for parsing
- JSON cleaning and validation
- Saving parsed questions to S3
- Error handling and retries

Run with: python test_parsing_pipeline.py
"""

import os
import sys
import json
from unittest.mock import Mock, patch, MagicMock

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Import functions to test
from parsing_pipeline import (
    clean_json_response,
    validate_and_fix_json,
    call_bedrock_for_parsing,
    load_ocr_from_s3,
    save_parsed_to_s3,
    parse_questions_for_job
)


class TestParsingPipeline:
    """Test class for parsing pipeline"""
    
    def __init__(self):
        self.passed = 0
        self.failed = 0
    
    def assert_true(self, condition, message):
        """Assert helper"""
        if condition:
            print(f"  ✓ {message}")
            self.passed += 1
        else:
            print(f"  ✗ {message}")
            self.failed += 1
    
    def create_sample_ocr_text(self):
        """Create sample OCR text for testing"""
        return """
K.J. Somaiya College of Engineering
Name of the Course: Database Management Systems
Semester: III
Branch: IT
Maximum Marks: 100
Year: 2019

Q1 (a) What are the features of database system? (10 marks)
Q1 (b) Explain the architecture of DBMS. (10 marks)

Q2. Design an ER diagram for library management system. (20 marks)

OR

Q2. Design a relational schema for student database. (20 marks)

Q3. Multiple Choice Questions (10 marks)
    i. Which of the following is a DDL command?
       a) SELECT
       b) CREATE
       c) UPDATE
       d) DELETE
    
    ii. What does ACID stand for?
        a) Atomicity, Consistency, Isolation, Durability
        b) Addition, Calculation, Integration, Display
        c) Active, Complete, Integrated, Database
        d) None of the above
"""
    
    def create_sample_parsed_json(self):
        """Create sample parsed JSON for testing"""
        return {
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
                        },
                        {
                            "question_number": "Q1 (b)",
                            "question_text": "Explain the architecture of DBMS.",
                            "questionType": "text",
                            "marks": "10"
                        }
                    ]
                }
            ],
            "subjectsCreated": ["Database Management Systems"]
        }
    
    def test_clean_json_response(self):
        """Test 1: Clean JSON from markdown"""
        print("\n🧪 Test 1: Clean JSON Response")
        
        # Test with markdown code blocks
        json_with_markdown = '''```json
{
  "exams": [],
  "subjectsCreated": []
}
```'''
        
        cleaned = clean_json_response(json_with_markdown)
        
        self.assert_true(
            '```' not in cleaned,
            "Removed markdown code blocks"
        )
        
        self.assert_true(
            cleaned.startswith('{'),
            "Starts with {"
        )
        
        self.assert_true(
            cleaned.endswith('}'),
            "Ends with }"
        )
    
    def test_validate_and_fix_json(self):
        """Test 2: Validate and fix JSON"""
        print("\n🧪 Test 2: Validate and Fix JSON")
        
        # Valid JSON
        valid_json = '{"exams": [], "subjectsCreated": []}'
        result = validate_and_fix_json(valid_json)
        
        self.assert_true(
            result is not None,
            "Parsed valid JSON"
        )
        
        self.assert_true(
            isinstance(result, dict),
            "Result is a dictionary"
        )
        
        # JSON with trailing comma
        json_with_comma = '{"exams": [], "subjectsCreated": [],}'
        result2 = validate_and_fix_json(json_with_comma)
        
        self.assert_true(
            result2 is not None,
            "Fixed JSON with trailing comma"
        )
    
    def test_load_ocr_from_s3(self):
        """Test 3: Load OCR data from S3 (mocked)"""
        print("\n🧪 Test 3: Load OCR from S3")
        
        ocr_data = {
            'extracted_text': self.create_sample_ocr_text(),
            'page_count': 2,
            'job_id': 'test-123'
        }
        
        with patch('parsing_pipeline.s3_client') as mock_s3:
            mock_response = {
                'Body': MagicMock()
            }
            mock_response['Body'].read.return_value = json.dumps(ocr_data).encode('utf-8')
            mock_s3.get_object.return_value = mock_response
            
            result = load_ocr_from_s3('test-123', 'exam.pdf')
            
            self.assert_true(
                result is not None,
                "Successfully loaded OCR text"
            )
            
            self.assert_true(
                len(result) > 0,
                "OCR text is not empty"
            )
            
            self.assert_true(
                'Database' in result,
                "Contains expected content"
            )
    
    def test_save_parsed_to_s3(self):
        """Test 4: Save parsed data to S3 (mocked)"""
        print("\n🧪 Test 4: Save Parsed Data to S3")
        
        parsed_data = self.create_sample_parsed_json()
        
        with patch('parsing_pipeline.s3_client') as mock_s3:
            mock_s3.put_object.return_value = {'ResponseMetadata': {'HTTPStatusCode': 200}}
            
            result = save_parsed_to_s3(parsed_data, 'test-123', 'exam.pdf')
            
            self.assert_true(
                result is True,
                "Successfully saved to S3"
            )
            
            self.assert_true(
                mock_s3.put_object.called,
                "S3 put_object was called"
            )
            
            # Check call arguments
            call_args = mock_s3.put_object.call_args
            self.assert_true(
                'Bucket' in call_args[1],
                "Bucket parameter included"
            )
            
            self.assert_true(
                'Key' in call_args[1],
                "Key parameter included"
            )
    
    def test_call_bedrock_for_parsing(self):
        """Test 5: Call Bedrock API (mocked)"""
        print("\n🧪 Test 5: Call Bedrock for Parsing")
        
        sample_response = json.dumps(self.create_sample_parsed_json())
        
        with patch('parsing_pipeline.bedrock_client') as mock_bedrock:
            mock_bedrock.converse.return_value = {
                'output': {
                    'message': {
                        'content': [
                            {'text': sample_response}
                        ]
                    }
                }
            }
            
            result = call_bedrock_for_parsing(self.create_sample_ocr_text())
            
            self.assert_true(
                result is not None,
                "Received response from Bedrock"
            )
            
            self.assert_true(
                len(result) > 0,
                "Response is not empty"
            )
            
            self.assert_true(
                mock_bedrock.converse.called,
                "Bedrock converse was called"
            )
    
    def test_full_parsing_pipeline(self):
        """Test 6: Full parsing pipeline (mocked)"""
        print("\n🧪 Test 6: Full Parsing Pipeline")
        
        ocr_text = self.create_sample_ocr_text()
        parsed_json = self.create_sample_parsed_json()
        
        with patch('parsing_pipeline.load_ocr_from_s3') as mock_load:
            with patch('parsing_pipeline.call_bedrock_for_parsing') as mock_bedrock:
                with patch('parsing_pipeline.save_parsed_to_s3') as mock_save:
                    
                    mock_load.return_value = ocr_text
                    mock_bedrock.return_value = json.dumps(parsed_json)
                    mock_save.return_value = True
                    
                    result = parse_questions_for_job('test-123', 'exam.pdf')
                    
                    self.assert_true(
                        result is not None,
                        "Pipeline completed successfully"
                    )
                    
                    self.assert_true(
                        result['total_exams'] == 1,
                        "Parsed 1 exam"
                    )
                    
                    self.assert_true(
                        result['total_questions'] == 2,
                        "Parsed 2 questions"
                    )
                    
                    self.assert_true(
                        'Database Management Systems' in result['subjects'],
                        "Extracted correct subject"
                    )
    
    def test_too_big_text_handling(self):
        """Test 7: Handle 'too big text' response"""
        print("\n🧪 Test 7: Too Big Text Handling")
        
        with patch('parsing_pipeline.load_ocr_from_s3') as mock_load:
            with patch('parsing_pipeline.call_bedrock_for_parsing') as mock_bedrock:
                
                mock_load.return_value = "Some OCR text"
                mock_bedrock.return_value = "too big text"
                
                result = parse_questions_for_job('test-123', 'huge_exam.pdf')
                
                self.assert_true(
                    result is None,
                    "Returns None for too big text"
                )
    
    def test_retry_logic(self):
        """Test 8: Retry logic on failures"""
        print("\n🧪 Test 8: Retry Logic")
        
        call_count = {'count': 0}
        
        def mock_load_side_effect(job_id, filename):
            call_count['count'] += 1
            if call_count['count'] < 3:  # Fail first 2 attempts
                return None
            return self.create_sample_ocr_text()
        
        with patch('parsing_pipeline.load_ocr_from_s3') as mock_load:
            with patch('parsing_pipeline.call_bedrock_for_parsing') as mock_bedrock:
                with patch('parsing_pipeline.save_parsed_to_s3') as mock_save:
                    with patch('parsing_pipeline.time.sleep'):  # Skip sleep
                        
                        mock_load.side_effect = mock_load_side_effect
                        mock_bedrock.return_value = json.dumps(self.create_sample_parsed_json())
                        mock_save.return_value = True
                        
                        result = parse_questions_for_job('test-123', 'exam.pdf')
                        
                        self.assert_true(
                            result is not None,
                            "Eventually succeeded"
                        )
                        
                        self.assert_true(
                            result['retry_count'] == 2,
                            "Recorded 2 retries"
                        )
    
    def test_max_retries_exceeded(self):
        """Test 9: Max retries exceeded"""
        print("\n🧪 Test 9: Max Retries Exceeded")
        
        with patch('parsing_pipeline.load_ocr_from_s3') as mock_load:
            with patch('parsing_pipeline.time.sleep'):  # Skip sleep
                
                mock_load.return_value = None  # Always fail
                
                result = parse_questions_for_job('test-123', 'exam.pdf')
                
                self.assert_true(
                    result is None,
                    "Returns None after max retries"
                )
    
    def test_array_response_wrapping(self):
        """Test 10: Handle array response from Bedrock"""
        print("\n🧪 Test 10: Array Response Wrapping")
        
        # Bedrock returns array instead of object with 'exams' key
        array_response = [
            {
                "subject": "Computer Science",
                "max_marks": "100",
                "year": "2023",
                "semester": "I",
                "branch": "CSE",
                "examType": "main",
                "questions": []
            }
        ]
        
        with patch('parsing_pipeline.load_ocr_from_s3') as mock_load:
            with patch('parsing_pipeline.call_bedrock_for_parsing') as mock_bedrock:
                with patch('parsing_pipeline.save_parsed_to_s3') as mock_save:
                    
                    mock_load.return_value = "Some text"
                    mock_bedrock.return_value = json.dumps(array_response)
                    mock_save.return_value = True
                    
                    result = parse_questions_for_job('test-123', 'exam.pdf')
                    
                    self.assert_true(
                        result is not None,
                        "Handled array response"
                    )
                    
                    self.assert_true(
                        result['total_exams'] == 1,
                        "Wrapped array correctly"
                    )
    
    def run_all_tests(self):
        """Run all tests"""
        print("=" * 80)
        print("PARSING PIPELINE TEST SUITE")
        print("=" * 80)
        
        self.test_clean_json_response()
        self.test_validate_and_fix_json()
        self.test_load_ocr_from_s3()
        self.test_save_parsed_to_s3()
        self.test_call_bedrock_for_parsing()
        self.test_full_parsing_pipeline()
        self.test_too_big_text_handling()
        self.test_retry_logic()
        self.test_max_retries_exceeded()
        self.test_array_response_wrapping()
        
        # Summary
        print("\n" + "=" * 80)
        print("TEST SUMMARY")
        print("=" * 80)
        print(f"✓ Passed: {self.passed}")
        print(f"✗ Failed: {self.failed}")
        print(f"📊 Total: {self.passed + self.failed}")
        
        if self.failed == 0:
            print("\n🎉 All tests passed!")
            return 0
        else:
            print(f"\n⚠️  {self.failed} test(s) failed")
            return 1


if __name__ == "__main__":
    tester = TestParsingPipeline()
    exit_code = tester.run_all_tests()
    sys.exit(exit_code)
