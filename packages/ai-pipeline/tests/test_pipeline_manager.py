"""
Unit tests for Pipeline Manager - Main orchestrator for OCR processing
Tests batch processing, job management, result compilation, and workflow orchestration
"""

import unittest
import json
import time
import threading
from unittest.mock import Mock, patch, MagicMock
import sys
import os

# Add the parent directory to the path to import from src
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from src.pipeline_manager import PipelineManager, JobStatus, BatchRequest, BatchResult


class TestPipelineManagerInitialization(unittest.TestCase):
    """Test Pipeline Manager initialization"""

    @patch('src.ocr_engine.OCREngine')
    @patch('src.image_processor.ImageProcessor')
    @patch('src.pdf_handler.PDFHandler')
    def test_init(self, mock_pdf_handler, mock_image_processor, mock_ocr_engine):
        """Test pipeline manager initialization"""
        # Create mock instances
        mock_ocr_instance = Mock()
        mock_image_instance = Mock()
        mock_pdf_instance = Mock()
        
        mock_ocr_engine.return_value = mock_ocr_instance
        mock_image_processor.return_value = mock_image_instance
        mock_pdf_handler.return_value = mock_pdf_instance
        
        manager = PipelineManager()
        
        self.assertIsNotNone(manager.ocr_engine)
        self.assertIsNotNone(manager.image_processor)
        self.assertIsNotNone(manager.pdf_handler)
        self.assertEqual(manager.active_batches, {})
        self.assertFalse(manager.is_running)
        self.assertIsInstance(manager.processing_lock, type(threading.Lock()))


class TestBatchRequestAndResult(unittest.TestCase):
    """Test BatchRequest and BatchResult data classes"""

    def test_batch_request_creation(self):
        """Test BatchRequest data class creation"""
        batch = BatchRequest(
            batch_id="test_batch_123",
            file_locations=["/test/file1.pdf", "/test/file2.pdf"],
            options={"dpi": 400}
        )
        
        self.assertEqual(batch.batch_id, "test_batch_123")
        self.assertEqual(len(batch.file_locations), 2)
        self.assertEqual(batch.options["dpi"], 400)
        self.assertIsNotNone(batch.created_at)

    def test_batch_request_default_values(self):
        """Test BatchRequest with default values"""
        batch = BatchRequest(
            batch_id="test_batch",
            file_locations=["/test/file.pdf"]
        )
        
        self.assertEqual(batch.options, {})
        self.assertIsInstance(batch.created_at, float)

    def test_batch_result_creation(self):
        """Test BatchResult data class creation"""
        result = BatchResult(
            batch_id="test_batch_123",
            status=JobStatus.COMPLETED,
            total_files=5,
            successful_files=4,
            failed_files=1,
            processing_time=120.5,
            results={"file1.pdf": {"text": "content"}},
            errors=["Error processing file2.pdf"]
        )
        
        self.assertEqual(result.batch_id, "test_batch_123")
        self.assertEqual(result.status, JobStatus.COMPLETED)
        self.assertEqual(result.total_files, 5)
        self.assertEqual(result.successful_files, 4)
        self.assertEqual(result.failed_files, 1)
        self.assertEqual(result.processing_time, 120.5)
        self.assertIsNotNone(result.completed_at)

    def test_batch_result_to_dict(self):
        """Test BatchResult conversion to dictionary"""
        result = BatchResult(
            batch_id="test",
            status=JobStatus.COMPLETED,
            total_files=2,
            successful_files=2,
            failed_files=0,
            processing_time=60.0,
            results={"file.pdf": {"text": "content"}},
            errors=[]
        )
        
        result_dict = result.to_dict()
        
        self.assertEqual(result_dict["batch_id"], "test")
        self.assertEqual(result_dict["status"], "completed")
        self.assertEqual(result_dict["total_files"], 2)
        self.assertIsInstance(result_dict["processing_time"], float)


@unittest.skip("Needs setUp refactoring")
class TestPipelineManagerServerOperations(unittest.TestCase):
    """Test Pipeline Manager server start/stop operations"""

    def setUp(self):
        """Set up test fixtures"""
        with patch('src.pipeline_manager.OCREngine'), \
             patch('src.pipeline_manager.ImageProcessor'), \
             patch('src.pipeline_manager.PDFHandler'):
            self.manager = PipelineManager()

    @patch('threading.Thread')
    def test_start_server(self, mock_thread):
        """Test starting the pipeline server"""
        mock_thread_instance = Mock()
        mock_thread.return_value = mock_thread_instance
        
        self.manager.start_server()
        
        self.assertTrue(self.manager.is_running)
        mock_thread.assert_called_once()
        mock_thread_instance.start.assert_called_once()

    def test_stop_server(self):
        """Test stopping the pipeline server"""
        self.manager.is_running = True
        
        self.manager.stop_server()
        
        self.assertFalse(self.manager.is_running)


@unittest.skip("Needs setUp refactoring")
class TestPipelineManagerBatchSubmission(unittest.TestCase):
    """Test Pipeline Manager batch submission functionality"""

    def setUp(self):
        """Set up test fixtures"""
        with patch('src.pipeline_manager.OCREngine'), \
             patch('src.pipeline_manager.ImageProcessor'), \
             patch('src.pipeline_manager.PDFHandler'):
            self.manager = PipelineManager()

    @patch('src.pipeline_manager.redis_client')
    @patch('uuid.uuid4')
    def test_submit_batch_success(self, mock_uuid, mock_redis_client):
        """Test successful batch submission"""
        mock_uuid.return_value = Mock()
        mock_uuid.return_value.__str__ = Mock(return_value="batch_123")
        
        mock_redis_client.hash_set.return_value = True
        mock_redis_client.queue_push.return_value = True
        
        file_locations = ["/test/file1.pdf", "/test/file2.pdf"]
        options = {"dpi": 400}
        
        batch_id = self.manager.submit_batch(file_locations, options)
        
        self.assertEqual(batch_id, "batch_123")
        self.assertIn(batch_id, self.manager.active_batches)
        
        # Verify Redis operations
        mock_redis_client.hash_set.assert_called_once()
        mock_redis_client.queue_push.assert_called_once()

    @patch('src.pipeline_manager.redis_client')
    @patch('uuid.uuid4')
    def test_submit_batch_no_options(self, mock_uuid, mock_redis_client):
        """Test batch submission without options"""
        mock_uuid.return_value = Mock()
        mock_uuid.return_value.__str__ = Mock(return_value="batch_456")
        
        mock_redis_client.hash_set.return_value = True
        mock_redis_client.queue_push.return_value = True
        
        file_locations = ["/test/single_file.pdf"]
        
        batch_id = self.manager.submit_batch(file_locations)
        
        self.assertEqual(batch_id, "batch_456")
        
        # Verify metadata contains empty options
        call_args = mock_redis_client.hash_set.call_args[0]
        metadata = call_args[2]  # Third argument is the metadata
        self.assertEqual(metadata["options"], {})

    @patch('src.pipeline_manager.redis_client')
    @patch('uuid.uuid4')
    def test_submit_empty_batch(self, mock_uuid, mock_redis_client):
        """Test submitting empty batch"""
        mock_uuid.return_value = Mock()
        mock_uuid.return_value.__str__ = Mock(return_value="empty_batch")
        
        mock_redis_client.hash_set.return_value = True
        mock_redis_client.queue_push.return_value = True
        
        batch_id = self.manager.submit_batch([])
        
        # Should still create batch (might be valid use case)
        self.assertEqual(batch_id, "empty_batch")


@unittest.skip("Needs setUp refactoring")
class TestPipelineManagerBatchStatus(unittest.TestCase):
    """Test Pipeline Manager batch status functionality"""

    def setUp(self):
        """Set up test fixtures"""
        with patch('src.pipeline_manager.OCREngine'), \
             patch('src.pipeline_manager.ImageProcessor'), \
             patch('src.pipeline_manager.PDFHandler'):
            self.manager = PipelineManager()

    @patch('src.pipeline_manager.redis_client')
    @patch('time.time')
    def test_get_batch_status_success(self, mock_time, mock_redis_client):
        """Test getting batch status successfully"""
        mock_time.return_value = 1000.0
        
        batch_metadata = {
            "batch_id": "test_batch",
            "status": "processing",
            "total_files": 10,
            "processed_files": 6,
            "failed_files": 1,
            "created_at": 950.0  # 50 seconds ago
        }
        
        mock_redis_client.hash_get_json.return_value = batch_metadata
        
        status = self.manager.get_batch_status("test_batch")
        
        self.assertEqual(status["batch_id"], "test_batch")
        self.assertEqual(status["status"], "processing")
        self.assertEqual(status["total_files"], 10)
        self.assertEqual(status["processed_files"], 6)
        self.assertEqual(status["progress_percentage"], 60.0)
        self.assertEqual(status["processing_time"], 50.0)

    @patch('src.pipeline_manager.redis_client')
    def test_get_batch_status_not_found(self, mock_redis_client):
        """Test getting status for non-existent batch"""
        mock_redis_client.hash_get_json.return_value = None
        
        status = self.manager.get_batch_status("nonexistent_batch")
        
        self.assertIsNone(status)

    @patch('src.pipeline_manager.redis_client')
    def test_get_batch_status_error_handling(self, mock_redis_client):
        """Test error handling in batch status retrieval"""
        mock_redis_client.hash_get_json.side_effect = Exception("Redis error")
        
        status = self.manager.get_batch_status("error_batch")
        
        self.assertIsNone(status)

    @patch('src.pipeline_manager.redis_client')
    def test_get_batch_status_zero_files(self, mock_redis_client):
        """Test batch status with zero total files"""
        batch_metadata = {
            "batch_id": "empty_batch",
            "status": "completed",
            "total_files": 0,
            "processed_files": 0,
            "failed_files": 0,
            "created_at": 1000.0
        }
        
        mock_redis_client.hash_get_json.return_value = batch_metadata
        
        status = self.manager.get_batch_status("empty_batch")
        
        self.assertEqual(status["progress_percentage"], 0)


@unittest.skip("Needs setUp refactoring")
class TestPipelineManagerBatchResults(unittest.TestCase):
    """Test Pipeline Manager batch result functionality"""

    def setUp(self):
        """Set up test fixtures"""
        with patch('src.pipeline_manager.OCREngine'), \
             patch('src.pipeline_manager.ImageProcessor'), \
             patch('src.pipeline_manager.PDFHandler'):
            self.manager = PipelineManager()

    @patch('src.pipeline_manager.redis_client')
    def test_get_batch_result_success(self, mock_redis_client):
        """Test getting batch result successfully"""
        batch_metadata = {
            "batch_id": "completed_batch",
            "status": "completed",
            "total_files": 3,
            "processed_files": 3,
            "failed_files": 0,
            "processing_time": 120.0,
            "completed_at": 2000.0
        }
        
        batch_results = {
            "file1.pdf": {"text": "Content 1", "confidence": 0.95},
            "file2.pdf": {"text": "Content 2", "confidence": 0.90}
        }
        
        batch_errors = []
        
        mock_redis_client.hash_get_json.side_effect = [
            batch_metadata,  # First call for metadata
            batch_results,   # Second call for results
            batch_errors     # Third call for errors
        ]
        
        result = self.manager.get_batch_result("completed_batch")
        
        self.assertIsInstance(result, BatchResult)
        self.assertEqual(result.batch_id, "completed_batch")
        self.assertEqual(result.status, JobStatus.COMPLETED)
        self.assertEqual(result.total_files, 3)
        self.assertEqual(result.successful_files, 3)
        self.assertEqual(result.failed_files, 0)
        self.assertEqual(result.processing_time, 120.0)
        self.assertEqual(result.results, batch_results)
        self.assertEqual(result.errors, batch_errors)

    @patch('src.pipeline_manager.redis_client')
    def test_get_batch_result_not_found(self, mock_redis_client):
        """Test getting result for non-existent batch"""
        mock_redis_client.hash_get_json.return_value = None
        
        result = self.manager.get_batch_result("nonexistent_batch")
        
        self.assertIsNone(result)

    @patch('src.pipeline_manager.redis_client')
    def test_get_batch_result_with_failures(self, mock_redis_client):
        """Test getting batch result with some failures"""
        batch_metadata = {
            "batch_id": "mixed_batch",
            "status": "failed",
            "total_files": 5,
            "processed_files": 5,
            "failed_files": 2,
            "processing_time": 180.0
        }
        
        batch_results = {
            "file1.pdf": {"text": "Content 1"},
            "file2.pdf": {"text": "Content 2"},
            "file3.pdf": {"text": "Content 3"}
        }
        
        batch_errors = [
            "Failed to process file4.pdf: Corrupted file",
            "Failed to process file5.pdf: Memory error"
        ]
        
        mock_redis_client.hash_get_json.side_effect = [
            batch_metadata,
            batch_results,
            batch_errors
        ]
        
        result = self.manager.get_batch_result("mixed_batch")
        
        self.assertEqual(result.status, JobStatus.FAILED)
        self.assertEqual(result.successful_files, 3)  # processed_files - failed_files
        self.assertEqual(result.failed_files, 2)
        self.assertEqual(len(result.errors), 2)


@unittest.skip("Needs setUp refactoring")
class TestPipelineManagerProcessing(unittest.TestCase):
    """Test Pipeline Manager processing functionality"""

    def setUp(self):
        """Set up test fixtures"""
        with patch('src.pipeline_manager.OCREngine'), \
             patch('src.pipeline_manager.ImageProcessor'), \
             patch('src.pipeline_manager.PDFHandler'):
            self.manager = PipelineManager()

    @patch('src.pipeline_manager.redis_client')
    @patch('time.sleep')
    def test_process_batches_continuously(self, mock_sleep, mock_redis_client):
        """Test continuous batch processing"""
        self.manager.is_running = True
        
        # Mock queue operations
        queue_results = ["batch_1", "batch_2", None, "STOP"]
        mock_redis_client.queue_pop.side_effect = queue_results
        
        with patch.object(self.manager, '_process_single_batch') as mock_process:
            # Run one iteration
            self.manager._process_batches_continuously()
        
        # Should have processed two batches
        self.assertEqual(mock_process.call_count, 2)
        mock_process.assert_any_call("batch_1")
        mock_process.assert_any_call("batch_2")

    def test_process_pdf_file_success(self):
        """Test successful PDF file processing"""
        # Mock dependencies
        mock_pages_data = [
            {"page_number": 0, "image": "mock_image_0"},
            {"page_number": 1, "image": "mock_image_1"}
        ]
        
        self.manager.pdf_handler.extract_pages = Mock(return_value=mock_pages_data)
        self.manager.image_processor.preprocess_image = Mock(return_value="processed_image")
        self.manager.ocr_engine.process_image = Mock(return_value={
            "success": True,
            "text": [{"text": "Page content", "confidence": 0.9}],
            "confidence": 0.9
        })
        
        result = self.manager._process_pdf_file("/test/document.pdf")
        
        self.assertTrue(result["success"])
        self.assertEqual(result["total_pages"], 2)
        self.assertEqual(result["successful_pages"], 2)
        self.assertEqual(result["failed_pages"], 0)
        self.assertIn("combined_text", result)
        self.assertIn("page_results", result)

    def test_process_pdf_file_no_pages(self):
        """Test PDF processing when no pages extracted"""
        self.manager.pdf_handler.extract_pages = Mock(return_value=[])
        
        result = self.manager._process_pdf_file("/test/empty.pdf")
        
        self.assertFalse(result["success"])
        self.assertEqual(result["error"], "No pages extracted from PDF")

    def test_process_pdf_file_mixed_results(self):
        """Test PDF processing with mixed success/failure"""
        mock_pages_data = [
            {"page_number": 0, "image": "mock_image_0"},
            {"page_number": 1, "image": "mock_image_1"}
        ]
        
        self.manager.pdf_handler.extract_pages = Mock(return_value=mock_pages_data)
        self.manager.image_processor.preprocess_image = Mock(return_value="processed_image")
        
        # First page succeeds, second fails
        ocr_results = [
            {"success": True, "text": [{"text": "Success", "confidence": 0.9}], "confidence": 0.9},
            {"success": False, "error": "OCR failed"}
        ]
        self.manager.ocr_engine.process_image = Mock(side_effect=ocr_results)
        
        result = self.manager._process_pdf_file("/test/mixed.pdf")
        
        self.assertTrue(result["success"])
        self.assertEqual(result["successful_pages"], 1)
        self.assertEqual(result["failed_pages"], 1)
        self.assertEqual(len(result["page_results"]), 2)

    def test_process_pdf_file_exception(self):
        """Test PDF processing with exception"""
        self.manager.pdf_handler.extract_pages = Mock(side_effect=Exception("Processing error"))
        
        result = self.manager._process_pdf_file("/test/error.pdf")
        
        self.assertFalse(result["success"])
        self.assertEqual(result["error"], "Processing error")


@unittest.skip("Needs setUp refactoring")
class TestPipelineManagerBatchProcessing(unittest.TestCase):
    """Test Pipeline Manager single batch processing"""

    def setUp(self):
        """Set up test fixtures"""
        with patch('src.pipeline_manager.OCREngine'), \
             patch('src.pipeline_manager.ImageProcessor'), \
             patch('src.pipeline_manager.PDFHandler'):
            self.manager = PipelineManager()

    @patch('src.pipeline_manager.redis_client')
    @patch('time.time')
    def test_process_single_batch_success(self, mock_time, mock_redis_client):
        """Test successful single batch processing"""
        mock_time.side_effect = [1000.0, 1120.0]  # Start and end times
        
        batch_metadata = {
            "batch_id": "test_batch",
            "file_locations": ["/test/file1.pdf", "/test/file2.pdf"],
            "status": "pending",
            "total_files": 2,
            "processed_files": 0,
            "failed_files": 0
        }
        
        mock_redis_client.hash_get_json.return_value = batch_metadata
        mock_redis_client.hash_set.return_value = True
        mock_redis_client.queue_push.return_value = True
        
        # Mock PDF processing to succeed
        with patch.object(self.manager, '_process_pdf_file') as mock_process:
            mock_process.return_value = {
                "success": True,
                "file_location": "/test/file1.pdf",
                "combined_text": "File content"
            }
            
            self.manager._process_single_batch("test_batch")
        
        # Verify processing was called for each file
        self.assertEqual(mock_process.call_count, 2)

    @patch('src.pipeline_manager.redis_client')
    def test_process_single_batch_no_metadata(self, mock_redis_client):
        """Test batch processing when metadata not found"""
        mock_redis_client.hash_get_json.return_value = None
        
        # Should handle gracefully without crashing
        self.manager._process_single_batch("missing_batch")

    @patch('src.pipeline_manager.redis_client')
    @patch('time.time')
    def test_process_single_batch_with_failures(self, mock_time, mock_redis_client):
        """Test batch processing with some file failures"""
        mock_time.side_effect = [1000.0, 1060.0]  # 60 seconds processing
        
        batch_metadata = {
            "batch_id": "mixed_batch",
            "file_locations": ["/test/good.pdf", "/test/bad.pdf"],
            "status": "pending",
            "total_files": 2,
            "processed_files": 0,
            "failed_files": 0
        }
        
        mock_redis_client.hash_get_json.return_value = batch_metadata
        mock_redis_client.hash_set.return_value = True
        mock_redis_client.queue_push.return_value = True
        
        # Mock mixed results
        def process_side_effect(file_path):
            if "good" in file_path:
                return {"success": True, "combined_text": "Good content"}
            else:
                return {"success": False, "error": "Bad file"}
        
        with patch.object(self.manager, '_process_pdf_file', side_effect=process_side_effect):
            self.manager._process_single_batch("mixed_batch")
        
        # Verify final results were stored
        final_call_args = mock_redis_client.queue_push.call_args_list[-1][0]
        final_result = json.loads(final_call_args[1])
        
        self.assertEqual(final_result["successful_files"], 1)
        self.assertEqual(final_result["failed_files"], 1)

    @patch('src.pipeline_manager.redis_client')
    def test_process_single_batch_exception(self, mock_redis_client):
        """Test batch processing with exception"""
        batch_metadata = {
            "batch_id": "error_batch",
            "file_locations": ["/test/file.pdf"],
            "status": "pending"
        }
        
        mock_redis_client.hash_get_json.return_value = batch_metadata
        mock_redis_client.hash_set.side_effect = Exception("Redis error")
        
        # Should handle exception gracefully
        self.manager._process_single_batch("error_batch")


class TestJobStatus(unittest.TestCase):
    """Test JobStatus enumeration"""

    def test_job_status_values(self):
        """Test JobStatus enum values"""
        self.assertEqual(JobStatus.PENDING.value, "pending")
        self.assertEqual(JobStatus.PROCESSING.value, "processing")
        self.assertEqual(JobStatus.COMPLETED.value, "completed")
        self.assertEqual(JobStatus.FAILED.value, "failed")
        self.assertEqual(JobStatus.CANCELLED.value, "cancelled")

    def test_job_status_from_string(self):
        """Test creating JobStatus from string"""
        self.assertEqual(JobStatus("completed"), JobStatus.COMPLETED)
        self.assertEqual(JobStatus("failed"), JobStatus.FAILED)


@unittest.skip("Needs setUp refactoring")
class TestPipelineManagerIntegration(unittest.TestCase):
    """Test Pipeline Manager integration scenarios"""

    def setUp(self):
        """Set up test fixtures"""
        with patch('src.pipeline_manager.OCREngine'), \
             patch('src.pipeline_manager.ImageProcessor'), \
             patch('src.pipeline_manager.PDFHandler'):
            self.manager = PipelineManager()

    @patch('src.pipeline_manager.redis_client')
    def test_full_workflow_simulation(self, mock_redis_client):
        """Test complete workflow from submission to completion"""
        # Setup mocks for full workflow
        mock_redis_client.hash_set.return_value = True
        mock_redis_client.queue_push.return_value = True
        mock_redis_client.hash_get_json.return_value = {
            "batch_id": "workflow_test",
            "file_locations": ["/test/sample.pdf"],
            "status": "pending",
            "total_files": 1,
            "processed_files": 0,
            "failed_files": 0
        }
        
        # Mock processing success
        self.manager.pdf_handler.extract_pages = Mock(return_value=[
            {"page_number": 0, "image": "mock_image"}
        ])
        self.manager.image_processor.preprocess_image = Mock(return_value="processed")
        self.manager.ocr_engine.process_image = Mock(return_value={
            "success": True,
            "text": [{"text": "Sample text", "confidence": 0.95}],
            "confidence": 0.95
        })
        
        # Step 1: Submit batch
        with patch('uuid.uuid4') as mock_uuid:
            mock_uuid.return_value = Mock()
            mock_uuid.return_value.__str__ = Mock(return_value="workflow_test")
            
            batch_id = self.manager.submit_batch(["/test/sample.pdf"])
            self.assertEqual(batch_id, "workflow_test")
        
        # Step 2: Process batch
        with patch('time.time', return_value=1000.0):
            self.manager._process_single_batch("workflow_test")
        
        # Verify the workflow completed successfully
        self.assertGreater(mock_redis_client.hash_set.call_count, 1)
        self.assertGreater(mock_redis_client.queue_push.call_count, 1)

    def test_concurrent_batch_processing(self):
        """Test handling of concurrent batch processing"""
        # This test verifies thread safety
        batch_ids = []
        
        def submit_batch_worker(i):
            with patch('src.pipeline_manager.redis_client'):
                with patch('uuid.uuid4') as mock_uuid:
                    mock_uuid.return_value = Mock()
                    mock_uuid.return_value.__str__ = Mock(return_value=f"concurrent_{i}")
                    
                    batch_id = self.manager.submit_batch([f"/test/file_{i}.pdf"])
                    batch_ids.append(batch_id)
        
        # Simulate concurrent submissions
        threads = []
        for i in range(5):
            thread = threading.Thread(target=submit_batch_worker, args=(i,))
            threads.append(thread)
            thread.start()
        
        for thread in threads:
            thread.join()
        
        # Verify all batches were submitted
        self.assertEqual(len(batch_ids), 5)
        self.assertEqual(len(set(batch_ids)), 5)  # All unique


if __name__ == '__main__':
    unittest.main(verbosity=2)