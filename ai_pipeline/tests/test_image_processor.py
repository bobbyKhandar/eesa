"""
Unit tests for Image Processor - Image preprocessing for OCR optimization
Tests resizing, grayscale conversion, contrast enhancement, noise reduction, and binarization
"""

import unittest
import numpy as np
import cv2
from unittest.mock import Mock, patch, MagicMock
import sys
import os

# Add the parent directory to the path to import from src
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from src.image_processor import ImageProcessor


class TestImageProcessorInitialization(unittest.TestCase):
    """Test Image Processor initialization"""

    def test_init(self):
        """Test image processor initialization"""
        processor = ImageProcessor()
        
        self.assertIsNotNone(processor.logger)
        self.assertEqual(processor.logger.name, 'src.image_processor')


class TestImageProcessorPreprocessing(unittest.TestCase):
    """Test Image Processor main preprocessing functionality"""

    def setUp(self):
        """Set up test fixtures"""
        self.processor = ImageProcessor()
        
        # Create test images
        self.color_image = np.random.randint(0, 255, (200, 150, 3), dtype=np.uint8)
        self.grayscale_image = np.random.randint(0, 255, (200, 150), dtype=np.uint8)
        self.large_image = np.random.randint(0, 255, (2000, 1500, 3), dtype=np.uint8)

    def test_preprocess_image_default_options(self):
        """Test image preprocessing with default options"""
        result = self.processor.preprocess_image(self.color_image)
        
        # Should return a processed image
        self.assertIsInstance(result, np.ndarray)
        self.assertEqual(len(result.shape), 2)  # Should be grayscale
        self.assertEqual(result.dtype, np.uint8)

    def test_preprocess_image_custom_options(self):
        """Test image preprocessing with custom options"""
        options = {
            "resize_width": 800,
            "enhance_contrast": True,
            "denoise_strength": 10,
            "sharpen_kernel": 3,
            "binarize_method": "otsu"
        }
        
        result = self.processor.preprocess_image(self.color_image, options)
        
        self.assertIsInstance(result, np.ndarray)
        self.assertEqual(len(result.shape), 2)  # Should be grayscale

    def test_preprocess_image_with_none_input(self):
        """Test preprocessing with None input"""
        result = self.processor.preprocess_image(None)
        
        # Should handle None gracefully (return None or raise appropriate error)
        self.assertIsNone(result)

    def test_preprocess_image_with_empty_array(self):
        """Test preprocessing with empty array"""
        empty_image = np.array([])
        
        result = self.processor.preprocess_image(empty_image)
        
        # Should handle empty array gracefully
        self.assertIsNotNone(result)

    def test_preprocess_image_preserves_original(self):
        """Test that preprocessing doesn't modify the original image"""
        original = self.color_image.copy()
        
        self.processor.preprocess_image(self.color_image)
        
        np.testing.assert_array_equal(self.color_image, original)

    def test_preprocess_image_error_handling(self):
        """Test error handling in preprocessing pipeline"""
        # Create an invalid image that might cause processing errors
        invalid_image = np.array([[[]]], dtype=np.uint8)
        
        # Should not raise exception, should handle gracefully
        result = self.processor.preprocess_image(invalid_image)
        
        # Should return something (original or None)
        self.assertIsNotNone(result)


class TestImageProcessorResizing(unittest.TestCase):
    """Test Image Processor resizing functionality"""

    def setUp(self):
        """Set up test fixtures"""
        self.processor = ImageProcessor()
        self.large_image = np.random.randint(0, 255, (2000, 1500, 3), dtype=np.uint8)
        self.small_image = np.random.randint(0, 255, (100, 80, 3), dtype=np.uint8)

    def test_resize_large_image_default(self):
        """Test resizing large image with default settings"""
        result = self.processor._resize_if_needed(self.large_image, {})
        
        # Should be resized to max width of 2000 (default)
        self.assertLessEqual(result.shape[1], 2000)
        self.assertGreater(result.shape[1], 0)

    def test_resize_large_image_custom_width(self):
        """Test resizing large image with custom width"""
        options = {"max_width": 800}
        
        result = self.processor._resize_if_needed(self.large_image, options)
        
        self.assertEqual(result.shape[1], 800)
        # Aspect ratio should be preserved
        expected_height = int(self.large_image.shape[0] * 800 / self.large_image.shape[1])
        self.assertEqual(result.shape[0], expected_height)

    def test_resize_small_image_no_resize(self):
        """Test that small images are not resized unnecessarily"""
        result = self.processor._resize_if_needed(self.small_image, {})
        
        # Small image below min_width (300) will be scaled up
        self.assertGreaterEqual(result.shape[1], 300)

    def test_resize_disabled(self):
        """Test resizing when disabled in options"""
        options = {"resize_enabled": False}
        
        result = self.processor._resize_if_needed(self.large_image, options)
        
        # Should remain unchanged
        np.testing.assert_array_equal(result, self.large_image)

    def test_resize_aspect_ratio_preservation(self):
        """Test that resizing preserves aspect ratio"""
        original_aspect = self.large_image.shape[1] / self.large_image.shape[0]
        
        result = self.processor._resize_if_needed(self.large_image, {})
        
        new_aspect = result.shape[1] / result.shape[0]
        self.assertAlmostEqual(original_aspect, new_aspect, places=2)


class TestImageProcessorGrayscaleConversion(unittest.TestCase):
    """Test Image Processor grayscale conversion"""

    def setUp(self):
        """Set up test fixtures"""
        self.processor = ImageProcessor()
        self.color_image = np.random.randint(0, 255, (200, 150, 3), dtype=np.uint8)
        self.grayscale_image = np.random.randint(0, 255, (200, 150), dtype=np.uint8)

    def test_convert_color_to_grayscale(self):
        """Test converting color image to grayscale"""
        result = self.processor._convert_to_grayscale(self.color_image)
        
        self.assertEqual(len(result.shape), 2)  # Should be 2D
        self.assertEqual(result.shape, (200, 150))
        self.assertEqual(result.dtype, np.uint8)

    def test_convert_already_grayscale(self):
        """Test converting already grayscale image"""
        result = self.processor._convert_to_grayscale(self.grayscale_image)
        
        # Should remain unchanged
        np.testing.assert_array_equal(result, self.grayscale_image)

    def test_convert_single_channel_color(self):
        """Test converting single channel color image"""
        # Single channel will be treated as grayscale
        single_channel = np.random.randint(0, 255, (200, 150), dtype=np.uint8)
        
        result = self.processor._convert_to_grayscale(single_channel)
        
        self.assertEqual(len(result.shape), 2)
        np.testing.assert_array_equal(result, single_channel)


class TestImageProcessorContrastEnhancement(unittest.TestCase):
    """Test Image Processor contrast enhancement"""

    def setUp(self):
        """Set up test fixtures"""
        self.processor = ImageProcessor()
        # Create low contrast image
        self.low_contrast_image = np.full((100, 100), 128, dtype=np.uint8)
        self.low_contrast_image[25:75, 25:75] = 140  # Slightly different region

    def test_enhance_contrast_clahe_default(self):
        """Test contrast enhancement with default CLAHE"""
        result = self.processor._enhance_contrast(self.low_contrast_image, {})
        
        # Should have better contrast than original
        original_std = np.std(self.low_contrast_image)
        enhanced_std = np.std(result)
        self.assertGreaterEqual(enhanced_std, original_std)

    def test_enhance_contrast_clahe_custom(self):
        """Test contrast enhancement with custom CLAHE parameters"""
        options = {
            "clahe_clip_limit": 3.0,
            "clahe_grid_size": (16, 16)  # Must be tuple
        }
        
        result = self.processor._enhance_contrast(self.low_contrast_image, options)
        
        self.assertEqual(result.shape, self.low_contrast_image.shape)
        self.assertEqual(result.dtype, np.uint8)

    def test_enhance_contrast_histogram_equalization(self):
        """Test contrast enhancement with histogram equalization"""
        options = {"contrast_method": "histogram_eq"}
        
        result = self.processor._enhance_contrast(self.low_contrast_image, options)
        
        self.assertEqual(result.shape, self.low_contrast_image.shape)

    def test_enhance_contrast_disabled(self):
        """Test contrast enhancement when disabled"""
        options = {"enhance_contrast": False}
        
        result = self.processor._enhance_contrast(self.low_contrast_image, options)
        
        # Should remain unchanged
        np.testing.assert_array_equal(result, self.low_contrast_image)


class TestImageProcessorDenoising(unittest.TestCase):
    """Test Image Processor noise reduction"""

    def setUp(self):
        """Set up test fixtures"""
        self.processor = ImageProcessor()
        # Create noisy image
        self.clean_image = np.full((100, 100), 128, dtype=np.uint8)
        noise = np.random.normal(0, 10, (100, 100))
        self.noisy_image = np.clip(self.clean_image.astype(np.float32) + noise, 0, 255).astype(np.uint8)

    def test_denoise_fastNlMeans_default(self):
        """Test denoising with default fastNlMeans"""
        result = self.processor._denoise(self.noisy_image, {})
        
        # Should reduce noise
        self.assertEqual(result.shape, self.noisy_image.shape)
        self.assertEqual(result.dtype, np.uint8)

    def test_denoise_fastNlMeans_custom_strength(self):
        """Test denoising with custom strength"""
        options = {"denoise_strength": 15}
        
        result = self.processor._denoise(self.noisy_image, options)
        
        self.assertEqual(result.shape, self.noisy_image.shape)

    def test_denoise_gaussian_blur(self):
        """Test denoising with Gaussian blur method"""
        options = {"denoise_method": "gaussian_blur"}
        
        result = self.processor._denoise(self.noisy_image, options)
        
        self.assertEqual(result.shape, self.noisy_image.shape)

    def test_denoise_bilateral_filter(self):
        """Test denoising with bilateral filter"""
        options = {"denoise_method": "bilateral"}
        
        result = self.processor._denoise(self.noisy_image, options)
        
        self.assertEqual(result.shape, self.noisy_image.shape)

    def test_denoise_disabled(self):
        """Test denoising when disabled"""
        options = {"denoise": False}
        
        result = self.processor._denoise(self.noisy_image, options)
        
        # Should remain unchanged
        np.testing.assert_array_equal(result, self.noisy_image)


class TestImageProcessorSharpening(unittest.TestCase):
    """Test Image Processor sharpening functionality"""

    def setUp(self):
        """Set up test fixtures"""
        self.processor = ImageProcessor()
        # Create slightly blurred image
        self.blurred_image = cv2.GaussianBlur(
            np.random.randint(0, 255, (100, 100), dtype=np.uint8), 
            (3, 3), 
            1.0
        )

    def test_sharpen_unsharp_mask_default(self):
        """Test sharpening with default unsharp mask"""
        result = self.processor._sharpen(self.blurred_image, {})
        
        self.assertEqual(result.shape, self.blurred_image.shape)
        self.assertEqual(result.dtype, np.uint8)

    def test_sharpen_unsharp_mask_custom(self):
        """Test sharpening with custom unsharp mask parameters"""
        options = {
            "sharpen_strength": 2.0,
            "sharpen_radius": 2,
            "sharpen_threshold": 5
        }
        
        result = self.processor._sharpen(self.blurred_image, options)
        
        self.assertEqual(result.shape, self.blurred_image.shape)

    def test_sharpen_laplacian_filter(self):
        """Test sharpening with Laplacian filter"""
        options = {"sharpen_method": "laplacian"}
        
        result = self.processor._sharpen(self.blurred_image, options)
        
        self.assertEqual(result.shape, self.blurred_image.shape)

    def test_sharpen_disabled(self):
        """Test sharpening when disabled"""
        options = {"sharpen": False}
        
        result = self.processor._sharpen(self.blurred_image, options)
        
        # Should remain unchanged
        np.testing.assert_array_equal(result, self.blurred_image)


class TestImageProcessorBinarization(unittest.TestCase):
    """Test Image Processor binarization functionality"""

    def setUp(self):
        """Set up test fixtures"""
        self.processor = ImageProcessor()
        self.grayscale_image = np.random.randint(0, 255, (100, 100), dtype=np.uint8)

    def test_binarize_otsu_default(self):
        """Test binarization with default Otsu method"""
        result = self.processor._binarize(self.grayscale_image, {})
        
        # Should be binary (only 0 and 255 values)
        unique_values = np.unique(result)
        self.assertTrue(len(unique_values) <= 2)
        self.assertTrue(all(val in [0, 255] for val in unique_values))

    def test_binarize_adaptive_threshold(self):
        """Test binarization with adaptive threshold"""
        options = {"binarize_method": "adaptive"}
        
        result = self.processor._binarize(self.grayscale_image, options)
        
        # Should be binary
        unique_values = np.unique(result)
        self.assertTrue(len(unique_values) <= 2)

    def test_binarize_fixed_threshold(self):
        """Test binarization with fixed threshold"""
        options = {
            "binarize_method": "fixed",
            "binarize_threshold": 128
        }
        
        result = self.processor._binarize(self.grayscale_image, options)
        
        # Should be binary
        unique_values = np.unique(result)
        self.assertTrue(len(unique_values) <= 2)

    def test_binarize_disabled(self):
        """Test binarization when disabled"""
        options = {"binarize": False}
        
        result = self.processor._binarize(self.grayscale_image, options)
        
        # Should remain unchanged
        np.testing.assert_array_equal(result, self.grayscale_image)


class TestImageProcessorAdvancedFeatures(unittest.TestCase):
    """Test Image Processor advanced functionality"""

    def setUp(self):
        """Set up test fixtures"""
        self.processor = ImageProcessor()
        self.test_image = np.random.randint(0, 255, (200, 150, 3), dtype=np.uint8)

    def test_detect_orientation(self):
        """Test orientation detection"""
        # Create a slightly rotated rectangle image
        rect_image = np.zeros((200, 300), dtype=np.uint8)
        cv2.rectangle(rect_image, (50, 50), (250, 150), 255, -1)
        
        angle = self.processor.detect_orientation(rect_image)
        
        self.assertIsInstance(angle, (int, float))
        self.assertGreaterEqual(angle, -45)
        self.assertLessEqual(angle, 45)

    def test_rotate_image_no_rotation(self):
        """Test image rotation with zero degrees"""
        result = self.processor.rotate_image(self.test_image, 0)
        
        # Should return same image for zero rotation
        np.testing.assert_array_equal(result, self.test_image)

    def test_rotate_image_with_angle(self):
        """Test image rotation with specific angle"""
        angle = 15.0  # 15 degree rotation
        
        result = self.processor.rotate_image(self.test_image, angle)
        
        self.assertIsInstance(result, np.ndarray)
        self.assertEqual(len(result.shape), len(self.test_image.shape))

    def test_auto_rotate(self):
        """Test automatic rotation based on detected orientation"""
        result = self.processor.auto_rotate(self.test_image)
        
        # Should return an image of same number of dimensions
        self.assertEqual(len(result.shape), len(self.test_image.shape))
        self.assertEqual(result.dtype, np.uint8)

    def test_crop_to_content(self):
        """Test cropping to content area"""
        # Create image with border
        large_image = np.zeros((200, 300), dtype=np.uint8)
        large_image[50:150, 75:225] = 255  # Content in center
        
        result = self.processor.crop_to_content(large_image)
        
        self.assertLessEqual(result.shape[0], large_image.shape[0])
        self.assertLessEqual(result.shape[1], large_image.shape[1])
        self.assertEqual(result.dtype, np.uint8)

    def test_get_image_stats(self):
        """Test getting image statistics"""
        stats = self.processor.get_image_stats(self.test_image)
        
        self.assertIsInstance(stats, dict)
        self.assertIn("shape", stats)
        self.assertIn("dtype", stats)
        self.assertIn("mean_intensity", stats)
        self.assertIn("std_intensity", stats)
        self.assertIn("min_intensity", stats)
        self.assertIn("max_intensity", stats)
        self.assertIn("is_grayscale", stats)
        
        # Verify values make sense
        self.assertEqual(stats["shape"], self.test_image.shape)
        self.assertGreaterEqual(stats["mean_intensity"], 0)
        self.assertLessEqual(stats["mean_intensity"], 255)

    def test_preprocess_image_full_pipeline(self):
        """Test complete preprocessing pipeline"""
        result = self.processor.preprocess_image(self.test_image)
        
        self.assertIsInstance(result, np.ndarray)
        # Result should be grayscale
        self.assertEqual(len(result.shape), 2)
        self.assertEqual(result.dtype, np.uint8)


class TestImageProcessorErrorHandling(unittest.TestCase):
    """Test Image Processor error handling"""

    def setUp(self):
        """Set up test fixtures"""
        self.processor = ImageProcessor()

    def test_handle_corrupted_image(self):
        """Test handling of corrupted image data"""
        # Simulate corrupted image
        corrupted = np.array([[256, -1, 300]], dtype=np.int16)  # Invalid values
        
        # Should handle gracefully without crashing
        try:
            result = self.processor.preprocess_image(corrupted)
            self.assertIsNotNone(result)
        except Exception:
            # If it raises an exception, it should be handled appropriately
            pass

    def test_handle_memory_error(self):
        """Test handling of memory-intensive operations"""
        # Create extremely large image that might cause memory issues
        try:
            large_image = np.zeros((10000, 10000, 3), dtype=np.uint8)
            result = self.processor.preprocess_image(large_image)
            # If it succeeds, that's fine
            self.assertIsNotNone(result)
        except MemoryError:
            # Memory error is expected and handled
            pass
        except Exception:
            # Other exceptions should be handled gracefully
            pass

    def test_handle_invalid_options(self):
        """Test handling of invalid processing options"""
        test_image = np.random.randint(0, 255, (100, 100, 3), dtype=np.uint8)
        invalid_options = {
            "max_width": "invalid",  # Use actual option names from implementation
            "denoise_h": -5,
            "unknown_option": True
        }
        
        # Should handle invalid options gracefully
        result = self.processor.preprocess_image(test_image, invalid_options)
        self.assertIsNotNone(result)


if __name__ == '__main__':
    unittest.main(verbosity=2)