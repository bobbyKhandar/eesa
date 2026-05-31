"""AI Pipeline Module - Clean OCR processing with batch management"""

__version__ = "2.0.0"

# Core classes
from .pipeline_manager import PipelineManager, pipeline_manager
from .ocr_engine import OCREngine
from .image_processor import ImageProcessor
from .pdf_handler import PDFHandler
from .server import AIServer, start_server, stop_server

# Redis client (utility)
from . import redis_client

__all__ = [
    'PipelineManager',
    'pipeline_manager',
    'OCREngine', 
    'ImageProcessor',
    'PDFHandler',
    'AIServer',
    'start_server',
    'stop_server',
    'redis_client'
]
