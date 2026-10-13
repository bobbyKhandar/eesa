"""
DOCX text extraction for exam uploads.

DOCX is Office Open XML, not a PDF. Opening it with the PDF handler fails
before any text is produced. The file already contains the document text, so
this module reads word/document.xml directly and does not OCR the upload.
"""

import os
import zipfile
from pathlib import Path
from typing import Any, Dict, Optional
from xml.etree import ElementTree as ET


W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
MC_FALLBACK = "{http://schemas.openxmlformats.org/markup-compatibility/2006}Fallback"


class DocxExtractError(Exception):
    """A DOCX upload could not be read as text."""


def should_extract_docx(file_location: str, options: Optional[Dict[str, Any]] = None) -> bool:
    """True when this upload must skip the PDF OCR path."""
    if not isinstance(options, dict):
        options = {}
    declared = str(options.get("file_type") or "").strip().lower()
    if declared == "docx":
        return True
    return Path(file_location).suffix.lower() == ".docx"


def extract_docx_result(file_location: str) -> Dict[str, Any]:
    """
    Return the same result shape the PDF OCR path uses, with combined_text set.

    Failures stay success=False so the batch is marked failed and the Node
    client surfaces the error instead of an empty OCR result.
    """
    try:
        text = _extract_text(file_location)
    except DocxExtractError as exc:
        return {"success": False, "error": str(exc)}
    except Exception as exc:
        return {"success": False, "error": f"Cannot extract DOCX: {exc}"}

    return {
        "success": True,
        "file_location": file_location,
        "total_pages": 1,
        "successful_pages": 1,
        "failed_pages": 0,
        "average_confidence": 1.0,
        "combined_text": text,
        "page_results": [
            {
                "page_number": 1,
                "text": text,
                "confidence": 1.0,
                "success": True,
            }
        ],
    }


def _extract_text(file_location: str) -> str:
    if not os.path.isfile(file_location):
        raise DocxExtractError(f"DOCX file not found: {file_location}")

    suffix = Path(file_location).suffix.lower()
    if suffix == ".doc":
        raise DocxExtractError(
            "Legacy .doc files are not supported. Save the exam as .docx and upload again."
        )

    if not zipfile.is_zipfile(file_location):
        raise DocxExtractError(
            f"Not a valid DOCX file (expected a Word .docx document): {file_location}"
        )

    try:
        with zipfile.ZipFile(file_location) as archive:
            try:
                xml_bytes = archive.read("word/document.xml")
            except KeyError as exc:
                raise DocxExtractError(
                    f"Not a valid DOCX file (missing word/document.xml): {file_location}"
                ) from exc
    except zipfile.BadZipFile as exc:
        raise DocxExtractError(f"Not a valid DOCX file: {file_location}") from exc

    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        raise DocxExtractError(
            f"Not a valid DOCX file (document.xml is not readable): {file_location}"
        ) from exc

    paragraphs = []
    for paragraph in _iter_paragraphs(root):
        line = _paragraph_text(paragraph)
        if line:
            paragraphs.append(line)

    text = "\n".join(paragraphs).strip()
    if not text:
        raise DocxExtractError(f"No text extracted from DOCX: {file_location}")
    return text


def _iter_paragraphs(root: ET.Element):
    """Yield body paragraphs, skipping Word compatibility fallback copies."""

    def walk(node: ET.Element):
        if node.tag == MC_FALLBACK:
            return
        if node.tag == f"{W_NS}p":
            yield node
        for child in list(node):
            yield from walk(child)

    yield from walk(root)


def _paragraph_text(paragraph: ET.Element) -> str:
    """Join runs in one paragraph. Nested paragraphs are returned separately."""
    parts = []

    def walk(node: ET.Element) -> None:
        for child in list(node):
            if child.tag == f"{W_NS}p":
                continue
            if child.tag == f"{W_NS}t" and child.text:
                parts.append(child.text)
            elif child.tag == f"{W_NS}tab":
                parts.append("\t")
            elif child.tag in (f"{W_NS}br", f"{W_NS}cr"):
                parts.append("\n")
            else:
                walk(child)

    walk(paragraph)
    return "".join(parts).strip()
