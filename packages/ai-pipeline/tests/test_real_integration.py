"""
REAL Integration Tests for Master Pipeline Server
===================================================
These tests ACTUALLY execute the full pipeline with real files.
NO MOCKS - This tests the actual working system that the frontend will use.

[WARNING] REQUIREMENTS:
- AWS credentials configured (boto3 must work)
- Test PDF files available at paths below
- S3 bucket accessible
- Internet connection for AWS services

[NOTE] CONFIGURATION: Edit these variables before running
"""

import unittest
import json
import sys
import os
import time
from pathlib import Path
from datetime import datetime
import requests

# ============================================================================
# [CONFIG] CONFIGURATION - EDIT THESE VALUES
# ============================================================================

# Test PDF files - Put your test PDFs here
TEST_PDF_PATH = r"C:/project/miniproject/uploads/os23.pdf"
TEST_PDF_PATH_2 = r"C:/project/miniproject/uploads/os_merged.pdf"
TEST_PDF_PATH_3 = r"C:/project/miniproject/uploads/os23_merged.pdf"

# S3 Configuration
S3_BUCKET = os.getenv('S3_BUCKET', 'eesa-pipeline-storage')
S3_TEST_PREFIX = 'test-runs/'  # Where to upload test files

# Server Configuration
# IMPORTANT: This tests the ROOT server.py (Master Pipeline - AWS only)
# NOT the src/server.py (Unified server with local + AWS)
# Start with: python server.py (from ai_pipeline directory)
SERVER_HOST = 'localhost'
SERVER_PORT = 5000
SERVER_URL = f'http://{SERVER_HOST}:{SERVER_PORT}'

# Test timeouts (seconds)
HEALTH_CHECK_TIMEOUT = 5
JOB_COMPLETION_TIMEOUT = 300  # 5 minutes for OCR+enrichment
POLL_INTERVAL = 5  # Check job status every 5 seconds

# Skip tests if files don't exist
SKIP_IF_NO_FILES = True

# ============================================================================
# Helper Functions
# ============================================================================

def upload_test_file_to_s3(local_path: str, s3_key: str) -> bool:
    """Upload a local test file to S3"""
    try:
        import boto3
        s3_client = boto3.client('s3')
        
        with open(local_path, 'rb') as f:
            s3_client.put_object(
                Bucket=S3_BUCKET,
                Key=s3_key,
                Body=f,
                ContentType='application/pdf'
            )
        print(f"[+] Uploaded {local_path} to s3://{S3_BUCKET}/{s3_key}")
        return True
    except Exception as e:
        print(f"[-] Failed to upload {local_path}: {e}")
        return False


def file_exists(path: str) -> bool:
    """Check if test file exists"""
    return Path(path).exists()


def wait_for_job_completion(job_id: str, timeout: int = JOB_COMPLETION_TIMEOUT) -> dict:
    """Poll job status until completion or timeout"""
    start_time = time.time()
    
    while time.time() - start_time < timeout:
        try:
            response = requests.get(f'{SERVER_URL}/job/{job_id}/status', timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                status = data.get('status')
                
                if status in ['success', 'failed', 'partial_success']:
                    return data
                    
            time.sleep(POLL_INTERVAL)
            
        except Exception as e:
            print(f"Warning: Error polling job status: {e}")
            time.sleep(POLL_INTERVAL)
    
    raise TimeoutError(f"Job {job_id} did not complete within {timeout} seconds")


# ============================================================================
# Test Classes
# ============================================================================

class TestServerAvailability(unittest.TestCase):
    """Verify the server is running and accessible"""
    
    def test_server_is_running(self):
        """Test that the Flask server is running"""
        try:
            response = requests.get(f'{SERVER_URL}/health', timeout=HEALTH_CHECK_TIMEOUT)
            self.assertEqual(response.status_code, 200)
            
            data = response.json()
            self.assertEqual(data['status'], 'healthy')
            print(f"[+] Server is healthy: {data}")
            
        except requests.exceptions.ConnectionError:
            self.fail(f"Server not running at {SERVER_URL}. Start it with: python server.py")
        except Exception as e:
            self.fail(f"Health check failed: {e}")


class TestSingleDocumentProcessing(unittest.TestCase):
    """Test processing a single PDF document through the complete pipeline"""
    
    @classmethod
    def setUpClass(cls):
        """Set up test - upload test file to S3"""
        if SKIP_IF_NO_FILES and not file_exists(TEST_PDF_PATH):
            raise unittest.SkipTest(f"Test file not found: {TEST_PDF_PATH}")
        
        # Generate unique S3 key for this test run
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        cls.s3_key = f"{S3_TEST_PREFIX}single_test_{timestamp}.pdf"
        
        # Upload test file
        if not upload_test_file_to_s3(TEST_PDF_PATH, cls.s3_key):
            raise unittest.SkipTest("Failed to upload test file to S3")
    
    def test_submit_single_job(self):
        """Test submitting a single document for processing"""
        payload = {
            's3_key': self.s3_key,
            'filename': 'test_document.pdf',
            's3_bucket': S3_BUCKET
        }
        
        response = requests.post(
            f'{SERVER_URL}/process',
            json=payload,
            timeout=10
        )
        
        self.assertEqual(response.status_code, 202)
        data = response.json()
        
        # Verify response structure
        self.assertIn('job_id', data)
        self.assertEqual(data['status'], 'processing')
        self.assertEqual(data['filename'], 'test_document.pdf')
        
        job_id = data['job_id']
        print(f"\n[+] Job submitted: {job_id}")
        
        # Store job_id for next test
        TestSingleDocumentProcessing.job_id = job_id
    
    def test_wait_for_job_completion(self):
        """Test waiting for job to complete all pipeline stages"""
        if not hasattr(TestSingleDocumentProcessing, 'job_id'):
            self.skipTest("No job_id from previous test")
        
        job_id = TestSingleDocumentProcessing.job_id
        print(f"\n[WAIT] Waiting for job {job_id} to complete...")
        print(f"   This may take several minutes (OCR + Enrichment + Organization)")
        
        try:
            result = wait_for_job_completion(job_id)
            
            print(f"\n[+] Job completed with status: {result['status']}")
            
            # Verify job completed successfully
            self.assertIn(result['status'], ['success', 'partial_success'])
            
            # Verify all pipeline stages exist
            self.assertIn('stages', result)
            stages = result['stages']
            
            # Check OCR stage
            self.assertIn('ocr', stages)
            print(f"  OCR: {stages['ocr']['status']}")
            
            # Check parsing stage (may be pending)
            if 'parsing' in stages:
                print(f"  Parsing: {stages['parsing']['status']}")
            
            # Check enrichment stage
            if 'enrichment' in stages:
                print(f"  Enrichment: {stages['enrichment']['status']}")
                if stages['enrichment']['status'] == 'success':
                    print(f"    Questions enriched: {stages['enrichment'].get('total_enriched', 0)}")
                    print(f"    Processing cost: ${stages['enrichment'].get('processing_cost', 0):.4f}")
            
            # Check organization stage
            if 'organization' in stages:
                print(f"  Organization: {stages['organization']['status']}")
                if stages['organization']['status'] == 'success':
                    print(f"    Subjects organized: {stages['organization'].get('total_subjects', 0)}")
                    print(f"    Total questions: {stages['organization'].get('total_questions', 0)}")
            
        except TimeoutError as e:
            self.fail(str(e))
    
    def test_get_job_status(self):
        """Test retrieving job status after completion"""
        if not hasattr(TestSingleDocumentProcessing, 'job_id'):
            self.skipTest("No job_id from previous test")
        
        job_id = TestSingleDocumentProcessing.job_id
        
        response = requests.get(f'{SERVER_URL}/job/{job_id}/status', timeout=10)
        
        self.assertEqual(response.status_code, 200)
        data = response.json()
        
        # Verify complete metadata structure
        self.assertEqual(data['job_id'], job_id)
        self.assertIn('status', data)
        self.assertIn('stages', data)
        self.assertIn('filename', data)
        self.assertIn('started_at', data)
        
        if data['status'] == 'success':
            self.assertIn('completed_at', data)


class TestBatchProcessing(unittest.TestCase):
    """Test processing multiple documents in batch"""
    
    @classmethod
    def setUpClass(cls):
        """Set up test - upload multiple test files"""
        test_files = [TEST_PDF_PATH, TEST_PDF_PATH_2, TEST_PDF_PATH_3]
        
        # Check if at least 2 test files exist
        existing_files = [f for f in test_files if file_exists(f)]
        
        if SKIP_IF_NO_FILES and len(existing_files) < 2:
            raise unittest.SkipTest(f"Need at least 2 test files. Found: {len(existing_files)}")
        
        # Upload test files
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        cls.s3_keys = []
        
        for i, local_path in enumerate(existing_files[:3]):  # Max 3 files
            s3_key = f"{S3_TEST_PREFIX}batch_test_{timestamp}_file{i+1}.pdf"
            if upload_test_file_to_s3(local_path, s3_key):
                cls.s3_keys.append(s3_key)
        
        if not cls.s3_keys:
            raise unittest.SkipTest("Failed to upload any test files")
    
    def test_submit_batch_job(self):
        """Test submitting multiple documents for batch processing"""
        payload = {
            's3_bucket': S3_BUCKET,
            'jobs': [
                {'s3_key': key, 'filename': f'batch_file_{i+1}.pdf'}
                for i, key in enumerate(self.s3_keys)
            ]
        }
        
        response = requests.post(
            f'{SERVER_URL}/process/batch',
            json=payload,
            timeout=10
        )
        
        self.assertEqual(response.status_code, 202)
        data = response.json()
        
        # Verify response
        self.assertIn('message', data)
        self.assertIn('jobs', data)
        self.assertEqual(len(data['jobs']), len(self.s3_keys))
        
        # Store job IDs
        self.job_ids = [job['job_id'] for job in data['jobs']]
        
        print(f"\n[+] Batch submitted: {len(self.job_ids)} jobs")
        for i, job_id in enumerate(self.job_ids):
            print(f"  Job {i+1}: {job_id}")
        
        # Store for next test
        TestBatchProcessing.job_ids = self.job_ids
    
    def test_track_batch_jobs(self):
        """Test tracking multiple jobs through completion"""
        if not hasattr(TestBatchProcessing, 'job_ids'):
            self.skipTest("No job_ids from previous test")
        
        print(f"\n[WAIT] Tracking {len(TestBatchProcessing.job_ids)} batch jobs...")
        
        completed_jobs = {}
        
        for job_id in TestBatchProcessing.job_ids:
            try:
                print(f"\n  Waiting for job {job_id}...")
                result = wait_for_job_completion(job_id)
                completed_jobs[job_id] = result
                print(f"  [+] Status: {result['status']}")
                
            except TimeoutError:
                print(f"  ⏱ Timeout waiting for {job_id}")
                completed_jobs[job_id] = {'status': 'timeout'}
        
        # Verify at least some jobs completed
        successful = sum(1 for r in completed_jobs.values() 
                        if r.get('status') in ['success', 'partial_success'])
        
        print(f"\n[+] Completed: {successful}/{len(TestBatchProcessing.job_ids)} jobs")
        
        self.assertGreater(successful, 0, "At least one job should complete successfully")


class TestActiveJobsListing(unittest.TestCase):
    """Test listing active jobs"""
    
    def test_list_active_jobs(self):
        """Test retrieving list of all active jobs"""
        response = requests.get(f'{SERVER_URL}/jobs/active', timeout=10)
        
        self.assertEqual(response.status_code, 200)
        data = response.json()
        
        # Verify response structure
        self.assertIn('count', data)
        self.assertIn('jobs', data)
        
        print(f"\n[+] Active jobs: {data['count']}")
        
        # Print job details if any exist
        if data['jobs']:
            for job in data['jobs'][:5]:  # Show first 5
                print(f"  - {job.get('job_id')}: {job.get('status')} ({job.get('filename')})")


class TestErrorHandling(unittest.TestCase):
    """Test error handling scenarios"""
    
    def test_nonexistent_file(self):
        """Test submitting job with non-existent S3 file"""
        payload = {
            's3_key': 'nonexistent/fake_file.pdf',
            'filename': 'fake.pdf'
        }
        
        response = requests.post(
            f'{SERVER_URL}/process',
            json=payload,
            timeout=10
        )
        
        # Should return error
        self.assertIn(response.status_code, [404, 500])
        data = response.json()
        self.assertIn('error', data)
        
        print(f"\n[+] Correctly rejected non-existent file: {data['error']}")
    
    def test_missing_parameters(self):
        """Test submitting job without required parameters"""
        payload = {
            'filename': 'test.pdf'
            # Missing s3_key
        }
        
        response = requests.post(
            f'{SERVER_URL}/process',
            json=payload,
            timeout=10
        )
        
        self.assertEqual(response.status_code, 400)
        data = response.json()
        self.assertIn('error', data)
        
        print(f"\n[+] Correctly rejected missing parameter: {data['error']}")
    
    def test_invalid_job_id(self):
        """Test getting status of non-existent job"""
        response = requests.get(
            f'{SERVER_URL}/job/fake-job-id-12345/status',
            timeout=10
        )
        
        self.assertIn(response.status_code, [404, 500])
        data = response.json()
        self.assertIn('error', data)
        
        print(f"\n[+] Correctly handled invalid job ID: {data['error']}")


# ============================================================================
# Local Pipeline Tests
# ============================================================================

class TestLocalPipeline(unittest.TestCase):
    """Test local EasyOCR pipeline endpoints"""
    
    batch_id = None
    
    @classmethod
    def setUpClass(cls):
        """Check if local pipeline is available"""
        try:
            response = requests.get(f'{SERVER_URL}/health', timeout=30)
            data = response.json()
            cls.local_available = data.get('local_pipeline', False)
            
            if not cls.local_available:
                print("\n[WARNING] Local pipeline not available - skipping local tests")
        except Exception as e:
            cls.local_available = False
            print(f"\n[WARNING] Could not check local pipeline availability: {e}")
    
    def test_submit_local_batch(self):
        """Test submitting files for local OCR processing"""
        if not self.local_available:
            self.skipTest("Local pipeline not available")
        
        # Test with actual PDF files
        test_files = [
            str(TEST_PDF_PATH),
            str(TEST_PDF_PATH_2)
        ]
        
        response = requests.post(
            f'{SERVER_URL}/submit-local',
            json={
                'file_locations': test_files,
                'options': {}
            },
            timeout=10
        )
        
        self.assertEqual(response.status_code, 202)
        data = response.json()
        
        self.assertTrue(data.get('success'))
        self.assertIn('batch_id', data)
        self.assertEqual(data.get('files_queued'), 2)
        
        # Store batch_id for next test
        TestLocalPipeline.batch_id = data['batch_id']
        
        print(f"\n[+] Local batch submitted: {data['batch_id']}")
        print(f"  Files queued: {data['files_queued']}")
    
    def test_get_local_batch_status(self):
        """Test retrieving local batch status"""
        if not self.local_available:
            self.skipTest("Local pipeline not available")
        
        if not TestLocalPipeline.batch_id:
            self.skipTest("No batch_id from previous test")
        
        response = requests.get(
            f'{SERVER_URL}/status/{TestLocalPipeline.batch_id}',
            timeout=10
        )
        
        self.assertEqual(response.status_code, 200)
        data = response.json()
        
        self.assertTrue(data.get('success'))
        self.assertIn('status', data)
        
        status = data['status']
        print(f"\n[+] Local batch status retrieved:")
        print(f"  Batch ID: {TestLocalPipeline.batch_id}")
        print(f"  Status: {status}")
    
    def test_local_invalid_batch_id(self):
        """Test getting status of non-existent local batch"""
        if not self.local_available:
            self.skipTest("Local pipeline not available")
        
        response = requests.get(
            f'{SERVER_URL}/status/fake-batch-id-12345',
            timeout=10
        )
        
        self.assertEqual(response.status_code, 404)
        data = response.json()
        self.assertIn('error', data)
        
        print(f"\n[+] Correctly handled invalid batch ID: {data['error']}")
    
    def test_local_missing_files(self):
        """Test submitting local batch without file_locations"""
        if not self.local_available:
            self.skipTest("Local pipeline not available")
        
        response = requests.post(
            f'{SERVER_URL}/submit-local',
            json={'options': {}},
            timeout=10
        )
        
        self.assertEqual(response.status_code, 400)
        data = response.json()
        self.assertIn('error', data)
        
        print(f"\n[+] Correctly rejected missing files: {data['error']}")


# ============================================================================
# Test Runner
# ============================================================================

def run_real_integration_tests():
    """Run all real integration tests with setup validation"""
    
    print("=" * 80)
    print("REAL INTEGRATION TESTS - Master Pipeline Server")
    print("=" * 80)
    print(f"\n[CONFIG] Configuration:")
    print(f"  Server: {SERVER_URL}")
    print(f"  S3 Bucket: {S3_BUCKET}")
    print(f"  Test PDF 1: {TEST_PDF_PATH}")
    print(f"  Test PDF 2: {TEST_PDF_PATH_2}")
    print(f"  Test PDF 3: {TEST_PDF_PATH_3}")
    print(f"\n[WARNING]  These tests will:")
    print(f"  - Upload files to S3 (costs: ~$0.001)")
    print(f"  - Run AWS Textract OCR (costs: ~$0.0015/page)")
    print(f"  - Run AWS Bedrock enrichment (costs: varies)")
    print(f"  - Take 5-15 minutes to complete")
    
    # Validate setup
    print(f"\n[CHECK] Validating setup...")
    
    # Check test files
    files_found = 0
    for path in [TEST_PDF_PATH, TEST_PDF_PATH_2, TEST_PDF_PATH_3]:
        if file_exists(path):
            files_found += 1
            print(f"  [+] Found: {path}")
        else:
            print(f"  [WARNING] Missing: {path}")
    
    if files_found == 0:
        print(f"\n[FAIL] ERROR: No test PDF files found!")
        print(f"   Please update TEST_PDF_PATH variables at the top of this file.")
        return False
    
    # Check AWS credentials
    try:
        import boto3
        s3_client = boto3.client('s3')
        s3_client.head_bucket(Bucket=S3_BUCKET)
        print(f"  [+] AWS credentials configured")
        print(f"  [+] S3 bucket accessible: {S3_BUCKET}")
    except Exception as e:
        print(f"  [FAIL] AWS setup issue: {e}")
        print(f"     Run: aws configure")
        return False
    
    # Check server
    try:
        response = requests.get(f'{SERVER_URL}/health', timeout=5)
        if response.status_code == 200:
            print(f"  [+] Server is running at {SERVER_URL}")
        else:
            print(f"  [FAIL] Server returned status {response.status_code}")
            return False
    except:
        print(f"  [FAIL] Server not accessible at {SERVER_URL}")
        print(f"     Start it with: python server.py")
        return False
    
    print(f"\n[PASS] Setup validated! Starting tests...\n")
    print("=" * 80)
    
    # Create test suite
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    
    # Add test classes in order
    suite.addTests(loader.loadTestsFromTestCase(TestServerAvailability))
    suite.addTests(loader.loadTestsFromTestCase(TestSingleDocumentProcessing))
    suite.addTests(loader.loadTestsFromTestCase(TestBatchProcessing))
    suite.addTests(loader.loadTestsFromTestCase(TestActiveJobsListing))
    suite.addTests(loader.loadTestsFromTestCase(TestErrorHandling))
    
    # Run tests
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    
    # Print summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print(f"Tests Run: {result.testsRun}")
    print(f"Successes: {result.testsRun - len(result.failures) - len(result.errors) - len(result.skipped)}")
    print(f"Failures: {len(result.failures)}")
    print(f"Errors: {len(result.errors)}")
    print(f"Skipped: {len(result.skipped)}")
    print("=" * 80)
    
    if result.wasSuccessful():
        print("\n[PASS] ALL TESTS PASSED - Pipeline is working correctly!")
        print("   Your frontend can safely integrate with these endpoints.")
    else:
        print("\n[WARNING]  SOME TESTS FAILED - Review errors above")
    
    return result.wasSuccessful()


if __name__ == '__main__':
    import sys
    success = run_real_integration_tests()
    sys.exit(0 if success else 1)
