"""Local OCR must render one PDF page at a time and refuse unsafe pages.

extract_pages used to render every page into a list before OCR started, and
validate_pdf only warned. These tests cover the incremental generator, the
batch path that frees each page after OCR, and hard page-count / pixel limits.
"""

import importlib.util
import os
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

import fitz


def _src_dir():
    return os.path.join(os.path.dirname(__file__), "..", "src")


def _load(name, filename):
    path = os.path.join(_src_dir(), filename)
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load {name} from {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _stub(name, **attrs):
    module = types.ModuleType(name)
    for key, value in attrs.items():
        setattr(module, key, value)
    sys.modules[name] = module
    return module


def _load_pdf_handler():
    if _src_dir() not in sys.path:
        sys.path.insert(0, _src_dir())
    return _load("pdf_handler", "pdf_handler.py")


def _load_pipeline():
    """Import the batch processor without EasyOCR, OpenCV, or Redis.

    Stubs are removed from ``sys.modules`` after import so later tests still
    load the real modules. The pipeline module keeps the objects it already
    bound.
    """
    src = _src_dir()
    if src not in sys.path:
        sys.path.insert(0, src)

    stub_names = (
        "cv2",
        "redis_client",
        "local_ocr_engine",
        "local_image_processor_pipeline",
    )
    previous = {name: sys.modules.get(name) for name in stub_names}

    _stub("cv2", imwrite=lambda *args, **kwargs: True)

    class _RedisKeys:
        QUEUE_MAIN_INTAKE = "queue:main:intake"

    _stub(
        "redis_client",
        RedisKeys=_RedisKeys,
        hash_set=lambda *args, **kwargs: None,
        hash_get_json=lambda *args, **kwargs: None,
        queue_push=lambda *args, **kwargs: None,
        queue_pop=lambda *args, **kwargs: None,
    )

    class _OCREngine:
        def __init__(self, *args, **kwargs):
            pass

        def process_image(self, image):
            return {"success": True, "text": "page", "confidence": 0.9}

    _stub("local_ocr_engine", OCREngine=_OCREngine)

    class _ImageProcessor:
        def __init__(self, *args, **kwargs):
            pass

        def preprocess_image(self, image):
            return image

    _stub("local_image_processor_pipeline", ImageProcessor=_ImageProcessor)

    try:
        _load("docx_handler", "docx_handler.py")
        _load("ocr_file_result", "ocr_file_result.py")
        return _load("pipeline_manager_under_test", "pipeline_manager.py")
    finally:
        for name, module in previous.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module


pdf_handler_mod = _load_pdf_handler()
pipeline_mod = _load_pipeline()
PDFHandler = pdf_handler_mod.PDFHandler


def _write_pdf(path, sizes):
    doc = fitz.open()
    for width, height in sizes:
        doc.new_page(width=width, height=height)
    doc.save(path)
    doc.close()


def _rendered_pixels(path, page_index, dpi):
    doc = fitz.open(path)
    page = doc[page_index]
    box = (page.rect * fitz.Matrix(dpi / 72.0, dpi / 72.0)).irect
    width, height = int(box.width), int(box.height)
    doc.close()
    return width, height, width * height


class _PageSource:
    """Stand-in handler that records whether pages are built all at once."""

    def __init__(self, pages=2, valid=True, errors=None):
        self.events = []
        self.image_still_held_at_next_yield = []
        self._previous = None
        self._pages = pages
        self._valid = valid
        self._errors = list(errors or [])

    def validate_pdf(self, path, dpi=None):
        self.events.append(("validate", dpi))
        return {
            "valid": self._valid,
            "errors": list(self._errors),
            "warnings": [],
            "info": {},
        }

    def extract_pages(self, path, dpi=400, page_range=None):
        self.events.append(("extract-all", dpi))
        return [self._make(number) for number in range(1, self._pages + 1)]

    def iter_pages(self, path, dpi=400, page_range=None):
        self.events.append(("iter", dpi))
        for number in range(1, self._pages + 1):
            if self._previous is not None:
                held = self._previous.get("image") is not None
                self.image_still_held_at_next_yield.append(held)
            page = self._make(number)
            self._previous = page
            yield page

    def _make(self, number):
        return {"page_number": number, "image": bytearray(b"page-image")}


class TestIncrementalPageRendering(unittest.TestCase):
    def setUp(self):
        self.handler = PDFHandler()
        self.temp = tempfile.TemporaryDirectory()
        self.pdf_path = os.path.join(self.temp.name, "paper.pdf")
        _write_pdf(self.pdf_path, [(612, 792), (612, 792)])

    def tearDown(self):
        self.temp.cleanup()

    def test_iter_pages_renders_the_next_page_only_when_pulled(self):
        iterate = getattr(self.handler, "iter_pages", None)
        self.assertTrue(callable(iterate), "iter_pages should yield one page at a time")

        calls = []
        real_get_pixmap = fitz.Page.get_pixmap

        def wrapped(page, *args, **kwargs):
            calls.append(page.number)
            return real_get_pixmap(page, *args, **kwargs)

        with patch.object(fitz.Page, "get_pixmap", wrapped):
            generator = iterate(self.pdf_path, dpi=72)
            self.assertTrue(hasattr(generator, "__next__"))
            self.assertEqual(calls, [])
            first = next(generator)
            self.assertEqual(calls, [0])
            self.assertEqual(first["page_number"], 1)
            self.assertIn("image", first)
            second = next(generator)
            self.assertEqual(calls, [0, 1])
            self.assertEqual(second["page_number"], 2)
            generator.close()

    def test_extract_pages_still_returns_a_list_for_existing_callers(self):
        missing = self.handler.extract_pages(os.path.join(self.temp.name, "missing.pdf"))
        self.assertEqual(missing, [])

        pages = self.handler.extract_pages(self.pdf_path, dpi=72)
        self.assertIsInstance(pages, list)
        self.assertEqual([page["page_number"] for page in pages], [1, 2])
        self.assertIn("image", pages[0])


class TestPdfRenderLimits(unittest.TestCase):
    def setUp(self):
        self.handler = PDFHandler()
        self.temp = tempfile.TemporaryDirectory()
        self.normal_path = os.path.join(self.temp.name, "normal.pdf")
        self.huge_path = os.path.join(self.temp.name, "huge.pdf")
        _write_pdf(self.normal_path, [(612, 792), (612, 792), (500, 500)])
        _write_pdf(self.huge_path, [(14400, 14400)])

    def tearDown(self):
        self.temp.cleanup()

    def test_page_count_over_the_configured_limit_fails_before_rendering(self):
        calls = []
        real_get_pixmap = fitz.Page.get_pixmap

        def wrapped(page, *args, **kwargs):
            calls.append(page.number)
            return real_get_pixmap(page, *args, **kwargs)

        with patch.dict(os.environ, {"MAX_PAGES_PER_PDF": "2"}, clear=False):
            with patch.object(fitz.Page, "get_pixmap", wrapped):
                result = self.handler.validate_pdf(self.normal_path, dpi=72)
                limit_error = getattr(pdf_handler_mod, "PDFLimitError", None)
                self.assertIsNotNone(limit_error, "PDFLimitError should name limit failures")
                with self.assertRaises(limit_error):
                    list(self.handler.iter_pages(self.normal_path, dpi=72))
                with self.assertRaises(limit_error):
                    self.handler.extract_pages(self.normal_path, dpi=72)

        self.assertFalse(result["valid"])
        message = " ".join(result["errors"])
        self.assertIn("3 pages", message)
        self.assertIn("maximum of 2", message)
        self.assertEqual(calls, [])

    def test_pixel_limit_fails_clearly_and_does_not_render_the_page(self):
        width, height, pixels = _rendered_pixels(self.normal_path, 0, 72)
        limit = pixels - 1
        calls = []

        def refuse_render(page, *args, **kwargs):
            calls.append("rendered")
            raise AssertionError("page was rendered")

        with patch.dict(os.environ, {"MAX_PDF_PAGE_PIXELS": str(limit)}, clear=False):
            with patch.object(fitz.Page, "get_pixmap", refuse_render):
                result = self.handler.validate_pdf(self.normal_path, dpi=72)
                limit_error = pdf_handler_mod.PDFLimitError
                with self.assertRaises(limit_error) as raised:
                    list(self.handler.iter_pages(self.normal_path, dpi=72))

        self.assertFalse(result["valid"])
        message = " ".join(result["errors"])
        self.assertIn(f"{width}x{height}", message)
        self.assertIn(str(pixels), message)
        self.assertIn(str(limit), message)
        self.assertIn("72", message)
        self.assertIn("Page 1", message)
        self.assertIn(f"{width}x{height}", str(raised.exception))
        self.assertEqual(calls, [])

    def test_a_page_within_the_pixel_limit_stays_valid(self):
        _width, _height, pixels = _rendered_pixels(self.normal_path, 0, 72)
        with patch.dict(os.environ, {"MAX_PDF_PAGE_PIXELS": str(pixels)}, clear=False):
            result = self.handler.validate_pdf(self.normal_path, dpi=72)
        self.assertTrue(result["valid"], result)
        self.assertEqual(result["errors"], [])

    def test_invalid_limit_values_keep_the_defaults(self):
        self.assertTrue(hasattr(pdf_handler_mod, "max_pages_per_pdf"))
        self.assertTrue(hasattr(pdf_handler_mod, "max_page_pixels"))
        self.assertTrue(hasattr(pdf_handler_mod, "default_dpi"))
        with patch.dict(
            os.environ,
            {
                "MAX_PAGES_PER_PDF": "0",
                "MAX_PDF_PAGE_PIXELS": "nope",
                "DEFAULT_DPI": " ",
            },
            clear=False,
        ):
            self.assertEqual(pdf_handler_mod.max_pages_per_pdf(), 1000)
            self.assertEqual(pdf_handler_mod.max_page_pixels(), 50_000_000)
            self.assertEqual(pdf_handler_mod.default_dpi(), 400)

        with patch.dict(os.environ, {"MAX_PAGES_PER_PDF": "2"}, clear=False):
            self.assertEqual(pdf_handler_mod.max_pages_per_pdf(), 2)

    def test_low_dpi_validation_does_not_probe_render_over_the_pixel_cap(self):
        calls = []

        def refuse_render(page, *args, **kwargs):
            calls.append("rendered")
            raise AssertionError("probe rendered")

        with patch.dict(os.environ, {"MAX_PDF_PAGE_PIXELS": "1000000"}, clear=False):
            with patch.object(fitz.Page, "get_pixmap", refuse_render):
                result = self.handler.validate_pdf(self.huge_path, dpi=1)

        self.assertFalse(result["valid"])
        self.assertIn("pixels", " ".join(result["errors"]))
        self.assertEqual(calls, [])

    def test_huge_page_is_rejected_under_the_default_pixel_cap(self):
        calls = []

        def refuse_render(page, *args, **kwargs):
            calls.append("rendered")
            raise AssertionError("huge page was rendered")

        with patch.dict(os.environ, {"MAX_PDF_PAGE_PIXELS": "50000000"}, clear=False):
            with patch.object(fitz.Page, "get_pixmap", refuse_render):
                result = self.handler.validate_pdf(self.huge_path, dpi=72)

        self.assertFalse(result["valid"])
        self.assertIn("pixels", " ".join(result["errors"]))
        self.assertEqual(calls, [])


class TestPipelineProcessesPagesIncrementally(unittest.TestCase):
    def setUp(self):
        self.manager = pipeline_mod.PipelineManager.__new__(pipeline_mod.PipelineManager)
        self.manager.image_processor = pipeline_mod.ImageProcessor()
        self.manager.ocr_engine = pipeline_mod.OCREngine()

    def _use(self, handler):
        self.manager.pdf_handler = handler
        return handler

    def test_validation_runs_and_each_page_is_released_before_the_next_render(self):
        handler = self._use(_PageSource())
        with patch.dict(os.environ, {"DEFAULT_DPI": "72"}, clear=False):
            result = self.manager._process_pdf_file("/tmp/paper.pdf")

        self.assertEqual(handler.events[0][0], "validate")
        self.assertEqual(handler.events[0][1], 72)
        self.assertIn(("iter", 72), handler.events)
        self.assertNotIn(("extract-all", 72), handler.events)
        self.assertEqual(handler.image_still_held_at_next_yield, [False])
        self.assertTrue(result["success"])
        self.assertEqual(result["failed_pages"], 0)
        self.assertEqual(result["total_pages"], 2)
        self.assertEqual(result["status"], "success")
        for page in result["page_results"]:
            self.assertNotIn("image", page)

    def test_invalid_pdf_fails_with_the_validation_error_and_does_not_render(self):
        handler = self._use(
            _PageSource(
                valid=False,
                errors=["PDF has 3 pages, which exceeds the maximum of 2"],
            )
        )
        result = self.manager._process_pdf_file("/tmp/too-many.pdf")

        self.assertFalse(result["success"])
        self.assertIn("exceeds the maximum of 2", result["error"])
        self.assertEqual([event[0] for event in handler.events], ["validate"])

    def test_failed_ocr_pages_stay_partial_and_the_image_is_still_released(self):
        handler = self._use(_PageSource())

        def process_image(_image):
            if not hasattr(process_image, "calls"):
                process_image.calls = 0
            process_image.calls += 1
            if process_image.calls == 1:
                return {"success": True, "text": "kept", "confidence": 0.8}
            return {"success": False, "error": "timeout"}

        self.manager.ocr_engine.process_image = process_image
        result = self.manager._process_pdf_file("/tmp/mixed.pdf")

        self.assertFalse(result["success"])
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["failed_pages"], 1)
        self.assertEqual(result["failed_page_numbers"], [2])
        self.assertIn("kept", result["combined_text"])
        self.assertIn("page 2", result["error"])
        self.assertEqual(handler.image_still_held_at_next_yield, [False])

    def test_real_pdf_over_the_page_limit_never_reaches_ocr(self):
        self.manager.pdf_handler = PDFHandler()
        ocr_calls = []
        self.manager.ocr_engine.process_image = lambda image: ocr_calls.append(True)
        with tempfile.TemporaryDirectory() as temp:
            path = os.path.join(temp, "three.pdf")
            _write_pdf(path, [(200, 200), (200, 200), (200, 200)])
            with patch.dict(os.environ, {"MAX_PAGES_PER_PDF": "1", "DEFAULT_DPI": "72"}, clear=False):
                result = self.manager._process_pdf_file(path)

        self.assertFalse(result["success"])
        self.assertIn("3 pages", result["error"])
        self.assertIn("maximum of 1", result["error"])
        self.assertEqual(ocr_calls, [])

    def test_no_pages_still_fails_clearly(self):
        handler = self._use(_PageSource(pages=0))
        result = self.manager._process_pdf_file("/tmp/empty.pdf")

        self.assertFalse(result["success"])
        self.assertEqual(result["error"], "No pages extracted from PDF")
        self.assertEqual(handler.events[0][0], "validate")


if __name__ == "__main__":
    unittest.main()
