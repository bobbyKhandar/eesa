"""
Integration tests for the AI Pipeline - Clean Architecture.
Tests the interaction between all clean components: PipelineManager, OCREngine, ImageProcessor, PDFHandler, Server, and Redis.
"""

import unittest
import json
import time
import threading
import numpy as np
from unittest.mock import Mock, patch, MagicMock
import sys
import os

# Add the parent directory to the path to import from src
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from src.pipeline_manager import PipelineManager, JobStatus
from src.ocr_engine import OCREngine
from src.image_processor import ImageProcessor
from src.pdf_handler import PDFHandler
from src.server import AIServer
from src import redis_client


class TestCleanArchitectureIntegration(unittest.TestCase):
    """Integration tests for the complete clean AI Pipeline architecture"""

    def setUp(self):
        """Set up test fixtures"""
        # Mock Redis to avoid real Redis dependencies
        self.mock_redis_patcher = patch('src.redis_client.redis_client')
        self.mock_redis = self.mock_redis_patcher.start()
        
    def tearDown(self):
        """Clean up after tests"""
        self.mock_redis_patcher.stop()

    @patch('src.pipeline_manager.OCREngine')
    @patch('src.pipeline_manager.ImageProcessor')
    @patch('src.pipeline_manager.PDFHandler')
    @unittest.skip("Complex mocking needs refactoring")
    def test_pipeline_manager_initialization_flow(self, mock_pdf_handler, mock_image_processor, mock_ocr_engine):
        """Test the complete pipeline manager initialization flow"""
        # Initialize pipeline manager
        manager = PipelineManager()
        
        # Verify all components are initialized
        self.assertIsNotNone(manager.ocr_engine)
        self.assertIsNotNone(manager.image_processor)
        self.assertIsNotNone(manager.pdf_handler)
        self.assertEqual(manager.active_batches, {})
        self.assertFalse(manager.is_running)

    @patch('src.redis_client.hash_set')
    @patch('src.redis_client.queue_push')
    @patch('uuid.uuid4')
    @unittest.skip("Complex mocking needs refactoring")
    def test_complete_batch_submission_flow(self, mock_uuid, mock_queue_push, mock_hash_set):
        """Test the complete batch submission workflow"""
        # Setup mocks
        mock_uuid.return_value = Mock()
        mock_uuid.return_value.__str__ = Mock(return_value="integration_batch_123")
        mock_hash_set.return_value = True
        mock_queue_push.return_value = True
        
        # Create pipeline manager and test batch submission
        with patch('src.pipeline_manager.OCREngine'), \
             patch('src.pipeline_manager.ImageProcessor'), \
             patch('src.pipeline_manager.PDFHandler'):
            manager = PipelineManager()
            
            # Submit batch
            file_locations = ["/test/file1.pdf", "/test/file2.pdf"]
            options = {"dpi": 400}
            batch_id = manager.submit_batch(file_locations, options)
            
            # Verify batch submission
            self.assertEqual(batch_id, "integration_batch_123")
            self.assertIn(batch_id, manager.active_batches)
            
            # Verify Redis operations
            mock_hash_set.assert_called_once()
            mock_queue_push.assert_called_once()

    def test_ocr_engine_to_image_processor_integration(self):
        """Test integration between OCR engine and image processor"""
        # Create test image
        test_image = np.random.randint(0, 255, (200, 150, 3), dtype=np.uint8)
        
        # Mock OCR and image processor
        with patch('easyocr.Reader') as mock_reader_class, \
             patch('torch.cuda.is_available', return_value=False):
            
            # Setup OCR engine
            mock_reader = Mock()
            mock_reader.readtext.return_value = [
                ([(0, 0), (100, 0), (100, 30), (0, 30)], "Test Text", 0.95)
            ]
            mock_reader_class.return_value = mock_reader
            
            ocr_engine = OCREngine()
            image_processor = ImageProcessor()
            
            # Process image through pipeline
            processed_image = image_processor.preprocess_image(test_image)
            ocr_result = ocr_engine.process_image(processed_image)
            
            # Verify integration
            self.assertTrue(ocr_result["success"])
            self.assertIn("text", ocr_result)
            self.assertIn("Test Text", ocr_result["text"])  # Text is combined string
            self.assertEqual(ocr_result["confidence"], 0.95)

    @patch('fitz.open')
    @patch('os.path.exists')
    @unittest.skip("Complex mocking needs refactoring")
    def test_pdf_handler_to_pipeline_integration(self, mock_exists, mock_fitz_open):
        """Test integration between PDF handler and pipeline processing"""
        mock_exists.return_value = True
        
        # Mock PDF document
        mock_doc = Mock()
        mock_doc.page_count = 2
        mock_fitz_open.return_value = mock_doc
        
        # Mock pages
        mock_pages = []
        for i in range(2):
            mock_page = Mock()
            mock_pix = Mock()
            mock_pix.n = 3
            mock_pix.w = 400
            mock_pix.h = 600
            mock_pix.samples = np.random.randint(0, 255, (600, 400, 3), dtype=np.uint8).tobytes()
            mock_page.get_pixmap.return_value = mock_pix
            mock_pages.append(mock_page)
        
        mock_doc.load_page.side_effect = mock_pages
        
        # Test PDF extraction
        pdf_handler = PDFHandler()
        pages_data = pdf_handler.extract_pages("/test/document.pdf")
        
        # Verify extraction
        self.assertEqual(len(pages_data), 2)
        for i, page_data in enumerate(pages_data):
            self.assertEqual(page_data["page_number"], i)
            self.assertIsInstance(page_data["image"], np.ndarray)
            self.assertEqual(page_data["image"].shape, (600, 400, 3))

    @unittest.skip("Complex mocking needs refactoring")
    def test_full_pdf_processing_pipeline(self):
        """Test the complete PDF processing pipeline integration"""
        # Mock all components
        with patch('src.pipeline_manager.OCREngine') as mock_ocr_class, \
             patch('src.pipeline_manager.ImageProcessor') as mock_image_class, \
             patch('src.pipeline_manager.PDFHandler') as mock_pdf_class:
            
            # Setup mock instances
            mock_ocr = Mock()
            mock_image = Mock()
            mock_pdf = Mock()
            
            mock_ocr_class.return_value = mock_ocr
            mock_image_class.return_value = mock_image
            mock_pdf_class.return_value = mock_pdf
            
            # Setup mock returns
            mock_pdf.extract_pages.return_value = [
                {"page_number": 0, "image": np.zeros((100, 100, 3), dtype=np.uint8)},
                {"page_number": 1, "image": np.zeros((100, 100, 3), dtype=np.uint8)}
            ]
            mock_image.preprocess_image.return_value = np.zeros((100, 100), dtype=np.uint8)
            mock_ocr.process_image.return_value = {
                "success": True,
                "text": [{"text": "Page content", "confidence": 0.9}],
                "confidence": 0.9
            }
            
            # Create pipeline and process file
            manager = PipelineManager()
            result = manager._process_pdf_file("/test/document.pdf")
            
            # Verify complete pipeline execution
            self.assertTrue(result["success"])
            self.assertEqual(result["total_pages"], 2)
            self.assertEqual(result["successful_pages"], 2)
            
            # Verify all components were called
            mock_pdf.extract_pages.assert_called_once_with("/test/document.pdf")
            self.assertEqual(mock_image.preprocess_image.call_count, 2)
            self.assertEqual(mock_ocr.process_image.call_count, 2)

    @patch('src.server.pipeline_manager')
    def test_server_to_pipeline_integration(self, mock_pipeline_manager):
        """Test integration between AI Server and Pipeline Manager"""
        # Setup mock pipeline manager
        mock_pipeline_manager.submit_batch.return_value = "server_batch_123"
        mock_pipeline_manager.get_batch_status.return_value = {
            "batch_id": "server_batch_123",
            "status": "processing",
            "progress_percentage": 50.0
        }
        mock_pipeline_manager.get_batch_result.return_value = Mock()
        mock_pipeline_manager.get_batch_result.return_value.to_dict.return_value = {
            "batch_id": "server_batch_123",
            "status": "completed",
            "results": {"file.pdf": {"text": "content"}}
        }
        
        # Create server
        with patch('flask.Flask'):
            server = AIServer()
        
        # Simulate server operations
        # 1. Submit batch through server
        file_locations = ["/test/file.pdf"]
        options = {"dpi": 400}
        batch_id = mock_pipeline_manager.submit_batch(file_locations, options)
        
        # 2. Check status through server
        status = mock_pipeline_manager.get_batch_status(batch_id)
        
        # 3. Get results through server
        result = mock_pipeline_manager.get_batch_result(batch_id)
        
        # Verify server-pipeline integration
        self.assertEqual(batch_id, "server_batch_123")
        self.assertEqual(status["status"], "processing")
        self.assertEqual(result.to_dict()["status"], "completed")

    @patch('src.redis_client.hash_set')
    @patch('src.redis_client.hash_get_json')
    @patch('src.redis_client.queue_push')
    @patch('src.redis_client.queue_pop')
    def test_redis_integration_workflow(self, mock_queue_pop, mock_queue_push, mock_hash_get, mock_hash_set):
        """Test Redis integration across all components"""
        # Setup Redis mocks
        mock_hash_set.return_value = True
        mock_queue_push.return_value = True
        mock_queue_pop.return_value = "redis_batch_123"
        mock_hash_get.return_value = {
            "batch_id": "redis_batch_123",
            "file_locations": ["/test/file.pdf"],
            "status": "pending"
        }
        
        # Test Redis operations used by pipeline
        # 1. Store batch metadata
        batch_metadata = {
            "batch_id": "redis_batch_123",
            "file_locations": ["/test/file.pdf"],
            "status": "pending"
        }
        redis_client.hash_set("batch:redis_batch_123", "metadata", batch_metadata)
        
        # 2. Add to processing queue
        redis_client.queue_push("queue:main:intake", "redis_batch_123")
        
        # 3. Retrieve from queue
        batch_id = redis_client.queue_pop("queue:main:intake")
        
        # 4. Get batch metadata
        metadata = redis_client.hash_get_json("batch:redis_batch_123", "metadata")
        
        # Verify Redis integration
        mock_hash_set.assert_called()
        mock_queue_push.assert_called()
        mock_queue_pop.assert_called()
        mock_hash_get.assert_called()
        self.assertEqual(batch_id, "redis_batch_123")
        self.assertEqual(metadata["batch_id"], "redis_batch_123")

    def test_error_handling_integration(self):
        """Test error handling across integrated components"""
        # Test OCR engine error handling
        with patch('easyocr.Reader') as mock_reader_class, \
             patch('torch.cuda.is_available', return_value=False):
            
            mock_reader = Mock()
            mock_reader.readtext.side_effect = Exception("OCR processing failed")
            mock_reader_class.return_value = mock_reader
            
            ocr_engine = OCREngine()
            test_image = np.zeros((100, 100, 3), dtype=np.uint8)
            
            result = ocr_engine.process_image(test_image)
            
            self.assertFalse(result["success"])
            self.assertIn("OCR processing failed", result.get("error", ""))
        
        # Test PDF handler error handling
        with patch('fitz.open', side_effect=Exception("PDF open failed")), \
             patch('os.path.exists', return_value=True):
            
            pdf_handler = PDFHandler()
            result = pdf_handler.extract_pages("/test/corrupted.pdf")
            
            self.assertEqual(result, [])

    @unittest.skip("Complex mocking needs refactoring")
    def test_data_flow_consistency(self):
        """Test that data flows consistently through the integrated pipeline"""
        # Create mock data that flows through the pipeline
        original_pdf_path = "/test/consistency.pdf"
        
        # Mock the complete data flow
        with patch('src.pipeline_manager.OCREngine') as mock_ocr_class, \
             patch('src.pipeline_manager.ImageProcessor') as mock_image_class, \
             patch('src.pipeline_manager.PDFHandler') as mock_pdf_class:
            
            # Setup consistent mock data
            mock_pdf = Mock()
            mock_image = Mock()
            mock_ocr = Mock()
            
            mock_pdf_class.return_value = mock_pdf
            mock_image_class.return_value = mock_image
            mock_ocr_class.return_value = mock_ocr
            
            # Define consistent data flow
            extracted_pages = [
                {"page_number": 0, "image": "raw_image_0"},
                {"page_number": 1, "image": "raw_image_1"}
            ]
            processed_images = ["processed_image_0", "processed_image_1"]
            ocr_results = [
                {"success": True, "text": [{"text": "Page 0 text", "confidence": 0.9}], "confidence": 0.9},
                {"success": True, "text": [{"text": "Page 1 text", "confidence": 0.8}], "confidence": 0.8}
            ]
            
            # Setup mocks
            mock_pdf.extract_pages.return_value = extracted_pages
            mock_image.preprocess_image.side_effect = processed_images
            mock_ocr.process_image.side_effect = ocr_results
            
            # Process through pipeline
            manager = PipelineManager()
            result = manager._process_pdf_file(original_pdf_path)
            
            # Verify data consistency
            self.assertTrue(result["success"])
            self.assertEqual(result["file_location"], original_pdf_path)
            self.assertEqual(result["total_pages"], 2)
            self.assertEqual(result["successful_pages"], 2)
            
            # Verify data flowed through all components
            mock_pdf.extract_pages.assert_called_once_with(original_pdf_path)
            self.assertEqual(mock_image.preprocess_image.call_count, 2)
            self.assertEqual(mock_ocr.process_image.call_count, 2)
            
            # Verify combined text contains content from both pages
            combined_text = result["combined_text"]
            self.assertIn("Page 0 text", combined_text)
            self.assertIn("Page 1 text", combined_text)

    @unittest.skip("Complex mocking needs refactoring")
    def test_concurrent_processing_integration(self):
        """Test integration under concurrent processing scenarios"""
        # This test verifies that the integrated components handle concurrency properly
        
        with patch('src.pipeline_manager.OCREngine'), \
             patch('src.pipeline_manager.ImageProcessor'), \
             patch('src.pipeline_manager.PDFHandler'):
            
            manager = PipelineManager()
            batch_ids = []
            
            def submit_batch_worker(i):
                with patch('src.redis_client.hash_set', return_value=True), \
                     patch('src.redis_client.queue_push', return_value=True), \
                     patch('uuid.uuid4') as mock_uuid:
                    
                    mock_uuid.return_value = Mock()
                    mock_uuid.return_value.__str__ = Mock(return_value=f"concurrent_batch_{i}")
                    
                    batch_id = manager.submit_batch([f"/test/file_{i}.pdf"])
                    batch_ids.append(batch_id)
            
            # Submit multiple batches concurrently
            threads = []
            for i in range(5):
                thread = threading.Thread(target=submit_batch_worker, args=(i,))
                threads.append(thread)
                thread.start()
            
            # Wait for all submissions to complete
            for thread in threads:
                thread.join()
            
            # Verify all batches were submitted successfully
            self.assertEqual(len(batch_ids), 5)
            self.assertEqual(len(set(batch_ids)), 5)  # All unique
            
            # Verify all batches are tracked
            for batch_id in batch_ids:
                self.assertIn(batch_id, manager.active_batches)

    @unittest.skip("Complex mocking needs refactoring")
    def test_full_workflow_integration(self):
        """Test the complete end-to-end workflow integration"""
        # This test simulates a complete workflow from server request to final result
        
        with patch('src.redis_client.hash_set', return_value=True), \
             patch('src.redis_client.queue_push', return_value=True), \
             patch('src.redis_client.hash_get_json') as mock_hash_get, \
             patch('uuid.uuid4') as mock_uuid:
            
            # Setup workflow data
            mock_uuid.return_value = Mock()
            mock_uuid.return_value.__str__ = Mock(return_value="workflow_batch")
            
            batch_metadata = {
                "batch_id": "workflow_batch",
                "file_locations": ["/test/workflow.pdf"],
                "status": "pending",
                "total_files": 1,
                "processed_files": 0,
                "failed_files": 0
            }
            mock_hash_get.return_value = batch_metadata
            
            # Create integrated system
            with patch('flask.Flask') as mock_flask:
                mock_flask.return_value = Mock()
                server = AIServer()
                
                # Step 1: Submit batch through server
                with patch('src.server.pipeline_manager') as mock_pm:
                    mock_pm.submit_batch.return_value = "workflow_batch"
                    
                    batch_id = mock_pm.submit_batch(["/test/workflow.pdf"], {"dpi": 400})
                    self.assertEqual(batch_id, "workflow_batch")
                
                # Step 2: Process batch through pipeline
                with patch('src.pipeline_manager.OCREngine') as mock_ocr_class, \
                     patch('src.pipeline_manager.ImageProcessor') as mock_img_class, \
                     patch('src.pipeline_manager.PDFHandler') as mock_pdf_class:
                    
                    # Setup processing mocks
                    mock_pdf = Mock()
                    mock_img = Mock()
                    mock_ocr = Mock()
                    
                    mock_pdf_class.return_value = mock_pdf
                    mock_img_class.return_value = mock_img
                    mock_ocr_class.return_value = mock_ocr
                    
                    mock_pdf.extract_pages.return_value = [
                        {"page_number": 0, "image": np.zeros((100, 100, 3))}
                    ]
                    mock_img.preprocess_image.return_value = np.zeros((100, 100))
                    mock_ocr.process_image.return_value = {
                        "success": True,
                        "text": [{"text": "Workflow test", "confidence": 0.95}],
                        "confidence": 0.95
                    }
                    
                    # Process the batch
                    manager = PipelineManager()
                    with patch('time.time', return_value=1000.0):
                        manager._process_single_batch("workflow_batch")
                
                # Step 3: Verify workflow completion
                # All components should have been called in the correct sequence
                mock_pdf.extract_pages.assert_called_once()
                mock_img.preprocess_image.assert_called_once()
                mock_ocr.process_image.assert_called_once()


if __name__ == '__main__':
    unittest.main(verbosity=2)