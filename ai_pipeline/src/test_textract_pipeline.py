"""
Test Suite for AWS Textract Pipeline

This test file validates the Textract OCR pipeline functionality including:
- Textract job starting
- Result retrieval with polling
- S3 output saving
- Retry logic
- Error handling

Run with: python test_textract_pipeline.py
"""

import os
import sys
import json
import tempfile
import time
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock

# Add parent directory to path to import the pipeline
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Import functions to test
from aws_texttract_pipeline import (
    start_textract_job,
    get_textract_results,
    save_ocr_output,
    process_document_async,
    process_batch_with_retry
)


class TestTextractPipeline:
    """Test class for Textract pipeline"""
    
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
    
    def test_start_textract_job_success(self):
        """Test 1: Start Textract job successfully"""
        print("\n🧪 Test 1: Start Textract Job (Mocked Success)")
        
        with patch('aws_texttract_pipeline.textract') as mock_textract:
            mock_textract.start_document_text_detection.return_value = {
                'JobId': 'test-textract-job-123'
            }
            
            job_id = start_textract_job(
                s3_bucket='test-bucket',
                s3_key='jobs/abc/original/test.pdf',
                job_id='abc-123'
            )
            
            self.assert_true(
                job_id == 'test-textract-job-123',
                "Textract job started and returned JobId"
            )
            
            self.assert_true(
                mock_textract.start_document_text_detection.called,
                "start_document_text_detection was called"
            )
    
    def test_start_textract_job_failure(self):
        """Test 2: Handle Textract job start failure"""
        print("\n🧪 Test 2: Start Textract Job (Mocked Failure)")
        
        with patch('aws_texttract_pipeline.textract') as mock_textract:
            mock_textract.start_document_text_detection.side_effect = Exception("API Error")
            
            job_id = start_textract_job(
                s3_bucket='test-bucket',
                s3_key='jobs/abc/original/test.pdf',
                job_id='abc-123'
            )
            
            self.assert_true(
                job_id is None,
                "Returns None on failure"
            )
    
    def test_get_textract_results_immediate_success(self):
        """Test 3: Get Textract results when job completes immediately"""
        print("\n🧪 Test 3: Get Textract Results (Immediate Success)")
        
        mock_response = {
            'JobStatus': 'SUCCEEDED',
            'Blocks': [
                {
                    'BlockType': 'LINE',
                    'Text': 'Sample text line 1'
                },
                {
                    'BlockType': 'LINE',
                    'Text': 'Sample text line 2'
                },
                {
                    'BlockType': 'PAGE',
                    'Id': 'page-1'
                }
            ]
        }
        
        with patch('aws_texttract_pipeline.textract') as mock_textract:
            mock_textract.get_document_text_detection.return_value = mock_response
            
            results = get_textract_results('test-job-id', max_wait_seconds=10)
            
            self.assert_true(
                results is not None,
                "Returns results on success"
            )
            
            self.assert_true(
                results['page_count'] == 1,
                "Page count is correct"
            )
            
            self.assert_true(
                results['line_count'] == 2,
                "Line count is correct"
            )
            
            self.assert_true(
                'Sample text line 1' in results['extracted_text'],
                "Extracted text contains expected content"
            )
    
    def test_get_textract_results_with_polling(self):
        """Test 4: Get Textract results with polling (IN_PROGRESS → SUCCEEDED)"""
        print("\n🧪 Test 4: Get Textract Results (With Polling)")
        
        responses = [
            {'JobStatus': 'IN_PROGRESS'},
            {'JobStatus': 'IN_PROGRESS'},
            {
                'JobStatus': 'SUCCEEDED',
                'Blocks': [
                    {'BlockType': 'LINE', 'Text': 'Test line'},
                    {'BlockType': 'PAGE', 'Id': 'page-1'}
                ]
            }
        ]
        
        with patch('aws_texttract_pipeline.textract') as mock_textract:
            mock_textract.get_document_text_detection.side_effect = responses
            
            with patch('aws_texttract_pipeline.time.sleep'):  # Skip actual sleep
                results = get_textract_results('test-job-id', max_wait_seconds=30)
            
            self.assert_true(
                results is not None,
                "Returns results after polling"
            )
            
            self.assert_true(
                mock_textract.get_document_text_detection.call_count == 3,
                "Polled 3 times before success"
            )
    
    def test_get_textract_results_timeout(self):
        """Test 5: Handle Textract job timeout"""
        print("\n🧪 Test 5: Get Textract Results (Timeout)")
        
        with patch('aws_texttract_pipeline.textract') as mock_textract:
            mock_textract.get_document_text_detection.return_value = {
                'JobStatus': 'IN_PROGRESS'
            }
            
            with patch('aws_texttract_pipeline.time.sleep'):
                with patch('aws_texttract_pipeline.time.time') as mock_time:
                    # Simulate time passing
                    mock_time.side_effect = [0, 100, 200, 400]  # Exceeds max_wait
                    
                    results = get_textract_results('test-job-id', max_wait_seconds=300)
            
            self.assert_true(
                results is None,
                "Returns None on timeout"
            )
    
    def test_save_ocr_output(self):
        """Test 6: Save OCR output to S3"""
        print("\n🧪 Test 6: Save OCR Output to S3")
        
        test_data = {
            'extracted_text': 'Test content',
            'page_count': 5,
            'line_count': 50,
            'processing_cost': 0.0075,
            'textract_job_id': 'job-123'
        }
        
        with patch('aws_texttract_pipeline.s3_client') as mock_s3:
            mock_s3.put_object.return_value = {'ResponseMetadata': {'HTTPStatusCode': 200}}
            
            success = save_ocr_output(test_data, 'abc-123', 'test.pdf')
            
            self.assert_true(
                success is True,
                "Save operation succeeded"
            )
            
            self.assert_true(
                mock_s3.put_object.called,
                "S3 put_object was called"
            )
            
            # Check S3 key format
            call_args = mock_s3.put_object.call_args
            s3_key = call_args[1]['Key']
            
            self.assert_true(
                'jobs/abc-123/ocr_output/test_ocr.json' in s3_key,
                "S3 key has correct format"
            )
    
    def test_process_document_full_pipeline(self):
        """Test 7: Full document processing pipeline"""
        print("\n🧪 Test 7: Full Document Processing Pipeline")
        
        with patch('aws_texttract_pipeline.start_textract_job') as mock_start:
            with patch('aws_texttract_pipeline.get_textract_results') as mock_results:
                with patch('aws_texttract_pipeline.save_ocr_output') as mock_save:
                    
                    mock_start.return_value = 'textract-job-123'
                    mock_results.return_value = {
                        'extracted_text': 'Sample text',
                        'page_count': 3,
                        'line_count': 30,
                        'processing_cost': 0.0045
                    }
                    mock_save.return_value = True
                    
                    success = process_document_async(
                        s3_bucket='test-bucket',
                        s3_key='jobs/abc/original/test.pdf',
                        job_id='abc-123'
                    )
                    
                    self.assert_true(
                        success is True,
                        "Full pipeline succeeded"
                    )
                    
                    self.assert_true(
                        mock_start.called and mock_results.called and mock_save.called,
                        "All pipeline stages executed"
                    )
    
    def test_retry_logic(self):
        """Test 8: Retry logic on failures"""
        print("\n🧪 Test 8: Retry Logic")
        
        with patch('aws_texttract_pipeline.start_textract_job') as mock_start:
            with patch('aws_texttract_pipeline.get_textract_results') as mock_results:
                with patch('aws_texttract_pipeline.save_ocr_output') as mock_save:
                    with patch('aws_texttract_pipeline.time.sleep'):  # Skip delays
                        
                        # Fail first 2 times, succeed on 3rd
                        mock_start.side_effect = [None, None, 'textract-job-123']
                        mock_results.return_value = {
                            'extracted_text': 'Text',
                            'page_count': 1,
                            'line_count': 10,
                            'processing_cost': 0.0015
                        }
                        mock_save.return_value = True
                        
                        success = process_document_async(
                            s3_bucket='test-bucket',
                            s3_key='jobs/abc/original/test.pdf',
                            job_id='abc-123'
                        )
                        
                        self.assert_true(
                            success is True,
                            "Succeeded after retries"
                        )
                        
                        self.assert_true(
                            mock_start.call_count == 3,
                            "Retried 2 times (3 total attempts)"
                        )
    
    def test_max_retries_exceeded(self):
        """Test 9: Max retries exceeded"""
        print("\n🧪 Test 9: Max Retries Exceeded")
        
        with patch('aws_texttract_pipeline.start_textract_job') as mock_start:
            with patch('aws_texttract_pipeline.time.sleep'):
                
                # Always fail
                mock_start.return_value = None
                
                success = process_document_async(
                    s3_bucket='test-bucket',
                    s3_key='jobs/abc/original/test.pdf',
                    job_id='abc-123'
                )
                
                self.assert_true(
                    success is False,
                    "Returns False when max retries exceeded"
                )
                
                self.assert_true(
                    mock_start.call_count == 4,  # Initial + 3 retries
                    "Attempted MAX_RETRIES + 1 times"
                )
    
    def test_batch_processing_all_success(self):
        """Test 10: Batch processing with all files succeeding"""
        print("\n🧪 Test 10: Batch Processing - All Success")
        
        with patch('aws_texttract_pipeline.process_document_async') as mock_process:
            mock_process.return_value = True
            
            files = [
                ('bucket', 'jobs/job1/original/file1.pdf', 'job1'),
                ('bucket', 'jobs/job1/original/file2.pdf', 'job1'),
                ('bucket', 'jobs/job1/original/file3.pdf', 'job1'),
            ]
            
            result = process_batch_with_retry(files)
            
            self.assert_true(
                result['total_files'] == 3,
                "Processed 3 files"
            )
            
            self.assert_true(
                result['successful'] == 3,
                "All 3 files succeeded"
            )
            
            self.assert_true(
                result['failed'] == 0,
                "No failures"
            )
            
            self.assert_true(
                result['success_rate'] == 100.0,
                "100% success rate"
            )
            
            self.assert_true(
                result['retry_rounds_used'] == 0,
                "No retry rounds needed"
            )
    
    def test_batch_processing_with_retries(self):
        """Test 11: Batch processing with failed files that succeed on retry"""
        print("\n🧪 Test 11: Batch Processing - With Retries")
        
        call_count = {'count': 0}
        
        def mock_process_side_effect(bucket, key, job_id):
            call_count['count'] += 1
            # Fail first 2 calls to file2.pdf, succeed on 3rd
            if 'file2.pdf' in key and call_count['count'] <= 2:
                return False
            return True
        
        with patch('aws_texttract_pipeline.process_document_async') as mock_process:
            with patch('aws_texttract_pipeline.time.sleep'):  # Skip sleep delays
                mock_process.side_effect = mock_process_side_effect
                
                files = [
                    ('bucket', 'jobs/job1/original/file1.pdf', 'job1'),
                    ('bucket', 'jobs/job1/original/file2.pdf', 'job1'),
                    ('bucket', 'jobs/job1/original/file3.pdf', 'job1'),
                ]
                
                result = process_batch_with_retry(files)
                
                self.assert_true(
                    result['successful'] == 3,
                    "All files eventually succeeded"
                )
                
                self.assert_true(
                    result['retry_rounds_used'] >= 1,
                    "Used at least 1 retry round"
                )
                
                self.assert_true(
                    result['success_rate'] == 100.0,
                    "100% final success rate"
                )
    
    def test_batch_processing_permanent_failures(self):
        """Test 12: Batch processing with permanent failures"""
        print("\n🧪 Test 12: Batch Processing - Permanent Failures")
        
        def mock_process_side_effect(bucket, key, job_id):
            # file2.pdf always fails
            if 'file2.pdf' in key:
                return False
            return True
        
        with patch('aws_texttract_pipeline.process_document_async') as mock_process:
            with patch('aws_texttract_pipeline.time.sleep'):  # Skip sleep delays
                mock_process.side_effect = mock_process_side_effect
                
                files = [
                    ('bucket', 'jobs/job1/original/file1.pdf', 'job1'),
                    ('bucket', 'jobs/job1/original/file2.pdf', 'job1'),
                    ('bucket', 'jobs/job1/original/file3.pdf', 'job1'),
                ]
                
                result = process_batch_with_retry(files)
                
                self.assert_true(
                    result['total_files'] == 3,
                    "Total 3 files"
                )
                
                self.assert_true(
                    result['successful'] == 2,
                    "2 files succeeded"
                )
                
                self.assert_true(
                    result['failed'] == 1,
                    "1 file failed permanently"
                )
                
                self.assert_true(
                    len(result['failed_files']) == 1,
                    "Failed files list has 1 entry"
                )
                
                self.assert_true(
                    result['failed_files'][0]['filename'] == 'file2.pdf',
                    "Correct file marked as failed"
                )
                
                self.assert_true(
                    result['retry_rounds_used'] == 3,
                    "Used all 3 retry rounds"
                )
    
    def test_batch_processing_empty_list(self):
        """Test 13: Batch processing with empty file list"""
        print("\n🧪 Test 13: Batch Processing - Empty List")
        
        files = []
        result = process_batch_with_retry(files)
        
        self.assert_true(
            result['total_files'] == 0,
            "No files to process"
        )
        
        self.assert_true(
            result['successful'] == 0,
            "No successful files"
        )
        
        self.assert_true(
            result['failed'] == 0,
            "No failed files"
        )
    
    def run_all_tests(self):
        """Run all tests"""
        print("=" * 80)
        print("TEXTRACT PIPELINE TEST SUITE")
        print("=" * 80)
        
        self.test_start_textract_job_success()
        self.test_start_textract_job_failure()
        self.test_get_textract_results_immediate_success()
        self.test_get_textract_results_with_polling()
        self.test_get_textract_results_timeout()
        self.test_save_ocr_output()
        self.test_process_document_full_pipeline()
        self.test_retry_logic()
        self.test_max_retries_exceeded()
        self.test_batch_processing_all_success()
        self.test_batch_processing_with_retries()
        self.test_batch_processing_permanent_failures()
        self.test_batch_processing_empty_list()
        
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
    tester = TestTextractPipeline()
    exit_code = tester.run_all_tests()
    sys.exit(exit_code)
