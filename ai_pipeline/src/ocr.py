"""
Simplified OCR module for the AI Pipeline.
This module provides only the OCR functionality needed by jobHandler.py
"""

import re
import easyocr
import torch
import os

class Ocr:
    """OCR engine that processes images and returns text with confidence scores"""
    
    def __init__(self):
        """Initialize the OCR engine with GPU configuration"""
        # Configure GPU usage
        if torch.cuda.is_available():
            device_count = torch.cuda.device_count()
            print(f"Found {device_count} CUDA devices")
            
            if device_count > 1:
                # Use GPU 1 (second GPU) if available
                torch.cuda.set_device(1)
                os.environ['CUDA_VISIBLE_DEVICES'] = '1'
                print(f"Using GPU 1: {torch.cuda.get_device_name(1)}")
            else:
                # Only one GPU available, use it
                torch.cuda.set_device(0)
                print(f"Only one GPU available, using GPU 0: {torch.cuda.get_device_name(0)}")
        else:
            print("CUDA not available, using CPU")
        
        # Initialize EasyOCR reader
        self.reader = easyocr.Reader(['en'], gpu=torch.cuda.is_available())

    def processImage(self, image, allowDebugging=True):
        """
        Process an image and extract text with confidence scores
        
        Args:
            image: numpy array representing the image
            allowDebugging: unused parameter for backward compatibility
            
        Returns:
            dict: {
                "success": bool,
                "text": list of dict with text and confidence,
                "confidence": float (average confidence)
            } or {"success": False, "error": str} on failure
        """
        try:
            # Use EasyOCR to extract text
            results = self.reader.readtext(
                image, 
                decoder="beamsearch", 
                beamWidth=15, 
                batch_size=8, 
                detail=1, 
                paragraph=False, 
                min_size=20
            )
            
            # Format results
            text = [{"text": text, "confidence": conf} for _, text, conf in results]
            
            # Calculate average confidence
            total_confidence = sum([conf for _, _, conf in results])
            avg_confidence = (total_confidence / len(results) if len(results) > 0 else 0)
            
            return {
                "success": True, 
                "text": text, 
                "confidence": avg_confidence
            }
            
        except Exception as e:
            return {
                "success": False, 
                "error": str(e)
            }


    def sanitize(self, text_list):
        """
        Sanitize a list of text items or a single text string
        
        Args:
            text_list: list of text items or single string
            
        Returns:
            list of sanitized strings or single sanitized string
        """
        if isinstance(text_list, list):
            return [self._sanitize_string(item.get("text", "") if isinstance(item, dict) else str(item)) 
                   for item in text_list]
        else:
            return self._sanitize_string(str(text_list))

    
    def _sanitize_string(self, text: str) -> str:
        """
        Sanitize a single text string by removing control characters and normalizing
        
        Args:
            text: input string to sanitize
            
        Returns:
            str: sanitized string
        """
        # Strip ASCII control chars (except \t, \n, \r)
        text = re.sub(r'[\x00-\x08\x0B-\x0C\x0E-\x1F]', '', text)

        # Normalize quotes → regular double/single quotes
        text = text.replace(""", '"').replace(""", '"')
        text = text.replace("'", "'").replace("'", "'")

        # Remove soft hyphen + zero-width junk
        text = re.sub(r'[\u00ad\u200b\u200c\u200d\ufeff]', '', text)

        # Escape backslashes that aren't valid JSON escapes
        text = re.sub(r'\\(?!["\\/bfnrtu])', r'\\\\', text)

        # Remove trailing commas before } or ]
        text = re.sub(r",\s*([}\]])", r"\1", text)

        # Collapse multiple spaces/tabs
        text = re.sub(r'[ \t]+', ' ', text)

        # Fix inner quotes: keep outer ", replace inner " with '
        text = re.sub(r'"([^"]*)"', lambda m: '"' + m.group(1).replace('"', "'") + '"', text)

        # Strip leading/trailing commas/colons (extra safety)
        text = re.sub(r'^[\s,:]+', '', text)
        text = re.sub(r'[\s,:]+$', '', text)

        # Trim leading/trailing whitespace
        return text.strip()
