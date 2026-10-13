"""
OCR Engine - Handles optical character recognition using EasyOCR
Clean implementation focused only on OCR processing
"""

import re
import unicodedata
import torch
import easyocr
from typing import Dict, Any, Optional
import numpy as np

# Punctuation the previous allowlist kept, plus ASCII operators and brackets
# that change the meaning of a formula. Unicode math symbols (category Sm,
# such as × ÷ ≤ ≥ ≠ √) are kept in sanitize_text. These extra marks are
# science notation that is not category Sm.
_KEPT_PUNCTUATION = frozenset(".,;:!?-()+=/*<>^%[]{}")
_KEPT_SCIENCE = frozenset("°·′″‰")
_WORD_CHAR = re.compile(r"\w")


class OCREngine:
    """
    OCR engine using EasyOCR for text extraction from images
    """
    
    def __init__(self, languages: list = None, gpu: bool = None):
        """
        Initialize OCR engine
        
        Args:
            languages: List of language codes (default: ['en'])
            gpu: Whether to use GPU (auto-detect if None)
        """
        self.languages = languages or ['en']
        self.gpu = gpu if gpu is not None else torch.cuda.is_available()
        self.reader = None
        self._initialize_reader()
    
    def _initialize_reader(self):
        """Initialize the EasyOCR reader with proper configuration"""
        try:
            print(f"🔧 Initializing OCR engine (GPU: {self.gpu}, Languages: {self.languages})")
            self.reader = easyocr.Reader(self.languages, gpu=self.gpu)
            print("✅ OCR engine initialized successfully")
        except Exception as e:
            print(f"❌ Failed to initialize OCR engine: {e}")
            # Fallback to CPU if GPU fails
            if self.gpu:
                print("🔄 Falling back to CPU...")
                self.gpu = False
                try:
                    self.reader = easyocr.Reader(self.languages, gpu=False)
                    print("✅ OCR engine initialized with CPU fallback")
                except Exception as cpu_error:
                    print(f"❌ CPU fallback also failed: {cpu_error}")
                    raise
            else:
                raise
    
    def process_image(self, image: np.ndarray, confidence_threshold: float = 0.5) -> Dict[str, Any]:
        """
        Process an image and extract text using OCR
        
        Args:
            image: Input image as numpy array
            confidence_threshold: Minimum confidence for text detection
            
        Returns:
            Dictionary containing OCR results
        """
        try:
            if self.reader is None:
                return {
                    "success": False,
                    "error": "OCR reader not initialized"
                }
            
            # Perform OCR
            results = self.reader.readtext(image)
            
            if not results:
                return {
                    "success": True,
                    "text": "",
                    "confidence": 0.0,
                    "detected_items": 0
                }
            
            # Filter results by confidence and extract text
            valid_results = []
            total_confidence = 0
            
            for (bbox, text, confidence) in results:
                if confidence >= confidence_threshold:
                    # Sanitize text
                    cleaned_text = self.sanitize_text(text)
                    if cleaned_text.strip():  # Only add non-empty text
                        valid_results.append({
                            "text": cleaned_text,
                            "confidence": confidence,
                            "bbox": bbox
                        })
                        total_confidence += confidence
            
            if not valid_results:
                return {
                    "success": True,
                    "text": "",
                    "confidence": 0.0,
                    "detected_items": 0
                }
            
            # Combine all text
            combined_text = " ".join([item["text"] for item in valid_results])
            average_confidence = total_confidence / len(valid_results)
            
            return {
                "success": True,
                "text": combined_text,
                "confidence": average_confidence,
                "detected_items": len(valid_results),
                "raw_results": valid_results
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": f"OCR processing failed: {str(e)}"
            }
    
    def sanitize_text(self, text: str) -> str:
        """
        Clean and sanitize extracted text.

        Keeps letters, numbers, whitespace, basic punctuation, and
        mathematical or scientific symbols. Control characters and other
        junk are replaced with spaces so formulas such as ``E = mc^2``
        stay intact.

        Args:
            text: Raw text from OCR

        Returns:
            Cleaned text
        """
        if not text:
            return ""

        def keep(ch: str) -> str:
            if (
                ch in _KEPT_PUNCTUATION
                or ch in _KEPT_SCIENCE
                or ch.isspace()
                or _WORD_CHAR.fullmatch(ch)
                or unicodedata.category(ch) == "Sm"
            ):
                return ch
            return " "

        cleaned = "".join(keep(ch) for ch in text)
        cleaned = re.sub(r"\s+", " ", cleaned)
        return cleaned.strip()
    
    def get_engine_info(self) -> Dict[str, Any]:
        """Get information about the OCR engine configuration"""
        return {
            "languages": self.languages,
            "gpu_enabled": self.gpu,
            "gpu_available": torch.cuda.is_available(),
            "device": "cuda" if self.gpu else "cpu",
            "initialized": self.reader is not None
        }
    
    def reinitialize(self, languages: list = None, gpu: bool = None):
        """
        Reinitialize the OCR engine with new configuration
        
        Args:
            languages: New language configuration
            gpu: New GPU configuration
        """
        if languages is not None:
            self.languages = languages
        if gpu is not None:
            self.gpu = gpu
        
        # Reinitialize reader
        self._initialize_reader()
    
    def cleanup(self):
        """Clean up OCR engine resources"""
        if self.reader is not None:
            del self.reader
            self.reader = None
        
        # Clear GPU cache if using CUDA
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        
        print("🧹 OCR engine cleaned up")