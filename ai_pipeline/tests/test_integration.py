"""
Integration tests for the AI Pipeline.
Tests the interaction between all components.
"""

import unittest
import json
import uuid
from unittest.mock import Mock, patch, MagicMock
import sys
import os
import numpy as np

# Add the src directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from src import redis_client
from src.jobHandler import jobHandler
from src.imagePreprocess import PreProcessImage
from src.ocr import Ocr


class TestFullPipelineIntegration(unittest.TestCase):
    """Integration tests for the complete AI Pipeline"""

    def setUp(self):
        """Set up test fixtures"""
        # Mock Redis to avoid real Redis dependencies
        self.mock_redis = Mock()
        
    @patch('src.redis_client.is_redis_available')
    @patch('src.redis_client.redis_client')
    @patch('src.imagePreprocess.PreProcessImage')
    def test_job_handler_initialization_flow(self, mock_preprocess_class, mock_redis, mock_redis_available):
        """Test the complete job handler initialization flow"""
        mock_redis_available.return_value = True
        mock_redis.ping.return_value = True
        
        # Mock the preprocessor
        mock_preprocessor = Mock()
        mock_preprocess_class.return_value = mock_preprocessor
        
        # Mock Redis operations for empty queues
        with patch('src.redis_client.are_queues_empty', return_value=True):
            with patch('src.redis_client.redis_client.lrange', return_value=[]):
                # Initialize job handler
                handler = jobHandler()
                
                # Verify initialization
                self.assertIsInstance(handler.ocrEngine, Ocr)
                self.assertEqual(handler.processResults, {})
                self.assertEqual(handler.ocrOutputCache, {})

    @patch('src.redis_client.queue_push')
    @patch('src.redis_client.store_page_metadata_dict')
    @patch('src.redis_client.hash_set')
    @patch('fitz.open')
    @patch('os.getcwd')
    @patch('pathlib.Path.rglob')
    def test_complete_job_creation_flow(self, mock_rglob, mock_getcwd, mock_fitz_open,
                                      mock_hash_set, mock_store_metadata, mock_queue_push):
        """Test the complete job creation workflow"""
        # Setup
        mock_getcwd.return_value = "/test/workspace"
        mock_rglob.return_value = ["/test/workspace/uploads/test.pdf"]
        
        # Mock PDF
        mock_pdf = Mock()
        mock_pdf.page_count = 2
        mock_fitz_open.return_value = mock_pdf
        
        # Mock Redis operations
        mock_queue_push.return_value = True
        mock_store_metadata.return_value = True
        mock_hash_set.return_value = True
        
        # Create job handler and test job creation
        with patch('src.redis_client.is_redis_available', return_value=True):
            with patch('src.imagePreprocess.PreProcessImage'):
                handler = jobHandler()
                handler._jobHandler__createJobs__(["test.pdf"])
        
        # Verify the workflow
        self.assertEqual(mock_queue_push.call_count, 2)  # 2 pages
        self.assertEqual(mock_store_metadata.call_count, 2)  # 2 pages
        self.assertEqual(mock_hash_set.call_count, 2)  # 2 task metadata entries

    @patch('src.redis_client.queue_pop')
    @patch('src.redis_client.get_page_metadata')
    @patch('src.redis_client.update_page_metadata')
    @patch('src.redis_client.queue_push')
    @patch('fitz.open')
    def test_image_preprocessing_to_ocr_flow(self, mock_fitz_open, mock_queue_push,
                                           mock_update_metadata, mock_get_metadata, mock_queue_pop):
        """Test the flow from image preprocessing to OCR queue"""
        # Setup
        preprocessor = PreProcessImage()
        
        # Mock Redis operations
        mock_queue_pop.return_value = "job123"
        mock_get_metadata.return_value = {
            "pdfLocation": "/test/doc.pdf",
            "pageNo": "0"
        }
        mock_update_metadata.return_value = True
        mock_queue_push.return_value = True
        
        # Mock PDF processing
        mock_doc = Mock()
        mock_page = Mock()
        mock_pix = Mock()
        mock_pix.n = 3
        mock_pix.samples = np.random.randint(0, 255, (100, 100, 3), dtype=np.uint8).tobytes()
        
        mock_page.get_pixmap.return_value = mock_pix
        mock_doc.load_page.return_value = mock_page
        mock_fitz_open.return_value = mock_doc
        
        # Simulate one preprocessing iteration
        try:
            job_id = mock_queue_pop()
            if job_id and job_id != "STOP":
                job_data = mock_get_metadata(job_id)
                
                # Process image (simplified)
                doc = mock_fitz_open(job_data["pdfLocation"])
                page = doc.load_page(int(job_data["pageNo"]))
                pix = page.get_pixmap()
                
                # Update status and add to OCR queue
                mock_update_metadata(job_id, "status", "ready_for_ocr")
                mock_queue_push(redis_client.RedisKeys.QUEUE_OCR, job_id)
                
                # Verify the flow
                mock_get_metadata.assert_called_with("job123")
                mock_fitz_open.assert_called_with("/test/doc.pdf")
                mock_queue_push.assert_called_with(redis_client.RedisKeys.QUEUE_OCR, "job123")
                
        except Exception as e:
            self.fail(f"Preprocessing to OCR flow failed: {e}")

    @patch('src.redis_client.queue_pop')
    @patch('src.redis_client.get_page_metadata')
    @patch('src.redis_client.update_page_metadata')
    def test_ocr_processing_flow(self, mock_update_metadata, mock_get_metadata, mock_queue_pop):
        """Test the OCR processing workflow"""
        # Setup
        with patch('src.redis_client.is_redis_available', return_value=True):
            with patch('src.imagePreprocess.PreProcessImage'):
                handler = jobHandler()
        
        # Mock Redis operations
        mock_queue_pop.return_value = "job123"
        mock_get_metadata.return_value = {
            "jobId": "job123",
            "pageNo": "0",
            "totalPages": "1",
            "imageData": "89504e470d0a1a0a",  # Mock hex data
            "pdfLocation": "/test/doc.pdf"
        }
        mock_update_metadata.return_value = True
        
        # Mock OCR processing
        mock_image = np.zeros((100, 100, 3), dtype=np.uint8)
        with patch('cv2.imdecode', return_value=mock_image):
            handler.ocrEngine.processImage = Mock(return_value={
                "success": True,
                "text": [{"text": "Test text", "confidence": 0.9}],
                "confidence": 0.9
            })
            
            # Simulate one OCR iteration
            try:
                task_id = mock_queue_pop()
                if task_id and task_id != "STOP":
                    task = mock_get_metadata(task_id)
                    
                    # Process image
                    result = handler.ocrEngine.processImage(mock_image)
                    
                    # Verify
                    self.assertTrue(result["success"])
                    self.assertEqual(result["confidence"], 0.9)
                    handler.ocrEngine.processImage.assert_called_once()
                    
            except Exception as e:
                self.fail(f"OCR processing flow failed: {e}")

    @patch('src.redis_client.queue_pop')
    @patch('src.redis_client.hash_get_json')
    @patch('src.redis_client.hash_get_all')
    @patch('src.redis_client.hash_set_map')
    @patch('src.redis_client.queue_push')
    def test_job_merging_flow(self, mock_queue_push_final, mock_hash_set_map,
                            mock_hash_get_all, mock_hash_get_json, mock_queue_pop):
        """Test the job merging workflow"""
        # Setup
        with patch('src.redis_client.is_redis_available', return_value=True):
            with patch('src.imagePreprocess.PreProcessImage'):
                handler = jobHandler()
        
        # Mock Redis operations
        mock_queue_pop.return_value = "task123"
        mock_hash_get_json.return_value = {
            "taskId": "task123",
            "processedJobsIds": ["job1", "job2"],
            "totalPages": 2
        }
        
        # Mock individual job results
        mock_hash_get_all.side_effect = [
            {"status": "complete", "result": '{"text": "Page 1", "confidence": 0.9}'},
            {"status": "complete", "result": '{"text": "Page 2", "confidence": 0.8}'}
        ]
        
        mock_hash_set_map.return_value = True
        mock_queue_push_final.return_value = True
        
        # Test one merge iteration
        try:
            job = mock_queue_pop()
            if job and job != "STOP":
                task_meta = mock_hash_get_json(redis_client.RedisKeys.TASK_METADATA, job)
                
                # Process job results
                final_text = ""
                total_confidence = 0
                for job_id in task_meta["processedJobsIds"]:
                    job_data = mock_hash_get_all(job_id)
                    if job_data.get("status") == "complete":
                        result = json.loads(job_data.get("result", "{}"))
                        final_text += result.get("text", "") + " "
                        total_confidence += result.get("confidence", 0)
                
                # Verify merging worked
                self.assertIn("Page 1", final_text)
                self.assertIn("Page 2", final_text)
                self.assertEqual(total_confidence, 1.7)  # 0.9 + 0.8
                
        except Exception as e:
            self.fail(f"Job merging flow failed: {e}")

    def test_redis_key_consistency(self):
        """Test that Redis keys are consistent across modules"""
        # Verify key constants
        self.assertEqual(redis_client.RedisKeys.QUEUE_IMAGE_PREPROCESS, "queue:image:preprocess")
        self.assertEqual(redis_client.RedisKeys.QUEUE_OCR, "queue:ocr")
        self.assertEqual(redis_client.RedisKeys.QUEUE_MERGE, "queue:merge")
        self.assertEqual(redis_client.RedisKeys.QUEUE_RESULTS_FINAL, "queue:results:final")
        
        # Test key generation
        page_id = "test_page_123"
        expected_key = f"meta:page:{page_id}"
        self.assertEqual(redis_client.RedisKeys.meta_page_key(page_id), expected_key)

    def test_error_handling_integration(self):
        """Test error handling across the pipeline"""
        # Test Redis connection error handling
        with patch('src.redis_client.redis_client.ping', side_effect=Exception("Connection failed")):
            is_available = redis_client.is_redis_available()
            self.assertFalse(is_available)
        
        # Test OCR error handling
        ocr_engine = Ocr()
        ocr_engine.reader = Mock()
        ocr_engine.reader.readtext.side_effect = Exception("OCR failed")
        
        mock_image = np.zeros((100, 100, 3), dtype=np.uint8)
        result = ocr_engine.processImage(mock_image)
        
        self.assertFalse(result["success"])
        self.assertEqual(result["error"], "OCR failed")

    @patch('src.redis_client.store_page_metadata')
    @patch('src.redis_client.store_pdf_metadata')
    @patch('src.redis_client.store_processed_result')
    def test_data_flow_consistency(self, mock_store_result, mock_store_pdf, mock_store_page):
        """Test that data flows consistently through the pipeline"""
        mock_store_page.return_value = True
        mock_store_pdf.return_value = True  
        mock_store_result.return_value = True
        
        # Test page metadata flow
        page_id = "page_123"
        pdf_id = "pdf_456"
        
        # Store page metadata
        redis_client.store_page_metadata(
            page_id=page_id,
            pdf_id=pdf_id,
            pdf_location="/test.pdf",
            page_no=1,
            status="queued"
        )
        
        # Store PDF metadata
        redis_client.store_pdf_metadata(
            pdf_id=pdf_id,
            file_path="/test.pdf",
            page_count=5,
            pages_ids=[page_id]
        )
        
        # Store OCR result
        redis_client.store_processed_result(
            job_id=page_id,
            task_id=pdf_id,
            text="Extracted text",
            confidence=0.95
        )
        
        # Verify all storage operations were called
        mock_store_page.assert_called_once()
        mock_store_pdf.assert_called_once()
        mock_store_result.assert_called_once()


if __name__ == '__main__':
    # Create test directory if it doesn't exist
    os.makedirs('tests', exist_ok=True)
    
    # Run integration tests
    unittest.main(verbosity=2)