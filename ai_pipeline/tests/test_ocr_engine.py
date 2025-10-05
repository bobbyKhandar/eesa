"""
Unit tests for OCR Engine - EasyOCR text extraction functionality
Tests initialization, text processing, confidence scoring, and error handling
"""

import unittest
import numpy as np
from unittest.mock import Mock, patch, MagicMock
import sys
import os

# Add the parent directory to the path to import from src
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from src.ocr_engine import OCREngine


class TestOCREngineInitialization(unittest.TestCase):
    """Test OCR Engine initialization and configuration"""

    @patch('torch.cuda.is_available')
    @patch('easyocr.Reader')
    def test_init_default_parameters(self, mock_reader_class, mock_cuda_available):
        """Test OCR engine initialization with default parameters"""
        mock_cuda_available.return_value = True
        mock_reader = Mock()
        mock_reader_class.return_value = mock_reader
        
        engine = OCREngine()
        
        self.assertEqual(engine.languages, ['en'])
        self.assertTrue(engine.gpu)
        mock_reader_class.assert_called_once_with(['en'], gpu=True)

    @patch('torch.cuda.is_available')
    @patch('easyocr.Reader')
    def test_init_custom_parameters(self, mock_reader_class, mock_cuda_available):
        """Test OCR engine initialization with custom parameters"""
        mock_cuda_available.return_value = False
        mock_reader = Mock()
        mock_reader_class.return_value = mock_reader
        
        engine = OCREngine(languages=['en', 'es'], gpu=False)
        
        self.assertEqual(engine.languages, ['en', 'es'])
        self.assertFalse(engine.gpu)
        mock_reader_class.assert_called_once_with(['en', 'es'], gpu=False)

    @patch('torch.cuda.is_available')
    @patch('easyocr.Reader')
    def test_init_auto_gpu_detection(self, mock_reader_class, mock_cuda_available):
        """Test automatic GPU detection during initialization"""
        mock_cuda_available.return_value = False
        mock_reader = Mock()
        mock_reader_class.return_value = mock_reader
        
        engine = OCREngine()
        
        self.assertFalse(engine.gpu)
        mock_reader_class.assert_called_once_with(['en'], gpu=False)

    @patch('torch.cuda.is_available')
    @patch('easyocr.Reader')
    def test_init_gpu_fallback(self, mock_reader_class, mock_cuda_available):
        """Test GPU initialization with CPU fallback"""
        mock_cuda_available.return_value = True
        
        # First call fails (GPU), second call succeeds (CPU fallback)
        mock_reader_class.side_effect = [Exception("GPU initialization failed"), Mock()]
        
        engine = OCREngine()
        
        self.assertFalse(engine.gpu)  # Should fallback to CPU
        self.assertEqual(mock_reader_class.call_count, 2)
        # First call with GPU, second with CPU
        mock_reader_class.assert_any_call(['en'], gpu=True)
        mock_reader_class.assert_any_call(['en'], gpu=False)

    @patch('torch.cuda.is_available')
    @patch('easyocr.Reader')
    def test_init_complete_failure(self, mock_reader_class, mock_cuda_available):
        """Test initialization failure with both GPU and CPU"""
        mock_cuda_available.return_value = True
        mock_reader_class.side_effect = Exception("Complete initialization failure")
        
        with self.assertRaises(Exception):
            OCREngine()


class TestOCREngineProcessing(unittest.TestCase):
    """Test OCR Engine image processing functionality"""

    def setUp(self):
        """Set up test fixtures"""
        self.mock_image = np.zeros((100, 100, 3), dtype=np.uint8)
        
        # Mock the EasyOCR reader
        self.mock_reader = Mock()
        
        with patch('easyocr.Reader', return_value=self.mock_reader):
            with patch('torch.cuda.is_available', return_value=False):
                self.engine = OCREngine()

    def test_process_image_success(self):
        """Test successful image processing"""
        # Mock successful OCR results
        mock_results = [
            ([(0, 0), (50, 0), (50, 20), (0, 20)], "Hello", 0.95),
            ([(0, 25), (50, 25), (50, 45), (0, 45)], "World", 0.90)
        ]
        self.mock_reader.readtext.return_value = mock_results
        
        result = self.engine.process_image(self.mock_image)
        
        self.assertTrue(result["success"])
        self.assertEqual(result["detected_items"], 2)
        self.assertEqual(result["text"], "Hello World")
        self.assertAlmostEqual(result["confidence"], 0.925, places=3)  # Average confidence
        self.assertIn("raw_results", result)
        self.assertEqual(len(result["raw_results"]), 2)

    def test_process_image_empty_result(self):
        """Test image processing with no text detected"""
        self.mock_reader.readtext.return_value = []
        
        result = self.engine.process_image(self.mock_image)
        
        self.assertTrue(result["success"])
        self.assertEqual(result["text"], "")
        self.assertEqual(result["confidence"], 0)
        self.assertEqual(result["detected_items"], 0)

    def test_process_image_single_result(self):
        """Test image processing with single text detection"""
        mock_results = [
            ([(0, 0), (100, 0), (100, 30), (0, 30)], "Single Text", 0.87)
        ]
        self.mock_reader.readtext.return_value = mock_results
        
        result = self.engine.process_image(self.mock_image)
        
        self.assertTrue(result["success"])
        self.assertEqual(result["detected_items"], 1)
        self.assertEqual(result["text"], "Single Text")
        self.assertEqual(result["confidence"], 0.87)

    def test_process_image_custom_options(self):
        """Test image processing with custom confidence threshold"""
        mock_results = [
            ([(0, 0), (50, 0), (50, 20), (0, 20)], "High Conf", 0.9),
            ([(0, 25), (50, 25), (50, 45), (0, 45)], "Low Conf", 0.3)
        ]
        self.mock_reader.readtext.return_value = mock_results
        
        result = self.engine.process_image(self.mock_image, confidence_threshold=0.8)
        
        # Verify readtext was called
        self.mock_reader.readtext.assert_called_once_with(self.mock_image)
        
        # Check that only high confidence text was included
        self.assertTrue(result["success"])
        self.assertEqual(result["text"], "High Conf")  # Only high confidence text
        self.assertEqual(result["detected_items"], 1)

    def test_process_image_ocr_failure(self):
        """Test image processing when OCR fails"""
        self.mock_reader.readtext.side_effect = Exception("OCR processing failed")
        
        result = self.engine.process_image(self.mock_image)
        
        self.assertFalse(result["success"])
        self.assertIn("OCR processing failed", result["error"])

    def test_process_image_uninitialized_reader(self):
        """Test image processing with uninitialized reader"""
        self.engine.reader = None
        
        result = self.engine.process_image(self.mock_image)
        
        self.assertFalse(result["success"])
        self.assertEqual(result["error"], "OCR reader not initialized")


class TestOCREngineTextSanitization(unittest.TestCase):
    """Test text sanitization functionality"""

    def setUp(self):
        """Set up test fixtures"""
        with patch('easyocr.Reader'):
            with patch('torch.cuda.is_available', return_value=False):
                self.engine = OCREngine()

    def test_sanitize_single_string(self):
        """Test sanitizing a simple string"""
        result = self.engine.sanitize_text("Hello@#$World")
        self.assertEqual(result, "Hello World")

    def test_sanitize_control_characters(self):
        """Test removing control characters"""
        result = self.engine.sanitize_text("Hello\x00\x01World")
        self.assertEqual(result, "Hello World")

    def test_sanitize_unicode_quotes(self):
        """Test normalizing unicode quotes"""
        result = self.engine.sanitize_text('"Hello" and \'World\'')
        self.assertEqual(result, "Hello and World")

    def test_sanitize_zero_width_characters(self):
        """Test removing zero-width characters"""
        result = self.engine.sanitize_text("Hello\u200bWorld")
        # Zero-width characters are removed and replaced with space, then normalized
        self.assertEqual(result, "Hello World")

    def test_sanitize_backslashes(self):
        """Test handling backslashes"""
        result = self.engine.sanitize_text("Path\\to\\file")
        self.assertEqual(result, "Path to file")

    def test_sanitize_trailing_commas(self):
        """Test removing trailing commas and special characters"""
        result = self.engine.sanitize_text('{"key": "value",}')
        # Special characters removed, colons and commas kept, whitespace normalized
        self.assertEqual(result, "key : value ,")

    def test_sanitize_empty_input(self):
        """Test sanitizing empty input"""
        result = self.engine.sanitize_text("")
        self.assertEqual(result, "")

    def test_sanitize_none_input(self):
        """Test sanitizing None input"""
        result = self.engine.sanitize_text(None)
        self.assertEqual(result, "")

    def test_sanitize_whitespace_normalization(self):
        """Test normalizing multiple whitespace"""
        result = self.engine.sanitize_text("Hello    World\n\n\nTest")
        self.assertEqual(result, "Hello World Test")


class TestOCREngineInfo(unittest.TestCase):
    """Test OCR Engine info and configuration methods"""

    def setUp(self):
        """Set up test fixtures"""
        with patch('easyocr.Reader'):
            with patch('torch.cuda.is_available', return_value=False):
                self.engine = OCREngine()

    def test_get_engine_info(self):
        """Test getting engine information"""
        info = self.engine.get_engine_info()
        
        self.assertIn("languages", info)
        self.assertIn("gpu_enabled", info)
        self.assertIn("gpu_available", info)
        self.assertIn("device", info)
        self.assertIn("initialized", info)
        
        self.assertEqual(info["languages"], ["en"])
        self.assertFalse(info["gpu_enabled"])
        self.assertEqual(info["device"], "cpu")
        self.assertTrue(info["initialized"])

    def test_reinitialize_engine(self):
        """Test reinitializing the OCR engine"""
        with patch('easyocr.Reader') as mock_reader_class:
            new_mock_reader = Mock()
            mock_reader_class.return_value = new_mock_reader
            
            self.engine.reinitialize(languages=['es', 'fr'], gpu=True)
            
            self.assertEqual(self.engine.languages, ['es', 'fr'])
            self.assertTrue(self.engine.gpu)

    def test_cleanup_engine(self):
        """Test cleaning up OCR engine resources"""
        original_reader = self.engine.reader
        
        with patch('torch.cuda.empty_cache') as mock_cache_clear:
            self.engine.cleanup()
            
            self.assertIsNone(self.engine.reader)


if __name__ == '__main__':
    unittest.main(verbosity=2)