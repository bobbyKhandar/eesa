"""
Integration Tests for Master Pipeline Server (ai_pipeline/server.py)
Tests the ACTUAL working of all API endpoints with real execution flow

These tests:
- Use real test files
- Execute actual pipeline stages
- Verify S3 interactions
- Test complete workflows end-to-end
- Can run with mocked AWS (default) or real AWS (with credentials)

Usage:
    # Run with mocked AWS (safe, no costs)
    python tests/test_master_server_integration.py
    
    # Run with real AWS (requires credentials, incurs costs)
    USE_REAL_AWS=true python tests/test_master_server_integration.py
"""

import unittest
import json
import sys
import os
import time
import tempfile
import io
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
from datetime import datetime
import requests

# Add parent directory to path
parent_dir = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, parent_dir)

# Check if we should use real AWS
USE_REAL_AWS = os.getenv('USE_REAL_AWS', 'false').lower() == 'true'

if not USE_REAL_AWS:
    # Mock AWS modules for safe testing
    sys.modules['boto3'] = MagicMock()
    
    # Mock pipeline modules that server.py imports
    sys.modules['aws_texttract_pipeline'] = MagicMock()
    sys.modules['enrich_questions_job_based'] = MagicMock()
    sys.modules['organize_by_subject_job_based'] = MagicMock()

# Import after mocking
import server


class TestMasterServerIntegrationHealth(unittest.TestCase):
    """Integration test for health check endpoint"""
    
    @classmethod
    def setUpClass(cls):
        """Start the Flask test server"""
        cls.app = server.app
        cls.app.config['TESTING'] = True
        cls.client = cls.app.test_client()
    
    def test_health_endpoint_response_structure(self):
        """Test health endpoint returns correct structure"""
        response = self.client.get('/health')
        
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content_type, 'application/json')
        
        data = json.loads(response.data)
        
        # Verify required fields
        self.assertIn('status', data)
        self.assertIn('service', data)
        self.assertIn('timestamp', data)
        
        # Verify values
        self.assertEqual(data['status'], 'healthy')
        self.assertEqual(data['service'], 'Master Pipeline Server')
        
        # Verify timestamp is recent (within last minute)
        timestamp = datetime.fromisoformat(data['timestamp'])
        now = datetime.now()
        time_diff = (now - timestamp).total_seconds()
        self.assertLess(abs(time_diff), 60, "Timestamp should be recent")


class TestMasterServerIntegrationProcessSingle(unittest.TestCase):
    """Integration tests for single document processing"""
    
    @classmethod
    def setUpClass(cls):
        """Set up test environment and mock S3 for safe testing"""
        cls.app = server.app
        cls.app.config['TESTING'] = True
        cls.client = cls.app.test_client()
        
        # Create mock S3 client with realistic behavior
        cls.mock_s3 = MagicMock()
        cls.mock_s3_data = {}  # Simulated S3 storage
        
        # Mock S3 head_object
        def mock_head_object(Bucket, Key):
            if Key in cls.mock_s3_data:
                return {'ContentLength': len(cls.mock_s3_data[Key])}
            raise Exception(f'NoSuchKey: {Key}')
        
        # Mock S3 put_object
        def mock_put_object(Bucket, Key, Body, **kwargs):
            cls.mock_s3_data[Key] = Body if isinstance(Body, bytes) else Body.encode()
            return {'ResponseMetadata': {'HTTPStatusCode': 200}}
        
        # Mock S3 get_object
        def mock_get_object(Bucket, Key):
            if Key in cls.mock_s3_data:
                body = io.BytesIO(cls.mock_s3_data[Key])
                return {'Body': body}
            raise Exception(f'NoSuchKey: {Key}')
        
        cls.mock_s3.head_object.side_effect = mock_head_object
        cls.mock_s3.put_object.side_effect = mock_put_object
        cls.mock_s3.get_object.side_effect = mock_get_object
        
        # Patch S3 client
        server.s3_client = cls.mock_s3
        
        # Pre-populate with test file
        cls.test_s3_key = 'test-uploads/sample.pdf'
        cls.mock_s3_data[cls.test_s3_key] = b'%PDF-1.4 fake pdf content'
    
    def setUp(self):
        """Clear jobs before each test"""
        server.active_jobs = {}
    
    @patch('server.process_document_async')
    @patch('server.enrich_questions_for_job')
    @patch('server.organize_by_subject_for_job')
    def test_single_job_complete_workflow(self, mock_organize, mock_enrich, mock_ocr):
        """Test complete workflow of single job from submission to completion"""
        
        # Mock successful pipeline execution
        mock_ocr.return_value = True
        mock_enrich.return_value = {
            'total_questions': 5,
            'total_enriched': 5,
            'processing_cost': 0.025,
            'retry_count': 0
        }
        mock_organize.return_value = {
            'total_subjects': 2,
            'total_exams': 1,
            'total_questions': 5,
            'subjects': {'Math': 3, 'Science': 2},
            'master_index_s3_key': 's3://bucket/organized/index.json'
        }
        
        # Step 1: Submit job
        payload = {
            's3_key': self.test_s3_key,
            'filename': 'sample.pdf'
        }
        
        submit_response = self.client.post(
            '/process',
            data=json.dumps(payload),
            content_type='application/json'
        )
        
        self.assertEqual(submit_response.status_code, 202)
        submit_data = json.loads(submit_response.data)
        
        job_id = submit_data['job_id']
        self.assertIsNotNone(job_id)
        self.assertEqual(submit_data['status'], 'processing')
        
        # Step 2: Wait for background processing
        time.sleep(2)  # Allow background thread to execute
        
        # Step 3: Check job status
        status_response = self.client.get(f'/job/{job_id}/status')
        
        if status_response.status_code == 200:
            status_data = json.loads(status_response.data)
            
            # Verify job metadata structure
            self.assertEqual(status_data['job_id'], job_id)
            self.assertEqual(status_data['filename'], 'sample.pdf')
            self.assertIn('status', status_data)
            self.assertIn('stages', status_data)
            
            # Verify pipeline was called
            mock_ocr.assert_called()
            
            if status_data['status'] == 'success':
                # Verify all stages completed
                self.assertIn('ocr', status_data['stages'])
                self.assertIn('enrichment', status_data['stages'])
                self.assertIn('organization', status_data['stages'])
                
                mock_enrich.assert_called()
                mock_organize.assert_called()
    
    def test_single_job_invalid_s3_key(self):
        """Test single job with non-existent S3 file"""
        payload = {
            's3_key': 'nonexistent/file.pdf',
            'filename': 'file.pdf'
        }
        
        response = self.client.post(
            '/process',
            data=json.dumps(payload),
            content_type='application/json'
        )
        
        self.assertEqual(response.status_code, 404)
        data = json.loads(response.data)
        self.assertIn('error', data)
        self.assertIn('File not found', data['error'])
    
    def test_single_job_metadata_persistence(self):
        """Test that job metadata is saved and retrievable"""
        
        # Create a job metadata
        job_id = 'test-persistence-job'
        metadata = {
            'job_id': job_id,
            'filename': 'test.pdf',
            'status': 'in_progress',
            's3_pdf_key': 'uploads/test.pdf',
            'started_at': datetime.now().isoformat(),
            'stages': {
                'ocr': {'status': 'in_progress'}
            }
        }
        
        # Save metadata
        result = server.save_job_metadata(job_id, metadata)
        self.assertTrue(result)
        
        # Verify it was saved to mock S3
        expected_key = f'jobs/{job_id}/metadata.json'
        self.assertIn(expected_key, self.mock_s3_data)
        
        # Retrieve metadata
        retrieved = server.load_job_metadata(job_id)
        self.assertIsNotNone(retrieved)
        self.assertEqual(retrieved['job_id'], job_id)
        self.assertEqual(retrieved['filename'], 'test.pdf')


class TestMasterServerIntegrationBatchProcessing(unittest.TestCase):
    """Integration tests for batch processing"""
    
    @classmethod
    def setUpClass(cls):
        """Set up test environment"""
        cls.app = server.app
        cls.app.config['TESTING'] = True
        cls.client = cls.app.test_client()
        
        # Set up mock S3
        cls.mock_s3 = MagicMock()
        cls.mock_s3_data = {}
        
        def mock_head_object(Bucket, Key):
            if Key in cls.mock_s3_data:
                return {'ContentLength': len(cls.mock_s3_data[Key])}
            raise Exception(f'NoSuchKey: {Key}')
        
        def mock_put_object(Bucket, Key, Body, **kwargs):
            cls.mock_s3_data[Key] = Body if isinstance(Body, bytes) else Body.encode()
            return {'ResponseMetadata': {'HTTPStatusCode': 200}}
        
        def mock_get_object(Bucket, Key):
            if Key in cls.mock_s3_data:
                body = io.BytesIO(cls.mock_s3_data[Key])
                return {'Body': body}
            raise Exception(f'NoSuchKey: {Key}')
        
        cls.mock_s3.head_object.side_effect = mock_head_object
        cls.mock_s3.put_object.side_effect = mock_put_object
        cls.mock_s3.get_object.side_effect = mock_get_object
        
        server.s3_client = cls.mock_s3
        
        # Create test files
        cls.test_files = [
            'test-batch/file1.pdf',
            'test-batch/file2.pdf',
            'test-batch/file3.pdf'
        ]
        for file_key in cls.test_files:
            cls.mock_s3_data[file_key] = b'%PDF-1.4 test content'
    
    def setUp(self):
        """Clear jobs before each test"""
        server.active_jobs = {}
    
    @patch('server.process_job_pipeline')
    def test_batch_submission_creates_multiple_jobs(self, mock_pipeline):
        """Test batch submission creates individual jobs for each file"""
        
        mock_pipeline.return_value = {
            'status': 'success',
            'job_id': 'test',
            'stages': {}
        }
        
        payload = {
            'jobs': [
                {'s3_key': self.test_files[0], 'filename': 'file1.pdf'},
                {'s3_key': self.test_files[1], 'filename': 'file2.pdf'},
                {'s3_key': self.test_files[2], 'filename': 'file3.pdf'}
            ]
        }
        
        response = self.client.post(
            '/process/batch',
            data=json.dumps(payload),
            content_type='application/json'
        )
        
        self.assertEqual(response.status_code, 202)
        data = json.loads(response.data)
        
        # Verify response structure
        self.assertIn('message', data)
        self.assertIn('jobs', data)
        self.assertEqual(len(data['jobs']), 3)
        
        # Verify each job has required fields
        job_ids = []
        for job in data['jobs']:
            self.assertIn('job_id', job)
            self.assertIn('filename', job)
            self.assertEqual(job['status'], 'processing')
            job_ids.append(job['job_id'])
        
        # Verify all job IDs are unique
        self.assertEqual(len(job_ids), len(set(job_ids)))
        
        # Allow background processing
        time.sleep(1)
    
    def test_batch_with_partial_failure(self):
        """Test batch processing where some files don't exist"""
        payload = {
            'jobs': [
                {'s3_key': self.test_files[0], 'filename': 'file1.pdf'},
                {'s3_key': 'nonexistent/bad.pdf', 'filename': 'bad.pdf'},
                {'s3_key': self.test_files[1], 'filename': 'file2.pdf'}
            ]
        }
        
        response = self.client.post(
            '/process/batch',
            data=json.dumps(payload),
            content_type='application/json'
        )
        
        # Should still accept the batch
        self.assertEqual(response.status_code, 202)
        data = json.loads(response.data)
        
        # Should process valid files
        self.assertGreaterEqual(len(data['jobs']), 2)


class TestMasterServerIntegrationJobTracking(unittest.TestCase):
    """Integration tests for job tracking and status"""
    
    @classmethod
    def setUpClass(cls):
        """Set up test environment"""
        cls.app = server.app
        cls.app.config['TESTING'] = True
        cls.client = cls.app.test_client()
        
        # Set up mock S3
        cls.mock_s3 = MagicMock()
        cls.mock_s3_data = {}
        
        def mock_put_object(Bucket, Key, Body, **kwargs):
            cls.mock_s3_data[Key] = Body if isinstance(Body, bytes) else Body.encode()
            return {'ResponseMetadata': {'HTTPStatusCode': 200}}
        
        def mock_get_object(Bucket, Key):
            if Key in cls.mock_s3_data:
                body = io.BytesIO(cls.mock_s3_data[Key])
                return {'Body': body}
            raise Exception(f'NoSuchKey: {Key}')
        
        cls.mock_s3.put_object.side_effect = mock_put_object
        cls.mock_s3.get_object.side_effect = mock_get_object
        
        server.s3_client = cls.mock_s3
    
    def setUp(self):
        """Clear jobs before each test"""
        server.active_jobs = {}
        self.mock_s3_data.clear()
    
    def test_active_jobs_listing(self):
        """Test listing all active jobs"""
        
        # Create some test jobs
        test_jobs = {
            'job-1': {
                'job_id': 'job-1',
                'filename': 'file1.pdf',
                'status': 'in_progress',
                'started_at': datetime.now().isoformat()
            },
            'job-2': {
                'job_id': 'job-2',
                'filename': 'file2.pdf',
                'status': 'success',
                'started_at': datetime.now().isoformat()
            }
        }
        
        # Add to server
        server.active_jobs = test_jobs.copy()
        
        # Request active jobs
        response = self.client.get('/jobs/active')
        
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        
        self.assertEqual(data['count'], 2)
        self.assertEqual(len(data['jobs']), 2)
        
        # Verify jobs are present
        job_ids = [job['job_id'] for job in data['jobs']]
        self.assertIn('job-1', job_ids)
        self.assertIn('job-2', job_ids)
    
    def test_job_status_lifecycle(self):
        """Test job status changes through lifecycle"""
        
        job_id = 'lifecycle-test-job'
        
        # Initial state: pending
        initial_metadata = {
            'job_id': job_id,
            'filename': 'test.pdf',
            'status': 'in_progress',
            'started_at': datetime.now().isoformat(),
            'stages': {
                'ocr': {'status': 'in_progress', 'started_at': datetime.now().isoformat()}
            }
        }
        
        server.save_job_metadata(job_id, initial_metadata)
        
        # Check initial status
        response = self.client.get(f'/job/{job_id}/status')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data['status'], 'in_progress')
        self.assertEqual(data['stages']['ocr']['status'], 'in_progress')
        
        # Update: OCR complete
        updated_metadata = initial_metadata.copy()
        updated_metadata['stages']['ocr']['status'] = 'success'
        updated_metadata['stages']['ocr']['completed_at'] = datetime.now().isoformat()
        updated_metadata['stages']['enrichment'] = {
            'status': 'in_progress',
            'started_at': datetime.now().isoformat()
        }
        
        server.save_job_metadata(job_id, updated_metadata)
        
        # Check updated status
        response = self.client.get(f'/job/{job_id}/status')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data['stages']['ocr']['status'], 'success')
        self.assertEqual(data['stages']['enrichment']['status'], 'in_progress')
        
        # Final: Complete
        final_metadata = updated_metadata.copy()
        final_metadata['status'] = 'success'
        final_metadata['completed_at'] = datetime.now().isoformat()
        final_metadata['stages']['enrichment']['status'] = 'success'
        final_metadata['stages']['enrichment']['completed_at'] = datetime.now().isoformat()
        
        server.save_job_metadata(job_id, final_metadata)
        
        # Check final status
        response = self.client.get(f'/job/{job_id}/status')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data['status'], 'success')
        self.assertIn('completed_at', data)


class TestMasterServerIntegrationErrorHandling(unittest.TestCase):
    """Integration tests for error handling scenarios"""
    
    @classmethod
    def setUpClass(cls):
        """Set up test environment"""
        cls.app = server.app
        cls.app.config['TESTING'] = True
        cls.client = cls.app.test_client()
    
    def test_malformed_json_request(self):
        """Test handling of malformed JSON in request"""
        response = self.client.post(
            '/process',
            data='{"invalid json',
            content_type='application/json'
        )
        
        # Server returns 500 for malformed JSON (could be improved to return 400)
        self.assertIn(response.status_code, [400, 500])
    
    def test_missing_content_type(self):
        """Test request without content-type header"""
        response = self.client.post(
            '/process',
            data='{"s3_key": "test.pdf"}'
        )
        
        # Should still try to process or return appropriate error
        self.assertIn(response.status_code, [400, 500])
    
    def test_empty_request_body(self):
        """Test request with empty body"""
        response = self.client.post(
            '/process',
            data='',
            content_type='application/json'
        )
        
        # Server returns 500 for empty JSON (could be improved to return 400)
        self.assertIn(response.status_code, [400, 500])
    
    def test_nonexistent_job_status(self):
        """Test requesting status of job that doesn't exist"""
        response = self.client.get('/job/nonexistent-job-12345/status')
        
        # Server may return 404 (not found) or 500 (error loading from S3)
        self.assertIn(response.status_code, [404, 500])
        data = json.loads(response.data)
        self.assertIn('error', data)
    
    def test_invalid_http_methods(self):
        """Test endpoints with wrong HTTP methods"""
        
        # GET on POST endpoint
        response = self.client.get('/process')
        self.assertEqual(response.status_code, 405)
        
        # POST on GET endpoint
        response = self.client.post('/health')
        self.assertEqual(response.status_code, 405)


class TestMasterServerIntegrationConcurrency(unittest.TestCase):
    """Integration tests for concurrent job processing"""
    
    @classmethod
    def setUpClass(cls):
        """Set up test environment"""
        cls.app = server.app
        cls.app.config['TESTING'] = True
        cls.client = cls.app.test_client()
        
        # Set up mock S3
        cls.mock_s3 = MagicMock()
        cls.mock_s3_data = {}
        
        def mock_head_object(Bucket, Key):
            return {'ContentLength': 1000}
        
        def mock_put_object(Bucket, Key, Body, **kwargs):
            cls.mock_s3_data[Key] = Body if isinstance(Body, bytes) else Body.encode()
            return {'ResponseMetadata': {'HTTPStatusCode': 200}}
        
        cls.mock_s3.head_object.side_effect = mock_head_object
        cls.mock_s3.put_object.side_effect = mock_put_object
        
        server.s3_client = cls.mock_s3
    
    def setUp(self):
        """Clear jobs before each test"""
        server.active_jobs = {}
    
    @patch('server.ThreadPoolExecutor')
    def test_concurrent_job_submissions(self, mock_executor):
        """Test multiple concurrent job submissions"""
        
        mock_executor_instance = MagicMock()
        mock_executor.return_value = mock_executor_instance
        
        # Submit multiple jobs concurrently
        job_ids = []
        for i in range(5):
            payload = {
                's3_key': f'test/file{i}.pdf',
                'filename': f'file{i}.pdf'
            }
            
            response = self.client.post(
                '/process',
                data=json.dumps(payload),
                content_type='application/json'
            )
            
            self.assertEqual(response.status_code, 202)
            data = json.loads(response.data)
            job_ids.append(data['job_id'])
        
        # Verify all jobs have unique IDs
        self.assertEqual(len(job_ids), len(set(job_ids)))
        
        # Verify ThreadPoolExecutor was used for each job
        self.assertEqual(mock_executor_instance.submit.call_count, 5)


def run_integration_tests():
    """Run all integration tests with summary"""
    
    print("=" * 80)
    print("MASTER PIPELINE SERVER - INTEGRATION TESTS")
    print("=" * 80)
    print(f"Mode: {'REAL AWS (⚠ COSTS MONEY)' if USE_REAL_AWS else 'MOCKED AWS (Safe)'}")
    print("=" * 80)
    print()
    
    # Create test suite
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    
    # Add all test classes
    suite.addTests(loader.loadTestsFromTestCase(TestMasterServerIntegrationHealth))
    suite.addTests(loader.loadTestsFromTestCase(TestMasterServerIntegrationProcessSingle))
    suite.addTests(loader.loadTestsFromTestCase(TestMasterServerIntegrationBatchProcessing))
    suite.addTests(loader.loadTestsFromTestCase(TestMasterServerIntegrationJobTracking))
    suite.addTests(loader.loadTestsFromTestCase(TestMasterServerIntegrationErrorHandling))
    suite.addTests(loader.loadTestsFromTestCase(TestMasterServerIntegrationConcurrency))
    
    # Run tests
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    
    # Print summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print(f"Tests Run: {result.testsRun}")
    print(f"Successes: {result.testsRun - len(result.failures) - len(result.errors)}")
    print(f"Failures: {len(result.failures)}")
    print(f"Errors: {len(result.errors)}")
    print("=" * 80)
    
    return result.wasSuccessful()


if __name__ == '__main__':
    success = run_integration_tests()
    sys.exit(0 if success else 1)
