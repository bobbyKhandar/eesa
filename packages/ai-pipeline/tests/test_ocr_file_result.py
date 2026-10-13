"""Failed OCR pages must not be reported as a clean file success."""

import ast
import importlib.util
import os
import unittest


def _load_ocr_file_result():
    """Load the helper without importing src/__init__.py (that pulls in cv2)."""
    module_path = os.path.join(os.path.dirname(__file__), "..", "src", "ocr_file_result.py")
    spec = importlib.util.spec_from_file_location("ocr_file_result", module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load OCR file result helper from {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_ocr_file_result = _load_ocr_file_result()
compile_pdf_file_result = _ocr_file_result.compile_pdf_file_result
classify_file_outcome = _ocr_file_result.classify_file_outcome
batch_terminal_status = _ocr_file_result.batch_terminal_status


def _page(number, text=None, error=None, success=True):
    page = {"page_number": number, "success": success}
    if success:
        page["text"] = text or ""
        page["confidence"] = 0.9
    else:
        page["error"] = error or "OCR processing failed"
    return page


class TestCompilePdfFileResult(unittest.TestCase):
    def test_every_page_succeeding_is_a_clean_success(self):
        result = compile_pdf_file_result(
            "/tmp/paper.pdf",
            2,
            [_page(1, "Question 1"), _page(2, "Question 2")],
            1.8,
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["failed_pages"], 0)
        self.assertEqual(result["failed_page_numbers"], [])
        self.assertEqual(result["successful_pages"], 2)
        self.assertIn("Question 1", result["combined_text"])
        self.assertIn("Question 2", result["combined_text"])
        self.assertNotIn("error", result)

    def test_some_failed_pages_are_partial_not_a_clean_success(self):
        result = compile_pdf_file_result(
            "/tmp/mixed.pdf",
            3,
            [
                _page(1, "Kept page"),
                _page(2, error="timeout", success=False),
                _page(3, "Also kept"),
            ],
            1.8,
        )

        self.assertFalse(result["success"])
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["failed_pages"], 1)
        self.assertEqual(result["failed_page_numbers"], [2])
        self.assertEqual(result["successful_pages"], 2)
        self.assertIn("Kept page", result["combined_text"])
        self.assertIn("Also kept", result["combined_text"])
        self.assertNotIn("timeout", result["combined_text"])
        self.assertIn("page 2", result["error"])
        self.assertIn("timeout", result["error"])
        self.assertEqual(len(result["page_results"]), 3)

    def test_all_failed_pages_fail_the_file_and_name_the_pages(self):
        result = compile_pdf_file_result(
            "/tmp/blank.pdf",
            2,
            [
                _page(1, error="blur", success=False),
                _page(4, error="blank image", success=False),
            ],
            0,
        )

        self.assertFalse(result["success"])
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["failed_pages"], 2)
        self.assertEqual(result["failed_page_numbers"], [1, 4])
        self.assertEqual(result["successful_pages"], 0)
        self.assertEqual(result["combined_text"], "")
        self.assertIn("page 1", result["error"])
        self.assertIn("page 4", result["error"])
        self.assertIn("blur", result["error"])


class TestFileOutcomeAndBatchStatus(unittest.TestCase):
    def test_docx_extraction_stays_a_clean_success(self):
        outcome = classify_file_outcome(
            {
                "success": True,
                "failed_pages": 0,
                "combined_text": "Q1. Define latency",
            }
        )
        self.assertEqual(outcome, "success")
        self.assertEqual(batch_terminal_status(0, 0), "completed")

    def test_docx_extraction_failure_still_fails_the_batch(self):
        outcome = classify_file_outcome(
            {"success": False, "error": "No text extracted from DOCX: paper.docx"}
        )
        self.assertEqual(outcome, "failed")
        self.assertEqual(batch_terminal_status(1, 0), "failed")

    def test_partial_pages_do_not_complete_or_fail_the_whole_batch(self):
        partial = compile_pdf_file_result(
            "/tmp/mixed.pdf",
            2,
            [_page(1, "kept"), _page(2, error="timeout", success=False)],
            0.9,
        )
        self.assertEqual(classify_file_outcome(partial), "partial")
        self.assertEqual(batch_terminal_status(0, 1), "partial")

    def test_a_fully_failed_file_still_fails_the_batch_ahead_of_partials(self):
        self.assertEqual(batch_terminal_status(1, 2), "failed")

    def test_legacy_success_flag_with_failed_pages_is_not_clean(self):
        outcome = classify_file_outcome(
            {
                "success": True,
                "failed_pages": 1,
                "combined_text": "only page 1",
                "page_results": [
                    _page(1, "only page 1"),
                    _page(2, error="timeout", success=False),
                ],
            }
        )
        self.assertEqual(outcome, "partial")


class TestPipelineUsesFileResultHelper(unittest.TestCase):
    def test_pdf_processing_compiles_page_outcomes_and_keeps_partial_results(self):
        source_path = os.path.join(os.path.dirname(__file__), "..", "src", "pipeline_manager.py")
        with open(source_path, encoding="utf-8") as handle:
            source = handle.read()
        tree = ast.parse(source)

        pdf_fn = _pipeline_method(tree, "_process_pdf_file")
        batch_fn = _pipeline_method(tree, "_process_single_batch")
        pdf_src = ast.get_source_segment(source, pdf_fn) or ""
        batch_src = ast.get_source_segment(source, batch_fn) or ""

        self.assertIn("compile_pdf_file_result", pdf_src)
        self.assertIn("classify_file_outcome", batch_src)
        self.assertIn("batch_terminal_status", batch_src)
        self.assertIn("should_extract_docx", batch_src)
        self.assertIn("_process_docx_file", batch_src)
        self.assertIn("batch_results[file_location] = file_result", batch_src)


def _pipeline_method(tree: ast.AST, name: str) -> ast.FunctionDef:
    for node in tree.body:
        if not isinstance(node, ast.ClassDef) or node.name != "PipelineManager":
            continue
        for item in node.body:
            if isinstance(item, ast.FunctionDef) and item.name == name:
                return item
    raise AssertionError(f"{name} should exist on PipelineManager")


if __name__ == "__main__":
    unittest.main()
