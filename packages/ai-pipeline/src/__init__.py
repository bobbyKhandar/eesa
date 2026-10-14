"""AI Pipeline Module - Clean OCR processing with batch management"""

import importlib

__version__ = "2.0.0"

# Core classes
from .pipeline_manager import PipelineManager, pipeline_manager
from .local_ocr_engine import OCREngine
from .local_image_processor_pipeline import ImageProcessor
from .pdf_handler import PDFHandler

# Redis client (utility)
from . import redis_client

# Server bootstrap names. Importing ``api.server`` creates the Flask app and
# its AWS clients, so these stay lazy: importing ``src`` (or the documented
# ``from src.pipeline_manager import pipeline_manager``) must not start a
# server just to expose the core classes.
_SERVER_EXPORTS = ("AIServer", "start_server", "stop_server")


def __getattr__(name):
    if name not in _SERVER_EXPORTS:
        raise AttributeError("module %r has no attribute %r" % (__name__, name))
    api_server = importlib.import_module(".api.server", __name__)
    return getattr(api_server, name)


def __dir__():
    return sorted(set(globals()) | set(_SERVER_EXPORTS))


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
