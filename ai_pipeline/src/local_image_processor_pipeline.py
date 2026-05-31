"""
Image Processor - Intelligent adaptive preprocessing for OCR
Uses quality assessment to determine optimal preprocessing steps
"""

import cv2
import numpy as np
from typing import Tuple, Optional, Dict, Any, List
import logging


class ImageQualityAnalyzer:
    """Analyzes image quality to determine what preprocessing is needed"""
    
    # Quality thresholds based on research and empirical testing
    THRESHOLDS = {
        'low_sharpness': 100,       # Laplacian variance below this = blurry
        'low_contrast': 40,          # Std dev below this = needs enhancement
        'high_noise': 15,            # Noise sigma above this = needs denoising
        'significant_skew': 1.0,     # Degrees above this = needs rotation
        'low_brightness': 80,        # Mean below this = too dark
        'high_brightness': 200,      # Mean above this = too bright
    }
    
    @staticmethod
    def calculate_sharpness(image: np.ndarray) -> float:
        """Calculate image sharpness using Laplacian variance"""
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
        laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
        return float(laplacian_var)
    
    @staticmethod
    def calculate_contrast(image: np.ndarray) -> float:
        """Calculate image contrast using standard deviation"""
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
        return float(gray.std())
    
    @staticmethod
    def calculate_brightness(image: np.ndarray) -> float:
        """Calculate average brightness"""
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
        return float(gray.mean())
    
    @staticmethod
    def estimate_noise_level(image: np.ndarray) -> float:
        """Estimate noise using median absolute deviation on Laplacian"""
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
        
        # Use median absolute deviation on Laplacian as noise estimator
        laplacian = cv2.Laplacian(gray, cv2.CV_64F)
        mad = np.median(np.abs(laplacian - np.median(laplacian)))
        noise_sigma = 1.4826 * mad  # Standard conversion factor
        return float(noise_sigma)
    
    @staticmethod
    def detect_skew(image: np.ndarray) -> float:
        """Detect skew angle using Hough line transform"""
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
        
        try:
            # Edge detection
            edges = cv2.Canny(gray, 50, 150, apertureSize=3)
            
            # Hough line detection
            lines = cv2.HoughLines(edges, 1, np.pi/180, 200)
            
            if lines is None:
                return 0.0
            
            # Calculate average angle from near-horizontal lines
            angles = []
            for rho, theta in lines[:, 0]:
                angle = np.degrees(theta) - 90
                # Only consider near-horizontal lines (within ±30 degrees)
                if abs(angle) < 30:
                    angles.append(angle)
            
            if not angles:
                return 0.0
            
            return float(np.median(angles))
        except Exception:
            return 0.0
    
    @classmethod
    def analyze(cls, image: np.ndarray) -> Dict[str, float]:
        """Comprehensive image quality analysis"""
        return {
            'sharpness': cls.calculate_sharpness(image),
            'contrast': cls.calculate_contrast(image),
            'brightness': cls.calculate_brightness(image),
            'noise_level': cls.estimate_noise_level(image),
            'skew_angle': cls.detect_skew(image),
        }


class ImageProcessor:
    """
    Intelligent image processor for OCR preprocessing
    Analyzes image quality and applies only necessary corrections
    """
    
    def __init__(self):
        """Initialize image processor"""
        self.logger = logging.getLogger(__name__)
        self.analyzer = ImageQualityAnalyzer()
        self.last_quality_report = None
        self.last_applied_steps = []
    
    def preprocess_image(self, image: np.ndarray, options: Dict[str, Any] = None) -> np.ndarray:
        """
        Intelligently preprocess image based on quality assessment
        
        Args:
            image: Input image as numpy array
            options: Processing options (can override auto-detection)
            
        Returns:
            Preprocessed image
        """
        if options is None:
            options = {}
        
        try:
            # Start with the original image
            processed = image.copy()
            self.last_applied_steps = []
            
            # Phase 1: Always apply geometric corrections (quality-neutral)
            processed = self._resize_if_needed(processed, options)
            
            # Phase 2: Quality Assessment (unless disabled)
            if not options.get('skip_quality_analysis', False):
                quality = self.analyzer.analyze(processed)
                self.last_quality_report = quality
                
                self.logger.info(f"Image Quality: sharpness={quality['sharpness']:.1f}, "
                               f"contrast={quality['contrast']:.1f}, "
                               f"brightness={quality['brightness']:.1f}, "
                               f"noise={quality['noise_level']:.1f}, "
                               f"skew={quality['skew_angle']:.2f}°")
            else:
                quality = None
            
            # Always convert to grayscale
            processed = self._convert_to_grayscale(processed)
            self.last_applied_steps.append("grayscale")
            
            # Phase 3: Conditional preprocessing based on quality
            if quality:
                # Deskew if needed (ALWAYS do this before other steps)
                if abs(quality['skew_angle']) > self.analyzer.THRESHOLDS['significant_skew']:
                    processed = self._deskew(processed, quality['skew_angle'])
                    self.last_applied_steps.append(f"deskew({quality['skew_angle']:.2f}°)")
                
                # Fix brightness issues
                if quality['brightness'] < self.analyzer.THRESHOLDS['low_brightness']:
                    processed = self._adjust_brightness(processed, target=127)
                    self.last_applied_steps.append("brightness_correction")
                elif quality['brightness'] > self.analyzer.THRESHOLDS['high_brightness']:
                    processed = self._adjust_brightness(processed, target=127)
                    self.last_applied_steps.append("brightness_correction")
                
                # Denoise if noisy (before other enhancements)
                if quality['noise_level'] > self.analyzer.THRESHOLDS['high_noise']:
                    # Use adaptive denoise strength based on noise level
                    h = min(10, max(3, int(quality['noise_level'] / 3)))
                    processed = self._denoise_bilateral(processed, h=h)
                    self.last_applied_steps.append(f"denoise(h={h})")
                
                # Enhance contrast only if low
                if quality['contrast'] < self.analyzer.THRESHOLDS['low_contrast']:
                    processed = self._enhance_contrast_adaptive(processed, quality['contrast'])
                    self.last_applied_steps.append("contrast_enhancement")
                
                # Sharpen only if blurry
                if quality['sharpness'] < self.analyzer.THRESHOLDS['low_sharpness']:
                    processed = self._sharpen_unsharp_mask(processed)
                    self.last_applied_steps.append("sharpening")
            
            # Manual overrides (if options provided)
            if options.get('force_contrast', False):
                processed = self._enhance_contrast_adaptive(processed)
                self.last_applied_steps.append("contrast_enhancement(forced)")
            
            if options.get('force_denoise', False):
                processed = self._denoise_bilateral(processed)
                self.last_applied_steps.append("denoise(forced)")
            
            # Note: We NEVER binarize by default for modern OCR (EasyOCR, Tesseract 4+)
            # They work better with grayscale
            if options.get('force_binarize', False):
                processed = self._binarize_otsu(processed)
                self.last_applied_steps.append("binarize(forced)")
            
            self.logger.info(f"Applied steps: {', '.join(self.last_applied_steps)}")
            return processed
            
        except Exception as e:
            self.logger.error(f"Error preprocessing image: {e}")
            # Return grayscale at minimum
            if len(image.shape) == 3:
                return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            return image
    
    def _resize_if_needed(self, image: np.ndarray, options: Dict[str, Any]) -> np.ndarray:
        """Resize image to optimal resolution for OCR (300 DPI equivalent)"""
        max_width = options.get('max_width', 3000)   # Increased for better OCR
        max_height = options.get('max_height', 3000)
        min_width = options.get('min_width', 600)    # Minimum for good OCR
        min_height = options.get('min_height', 600)
        
        height, width = image.shape[:2]
        scale_factor = 1.0
        
        # Scale down if too large (uses anti-aliasing automatically)
        if width > max_width or height > max_height:
            scale_factor = min(max_width / width, max_height / height)
            interpolation = cv2.INTER_AREA  # Best for downscaling
        # Scale up if too small (use bicubic for quality)
        elif width < min_width or height < min_height:
            scale_factor = max(min_width / width, min_height / height)
            interpolation = cv2.INTER_CUBIC  # Best for upscaling
        else:
            return image
        
        new_width = int(width * scale_factor)
        new_height = int(height * scale_factor)
        return cv2.resize(image, (new_width, new_height), interpolation=interpolation)
    
    def _convert_to_grayscale(self, image: np.ndarray) -> np.ndarray:
        """Convert image to grayscale if it's not already"""
        if len(image.shape) == 3:
            return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        return image
    
    def _deskew(self, image: np.ndarray, angle: float) -> np.ndarray:
        """Rotate image to correct skew"""
        height, width = image.shape[:2]
        center = (width // 2, height // 2)
        
        # Calculate rotation matrix
        rotation_matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
        
        # Calculate new dimensions to avoid cropping
        cos_angle = abs(rotation_matrix[0, 0])
        sin_angle = abs(rotation_matrix[0, 1])
        new_width = int((height * sin_angle) + (width * cos_angle))
        new_height = int((height * cos_angle) + (width * sin_angle))
        
        # Adjust rotation matrix for new dimensions
        rotation_matrix[0, 2] += (new_width / 2) - center[0]
        rotation_matrix[1, 2] += (new_height / 2) - center[1]
        
        # Perform rotation with white background
        rotated = cv2.warpAffine(image, rotation_matrix, (new_width, new_height),
                                 borderMode=cv2.BORDER_CONSTANT, borderValue=255)
        return rotated
    
    def _adjust_brightness(self, image: np.ndarray, target: float = 127) -> np.ndarray:
        """Adjust image brightness to target level using gamma correction"""
        current_brightness = image.mean()
        
        if current_brightness < 1:
            return image
        
        # Calculate gamma to reach target brightness
        gamma = np.log(target / 255.0) / np.log(current_brightness / 255.0)
        gamma = np.clip(gamma, 0.5, 2.0)  # Limit gamma range
        
        # Apply gamma correction
        inv_gamma = 1.0 / gamma
        table = np.array([((i / 255.0) ** inv_gamma) * 255 for i in range(256)]).astype("uint8")
        return cv2.LUT(image, table)
    
    def _denoise_bilateral(self, image: np.ndarray, h: int = 5) -> np.ndarray:
        """
        Remove noise using bilateral filter (better edge preservation than NLM for documents)
        """
        # Bilateral filter: preserves edges while denoising
        # d=5: diameter of pixel neighborhood
        # sigmaColor=h*10: filter sigma in color space
        # sigmaSpace=h*10: filter sigma in coordinate space
        return cv2.bilateralFilter(image, d=5, sigmaColor=h*10, sigmaSpace=h*10)
    
    def _enhance_contrast_adaptive(self, image: np.ndarray, current_contrast: float = None) -> np.ndarray:
        """
        Enhance contrast adaptively using CLAHE with gentle settings
        """
        # For documents, use larger tiles and lower clip limit to avoid artifacts
        if current_contrast and current_contrast < 20:
            # Very low contrast - stronger enhancement
            clip_limit = 2.0
            tile_grid_size = (8, 8)
        elif current_contrast and current_contrast < 40:
            # Low contrast - moderate enhancement
            clip_limit = 1.5
            tile_grid_size = (16, 16)
        else:
            # Slight enhancement
            clip_limit = 1.2
            tile_grid_size = (32, 32)
        
        clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=tile_grid_size)
        return clahe.apply(image)
    
    def _sharpen_unsharp_mask(self, image: np.ndarray, amount: float = 0.5) -> np.ndarray:
        """
        Sharpen using unsharp mask (more controllable than kernel convolution)
        """
        # Create blurred version
        gaussian = cv2.GaussianBlur(image, (0, 0), 2.0)
        
        # Unsharp mask: original + amount * (original - blurred)
        sharpened = cv2.addWeighted(image, 1.0 + amount, gaussian, -amount, 0)
        return sharpened
    
    def _binarize_otsu(self, image: np.ndarray) -> np.ndarray:
        """
        Binarize using Otsu's method (better than adaptive for uniform lighting)
        Note: Modern OCR engines prefer grayscale, so this is rarely needed
        """
        _, binary = cv2.threshold(image, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        return binary
    
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
    
    def get_quality_report(self) -> Optional[Dict[str, Any]]:
        """
        Get the quality analysis report from the last preprocessing operation
        
        Returns:
            Dict with quality metrics and applied steps, or None if no preprocessing done yet
        """
        if self.last_quality_report is None:
            return None
        
        return {
            "quality_metrics": self.last_quality_report,
            "applied_steps": self.last_applied_steps,
            "recommendations": self._generate_recommendations()
        }
    
    def _generate_recommendations(self) -> List[str]:
        """Generate human-readable recommendations based on quality analysis"""
        if not self.last_quality_report:
            return []
        
        recommendations = []
        quality = self.last_quality_report
        
        if quality['sharpness'] > 300:
            recommendations.append("Image is very sharp - minimal processing needed")
        elif quality['sharpness'] < 50:
            recommendations.append("Image is very blurry - consider rescanning")
        
        if quality['contrast'] > 60:
            recommendations.append("Excellent contrast - no enhancement needed")
        elif quality['contrast'] < 20:
            recommendations.append("Very low contrast - applied strong enhancement")
        
        if quality['noise_level'] < 5:
            recommendations.append("Clean image - no denoising needed")
        elif quality['noise_level'] > 20:
            recommendations.append("High noise detected - applied strong denoising")
        
        if abs(quality['skew_angle']) < 0.5:
            recommendations.append("Perfect alignment - no rotation needed")
        elif abs(quality['skew_angle']) > 5:
            recommendations.append("Significant skew detected - corrected rotation")
        
        return recommendations