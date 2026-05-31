"""
Unit tests for Master Pipeline Server (ai_pipeline/server.py)
Tests API endpoints for AWS Textract + Bedrock pipeline orchestration

Endpoints tested:
- GET /health
- POST /process
- POST /process/batch
- GET /job/<job_id>/status
- GET /job/<job_id>/metadata
- GET /jobs/active
"""

import unittest
import json
import sys
import os
from unittest.mock import Mock, patch, MagicMock, call
from datetime import datetime

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

# Mock AWS modules before importing server
sys.modules['boto3'] = MagicMock()
sys.modules['aws_texttract_pipeline'] = MagicMock()
sys.modules['enrich_questions_job_based'] = MagicMock()
sys.modules['organize_by_subject_job_based'] = MagicMock()


class TestMasterServerHealth(unittest.TestCase):
    """Test health check endpoint"""
    
    @patch.dict(os.environ, {'S3_BUCKET': 'test-bucket', 'MAX_CONCURRENT_JOBS': '5'})
    def setUp(self):
        """Set up test Flask app"""
        import server
        self.app = server.app
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()
    
    def test_health_check_success(self):
        """Test health check returns healthy status"""
        response = self.client.get('/health')
        
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        
        self.assertEqual(data['status'], 'healthy')
        self.assertEqual(data['service'], 'Master Pipeline Server')
        self.assertIn('timestamp', data)


class TestMasterServerProcessSingle(unittest.TestCase):
    """Test single document processing endpoint"""
    
    @patch('server.process_job_pipeline')
    @patch('server.ThreadPoolExecutor')
    @patch('server.s3_client')
    @patch.dict(os.environ, {'S3_BUCKET': 'test-bucket'})
    def setUp(self, mock_s3, mock_executor, mock_process):
        """Set up test Flask app with mocks"""
        import server
        self.app = server.app
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()
        self.mock_s3 = mock_s3
        self.mock_executor = mock_executor
        self.mock_process = mock_process
    
    @patch('server.s3_client')
    @patch('server.ThreadPoolExecutor')
    def test_process_single_job_success(self, mock_executor, mock_s3):
        """Test successful single job submission"""
        # Mock S3 head_object to verify file exists
        mock_s3.head_object.return_value = {'ContentLength': 1000}
        
        # Mock executor
        mock_future = Mock()
        mock_executor_instance = Mock()
        mock_executor_instance.submit.return_value = mock_future
        mock_executor.return_value = mock_executor_instance
        
        payload = {
            's3_key': 'uploads/test.pdf',
            'filename': 'test.pdf'
        }
        
        response = self.client.post(
            '/process',
            data=json.dumps(payload),
            content_type='application/json'
        )
        
        self.assertEqual(response.status_code, 202)
        data = json.loads(response.data)
        
        self.assertIn('job_id', data)
        self.assertEqual(data['status'], 'processing')
        self.assertEqual(data['message'], 'Job started successfully')
        self.assertEqual(data['s3_key'], 'uploads/test.pdf')
        self.assertEqual(data['filename'], 'test.pdf')
        
        # Verify S3 was checked
        mock_s3.head_object.assert_called_once()
    
    def test_process_missing_s3_key(self):
        """Test process endpoint with missing s3_key"""
        payload = {
            'filename': 'test.pdf'
        }
        
        response = self.client.post(
            '/process',
            data=json.dumps(payload),
            content_type='application/json'
        )
        
        self.assertEqual(response.status_code, 400)
        data = json.loads(response.data)
        self.assertIn('error', data)
        self.assertIn('Missing s3_key', data['error'])
    
    @patch('server.s3_client')
    def test_process_file_not_found(self, mock_s3):
        """Test process endpoint when file doesn't exist in S3"""
        # Mock S3 to raise exception
        mock_s3.head_object.side_effect = Exception('File not found')
        
        payload = {
            's3_key': 'uploads/nonexistent.pdf',
            'filename': 'nonexistent.pdf'
        }
        
        response = self.client.post(
            '/process',
            data=json.dumps(payload),
            content_type='application/json'
        )
        
        self.assertEqual(response.status_code, 404)
        data = json.loads(response.data)
        self.assertIn('error', data)
        self.assertIn('File not found in S3', data['error'])
    
    @patch('server.s3_client')
    @patch('server.ThreadPoolExecutor')
    def test_process_custom_job_id(self, mock_executor, mock_s3):
        """Test process with custom job_id"""
        mock_s3.head_object.return_value = {'ContentLength': 1000}
        mock_executor_instance = Mock()
        mock_executor.return_value = mock_executor_instance
        
        payload = {
            's3_key': 'uploads/test.pdf',
            'filename': 'test.pdf',
            'job_id': 'custom-job-123'
        }
        
        response = self.client.post(
            '/process',
            data=json.dumps(payload),
            content_type='application/json'
        )
        
        self.assertEqual(response.status_code, 202)
        data = json.loads(response.data)
        self.assertEqual(data['job_id'], 'custom-job-123')


class TestMasterServerProcessBatch(unittest.TestCase):
    """Test batch document processing endpoint"""
    
    @patch('server.ThreadPoolExecutor')
    @patch('server.s3_client')
    @patch.dict(os.environ, {'S3_BUCKET': 'test-bucket', 'MAX_CONCURRENT_JOBS': '10'})
    def setUp(self, mock_s3, mock_executor):
        """Set up test Flask app"""
        import server
        self.app = server.app
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()
    
    @patch('server.ThreadPoolExecutor')
    def test_batch_process_success(self, mock_executor):
        """Test successful batch job submission"""
        mock_executor_instance = Mock()
        mock_executor.return_value.__enter__ = Mock(return_value=mock_executor_instance)
        mock_executor.return_value.__exit__ = Mock(return_value=False)
        
        payload = {
            'jobs': [
                {'s3_key': 'uploads/file1.pdf', 'filename': 'file1.pdf'},
                {'s3_key': 'uploads/file2.pdf', 'filename': 'file2.pdf'},
                {'s3_key': 'uploads/file3.pdf', 'filename': 'file3.pdf'}
            ]
        }
        
        response = self.client.post(
            '/process/batch',
            data=json.dumps(payload),
            content_type='application/json'
        )
        
        self.assertEqual(response.status_code, 202)
        data = json.loads(response.data)
        
        self.assertIn('message', data)
        self.assertIn('3 jobs', data['message'])
        self.assertEqual(len(data['jobs']), 3)
        
        # Verify all jobs have IDs and are processing
        for job in data['jobs']:
            self.assertIn('job_id', job)
            self.assertIn('filename', job)
            self.assertEqual(job['status'], 'processing')
    
    def test_batch_process_missing_jobs(self):
        """Test batch endpoint with missing jobs array"""
        payload = {}
        
        response = self.client.post(
            '/process/batch',
            data=json.dumps(payload),
            content_type='application/json'
        )
        
        self.assertEqual(response.status_code, 400)
        data = json.loads(response.data)
        self.assertIn('error', data)
        self.assertIn('Missing or invalid jobs array', data['error'])
    
    def test_batch_process_invalid_jobs(self):
        """Test batch endpoint with invalid jobs format"""
        payload = {
            'jobs': 'not-an-array'
        }
        
        response = self.client.post(
            '/process/batch',
            data=json.dumps(payload),
            content_type='application/json'
        )
        
        self.assertEqual(response.status_code, 400)
        data = json.loads(response.data)
        self.assertIn('error', data)
    
    def test_batch_process_empty_jobs(self):
        """Test batch endpoint with empty jobs array"""
        payload = {
            'jobs': []
        }
        
        response = self.client.post(
            '/process/batch',
            data=json.dumps(payload),
            content_type='application/json'
        )
        
        self.assertEqual(response.status_code, 400)
        data = json.loads(response.data)
        self.assertIn('error', data)
        # Empty array is treated as missing/invalid jobs array
        self.assertTrue('jobs' in data['error'].lower() or 'No valid jobs' in data['error'])
    
    @patch('server.ThreadPoolExecutor')
    def test_batch_process_custom_bucket(self, mock_executor):
        """Test batch processing with custom S3 bucket"""
        mock_executor_instance = Mock()
        mock_executor.return_value.__enter__ = Mock(return_value=mock_executor_instance)
        mock_executor.return_value.__exit__ = Mock(return_value=False)
        
        payload = {
            's3_bucket': 'custom-bucket',
            'jobs': [
                {'s3_key': 'uploads/file1.pdf', 'filename': 'file1.pdf'}
            ]
        }
        
        response = self.client.post(
            '/process/batch',
            data=json.dumps(payload),
            content_type='application/json'
        )
        
        self.assertEqual(response.status_code, 202)


class TestMasterServerJobStatus(unittest.TestCase):
    """Test job status endpoints"""
    
    @patch.dict(os.environ, {'S3_BUCKET': 'test-bucket'})
    def setUp(self):
        """Set up test Flask app"""
        import server
        self.app = server.app
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()
        
        # Clear active jobs
        server.active_jobs = {}
    
    @patch('server.load_job_metadata')
    def test_get_job_status_success(self, mock_load):
        """Test getting status of an existing job"""
        mock_metadata = {
            'job_id': 'test-job-123',
            'filename': 'test.pdf',
            'status': 'success',
            'stages': {
                'ocr': {'status': 'success'},
                'enrichment': {'status': 'success'}
            }
        }
        mock_load.return_value = mock_metadata
        
        response = self.client.get('/job/test-job-123/status')
        
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        
        self.assertEqual(data['job_id'], 'test-job-123')
        self.assertEqual(data['status'], 'success')
        self.assertIn('stages', data)
        
        mock_load.assert_called_once_with('test-job-123')
    
    @patch('server.load_job_metadata')
    def test_get_job_status_not_found(self, mock_load):
        """Test getting status of non-existent job"""
        mock_load.return_value = None
        
        response = self.client.get('/job/nonexistent-job/status')
        
        self.assertEqual(response.status_code, 404)
        data = json.loads(response.data)
        self.assertIn('error', data)
        self.assertIn('Job not found', data['error'])
    
    @patch('server.load_job_metadata')
    def test_get_job_metadata(self, mock_load):
        """Test getting complete job metadata"""
        mock_metadata = {
            'job_id': 'test-job-456',
            'filename': 'document.pdf',
            'status': 'in_progress',
            'started_at': '2026-01-02T10:00:00',
            'stages': {
                'ocr': {'status': 'success', 'completed_at': '2026-01-02T10:05:00'},
                'enrichment': {'status': 'in_progress'}
            }
        }
        mock_load.return_value = mock_metadata
        
        response = self.client.get('/job/test-job-456/metadata')
        
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        
        self.assertEqual(data['job_id'], 'test-job-456')
        self.assertEqual(data['status'], 'in_progress')
        self.assertIn('started_at', data)


class TestMasterServerActiveJobs(unittest.TestCase):
    """Test active jobs listing endpoint"""
    
    @patch.dict(os.environ, {'S3_BUCKET': 'test-bucket'})
    def setUp(self):
        """Set up test Flask app"""
        import server
        self.app = server.app
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()
        self.server = server
    
    def test_get_active_jobs_empty(self):
        """Test getting active jobs when none exist"""
        self.server.active_jobs = {}
        
        response = self.client.get('/jobs/active')
        
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        
        self.assertEqual(data['count'], 0)
        self.assertEqual(len(data['jobs']), 0)
    
    def test_get_active_jobs_with_data(self):
        """Test getting active jobs with existing jobs"""
        self.server.active_jobs = {
            'job-1': {
                'job_id': 'job-1',
                'filename': 'file1.pdf',
                'status': 'in_progress'
            },
            'job-2': {
                'job_id': 'job-2',
                'filename': 'file2.pdf',
                'status': 'success'
            }
        }
        
        response = self.client.get('/jobs/active')
        
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        
        self.assertEqual(data['count'], 2)
        self.assertEqual(len(data['jobs']), 2)
        
        # Verify job data
        job_ids = [job['job_id'] for job in data['jobs']]
        self.assertIn('job-1', job_ids)
        self.assertIn('job-2', job_ids)


class TestMasterServerJobMetadataOperations(unittest.TestCase):
    """Test job metadata save/load operations"""
    
    @patch('server.s3_client')
    @patch.dict(os.environ, {'S3_BUCKET': 'test-bucket'})
    def setUp(self, mock_s3):
        """Set up test environment"""
        import server
        self.server = server
        self.mock_s3 = mock_s3
        
        # Clear active jobs
        self.server.active_jobs = {}
    
    @patch('server.s3_client')
    def test_save_job_metadata_success(self, mock_s3):
        """Test saving job metadata to S3"""
        mock_s3.put_object.return_value = {'ResponseMetadata': {'HTTPStatusCode': 200}}
        
        metadata = {
            'job_id': 'test-job',
            'filename': 'test.pdf',
            'status': 'processing'
        }
        
        result = self.server.save_job_metadata('test-job', metadata)
        
        self.assertTrue(result)
        mock_s3.put_object.assert_called_once()
        
        # Verify metadata is cached
        self.assertIn('test-job', self.server.active_jobs)
        self.assertEqual(self.server.active_jobs['test-job']['filename'], 'test.pdf')
    
    @patch('server.s3_client')
    def test_save_job_metadata_failure(self, mock_s3):
        """Test saving job metadata when S3 fails"""
        mock_s3.put_object.side_effect = Exception('S3 error')
        
        metadata = {'job_id': 'test-job', 'status': 'processing'}
        result = self.server.save_job_metadata('test-job', metadata)
        
        self.assertFalse(result)
    
    @patch('server.s3_client')
    def test_load_job_metadata_from_cache(self, mock_s3):
        """Test loading job metadata from cache"""
        self.server.active_jobs = {
            'cached-job': {
                'job_id': 'cached-job',
                'filename': 'cached.pdf',
                'status': 'success'
            }
        }
        
        metadata = self.server.load_job_metadata('cached-job')
        
        self.assertIsNotNone(metadata)
        self.assertEqual(metadata['job_id'], 'cached-job')
        
        # S3 should not be called
        mock_s3.get_object.assert_not_called()
    
    @patch('server.s3_client')
    def test_load_job_metadata_from_s3(self, mock_s3):
        """Test loading job metadata from S3 when not cached"""
        mock_metadata = {
            'job_id': 's3-job',
            'filename': 'from-s3.pdf',
            'status': 'completed'
        }
        
        mock_response = {
            'Body': Mock()
        }
        mock_response['Body'].read.return_value = json.dumps(mock_metadata).encode('utf-8')
        mock_s3.get_object.return_value = mock_response
        
        metadata = self.server.load_job_metadata('s3-job')
        
        self.assertIsNotNone(metadata)
        self.assertEqual(metadata['job_id'], 's3-job')
        
        # Verify S3 was called
        mock_s3.get_object.assert_called_once()
        
        # Verify metadata is now cached
        self.assertIn('s3-job', self.server.active_jobs)
    
    @patch('server.s3_client')
    def test_load_job_metadata_not_found(self, mock_s3):
        """Test loading non-existent job metadata"""
        mock_s3.get_object.side_effect = Exception('NoSuchKey')
        
        metadata = self.server.load_job_metadata('nonexistent-job')
        
        self.assertIsNone(metadata)


class TestMasterServerPipelineWorkflow(unittest.TestCase):
    """Test the complete pipeline workflow"""
    
    @patch('server.organize_by_subject_for_job')
    @patch('server.enrich_questions_for_job')
    @patch('server.process_document_async')
    @patch('server.save_job_metadata')
    @patch.dict(os.environ, {'S3_BUCKET': 'test-bucket'})
    def test_process_job_pipeline_success(
        self,
        mock_save,
        mock_ocr,
        mock_enrich,
        mock_organize
    ):
        """Test successful execution of complete pipeline"""
        import server
        
        # Mock successful pipeline stages
        mock_ocr.return_value = True
        mock_enrich.return_value = {
            'total_questions': 10,
            'total_enriched': 10,
            'processing_cost': 0.05,
            'retry_count': 0
        }
        mock_organize.return_value = {
            'total_subjects': 3,
            'total_exams': 1,
            'total_questions': 10,
            'subjects': {'Math': 5, 'Science': 5},
            'master_index_s3_key': 's3://bucket/index.json'
        }
        mock_save.return_value = True
        
        result = server.process_job_pipeline('test-job', 'uploads/test.pdf', 'test.pdf')
        
        self.assertEqual(result['status'], 'success')
        self.assertIn('completed_at', result)
        
        # Verify all stages were called
        mock_ocr.assert_called_once()
        mock_enrich.assert_called_once()
        mock_organize.assert_called_once()
    
    @patch('server.process_document_async')
    @patch('server.save_job_metadata')
    @patch.dict(os.environ, {'S3_BUCKET': 'test-bucket'})
    def test_process_job_pipeline_ocr_failure(self, mock_save, mock_ocr):
        """Test pipeline when OCR fails"""
        import server
        
        mock_ocr.return_value = False
        mock_save.return_value = True
        
        result = server.process_job_pipeline('test-job', 'uploads/test.pdf', 'test.pdf')
        
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['failed_stage'], 'ocr')
        self.assertIn('error', result)


if __name__ == '__main__':
    # Run tests with verbose output
    unittest.main(verbosity=2)
