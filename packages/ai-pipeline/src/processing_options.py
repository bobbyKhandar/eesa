"""
Batch processing options for the local OCR pipeline.

``PipelineManager.submit_batch`` validates every submitted option against the
allowlist below. An unsupported key is a submission error, not metadata the
pipeline stores and then ignores: the batch is rejected with HTTP 400 before
it reaches Redis. The mapping helpers turn the validated options into the
parameters the PDF, preprocessing, and OCR stages actually read, so a batch
that asks for a stricter confidence threshold or different preprocessing
bounds is processed with them.
"""

from typing import Any, Dict, List, Optional


class ProcessingOptionsError(ValueError):
    """A batch was submitted with unsupported or malformed processing options."""


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _reject(name: str, value: Any, expectation: str) -> ProcessingOptionsError:
    return ProcessingOptionsError(
        "Option '%s' must be %s, got %r" % (name, expectation, value)
    )


def _validate_positive_int(name: str, value: Any) -> int:
    if not _is_int(value) or value <= 0:
        raise _reject(name, value, "a positive integer")
    return value


def _validate_bool(name: str, value: Any) -> bool:
    if not isinstance(value, bool):
        raise _reject(name, value, "a boolean (true or false)")
    return value


def _validate_confidence_threshold(name: str, value: Any) -> float:
    if not _is_number(value) or not 0.0 <= float(value) <= 1.0:
        raise _reject(name, value, "a number between 0 and 1")
    return float(value)


def _validate_page_range(name: str, value: Any) -> List[int]:
    """A ``[start, end]`` page span. ``end`` is exclusive, matching ``iter_pages``."""
    pair = list(value) if isinstance(value, (list, tuple)) else None
    if pair is None or len(pair) != 2 or not all(_is_int(item) for item in pair):
        raise _reject(name, value, "a [start, end] pair of integers")
    start, end = pair
    if start < 0 or end <= start:
        raise ProcessingOptionsError(
            "Option '%s' must satisfy 0 <= start < end, got [%d, %d]" % (name, start, end)
        )
    return [start, end]


FILE_TYPES = ("pdf", "docx", "image")


def _validate_file_type(name: str, value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise _reject(name, value, "one of " + ", ".join(FILE_TYPES))
    normalized = value.strip().lower()
    if normalized not in FILE_TYPES:
        raise _reject(name, value, "one of " + ", ".join(FILE_TYPES))
    return normalized


# Every option a batch may submit. Anything outside this table is rejected.
OPTION_VALIDATORS = {
    # PDF rendering
    "dpi": _validate_positive_int,
    "page_range": _validate_page_range,
    # Image preprocessing
    "max_width": _validate_positive_int,
    "max_height": _validate_positive_int,
    "min_width": _validate_positive_int,
    "min_height": _validate_positive_int,
    "skip_quality_analysis": _validate_bool,
    "enhance_contrast": _validate_bool,
    "denoise": _validate_bool,
    "binarize": _validate_bool,
    # OCR
    "confidence_threshold": _validate_confidence_threshold,
    # Routing
    "file_type": _validate_file_type,
}

SUPPORTED_OPTIONS = tuple(sorted(OPTION_VALIDATORS))


def validate_batch_options(options: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Validate submitted processing options and return the normalized copy.

    An empty or missing option set is valid. Anything the pipeline cannot
    honor, or a recognized option with a malformed value, raises
    ``ProcessingOptionsError`` so the caller is told instead of having the
    option silently dropped.
    """
    if options is None:
        return {}
    if not isinstance(options, dict):
        raise ProcessingOptionsError(
            "Processing options must be an object, got %r" % (options,)
        )

    unsupported = sorted(str(key) for key in options if key not in OPTION_VALIDATORS)
    if unsupported:
        raise ProcessingOptionsError(
            "Unsupported processing options: %s. Supported options: %s"
            % (", ".join(unsupported), ", ".join(SUPPORTED_OPTIONS))
        )

    return {
        name: OPTION_VALIDATORS[name](name, options[name]) for name in options
    }


# Options the preprocessing stage consumes, with the public names mapped onto
# the ImageProcessor parameters they force.
PREPROCESSING_PASSTHROUGH = (
    "max_width",
    "max_height",
    "min_width",
    "min_height",
    "skip_quality_analysis",
)
PREPROCESSING_ALIASES = {
    "enhance_contrast": "force_contrast",
    "denoise": "force_denoise",
    "binarize": "force_binarize",
}


def pdf_render_options(options: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Map validated options onto ``PDFHandler`` render parameters."""
    options = options or {}
    render: Dict[str, Any] = {}
    if "dpi" in options:
        render["dpi"] = options["dpi"]
    if "page_range" in options:
        render["page_range"] = tuple(options["page_range"])
    return render


def preprocessing_options(options: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Map validated options onto ``ImageProcessor.preprocess_image`` parameters."""
    options = options or {}
    mapped: Dict[str, Any] = {
        key: options[key] for key in PREPROCESSING_PASSTHROUGH if key in options
    }
    for source, target in PREPROCESSING_ALIASES.items():
        if source in options:
            mapped[target] = options[source]
    return mapped


def ocr_options(options: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Map validated options onto ``OCREngine.process_image`` parameters."""
    options = options or {}
    ocr: Dict[str, Any] = {}
    if "confidence_threshold" in options:
        ocr["confidence_threshold"] = options["confidence_threshold"]
    return ocr
