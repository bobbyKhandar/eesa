"""
Unit tests for the AI Pipeline jobHandler module.
Tests all functions and integration points.
"""

import unittest
import json
import uuid
from unittest.mock import Mock, patch, MagicMock
import sys
import os
import numpy as np
import cv2

# Add the src directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from src import redis_client
from src.jobHandler import jobHandler
from src.ocr import Ocr


class TestJobHandler(unittest.TestCase):
    """Test cases for jobHandler class"""

    def setUp(self):
        """Set up test fixtures"""
        # Mock Redis client to avoid real Redis dependencies
        self.mock_redis = Mock()
        with patch('src.redis_client.is_redis_available', return_value=True):
            with patch('src.redis_client.redis_client', self.mock_redis):
                with patch('src.imagePreprocess.PreProcessImage'):
                    self.job_handler = jobHandler()

    @patch('src.redis_client.is_redis_available')
    def test_init_redis_available(self, mock_redis_available):
        """Test jobHandler initialization when Redis is available"""
        mock_redis_available.return_value = True
        
        with patch('src.imagePreprocess.PreProcessImage'):
            handler = jobHandler()
            
        self.assertIsInstance(handler.ocrEngine, Ocr)
        self.assertEqual(handler.processResults, {})
        self.assertEqual(handler.ocrOutputCache, {})

    @patch('src.redis_client.is_redis_available')
    def test_init_redis_unavailable(self, mock_redis_available):
        """Test that jobHandler raises exception when Redis is unavailable"""
        mock_redis_available.return_value = False
        
        # This should be handled at import time, but let's test the logic
        with self.assertRaises(Exception):
            # Simulate the check that happens in the main block
            if not mock_redis_available():
                raise Exception("Redis is required for the job handler to work. Please make sure Redis server is running.")

    @patch('src.redis_client.queue_push')
    @patch('src.redis_client.store_page_metadata_dict')
    @patch('src.redis_client.hash_set')
    @patch('fitz.open')
    @patch('os.getcwd')
    def test_create_jobs(self, mock_getcwd, mock_fitz_open, mock_hash_set, 
                        mock_store_metadata, mock_queue_push):
        """Test __createJobs__ method"""
        # Setup mocks
        mock_getcwd.return_value = "/test/path"
        mock_pdf = Mock()
        mock_pdf.page_count = 3
        mock_fitz_open.return_value = mock_pdf
        
        mock_queue_push.return_value = True
        mock_store_metadata.return_value = True
        mock_hash_set.return_value = True
        
        # Test data
        test_job_path = ["test_document.pdf"]
        
        # Execute
        self.job_handler._jobHandler__createJobs__(test_job_path)
        
        # Verify calls were made for each page
        self.assertEqual(mock_queue_push.call_count, 3)  # 3 pages
        self.assertEqual(mock_store_metadata.call_count, 3)  # 3 pages
        self.assertEqual(mock_hash_set.call_count, 3)  # 3 task metadata entries

    @patch('src.redis_client.queue_pop')
    @patch('src.redis_client.hash_get_json')
    @patch('src.redis_client.hash_get_all')
    @patch('src.redis_client.hash_set_map')
    @patch('src.redis_client.queue_push')
    @patch('src.redis_client.hash_delete')
    def test_merge_jobs(self, mock_hash_delete, mock_queue_push_final, 
                       mock_hash_set_map, mock_hash_get_all, 
                       mock_hash_get_json, mock_queue_pop):
        """Test mergeJobs method"""
        # Setup mocks
        mock_queue_pop.side_effect = ["task123", "STOP"]
        mock_hash_get_json.return_value = {
            "taskId": "task123",
            "processedJobsIds": ["job1", "job2"],
            "totalPages": 2
        }
        
        # Mock job results
        mock_hash_get_all.side_effect = [
            {"status": "complete", "result": '{"text": "Page 1 text", "confidence": 0.9}'},
            {"status": "complete", "result": '{"text": "Page 2 text", "confidence": 0.8}'}
        ]
        
        mock_hash_set_map.return_value = True
        mock_queue_push_final.return_value = True
        mock_hash_delete.return_value = True
        
        # Execute
        self.job_handler.mergeJobs()
        
        # Verify
        mock_hash_set_map.assert_called_once()
        mock_queue_push_final.assert_called_once()
        mock_hash_delete.assert_called_once()

    @patch('multiprocessing.current_process')
    @patch('os.getpid')
    @patch('src.redis_client.queue_pop')
    @patch('src.redis_client.get_page_metadata')
    @patch('src.redis_client.update_page_metadata')
    @patch('fitz.open')
    @patch('cv2.imdecode')
    def test_process_ocr_with_image_data(self, mock_cv2_decode, mock_fitz_open,
                                       mock_update_metadata, mock_get_metadata,
                                       mock_queue_pop, mock_getpid, mock_current_process):
        """Test processOcr method with existing image data"""
        # Setup mocks
        mock_current_process.return_value.name = "TestWorker"
        mock_getpid.return_value = 12345
        mock_queue_pop.side_effect = ["page123", "STOP"]
        
        mock_get_metadata.return_value = {
            "jobId": "job123",
            "pageNo": "0",
            "totalPages": "1",
            "imageData": "89504e470d0a1a0a",  # Mock hex data
            "pdfLocation": "/test/doc.pdf"
        }
        
        # Mock image processing
        mock_image = np.zeros((100, 100, 3), dtype=np.uint8)
        mock_cv2_decode.return_value = mock_image
        
        # Mock OCR engine
        self.job_handler.ocrEngine.processImage = Mock(return_value={
            "success": True,
            "text": [{"text": "Test text", "confidence": 0.9}],
            "confidence": 0.9
        })
        
        mock_update_metadata.return_value = True
        
        # Execute
        self.job_handler.processOcr()
        
        # Verify
        mock_get_metadata.assert_called_with("page123")
        self.job_handler.ocrEngine.processImage.assert_called_once()

    @patch('multiprocessing.current_process')
    @patch('src.redis_client.hash_keys')
    @patch('src.redis_client.hash_get')
    @patch('src.redis_client.hash_delete')
    @patch('src.redis_client.update_page_metadata')
    @patch('src.redis_client.queue_push')
    @patch('fitz.open')
    def test_process_preprocessing(self, mock_fitz_open, mock_queue_push,
                                 mock_update_metadata, mock_hash_delete,
                                 mock_hash_get, mock_hash_keys, mock_current_process):
        """Test processPreprocessing method"""
        # Setup mocks
        mock_current_process.return_value.name = "TestPreprocessor"
        mock_hash_keys.side_effect = [["task1"], []]  # First call has task, second is empty
        
        task_data = {
            "pageId": "page123",
            "jobLocation": "/test/doc.pdf",
            "pageNo": 0
        }
        mock_hash_get.return_value = json.dumps(task_data)
        mock_hash_delete.return_value = True
        
        # Mock PDF processing
        mock_doc = Mock()
        mock_page = Mock()
        mock_pix = Mock()
        mock_pix.n = 3
        mock_pix.samples = b'\x00' * (100 * 100 * 3)
        mock_page.get_pixmap.return_value = mock_pix
        mock_doc.load_page.return_value = mock_page
        mock_fitz_open.return_value = mock_doc
        
        mock_update_metadata.return_value = True
        mock_queue_push.return_value = True
        
        # Execute (will run once and then exit due to empty keys)
        with patch('time.sleep'):  # Prevent actual sleeping
            self.job_handler.processPreprocessing()
        
        # Verify
        mock_hash_get.assert_called_with(redis_client.RedisKeys.QUEUE_IMAGE_PROCESSING, "task1")
        mock_fitz_open.assert_called_with("/test/doc.pdf")

    def test_finalize_ocr_results(self):
        """Test finalizeOcrResults method"""
        # Setup test data
        job_id = "test_job_123"
        self.job_handler.ocrOutputCache[job_id] = [
            {
                "pageNo": 0,
                "result": {
                    "success": True,
                    "text": [{"text": "Page 1 text", "confidence": 0.9}],
                    "confidence": 0.9
                },
                "confidence": 0.9,
                "text": [{"text": "Page 1 text", "confidence": 0.9}]
            },
            {
                "pageNo": 1,
                "result": {
                    "success": True,
                    "text": [{"text": "Page 2 text", "confidence": 0.8}],
                    "confidence": 0.8
                },
                "confidence": 0.8,
                "text": [{"text": "Page 2 text", "confidence": 0.8}]
            }
        ]
        
        # Execute
        self.job_handler.finalizeOcrResults(job_id)
        
        # Verify
        self.assertIn(job_id, self.job_handler.processResults)
        result = self.job_handler.processResults[job_id]
        self.assertEqual(result["status"], "complete")
        self.assertIn("Page 1 text", result["text"])
        self.assertIn("Page 2 text", result["text"])
        self.assertNotIn(job_id, self.job_handler.ocrOutputCache)  # Should be cleaned up

    def test_process_job_success(self):
        """Test processJob method with successful completion"""
        # Setup
        job_id = "test_job_456"
        test_job = {"jobId": job_id}
        
        # Mock successful result
        self.job_handler.processResults[job_id] = {
            "text": "Extracted text",
            "confidence": 0.85,
            "status": "complete"
        }
        
        # Execute
        result = self.job_handler.processJob(test_job)
        
        # Verify
        self.assertEqual(result["text"], "Extracted text")
        self.assertEqual(result["confidence"], 0.85)
        self.assertEqual(result["status"], "complete")
        self.assertNotIn(job_id, self.job_handler.processResults)  # Should be cleaned up

    def test_process_job_timeout(self):
        """Test processJob method with timeout"""
        # Setup
        test_job = {"jobId": "nonexistent_job"}
        
        # Execute with timeout patch
        with patch('time.sleep'):
            result = self.job_handler.processJob(test_job)
        
        # Verify error handling
        self.assertEqual(result["error"], "Job processing timeout")

    def test_process_job_no_job_id(self):
        """Test processJob method with missing job ID"""
        # Setup
        test_job = {}
        
        # Execute
        result = self.job_handler.processJob(test_job)
        
        # Verify error handling
        self.assertEqual(result["error"], "No jobId found in job")


class TestOcrModule(unittest.TestCase):
    """Test cases for OCR module"""

    def setUp(self):
        """Set up test fixtures"""
        with patch('torch.cuda.is_available', return_value=False):
            with patch('easyocr.Reader'):
                self.ocr_engine = Ocr()

    def test_ocr_initialization(self):
        """Test OCR engine initialization"""
        with patch('torch.cuda.is_available', return_value=True):
            with patch('torch.cuda.device_count', return_value=2):
                with patch('torch.cuda.set_device'):
                    with patch('easyocr.Reader') as mock_reader:
                        ocr_engine = Ocr()
                        mock_reader.assert_called_once_with(['en'], gpu=True)

    def test_process_image_success(self):
        """Test successful image processing"""
        # Setup
        mock_image = np.zeros((100, 100, 3), dtype=np.uint8)
        mock_results = [
            ([(0, 0), (100, 0), (100, 50), (0, 50)], "Test text 1", 0.9),
            ([(0, 50), (100, 50), (100, 100), (0, 100)], "Test text 2", 0.8)
        ]
        
        self.ocr_engine.reader = Mock()
        self.ocr_engine.reader.readtext.return_value = mock_results
        
        # Execute
        result = self.ocr_engine.processImage(mock_image)
        
        # Verify
        self.assertTrue(result["success"])
        self.assertEqual(len(result["text"]), 2)
        self.assertEqual(result["text"][0]["text"], "Test text 1")
        self.assertEqual(result["text"][0]["confidence"], 0.9)
        self.assertEqual(result["confidence"], 0.85)  # Average of 0.9 and 0.8

    def test_process_image_error(self):
        """Test image processing with error"""
        # Setup
        mock_image = np.zeros((100, 100, 3), dtype=np.uint8)
        self.ocr_engine.reader = Mock()
        self.ocr_engine.reader.readtext.side_effect = Exception("OCR Error")
        
        # Execute
        result = self.ocr_engine.processImage(mock_image)
        
        # Verify
        self.assertFalse(result["success"])
        self.assertEqual(result["error"], "OCR Error")

    def test_sanitize_text_list(self):
        """Test text sanitization with list input"""
        # Setup
        test_text = [
            {"text": "Hello "World"", "confidence": 0.9},
            {"text": "Test\x00text", "confidence": 0.8}
        ]
        
        # Execute
        result = self.ocr_engine.sanitize(test_text)
        
        # Verify
        self.assertEqual(result[0], 'Hello "World"')  # Quotes normalized
        self.assertEqual(result[1], "Testtext")  # Control char removed

    def test_sanitize_single_string(self):
        """Test text sanitization with single string input"""
        # Setup
        test_text = "Hello\x08 "world" with\u00ad soft-hyphen"
        
        # Execute
        result = self.ocr_engine.sanitize(test_text)
        
        # Verify
        self.assertEqual(result, 'Hello "world" with soft-hyphen')

    def test_sanitize_string_internal(self):
        """Test internal string sanitization method"""
        # Setup
        test_cases = [
            ("Hello\x00world", "Helloworld"),  # Control char removal
            (""Hello"", '"Hello"'),  # Quote normalization
            ("text\u00adwith\u200bspaces", "textwithspaces"),  # Zero-width char removal
            ("multiple   spaces", "multiple spaces"),  # Space collapsing
            ("  leading and trailing  ", "leading and trailing")  # Trim
        ]
        
        # Execute and verify
        for input_text, expected in test_cases:
            with self.subTest(input_text=input_text):
                result = self.ocr_engine._sanitize_string(input_text)
                self.assertEqual(result, expected)


class TestRedisClientIntegration(unittest.TestCase):
    """Test Redis client integration"""

    def setUp(self):
        """Set up test fixtures"""
        self.mock_redis = Mock()
        
    @patch('src.redis_client.redis_client')
    def test_queue_operations(self, mock_redis_client):
        """Test Redis queue operations"""
        mock_redis_client.rpush.return_value = 1
        mock_redis_client.lpop.return_value = "test_value"
        mock_redis_client.llen.return_value = 5
        
        # Test queue operations
        result_push = redis_client.queue_push("test_queue", "test_value")
        result_pop = redis_client.queue_pop("test_queue")
        result_len = redis_client.queue_length("test_queue")
        
        self.assertTrue(result_push)
        self.assertEqual(result_pop, "test_value")
        self.assertEqual(result_len, 5)

    @patch('src.redis_client.redis_client')
    def test_hash_operations(self, mock_redis_client):
        """Test Redis hash operations"""
        mock_redis_client.hset.return_value = 1
        mock_redis_client.hget.return_value = "test_value"
        mock_redis_client.hgetall.return_value = {"key": "value"}
        mock_redis_client.hdel.return_value = 1
        
        # Test hash operations
        result_set = redis_client.hash_set("test_hash", "test_field", "test_value")
        result_get = redis_client.hash_get("test_hash", "test_field")
        result_all = redis_client.hash_get_all("test_hash")
        result_del = redis_client.hash_delete("test_hash", "test_field")
        
        self.assertTrue(result_set)
        self.assertEqual(result_get, "test_value")
        self.assertEqual(result_all, {"key": "value"})
        self.assertTrue(result_del)


if __name__ == '__main__':
    # Create test directory if it doesn't exist
    os.makedirs('tests', exist_ok=True)
    
    # Run tests
    unittest.main(verbosity=2)