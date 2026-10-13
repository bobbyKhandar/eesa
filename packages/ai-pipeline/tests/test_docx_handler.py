"""DOCX uploads must be text-extracted, not opened as PDFs."""

import ast
import importlib.util
import os
import tempfile
import unittest
import zipfile
from xml.sax.saxutils import escape


def _load_docx_handler():
    """Load the extractor without importing src/__init__.py (that pulls in cv2)."""
    handler_path = os.path.join(os.path.dirname(__file__), "..", "src", "docx_handler.py")
    spec = importlib.util.spec_from_file_location("docx_handler", handler_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load DOCX handler from {handler_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_docx_handler = _load_docx_handler()
extract_docx_result = _docx_handler.extract_docx_result
should_extract_docx = _docx_handler.should_extract_docx


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006"


def _document_xml(body_inner: str) -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:document xmlns:w="{W_NS}" xmlns:mc="{MC_NS}">'
        f"<w:body>{body_inner}</w:body></w:document>"
    )


def _paragraph(text: str) -> str:
    return f'<w:p><w:r><w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>'


def write_docx(path: str, body_inner: str) -> None:
    document = _document_xml(body_inner)
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
"""
    rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"""
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", rels)
        archive.writestr("word/document.xml", document.encode("utf-8"))


class TestDocxRouting(unittest.TestCase):
    def test_routes_docx_extension_even_when_file_type_says_pdf(self):
        self.assertTrue(should_extract_docx("/tmp/exam.DOCX", {"file_type": "pdf"}))

    def test_routes_declared_docx_type_without_relying_on_extension(self):
        self.assertTrue(should_extract_docx("/tmp/upload/123-paper", {"file_type": "DOCX"}))

    def test_leaves_pdf_and_images_on_the_ocr_path(self):
        self.assertFalse(should_extract_docx("/tmp/exam.pdf", {"file_type": "pdf"}))
        self.assertFalse(should_extract_docx("/tmp/scan.png", {"file_type": "image"}))
        self.assertFalse(should_extract_docx("/tmp/scan.png", None))


class TestDocxExtraction(unittest.TestCase):
    def test_extracts_paragraphs_tables_and_split_runs(self):
        body = (
            _paragraph("Q1. Define latency")
            + "<w:p><w:r><w:t>Marks</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>5</w:t></w:r></w:p>"
            + "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell answer</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"
            + _paragraph("Unité — café")
        )
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "exam.docx")
            write_docx(path, body)
            result = extract_docx_result(path)

        self.assertTrue(result["success"])
        self.assertEqual(result["file_location"], path)
        self.assertIn("Q1. Define latency", result["combined_text"])
        self.assertIn("Marks\t5", result["combined_text"])
        self.assertIn("Cell answer", result["combined_text"])
        self.assertIn("Unité — café", result["combined_text"])
        self.assertGreaterEqual(result["successful_pages"], 1)
        self.assertTrue(result["page_results"][0]["success"])
        self.assertNotIn("No pages extracted from PDF", result.get("error", ""))

    def test_does_not_duplicate_compatibility_fallback_text(self):
        body = (
            f'<mc:AlternateContent>'
            f'<mc:Choice Requires="wps">{_paragraph("Visible question")}</mc:Choice>'
            f'<mc:Fallback>{_paragraph("Visible question")}</mc:Fallback>'
            f"</mc:AlternateContent>"
        )
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "fallback.docx")
            write_docx(path, body)
            result = extract_docx_result(path)

        self.assertTrue(result["success"])
        self.assertEqual(result["combined_text"].count("Visible question"), 1)

    def test_rejects_empty_legacy_and_non_docx_files_with_a_clear_error(self):
        with tempfile.TemporaryDirectory() as directory:
            empty_path = os.path.join(directory, "empty.docx")
            write_docx(empty_path, _paragraph("   "))
            empty = extract_docx_result(empty_path)
            self.assertFalse(empty["success"])
            self.assertIn("no text", empty["error"].lower())

            fake_path = os.path.join(directory, "not-really.docx")
            with open(fake_path, "w", encoding="utf-8") as handle:
                handle.write("this is not a zip")
            fake = extract_docx_result(fake_path)
            self.assertFalse(fake["success"])
            self.assertIn("not a valid", fake["error"].lower())

            legacy_path = os.path.join(directory, "old.doc")
            with open(legacy_path, "wb") as handle:
                handle.write(b"\xd0\xcf\x11\xe0")
            legacy = extract_docx_result(legacy_path)
            self.assertFalse(legacy["success"])
            self.assertIn(".docx", legacy["error"].lower())

            missing = extract_docx_result(os.path.join(directory, "missing.docx"))
            self.assertFalse(missing["success"])
            self.assertIn("not found", missing["error"].lower())


class TestPipelineDispatch(unittest.TestCase):
    def test_batch_processor_sends_docx_to_the_docx_extractor(self):
        source_path = os.path.join(os.path.dirname(__file__), "..", "src", "pipeline_manager.py")
        with open(source_path, encoding="utf-8") as handle:
            source = handle.read()
        tree = ast.parse(source)
        batch_fn = None
        for node in tree.body:
            if isinstance(node, ast.ClassDef) and node.name == "PipelineManager":
                for item in node.body:
                    if isinstance(item, ast.FunctionDef) and item.name == "_process_single_batch":
                        batch_fn = item
        self.assertIsNotNone(batch_fn, "_process_single_batch should exist")

        found = False
        for node in ast.walk(batch_fn):
            if not isinstance(node, ast.If):
                continue
            test_src = ast.get_source_segment(source, node.test) or ""
            if "should_extract_docx" not in test_src:
                continue
            then_src = "\n".join(ast.get_source_segment(source, stmt) or "" for stmt in node.body)
            else_src = "\n".join(ast.get_source_segment(source, stmt) or "" for stmt in node.orelse)
            self.assertIn("_process_docx_file", then_src)
            self.assertNotIn("_process_pdf_file", then_src)
            self.assertIn("_process_pdf_file", else_src)
            found = True
        self.assertTrue(found, "DOCX files must branch away from the PDF handler")
