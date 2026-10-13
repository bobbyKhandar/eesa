"""sanitize_text must keep math and science symbols.

OCR formulas were losing operators because the allowlist only kept word
characters, whitespace, and a short punctuation set. These tests lock the
symbols that change the meaning of an expression, and the junk that should
still be removed.
"""

import contextlib
import io
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

# Import the engine module directly so package __init__ (cv2, Redis, …) is not required.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

# The engine imports torch and easyocr at module load. Sanitization does not
# need either library, so tests inject stubs when they are not installed.
if "torch" not in sys.modules:
    torch_stub = MagicMock()
    torch_stub.cuda.is_available.return_value = False
    sys.modules["torch"] = torch_stub
if "easyocr" not in sys.modules:
    sys.modules["easyocr"] = MagicMock()

from local_ocr_engine import OCREngine


class TestSanitizeKeepsMathSymbols(unittest.TestCase):
    def setUp(self):
        with patch("easyocr.Reader"), patch("torch.cuda.is_available", return_value=False):
            with contextlib.redirect_stdout(io.StringIO()):
                self.engine = OCREngine()

    def test_keeps_ascii_math_operators(self):
        raw = "x^2 + y = z/2 * (a < b) > c % 100"
        self.assertEqual(self.engine.sanitize_text(raw), raw)

    def test_keeps_brackets_and_braces(self):
        raw = "a[i] = {1, 2}"
        self.assertEqual(self.engine.sanitize_text(raw), raw)

    def test_keeps_unicode_math_greek_and_degree(self):
        raw = "πr^2 × 3 ÷ 4 ≤ n ≥ 1 ≠ 0 √2 α + β 90°"
        self.assertEqual(self.engine.sanitize_text(raw), raw)

    def test_keeps_other_common_math_symbols(self):
        raw = "2 ± 1 ≈ ∞ ∫ x dx · y′"
        self.assertEqual(self.engine.sanitize_text(raw), raw)

    def test_strips_control_characters_and_junk(self):
        self.assertEqual(
            self.engine.sanitize_text("Hello\x00\x01@#$\u200bWorld"),
            "Hello World",
        )
        self.assertEqual(
            self.engine.sanitize_text('"Hello" and \'World\''),
            "Hello and World",
        )
        self.assertEqual(self.engine.sanitize_text("Path\\to\\file"), "Path to file")

    def test_empty_and_blank_input(self):
        self.assertEqual(self.engine.sanitize_text(""), "")
        self.assertEqual(self.engine.sanitize_text(None), "")

    def test_normalizes_whitespace(self):
        self.assertEqual(
            self.engine.sanitize_text("Hello    World\n\n\nTest"),
            "Hello World Test",
        )

    def test_process_image_preserves_formula(self):
        self.engine.reader.readtext.return_value = [
            (
                [(0, 0), (80, 0), (80, 20), (0, 20)],
                "E = mc^2 × π",
                0.92,
            )
        ]
        result = self.engine.process_image(b"image")
        self.assertTrue(result["success"])
        self.assertEqual(result["text"], "E = mc^2 × π")
        self.assertEqual(result["raw_results"][0]["text"], "E = mc^2 × π")


if __name__ == "__main__":
    unittest.main()
