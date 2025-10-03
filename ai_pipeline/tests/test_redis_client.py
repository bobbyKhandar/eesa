"""
Unit tests for the AI Pipeline Redis client module.
Tests all functions and Redis operations.
"""

import unittest
import json
from unittest.mock import Mock, patch, MagicMock
import sys
import os
from datetime import datetime

# Add the src directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

import src.redis_client as redis_client


class TestRedisClient(unittest.TestCase):
    """Test cases for Redis client module"""

    def setUp(self):
        """Set up test fixtures"""
        self.mock_redis = Mock()

    @patch('src.redis_client.redis_client')
    def test_queue_push_success(self, mock_redis_client):
        """Test successful queue push operation"""
        mock_redis_client.rpush.return_value = 1
        
        result = redis_client.queue_push("test_queue", "test_value")
        
        self.assertTrue(result)
        mock_redis_client.rpush.assert_called_once_with("test_queue", "test_value")

    @patch('src.redis_client.redis_client')
    def test_queue_push_error(self, mock_redis_client):
        """Test queue push operation with error"""
        mock_redis_client.rpush.side_effect = Exception("Redis connection error")
        
        with self.assertRaises(Exception):
            redis_client.queue_push("test_queue", "test_value")

    @patch('src.redis_client.redis_client')
    def test_queue_pop_success(self, mock_redis_client):
        """Test successful queue pop operation"""
        mock_redis_client.lpop.return_value = "test_value"
        
        result = redis_client.queue_pop("test_queue")
        
        self.assertEqual(result, "test_value")
        mock_redis_client.lpop.assert_called_once_with("test_queue")

    @patch('src.redis_client.redis_client')
    def test_queue_pop_empty(self, mock_redis_client):
        """Test queue pop operation with empty queue"""
        mock_redis_client.lpop.return_value = None
        
        result = redis_client.queue_pop("test_queue")
        
        self.assertIsNone(result)

    @patch('src.redis_client.redis_client')
    def test_queue_length(self, mock_redis_client):
        """Test queue length operation"""
        mock_redis_client.llen.return_value = 5
        
        result = redis_client.queue_length("test_queue")
        
        self.assertEqual(result, 5)
        mock_redis_client.llen.assert_called_once_with("test_queue")

    @patch('src.redis_client.redis_client')
    def test_hash_set_string(self, mock_redis_client):
        """Test hash set operation with string value"""
        mock_redis_client.hset.return_value = 1
        
        result = redis_client.hash_set("test_hash", "test_field", "test_value")
        
        self.assertTrue(result)
        mock_redis_client.hset.assert_called_once_with("test_hash", "test_field", "test_value")

    @patch('src.redis_client.redis_client')
    def test_hash_set_dict(self, mock_redis_client):
        """Test hash set operation with dictionary value"""
        mock_redis_client.hset.return_value = 1
        test_dict = {"key": "value", "number": 42}
        
        result = redis_client.hash_set("test_hash", "test_field", test_dict)
        
        self.assertTrue(result)
        expected_json = json.dumps(test_dict)
        mock_redis_client.hset.assert_called_once_with("test_hash", "test_field", expected_json)

    @patch('src.redis_client.redis_client')
    def test_hash_set_map(self, mock_redis_client):
        """Test hash set map operation"""
        mock_redis_client.hset.return_value = 1
        test_mapping = {"field1": "value1", "field2": "value2"}
        
        result = redis_client.hash_set_map("test_hash", test_mapping)
        
        self.assertTrue(result)
        mock_redis_client.hset.assert_called_once_with("test_hash", mapping=test_mapping)

    @patch('src.redis_client.redis_client')
    def test_hash_get(self, mock_redis_client):
        """Test hash get operation"""
        mock_redis_client.hget.return_value = "test_value"
        
        result = redis_client.hash_get("test_hash", "test_field")
        
        self.assertEqual(result, "test_value")
        mock_redis_client.hget.assert_called_once_with("test_hash", "test_field")

    @patch('src.redis_client.redis_client')
    def test_hash_get_json_valid(self, mock_redis_client):
        """Test hash get JSON operation with valid JSON"""
        test_dict = {"key": "value", "number": 42}
        mock_redis_client.hget.return_value = json.dumps(test_dict)
        
        result = redis_client.hash_get_json("test_hash", "test_field")
        
        self.assertEqual(result, test_dict)

    @patch('src.redis_client.redis_client')
    def test_hash_get_json_invalid(self, mock_redis_client):
        """Test hash get JSON operation with invalid JSON"""
        mock_redis_client.hget.return_value = "invalid json {"
        
        result = redis_client.hash_get_json("test_hash", "test_field")
        
        self.assertIsNone(result)

    @patch('src.redis_client.redis_client')
    def test_hash_get_all(self, mock_redis_client):
        """Test hash get all operation"""
        test_data = {"field1": "value1", "field2": "value2"}
        mock_redis_client.hgetall.return_value = test_data
        
        result = redis_client.hash_get_all("test_hash")
        
        self.assertEqual(result, test_data)
        mock_redis_client.hgetall.assert_called_once_with("test_hash")

    @patch('src.redis_client.redis_client')
    def test_hash_delete(self, mock_redis_client):
        """Test hash delete operation"""
        mock_redis_client.hdel.return_value = 1
        
        result = redis_client.hash_delete("test_hash", "test_field")
        
        self.assertTrue(result)
        mock_redis_client.hdel.assert_called_once_with("test_hash", "test_field")

    @patch('src.redis_client.redis_client')
    def test_hash_keys(self, mock_redis_client):
        """Test hash keys operation"""
        test_keys = ["key1", "key2", "key3"]
        mock_redis_client.hkeys.return_value = test_keys
        
        result = redis_client.hash_keys("test_hash")
        
        self.assertEqual(result, test_keys)
        mock_redis_client.hkeys.assert_called_once_with("test_hash")


class TestRedisClientHighLevel(unittest.TestCase):
    """Test cases for high-level Redis client methods"""

    def setUp(self):
        """Set up test fixtures"""
        self.test_page_id = "page_123"
        self.test_pdf_id = "pdf_456"

    @patch('src.redis_client.hash_set_map')
    @patch('datetime.datetime')
    def test_store_page_metadata(self, mock_datetime, mock_hash_set_map):
        """Test store page metadata with explicit parameters"""
        mock_datetime.now.return_value.isoformat.return_value = "2023-10-01T12:00:00"
        mock_hash_set_map.return_value = True
        
        result = redis_client.store_page_metadata(
            page_id=self.test_page_id,
            pdf_id=self.test_pdf_id,
            pdf_location="/test/doc.pdf",
            page_no=1,
            status="queued",
            result="",
            retry_count=0,
            image_data=""
        )
        
        self.assertTrue(result)
        mock_hash_set_map.assert_called_once()
        
        # Verify the metadata structure
        call_args = mock_hash_set_map.call_args
        key = call_args[0][0]
        metadata = call_args[0][1]
        
        self.assertEqual(key, f"meta:page:{self.test_page_id}")
        self.assertEqual(metadata["pageId"], self.test_page_id)
        self.assertEqual(metadata["pdfId"], self.test_pdf_id)
        self.assertEqual(metadata["pageNo"], 1)
        self.assertEqual(metadata["status"], "queued")

    @patch('src.redis_client.hash_set_map')
    def test_store_page_metadata_dict(self, mock_hash_set_map):
        """Test store page metadata dictionary method"""
        mock_hash_set_map.return_value = True
        test_metadata = {
            "pageId": self.test_page_id,
            "pdfId": self.test_pdf_id,
            "status": "processing"
        }
        
        result = redis_client.store_page_metadata_dict(self.test_page_id, test_metadata)
        
        self.assertTrue(result)
        mock_hash_set_map.assert_called_once()

    @patch('src.redis_client.hash_get_all')
    def test_get_page_metadata(self, mock_hash_get_all):
        """Test get page metadata"""
        test_metadata = {
            "pageId": self.test_page_id,
            "status": "complete",
            "confidence": "0.95"
        }
        mock_hash_get_all.return_value = test_metadata
        
        result = redis_client.get_page_metadata(self.test_page_id)
        
        self.assertEqual(result, test_metadata)
        mock_hash_get_all.assert_called_once_with(f"meta:page:{self.test_page_id}")

    @patch('src.redis_client.hash_set')
    @patch('datetime.datetime')
    def test_update_page_metadata(self, mock_datetime, mock_hash_set):
        """Test update page metadata"""
        mock_datetime.now.return_value.isoformat.return_value = "2023-10-01T12:00:00"
        mock_hash_set.return_value = True
        
        result = redis_client.update_page_metadata(self.test_page_id, "status", "complete")
        
        self.assertTrue(result)
        # Should be called twice: once for the field, once for lastUpdated
        self.assertEqual(mock_hash_set.call_count, 2)

    @patch('src.redis_client.hash_set')
    @patch('datetime.datetime')
    def test_store_pdf_metadata(self, mock_datetime, mock_hash_set):
        """Test store PDF metadata with explicit parameters"""
        mock_datetime.now.return_value.isoformat.return_value = "2023-10-01T12:00:00"
        mock_hash_set.return_value = True
        
        result = redis_client.store_pdf_metadata(
            pdf_id=self.test_pdf_id,
            file_path="/test/doc.pdf",
            page_count=10,
            status="processing",
            pages_ids=["page1", "page2"]
        )
        
        self.assertTrue(result)
        mock_hash_set.assert_called_once()

    @patch('src.redis_client.hash_get_json')
    def test_get_pdf_metadata(self, mock_hash_get_json):
        """Test get PDF metadata"""
        test_metadata = {
            "pdfId": self.test_pdf_id,
            "pageCount": 10,
            "status": "complete"
        }
        mock_hash_get_json.return_value = test_metadata
        
        result = redis_client.get_pdf_metadata(self.test_pdf_id)
        
        self.assertEqual(result, test_metadata)
        mock_hash_get_json.assert_called_once_with("meta:pdf", self.test_pdf_id)

    @patch('src.redis_client.queue_push')
    def test_add_image_to_preprocess_queue(self, mock_queue_push):
        """Test add image to preprocess queue"""
        mock_queue_push.return_value = True
        
        result = redis_client.add_image_to_preprocess_queue("job123")
        
        self.assertTrue(result)
        mock_queue_push.assert_called_once_with("queue:image:preprocess", "job123")

    @patch('src.redis_client.queue_pop')
    def test_get_next_image_from_preprocess_queue(self, mock_queue_pop):
        """Test get next image from preprocess queue"""
        mock_queue_pop.return_value = "job123"
        
        result = redis_client.get_next_image_from_preprocess_queue()
        
        self.assertEqual(result, "job123")
        mock_queue_pop.assert_called_once_with("queue:image:preprocess")

    @patch('src.redis_client.hash_set_map')
    @patch('datetime.datetime')
    def test_store_processed_result(self, mock_datetime, mock_hash_set_map):
        """Test store processed result with explicit parameters"""
        mock_datetime.now.return_value.isoformat.return_value = "2023-10-01T12:00:00"
        mock_hash_set_map.return_value = True
        
        result = redis_client.store_processed_result(
            job_id="job123",
            task_id="task456",
            text="Extracted text",
            confidence=0.95,
            status="complete",
            page_no=1
        )
        
        self.assertTrue(result)
        mock_hash_set_map.assert_called_once()

    @patch('src.redis_client.queue_length')
    def test_are_queues_empty_true(self, mock_queue_length):
        """Test are_queues_empty when all queues are empty"""
        mock_queue_length.return_value = 0
        
        result = redis_client.are_queues_empty()
        
        self.assertTrue(result)
        self.assertEqual(mock_queue_length.call_count, 3)  # OCR, preprocess, merge queues

    @patch('src.redis_client.queue_length')
    def test_are_queues_empty_false(self, mock_queue_length):
        """Test are_queues_empty when queues have items"""
        mock_queue_length.side_effect = [1, 0, 0]  # OCR queue has 1 item
        
        result = redis_client.are_queues_empty()
        
        self.assertFalse(result)

    @patch('src.redis_client.hash_set')
    @patch('datetime.datetime')
    def test_store_task_metadata(self, mock_datetime, mock_hash_set):
        """Test store task metadata with explicit parameters"""
        mock_datetime.now.return_value.isoformat.return_value = "2023-10-01T12:00:00"
        mock_hash_set.return_value = True
        
        result = redis_client.store_task_metadata(
            task_id="task123",
            total_pages=5,
            jobs_ids=["job1", "job2", "job3"],
            processed_pages=2,
            processed_jobs_ids=["job1", "job2"],
            status="in_progress"
        )
        
        self.assertTrue(result)
        mock_hash_set.assert_called_once()

    @patch('src.redis_client.redis_client')
    def test_is_redis_available_true(self, mock_redis_client):
        """Test is_redis_available when Redis is available"""
        mock_redis_client.ping.return_value = True
        
        result = redis_client.is_redis_available()
        
        self.assertTrue(result)
        mock_redis_client.ping.assert_called_once()

    @patch('src.redis_client.redis_client')
    def test_is_redis_available_false(self, mock_redis_client):
        """Test is_redis_available when Redis is not available"""
        mock_redis_client.ping.side_effect = Exception("Connection error")
        
        result = redis_client.is_redis_available()
        
        self.assertFalse(result)


class TestRedisKeys(unittest.TestCase):
    """Test cases for Redis key utilities"""

    def test_redis_keys_constants(self):
        """Test Redis key constants"""
        self.assertEqual(redis_client.RedisKeys.QUEUE_IMAGE_PREPROCESS, "queue:image:preprocess")
        self.assertEqual(redis_client.RedisKeys.QUEUE_OCR, "queue:ocr")
        self.assertEqual(redis_client.RedisKeys.META_PDF, "meta:pdf")

    def test_meta_page_key(self):
        """Test meta page key generation"""
        page_id = "page_123"
        expected_key = "meta:page:page_123"
        
        result = redis_client.RedisKeys.meta_page_key(page_id)
        
        self.assertEqual(result, expected_key)


class TestJobStatusConstants(unittest.TestCase):
    """Test cases for job status constants"""

    def test_job_status_constants(self):
        """Test job status constants"""
        self.assertEqual(redis_client.JobStatus.QUEUED, "queued")
        self.assertEqual(redis_client.JobStatus.IN_PROGRESS, "in_progress")
        self.assertEqual(redis_client.JobStatus.COMPLETE, "complete")
        self.assertEqual(redis_client.JobStatus.ERROR, "error")


class TestDataModels(unittest.TestCase):
    """Test cases for TypedDict data models"""

    def test_page_metadata_structure(self):
        """Test PageMetadata TypedDict structure"""
        # This is more of a documentation test
        # TypedDict doesn't enforce at runtime, but helps with IDE support
        page_data: redis_client.PageMetadata = {
            "pageId": "page_123",
            "pdfId": "pdf_456",
            "pdfLocation": "/test/doc.pdf",
            "pageNo": 1,
            "status": "queued"
        }
        
        self.assertEqual(page_data["pageId"], "page_123")
        self.assertEqual(page_data["pageNo"], 1)

    def test_ocr_result_structure(self):
        """Test OCRResult TypedDict structure"""
        ocr_data: redis_client.OCRResult = {
            "jobId": "job_123",
            "taskId": "task_456",
            "text": "Extracted text",
            "confidence": 0.95,
            "status": "complete",
            "pageNo": 1
        }
        
        self.assertEqual(ocr_data["confidence"], 0.95)
        self.assertEqual(ocr_data["text"], "Extracted text")


if __name__ == '__main__':
    # Create test directory if it doesn't exist
    os.makedirs('tests', exist_ok=True)
    
    # Run tests
    unittest.main(verbosity=2)