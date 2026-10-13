"""Compile per-page OCR outcomes into a file result that keeps failed pages visible.

A file is a clean success only when every page succeeded. Some failed pages
produce status ``partial`` (usable text, plus the pages that were lost). Every
page failing produces status ``failed``. DOCX extraction does not set a page
status; a successful DOCX result stays a clean success.
"""

from typing import Any, Dict, List


def compile_pdf_file_result(
    file_location: str,
    total_pages: int,
    file_results: List[Dict[str, Any]],
    total_confidence: float,
) -> Dict[str, Any]:
    """Build the file payload returned by PDF OCR."""
    successful_pages = [page for page in file_results if page.get("success")]
    failed_pages = [page for page in file_results if not page.get("success")]
    average_confidence = (
        total_confidence / len(successful_pages) if successful_pages else 0
    )
    combined_text = "\n\n".join(_page_text(page) for page in successful_pages)
    failed_page_numbers = [page.get("page_number") for page in failed_pages]

    result: Dict[str, Any] = {
        "file_location": file_location,
        "total_pages": total_pages,
        "successful_pages": len(successful_pages),
        "failed_pages": len(failed_pages),
        "failed_page_numbers": failed_page_numbers,
        "average_confidence": average_confidence,
        "combined_text": combined_text,
        "page_results": file_results,
    }

    if not successful_pages:
        result["success"] = False
        result["status"] = "failed"
        result["error"] = _pages_error(failed_pages, all_failed=True)
        return result

    if failed_pages:
        result["success"] = False
        result["status"] = "partial"
        result["error"] = _pages_error(failed_pages, all_failed=False)
        return result

    result["success"] = True
    result["status"] = "success"
    return result


def classify_file_outcome(file_result: Dict[str, Any]) -> str:
    """Return ``success``, ``partial``, or ``failed`` for one file payload.

    DOCX results omit ``status``. They stay a clean success when ``success`` is
    true and no pages were dropped. A legacy payload that says ``success``
    while ``failed_pages`` is non-zero is partial, not clean.
    """
    if not isinstance(file_result, dict):
        return "failed"

    status = file_result.get("status")
    if status == "partial":
        return "partial"
    if status == "failed":
        return "failed"
    if status == "success":
        return "success"

    failed_pages = file_result.get("failed_pages") or 0
    try:
        dropped = int(failed_pages) > 0
    except (TypeError, ValueError):
        dropped = False

    if file_result.get("success") is True and not dropped:
        return "success"
    if file_result.get("success") is True and dropped:
        return "partial"
    return "failed"


def batch_terminal_status(failed_files: int, partial_files: int) -> str:
    """Local batch status. A hard file failure still wins over partial pages.

    ``partial`` is the OCR batch status when pages were dropped but every file
    still produced text. It is separate from the AWS job status ``partial_success``.
    """
    if failed_files:
        return "failed"
    if partial_files:
        return "partial"
    return "completed"


def _page_text(page: Dict[str, Any]) -> str:
    text = page.get("text", "")
    return text if isinstance(text, str) else ""


def _pages_error(pages: List[Dict[str, Any]], *, all_failed: bool) -> str:
    parts = []
    for page in pages:
        number = page.get("page_number")
        reason = page.get("error") or "OCR processing failed"
        parts.append(f"page {number} ({reason})")
    detail = ", ".join(parts) if parts else "no page produced text"
    if all_failed:
        return f"All OCR pages failed: {detail}"
    return f"OCR failed for {detail}"
