"""
Test Suite for Organize by Subject Pipeline

This test file validates the subject organization pipeline functionality including:
- Loading enriched data from S3
- Organizing exams by subject in memory
- Saving organized structure to S3
- Creating subject indexes
- Creating master index
- Error handling

Run with: python test_organize_by_subject.py
"""

import os
import sys
import json
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock

# Add parent directory to path to import the pipeline
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Import functions to test
from organize_by_subject_job_based import (
    sanitize_filename,
    load_enriched_from_s3,
    organize_exams_by_subject,
    generate_exam_filename,
    save_organized_to_s3,
    organize_by_subject_for_job
)


class TestOrganizeBySubject:
    """Test class for organize by subject pipeline"""
    
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
    
    def create_test_enriched_data(self):
        """Create sample enriched data for testing"""
        return {
            'exams': [
                {
                    'subject': 'Computer Science',
                    'year': '2023',
                    'semester': 'I',
                    'examType': 'main',
                    'max_marks': '100',
                    'branch': 'CSE',
                    'questions': [
                        {
                            'question_number': 'Q1',
                            'question_text': 'What is an algorithm?',
                            'marks': '5',
                            'bloomLevel': 'Recall',
                            'confidence': 0.95
                        },
                        {
                            'question_number': 'Q2',
                            'question_text': 'Implement a sorting algorithm',
                            'marks': '10',
                            'bloomLevel': 'Apply',
                            'confidence': 0.90
                        }
                    ]
                },
                {
                    'subject': 'Mathematics',
                    'year': '2023',
                    'semester': 'I',
                    'examType': 'main',
                    'max_marks': '100',
                    'branch': 'CSE',
                    'questions': [
                        {
                            'question_number': 'Q1',
                            'question_text': 'Solve the equation',
                            'marks': '5',
                            'bloomLevel': 'Apply',
                            'confidence': 0.88
                        }
                    ]
                },
                {
                    'subject': 'Computer Science',
                    'year': '2024',
                    'semester': 'II',
                    'examType': 'kt',
                    'max_marks': '80',
                    'branch': 'CSE',
                    'questions': [
                        {
                            'question_number': 'Q1',
                            'question_text': 'Analyze the complexity',
                            'marks': '10',
                            'bloomLevel': 'Analyze',
                            'confidence': 0.92
                        }
                    ]
                }
            ],
            'subjectsCreated': ['Computer Science', 'Mathematics']
        }
    
    def test_sanitize_filename(self):
        """Test 1: Filename sanitization"""
        print("\n🧪 Test 1: Filename Sanitization")
        
        test_cases = [
            ('Computer Science', 'Computer Science'),
            ('CS/IT', 'CS_IT'),
            ('Math & Stats', 'Math and Stats'),
            ('Data: Analysis', 'Data_ Analysis'),
            ('Test*File?Name', 'Test_File_Name'),
        ]
        
        for input_name, expected_partial in test_cases:
            result = sanitize_filename(input_name)
            self.assert_true(
                '_' in result or 'and' in result or result == expected_partial,
                f"Sanitized '{input_name}' correctly"
            )
    
    def test_organize_exams_by_subject(self):
        """Test 2: Organize exams by subject in memory"""
        print("\n🧪 Test 2: Organize Exams by Subject")
        
        enriched_data = self.create_test_enriched_data()
        organized = organize_exams_by_subject(enriched_data)
        
        self.assert_true(
            len(organized) == 2,
            "Organized into 2 subjects"
        )
        
        self.assert_true(
            'Computer Science' in organized,
            "Computer Science subject exists"
        )
        
        self.assert_true(
            'Mathematics' in organized,
            "Mathematics subject exists"
        )
        
        self.assert_true(
            len(organized['Computer Science']) == 2,
            "Computer Science has 2 exams"
        )
        
        self.assert_true(
            len(organized['Mathematics']) == 1,
            "Mathematics has 1 exam"
        )
    
    def test_generate_exam_filename(self):
        """Test 3: Generate exam filename"""
        print("\n🧪 Test 3: Generate Exam Filename")
        
        exam = {
            'subject': 'Computer Science',
            'year': '2023',
            'semester': 'I',
            'examType': 'main'
        }
        
        filename = generate_exam_filename(exam, 0)
        
        self.assert_true(
            'Computer_Science' in filename,
            "Filename contains subject"
        )
        
        self.assert_true(
            '2023' in filename,
            "Filename contains year"
        )
        
        self.assert_true(
            filename.endswith('.json'),
            "Filename ends with .json"
        )
        
        # Test with index
        filename_with_index = generate_exam_filename(exam, 1)
        
        self.assert_true(
            '_1.json' in filename_with_index,
            "Filename with index has correct format"
        )
    
    def test_load_enriched_from_s3(self):
        """Test 4: Load enriched data from S3 (mocked)"""
        print("\n🧪 Test 4: Load Enriched Data from S3")
        
        enriched_data = self.create_test_enriched_data()
        
        with patch('organize_by_subject_job_based.s3_client') as mock_s3:
            mock_response = {
                'Body': MagicMock()
            }
            mock_response['Body'].read.return_value = json.dumps(enriched_data).encode('utf-8')
            mock_s3.get_object.return_value = mock_response
            
            result = load_enriched_from_s3('abc-123', 'test.pdf')
            
            self.assert_true(
                result is not None,
                "Successfully loaded enriched data"
            )
            
            self.assert_true(
                len(result['exams']) == 3,
                "Loaded correct number of exams"
            )
            
            self.assert_true(
                mock_s3.get_object.called,
                "S3 get_object was called"
            )
    
    def test_save_organized_to_s3(self):
        """Test 5: Save organized data to S3 (mocked)"""
        print("\n🧪 Test 5: Save Organized Data to S3")
        
        enriched_data = self.create_test_enriched_data()
        organized = organize_exams_by_subject(enriched_data)
        
        with patch('organize_by_subject_job_based.s3_client') as mock_s3:
            mock_s3.put_object.return_value = {'ResponseMetadata': {'HTTPStatusCode': 200}}
            
            metadata = save_organized_to_s3('abc-123', organized, 'test.pdf')
            
            self.assert_true(
                metadata is not None,
                "Save operation succeeded"
            )
            
            self.assert_true(
                metadata['total_subjects'] == 2,
                "Metadata has correct subject count"
            )
            
            self.assert_true(
                metadata['total_exams'] == 3,
                "Metadata has correct exam count"
            )
            
            self.assert_true(
                metadata['total_questions'] == 4,
                "Metadata has correct question count"
            )
            
            # Verify S3 calls
            call_count = mock_s3.put_object.call_count
            # Should be: 3 exam files + 2 subject indexes + 1 master index = 6
            self.assert_true(
                call_count == 6,
                f"Made correct number of S3 uploads ({call_count} calls)"
            )
    
    def test_subject_metadata_structure(self):
        """Test 6: Subject metadata structure"""
        print("\n🧪 Test 6: Subject Metadata Structure")
        
        enriched_data = self.create_test_enriched_data()
        organized = organize_exams_by_subject(enriched_data)
        
        with patch('organize_by_subject_job_based.s3_client') as mock_s3:
            mock_s3.put_object.return_value = {'ResponseMetadata': {'HTTPStatusCode': 200}}
            
            metadata = save_organized_to_s3('abc-123', organized, 'test.pdf')
            
            cs_metadata = metadata['subjects']['Computer Science']
            
            self.assert_true(
                'folder' in cs_metadata,
                "Subject metadata has folder"
            )
            
            self.assert_true(
                'exam_count' in cs_metadata,
                "Subject metadata has exam_count"
            )
            
            self.assert_true(
                'question_count' in cs_metadata,
                "Subject metadata has question_count"
            )
            
            self.assert_true(
                'years' in cs_metadata,
                "Subject metadata has years array"
            )
            
            self.assert_true(
                'files' in cs_metadata,
                "Subject metadata has files array"
            )
            
            self.assert_true(
                cs_metadata['exam_count'] == 2,
                "Computer Science has 2 exams in metadata"
            )
    
    def test_full_pipeline(self):
        """Test 7: Full organization pipeline"""
        print("\n🧪 Test 7: Full Organization Pipeline")
        
        enriched_data = self.create_test_enriched_data()
        
        with patch('organize_by_subject_job_based.load_enriched_from_s3') as mock_load:
            with patch('organize_by_subject_job_based.save_organized_to_s3') as mock_save:
                
                mock_load.return_value = enriched_data
                mock_save.return_value = {
                    'job_id': 'abc-123',
                    'total_subjects': 2,
                    'total_exams': 3,
                    'total_questions': 4,
                    'processing_cost': 0.0001
                }
                
                result = organize_by_subject_for_job('abc-123', 'test.pdf')
                
                self.assert_true(
                    result is not None,
                    "Full pipeline succeeded"
                )
                
                self.assert_true(
                    result['total_subjects'] == 2,
                    "Result has correct subject count"
                )
                
                self.assert_true(
                    mock_load.called and mock_save.called,
                    "Both load and save were called"
                )
    
    def test_empty_enriched_data(self):
        """Test 8: Handle empty enriched data"""
        print("\n🧪 Test 8: Handle Empty Enriched Data")
        
        empty_data = {
            'exams': [],
            'subjectsCreated': []
        }
        
        with patch('organize_by_subject_job_based.load_enriched_from_s3') as mock_load:
            mock_load.return_value = empty_data
            
            result = organize_by_subject_for_job('abc-123', 'test.pdf')
            
            self.assert_true(
                result is None,
                "Returns None for empty data"
            )
    
    def test_s3_load_failure(self):
        """Test 9: Handle S3 load failure"""
        print("\n🧪 Test 9: Handle S3 Load Failure")
        
        with patch('organize_by_subject_job_based.load_enriched_from_s3') as mock_load:
            mock_load.return_value = None
            
            result = organize_by_subject_for_job('abc-123', 'test.pdf')
            
            self.assert_true(
                result is None,
                "Returns None on load failure"
            )
    
    def run_all_tests(self):
        """Run all tests"""
        print("=" * 80)
        print("ORGANIZE BY SUBJECT PIPELINE TEST SUITE")
        print("=" * 80)
        
        self.test_sanitize_filename()
        self.test_organize_exams_by_subject()
        self.test_generate_exam_filename()
        self.test_load_enriched_from_s3()
        self.test_save_organized_to_s3()
        self.test_subject_metadata_structure()
        self.test_full_pipeline()
        self.test_empty_enriched_data()
        self.test_s3_load_failure()
        
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
    tester = TestOrganizeBySubject()
    exit_code = tester.run_all_tests()
    sys.exit(exit_code)
