"""
Image Processor - Handles image preprocessing for OCR
Clean implementation focused on image enhancement and preparation
"""

import cv2
import numpy as np
from typing import Tuple, Optional, Dict, Any
import logging


class ImageProcessor:
    """
    Image processor for enhancing images before OCR processing
    """
    
    def __init__(self):
        """Initialize image processor"""
        self.logger = logging.getLogger(__name__)
    
    def preprocess_image(self, image: np.ndarray, options: Dict[str, Any] = None) -> np.ndarray:
        """
        Preprocess an image for optimal OCR performance
        
        Args:
            image: Input image as numpy array
            options: Processing options
            
        Returns:
            Preprocessed image
        """
        if options is None:
            options = {}
        
        try:
            # Start with the original image
            processed = image.copy()
            
            # Apply preprocessing steps
            processed = self._resize_if_needed(processed, options)
            processed = self._convert_to_grayscale(processed)
            processed = self._enhance_contrast(processed, options)
            processed = self._denoise(processed, options)
            processed = self._sharpen(processed, options)
            processed = self._binarize(processed, options)
            
            return processed
            
        except Exception as e:
            self.logger.error(f"Error preprocessing image: {e}")
            # Return original image if preprocessing fails
            return image
    
    def _resize_if_needed(self, image: np.ndarray, options: Dict[str, Any]) -> np.ndarray:
        """Resize image if it's too large or too small"""
        max_width = options.get('max_width', 2000)
        max_height = options.get('max_height', 2000)
        min_width = options.get('min_width', 300)
        min_height = options.get('min_height', 300)
        
        height, width = image.shape[:2]
        
        # Calculate scaling factor
        scale_factor = 1.0
        
        # Scale down if too large
        if width > max_width or height > max_height:
            scale_factor = min(max_width / width, max_height / height)
        
        # Scale up if too small
        elif width < min_width or height < min_height:
            scale_factor = max(min_width / width, min_height / height)
        
        # Apply scaling if needed
        if scale_factor != 1.0:
            new_width = int(width * scale_factor)
            new_height = int(height * scale_factor)
            image = cv2.resize(image, (new_width, new_height), interpolation=cv2.INTER_CUBIC)
        
        return image
    
    def _convert_to_grayscale(self, image: np.ndarray) -> np.ndarray:
        """Convert image to grayscale if it's not already"""
        if len(image.shape) == 3:
            return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        return image
    
    def _enhance_contrast(self, image: np.ndarray, options: Dict[str, Any]) -> np.ndarray:
        """Enhance image contrast using CLAHE"""
        if options.get('enhance_contrast', True):
            clahe = cv2.createCLAHE(
                clipLimit=options.get('clahe_clip_limit', 2.0),
                tileGridSize=options.get('clahe_grid_size', (8, 8))
            )
            return clahe.apply(image)
        return image
    
    def _denoise(self, image: np.ndarray, options: Dict[str, Any]) -> np.ndarray:
        """Remove noise from the image"""
        if options.get('denoise', True):
            # Use Non-local Means Denoising for grayscale images
            h = options.get('denoise_h', 10)
            template_window_size = options.get('denoise_template_size', 7)
            search_window_size = options.get('denoise_search_size', 21)
            
            return cv2.fastNlMeansDenoising(
                image, 
                None, 
                h, 
                template_window_size, 
                search_window_size
            )
        return image
    
    def _sharpen(self, image: np.ndarray, options: Dict[str, Any]) -> np.ndarray:
        """Sharpen the image to improve text clarity"""
        if options.get('sharpen', True):
            # Create sharpening kernel
            kernel = np.array([
                [-1, -1, -1],
                [-1,  9, -1],
                [-1, -1, -1]
            ])
            
            # Apply sharpening
            sharpened = cv2.filter2D(image, -1, kernel)
            
            # Blend with original image
            alpha = options.get('sharpen_strength', 0.5)
            return cv2.addWeighted(image, 1 - alpha, sharpened, alpha, 0)
        
        return image
    
    def _binarize(self, image: np.ndarray, options: Dict[str, Any]) -> np.ndarray:
        """Apply adaptive thresholding for binarization"""
        if options.get('binarize', True):
            # Use adaptive threshold for better results with varying lighting
            return cv2.adaptiveThreshold(
                image,
                255,
                cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY,
                blockSize=options.get('adaptive_block_size', 11),
                C=options.get('adaptive_c', 2)
            )
        return image
    
    def rotate_image(self, image: np.ndarray, angle: float) -> np.ndarray:
        """
        Rotate image by specified angle
        
        Args:
            image: Input image
            angle: Rotation angle in degrees
            
        Returns:
            Rotated image
        """
        if angle == 0:
            return image
        
        height, width = image.shape[:2]
        center = (width // 2, height // 2)
        
        # Calculate rotation matrix
        rotation_matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
        
        # Calculate new dimensions
        cos_angle = abs(rotation_matrix[0, 0])
        sin_angle = abs(rotation_matrix[0, 1])
        new_width = int((height * sin_angle) + (width * cos_angle))
        new_height = int((height * cos_angle) + (width * sin_angle))
        
        # Adjust rotation matrix for new dimensions
        rotation_matrix[0, 2] += (new_width / 2) - center[0]
        rotation_matrix[1, 2] += (new_height / 2) - center[1]
        
        # Perform rotation
        rotated = cv2.warpAffine(image, rotation_matrix, (new_width, new_height))
        
        return rotated
    
    def detect_orientation(self, image: np.ndarray) -> float:
        """
        Detect text orientation and suggest rotation angle
        
        Args:
            image: Input image
            
        Returns:
            Suggested rotation angle in degrees
        """
        try:
            # Use Hough line detection to find text orientation
            edges = cv2.Canny(image, 50, 150, apertureSize=3)
            lines = cv2.HoughLines(edges, 1, np.pi/180, threshold=100)
            
            if lines is not None:
                angles = []
                for rho, theta in lines[:, 0]:
                    angle = np.degrees(theta) - 90
                    # Normalize angle to [-45, 45] range
                    if angle > 45:
                        angle -= 90
                    elif angle < -45:
                        angle += 90
                    angles.append(angle)
                
                # Return median angle
                if angles:
                    return float(np.median(angles))
            
            return 0.0
            
        except Exception as e:
            self.logger.error(f"Error detecting orientation: {e}")
            return 0.0
    
    def auto_rotate(self, image: np.ndarray) -> np.ndarray:
        """
        Automatically rotate image to correct orientation
        
        Args:
            image: Input image
            
        Returns:
            Corrected image
        """
        angle = self.detect_orientation(image)
        if abs(angle) > 1:  # Only rotate if angle is significant
            return self.rotate_image(image, -angle)  # Negative to correct
        return image
    
    def crop_to_content(self, image: np.ndarray) -> np.ndarray:
        """
        Crop image to remove empty borders and focus on content
        
        Args:
            image: Input image
            
        Returns:
            Cropped image
        """
        try:
            # Find contours to detect content area
            _, binary = cv2.threshold(image, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            
            # Invert if background is white
            if np.mean(binary) > 127:
                binary = cv2.bitwise_not(binary)
            
            # Find contours
            contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            if contours:
                # Get bounding rectangle of all contours
                all_contours = np.vstack(contours)
                x, y, w, h = cv2.boundingRect(all_contours)
                
                # Add small padding
                padding = 10
                x = max(0, x - padding)
                y = max(0, y - padding)
                w = min(image.shape[1] - x, w + 2 * padding)
                h = min(image.shape[0] - y, h + 2 * padding)
                
                # Crop image
                return image[y:y+h, x:x+w]
            
            return image
            
        except Exception as e:
            self.logger.error(f"Error cropping image: {e}")
            return image
    
    def get_image_stats(self, image: np.ndarray) -> Dict[str, Any]:
        """Get statistics about the image"""
        return {
            "shape": image.shape,
            "dtype": str(image.dtype),
            "mean_intensity": float(np.mean(image)),
            "std_intensity": float(np.std(image)),
            "min_intensity": float(np.min(image)),
            "max_intensity": float(np.max(image)),
            "is_grayscale": len(image.shape) == 2
        }