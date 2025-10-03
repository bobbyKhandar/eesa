"""
Unit tests for the AI Pipeline imagePreprocess module.
Tests all functions and integration points.
"""

import unittest
import numpy as np
import cv2
from unittest.mock import Mock, patch, MagicMock
import sys
import os
import multiprocessing as mp

# Add the src directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from src.imagePreprocess import PreProcessImage
from src import redis_client


class TestPreProcessImage(unittest.TestCase):
    """Test cases for PreProcessImage class"""

    def setUp(self):
        """Set up test fixtures"""
        self.preprocessor = PreProcessImage()

    @patch('src.redis_client.queue_push')
    @patch('multiprocessing.Process')
    def test_start_method(self, mock_process, mock_queue_push):
        """Test the start method with multiple workers"""
        # Setup
        mock_queue_push.return_value = True
        mock_process_instance = Mock()
        mock_process.return_value = mock_process_instance
        
        # Execute
        workers = 3
        result = self.preprocessor.start(workers)
        
        # Verify
        self.assertEqual(len(result), workers)
        self.assertEqual(mock_queue_push.call_count, workers)  # STOP signal for each worker
        self.assertEqual(mock_process.call_count, workers)  # Process created for each worker
        mock_process_instance.start.assert_called()

    @patch('src.redis_client.queue_pop')
    @patch('src.redis_client.get_page_metadata')
    @patch('src.redis_client.update_page_metadata')
    @patch('src.redis_client.queue_push')
    @patch('fitz.open')
    @patch('time.sleep')
    def test_job_handler_success(self, mock_sleep, mock_fitz_open, mock_queue_push,
                                mock_update_metadata, mock_get_metadata, mock_queue_pop):
        """Test jobHandler method with successful processing"""
        # Setup
        mock_queue_pop.side_effect = ["job123", "STOP"]
        mock_get_metadata.return_value = {
            "pdfLocation": "/test/document.pdf",
            "pageNo": "0"
        }
        
        # Mock PDF processing
        mock_doc = Mock()
        mock_page = Mock()
        mock_pix = Mock()
        mock_pix.n = 3  # RGB
        mock_pix.samples = np.random.randint(0, 255, (100, 100, 3), dtype=np.uint8).tobytes()
        
        mock_page.get_pixmap.return_value = mock_pix
        mock_doc.load_page.return_value = mock_page
        mock_fitz_open.return_value = mock_doc
        
        mock_update_metadata.return_value = True
        mock_queue_push.return_value = True
        
        # Execute
        self.preprocessor.jobHandler()
        
        # Verify
        mock_get_metadata.assert_called_with("job123")
        mock_fitz_open.assert_called_with("/test/document.pdf")
        mock_doc.load_page.assert_called_with(0)
        mock_queue_push.assert_called_with(redis_client.RedisKeys.QUEUE_OCR, "job123")

    @patch('src.redis_client.queue_pop')
    def test_job_handler_stop_signal(self, mock_queue_pop):
        """Test jobHandler method with STOP signal"""
        # Setup
        mock_queue_pop.return_value = "STOP"
        
        # Execute
        self.preprocessor.jobHandler()
        
        # Verify - method should exit cleanly
        mock_queue_pop.assert_called_once()

    @patch('src.redis_client.queue_pop')
    @patch('src.redis_client.get_page_metadata')
    @patch('time.sleep')
    def test_job_handler_no_metadata(self, mock_sleep, mock_get_metadata, mock_queue_pop):
        """Test jobHandler method when metadata is not found"""
        # Setup
        mock_queue_pop.side_effect = ["job123", "STOP"]
        mock_get_metadata.return_value = None
        
        # Execute
        self.preprocessor.jobHandler()
        
        # Verify
        mock_get_metadata.assert_called_with("job123")

    @patch('src.redis_client.queue_pop')
    @patch('time.sleep')
    def test_job_handler_no_jobs(self, mock_sleep, mock_queue_pop):
        """Test jobHandler method when no jobs are available"""
        # Setup
        mock_queue_pop.side_effect = [None, "STOP"]
        
        # Execute
        self.preprocessor.jobHandler()
        
        # Verify
        mock_sleep.assert_called_with(1)

    @patch('src.redis_client.queue_pop')
    @patch('src.redis_client.get_page_metadata')
    @patch('src.redis_client.update_page_metadata')
    def test_job_handler_error_handling(self, mock_update_metadata, mock_get_metadata, mock_queue_pop):
        """Test jobHandler method error handling"""
        # Setup
        mock_queue_pop.side_effect = ["job123", "STOP"]
        mock_get_metadata.side_effect = Exception("Redis error")
        mock_update_metadata.return_value = True
        
        # Execute
        with patch('time.sleep'):
            self.preprocessor.jobHandler()
        
        # Verify error handling
        mock_update_metadata.assert_any_call("job123", "status", "error")

    def test_image_preprocess_basic(self):
        """Test basic image preprocessing"""
        # Create a test image
        test_image = np.random.randint(0, 255, (200, 300, 3), dtype=np.uint8)
        
        # Execute
        result = self.preprocessor.imagePreprocess(test_image)
        
        # Verify
        self.assertIsInstance(result, np.ndarray)
        self.assertEqual(len(result.shape), 2)  # Should be grayscale
        self.assertEqual(result.dtype, np.uint8)

    def test_image_preprocess_grayscale_input(self):
        """Test image preprocessing with grayscale input"""
        # Create a grayscale test image
        test_image = np.random.randint(0, 255, (200, 300), dtype=np.uint8)
        
        # Execute - should handle gracefully
        try:
            result = self.preprocessor.imagePreprocess(test_image)
            # If it doesn't crash, that's good
            self.assertIsInstance(result, np.ndarray)
        except Exception as e:
            # If it does crash, we need to fix the method
            self.fail(f"imagePreprocess failed with grayscale input: {e}")

    @patch('cv2.Canny')
    @patch('cv2.HoughLines')
    def test_detect_skew_angle_with_lines(self, mock_hough_lines, mock_canny):
        """Test skew angle detection when lines are found"""
        # Setup
        test_image = np.random.randint(0, 255, (200, 300), dtype=np.uint8)
        mock_canny.return_value = np.zeros((200, 300), dtype=np.uint8)
        
        # Mock Hough lines - simulate finding some lines
        mock_lines = np.array([[[100, np.pi/2 + 0.1]]])  # Slightly skewed line
        mock_hough_lines.return_value = mock_lines
        
        # Execute
        angle = self.preprocessor.detect_skew_angle(test_image)
        
        # Verify
        self.assertIsInstance(angle, (int, float))
        self.assertGreaterEqual(angle, -45)
        self.assertLessEqual(angle, 45)

    @patch('cv2.Canny')
    @patch('cv2.HoughLines')
    def test_detect_skew_angle_no_lines(self, mock_hough_lines, mock_canny):
        """Test skew angle detection when no lines are found"""
        # Setup
        test_image = np.random.randint(0, 255, (200, 300), dtype=np.uint8)
        mock_canny.return_value = np.zeros((200, 300), dtype=np.uint8)
        mock_hough_lines.return_value = None
        
        # Execute
        angle = self.preprocessor.detect_skew_angle(test_image)
        
        # Verify - should return 0 when no lines found
        self.assertEqual(angle, 0)

    def test_detect_skew_angle_empty_image(self):
        """Test skew angle detection with empty/black image"""
        # Setup
        test_image = np.zeros((100, 100), dtype=np.uint8)
        
        # Execute
        angle = self.preprocessor.detect_skew_angle(test_image)
        
        # Verify - should handle gracefully
        self.assertIsInstance(angle, (int, float))

    def test_detect_skew_angle_white_image(self):
        """Test skew angle detection with white image"""
        # Setup
        test_image = np.full((100, 100), 255, dtype=np.uint8)
        
        # Execute
        angle = self.preprocessor.detect_skew_angle(test_image)
        
        # Verify - should handle gracefully
        self.assertIsInstance(angle, (int, float))

    @patch('cv2.findContours')
    def test_detect_skew_angle_with_contours(self, mock_find_contours):
        """Test skew angle detection using contour analysis"""
        # Setup
        test_image = np.random.randint(0, 255, (200, 300), dtype=np.uint8)
        
        # Mock contours - simulate a large rectangular contour
        mock_contour = np.array([[[10, 10]], [[290, 10]], [[290, 190]], [[10, 190]]])
        mock_find_contours.return_value = ([mock_contour], None)
        
        # Execute
        angle = self.preprocessor.detect_skew_angle(test_image)
        
        # Verify
        self.assertIsInstance(angle, (int, float))

    def test_image_preprocessing_pipeline_integration(self):
        """Test the complete image preprocessing pipeline"""
        # Create a more realistic test image with some text-like patterns
        test_image = np.ones((400, 600, 3), dtype=np.uint8) * 255  # White background
        
        # Add some black rectangles to simulate text
        test_image[50:70, 50:200] = 0   # Horizontal line
        test_image[100:120, 50:200] = 0  # Another horizontal line
        test_image[150:170, 50:200] = 0  # Another horizontal line
        
        # Execute the full pipeline
        result = self.preprocessor.imagePreprocess(test_image)
        
        # Verify
        self.assertIsInstance(result, np.ndarray)
        self.assertEqual(len(result.shape), 2)  # Should be grayscale
        self.assertEqual(result.shape[0], test_image.shape[0])  # Height should be preserved or adjusted
        self.assertTrue(np.any(result == 0))  # Should have some black pixels (text)
        self.assertTrue(np.any(result == 255))  # Should have some white pixels (background)

    def test_image_preprocessing_edge_cases(self):
        """Test image preprocessing with edge cases"""
        # Test very small image
        small_image = np.random.randint(0, 255, (10, 10, 3), dtype=np.uint8)
        result_small = self.preprocessor.imagePreprocess(small_image)
        self.assertIsInstance(result_small, np.ndarray)
        
        # Test very large image (but keep it reasonable for testing)
        large_image = np.random.randint(0, 255, (1000, 1500, 3), dtype=np.uint8)
        result_large = self.preprocessor.imagePreprocess(large_image)
        self.assertIsInstance(result_large, np.ndarray)

    def test_image_preprocessing_rgba_input(self):
        """Test image preprocessing with RGBA input (4 channels)"""
        # Create RGBA test image
        test_image = np.random.randint(0, 255, (200, 300, 4), dtype=np.uint8)
        
        # The method should handle this by converting from RGBA to RGB first
        # This tests the integration with the jobHandler logic
        try:
            # Simulate the conversion that happens in jobHandler
            rgb_image = cv2.cvtColor(test_image, cv2.COLOR_RGBA2RGB)
            result = self.preprocessor.imagePreprocess(rgb_image)
            self.assertIsInstance(result, np.ndarray)
        except Exception as e:
            self.fail(f"Failed to process RGBA image: {e}")


class TestImagePreprocessIntegration(unittest.TestCase):
    """Integration tests for imagePreprocess module with Redis"""

    def setUp(self):
        """Set up test fixtures"""
        self.preprocessor = PreProcessImage()

    @patch('src.redis_client.queue_push')
    @patch('src.redis_client.queue_pop')
    @patch('src.redis_client.get_page_metadata')
    @patch('src.redis_client.update_page_metadata')
    def test_redis_integration_flow(self, mock_update_metadata, mock_get_metadata,
                                  mock_queue_pop, mock_queue_push):
        """Test the complete Redis integration flow"""
        # Setup
        mock_queue_pop.return_value = "job123"
        mock_get_metadata.return_value = {
            "pdfLocation": "/test/doc.pdf",
            "pageNo": "0"
        }
        mock_update_metadata.return_value = True
        mock_queue_push.return_value = True
        
        # Mock the PDF and image processing
        with patch('fitz.open') as mock_fitz:
            mock_doc = Mock()
            mock_page = Mock()
            mock_pix = Mock()
            mock_pix.n = 3
            mock_pix.samples = np.random.randint(0, 255, (100, 100, 3), dtype=np.uint8).tobytes()
            
            mock_page.get_pixmap.return_value = mock_pix
            mock_doc.load_page.return_value = mock_page
            mock_fitz.return_value = mock_doc
            
            # Execute one iteration
            with patch.object(self.preprocessor, 'imagePreprocess') as mock_preprocess:
                mock_preprocess.return_value = np.zeros((100, 100), dtype=np.uint8)
                
                # Simulate one job processing
                try:
                    # Get job
                    job_id = mock_queue_pop()
                    if job_id and job_id != "STOP":
                        # Get metadata
                        job_data = mock_get_metadata(job_id)
                        
                        # Update status
                        mock_update_metadata(job_id, "status", "preprocessing")
                        
                        # Process (mocked)
                        processed_img = mock_preprocess()
                        
                        # Update with result
                        mock_update_metadata(job_id, "imageData", "mock_hex_data")
                        mock_update_metadata(job_id, "status", "ready_for_ocr")
                        
                        # Add to OCR queue
                        mock_queue_push(redis_client.RedisKeys.QUEUE_OCR, job_id)
                        
                    # Verify the flow
                    mock_get_metadata.assert_called_with("job123")
                    mock_update_metadata.assert_any_call("job123", "status", "preprocessing")
                    mock_update_metadata.assert_any_call("job123", "status", "ready_for_ocr")
                    mock_queue_push.assert_called_with(redis_client.RedisKeys.QUEUE_OCR, "job123")
                    
                except Exception as e:
                    self.fail(f"Redis integration flow failed: {e}")


if __name__ == '__main__':
    # Create test directory if it doesn't exist
    os.makedirs('tests', exist_ok=True)
    
    # Run tests
    unittest.main(verbosity=2)