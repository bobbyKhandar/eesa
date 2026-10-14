"""
PDF Handler - Manages PDF file processing and page extraction
Clean implementation focused on PDF operations
"""

import fitz  # PyMuPDF
import numpy as np
from typing import List, Dict, Any, Optional, Iterator
import os
import logging
from PIL import Image
import io


DEFAULT_DPI = 400
DEFAULT_MAX_PAGES = 1000
DEFAULT_MAX_PAGE_PIXELS = 50_000_000

DPI_ENV = "DEFAULT_DPI"
MAX_PAGES_ENV = "MAX_PAGES_PER_PDF"
MAX_PIXELS_ENV = "MAX_PDF_PAGE_PIXELS"


class PDFLimitError(ValueError):
    """A PDF exceeds the configured page-count or rendered-pixel limit."""


def _positive_int(name: str, default: int) -> int:
    """Env overrides must be positive integers. Blank or invalid values keep the default."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    text = raw.strip()
    if not text.isdigit():
        return default
    value = int(text)
    if value <= 0:
        return default
    return value


def default_dpi() -> int:
    return _positive_int(DPI_ENV, DEFAULT_DPI)


def max_pages_per_pdf() -> int:
    return _positive_int(MAX_PAGES_ENV, DEFAULT_MAX_PAGES)


def max_page_pixels() -> int:
    return _positive_int(MAX_PIXELS_ENV, DEFAULT_MAX_PAGE_PIXELS)


def _rendered_size(page, dpi: int):
    """Pixel size of a page at ``dpi`` without building the pixmap.

    ``irect`` matches ``Page.get_pixmap`` for the same matrix, including the
    case where the transformed width is just under an integer.
    """
    matrix = fitz.Matrix(dpi / 72.0, dpi / 72.0)
    box = (page.rect * matrix).irect
    return int(box.width), int(box.height)


class PDFHandler:
    """
    PDF handler for extracting pages and converting to images
    """
    
    def __init__(self):
        """Initialize PDF handler"""
        self.logger = logging.getLogger(__name__)
    
    def extract_pages(self, pdf_path: str, dpi: Optional[int] = None, page_range: Optional[tuple] = None) -> List[Dict[str, Any]]:
        """
        Extract pages from PDF as images.

        This materializes every page for callers that already expect a list.
        The local OCR batch path uses ``iter_pages`` so only one rendered
        page is resident at a time.

        Args:
            pdf_path: Path to PDF file
            dpi: Resolution for image conversion. ``None`` uses ``DEFAULT_DPI``.
            page_range: Optional tuple (start, end) for page range

        Returns:
            List of page data dictionaries
        """
        return list(self.iter_pages(pdf_path, dpi=dpi, page_range=page_range))

    def iter_pages(self, pdf_path: str, dpi: Optional[int] = None, page_range: Optional[tuple] = None) -> Iterator[Dict[str, Any]]:
        """
        Yield one rendered page at a time.

        Page-count and pixel limits are enforced before the first pixmap is
        built. The caller should drop ``page["image"]`` before requesting the
        next page so the previous render can be freed.
        """
        doc = None
        try:
            if dpi is None:
                dpi = default_dpi()

            if not os.path.exists(pdf_path):
                self.logger.error(f"PDF file not found: {pdf_path}")
                return

            doc = fitz.open(pdf_path)

            if doc.page_count == 0:
                self.logger.warning(f"PDF has no pages: {pdf_path}")
                return

            start_page = 0
            end_page = doc.page_count
            if page_range:
                start_page = max(0, page_range[0])
                end_page = min(doc.page_count, page_range[1])
            if end_page < start_page:
                end_page = start_page

            self._enforce_render_limits(doc, start_page, end_page, dpi)
            self.logger.info(f"Extracting pages {start_page} to {end_page-1} from {pdf_path}")

            for page_num in range(start_page, end_page):
                try:
                    page_data = self._extract_single_page(doc, page_num, dpi)
                except PDFLimitError:
                    raise
                except Exception as e:
                    self.logger.error(f"Error extracting page {page_num}: {e}")
                    continue
                if page_data:
                    yield page_data
        except PDFLimitError:
            raise
        except Exception as e:
            self.logger.error(f"Error processing PDF {pdf_path}: {e}")
        finally:
            if doc is not None:
                doc.close()

    def _enforce_render_limits(self, doc, start_page: int, end_page: int, dpi: int) -> None:
        """Reject a render span that would exceed the configured memory caps."""
        page_count = end_page - start_page
        page_limit = max_pages_per_pdf()
        if page_count > page_limit:
            message = f"PDF has {page_count} pages, which exceeds the maximum of {page_limit}"
            self.logger.error(message)
            raise PDFLimitError(message)

        pixel_limit = max_page_pixels()
        for page_num in range(start_page, end_page):
            width, height = _rendered_size(doc[page_num], dpi)
            pixels = width * height
            if pixels > pixel_limit:
                message = (
                    f"Page {page_num + 1} would render to {width}x{height} ({pixels} pixels) "
                    f"at {dpi} DPI, which exceeds the maximum of {pixel_limit} pixels"
                )
                self.logger.error(message)
                raise PDFLimitError(message)
    
    def _extract_single_page(self, doc: fitz.Document, page_num: int, dpi: int) -> Optional[Dict[str, Any]]:
        """
        Extract a single page from PDF document
        
        Args:
            doc: PyMuPDF document
            page_num: Page number (0-indexed)
            dpi: Resolution for conversion
            
        Returns:
            Page data dictionary or None if failed
        """
        try:
            # Get page
            page = doc[page_num]
            
            # Calculate zoom factor based on DPI
            zoom_factor = dpi / 72  # 72 DPI is default
            matrix = fitz.Matrix(zoom_factor, zoom_factor)
            
            # Render page as image. The pixmap and PNG bytes are dropped
            # before this method returns so only the numpy image is yielded.
            pix = page.get_pixmap(matrix=matrix)
            try:
                width = int(pix.width)
                height = int(pix.height)
                pixel_limit = max_page_pixels()
                if width * height > pixel_limit:
                    message = (
                        f"Page {page_num + 1} would render to {width}x{height} "
                        f"({width * height} pixels) at {dpi} DPI, which exceeds "
                        f"the maximum of {pixel_limit} pixels"
                    )
                    self.logger.error(message)
                    raise PDFLimitError(message)
                img_data = pix.tobytes("png")
            finally:
                pix = None

            img = Image.open(io.BytesIO(img_data))
            img_array = np.array(img)
            img.close()
            del img_data
            
            # Convert RGB to BGR for OpenCV compatibility
            if len(img_array.shape) == 3 and img_array.shape[2] == 3:
                img_array = img_array[:, :, ::-1]  # RGB to BGR
            
            # Get page information
            page_info = {
                "page_number": page_num + 1,  # 1-indexed for user display
                "image": img_array,
                "width": width,
                "height": height,
                "dpi": dpi,
                "rotation": page.rotation
            }

            return page_info

        except PDFLimitError:
            raise
        except Exception as e:
            self.logger.error(f"Error extracting page {page_num}: {e}")
            return None
    
    def get_pdf_info(self, pdf_path: str) -> Dict[str, Any]:
        """
        Get information about a PDF file
        
        Args:
            pdf_path: Path to PDF file
            
        Returns:
            PDF information dictionary
        """
        info = {
            "file_path": pdf_path,
            "exists": False,
            "page_count": 0,
            "file_size": 0,
            "metadata": {}
        }
        
        try:
            if not os.path.exists(pdf_path):
                return info
            
            info["exists"] = True
            info["file_size"] = os.path.getsize(pdf_path)
            
            # Open document to get detailed info
            doc = fitz.open(pdf_path)
            info["page_count"] = doc.page_count
            
            # Get metadata
            metadata = doc.metadata
            if metadata:
                info["metadata"] = {
                    "title": metadata.get("title", ""),
                    "author": metadata.get("author", ""),
                    "subject": metadata.get("subject", ""),
                    "creator": metadata.get("creator", ""),
                    "producer": metadata.get("producer", ""),
                    "creation_date": metadata.get("creationDate", ""),
                    "modification_date": metadata.get("modDate", "")
                }
            
            # Get page size information from first page
            if doc.page_count > 0:
                first_page = doc[0]
                rect = first_page.rect
                info["page_dimensions"] = {
                    "width": rect.width,
                    "height": rect.height
                }
            
            doc.close()
            
        except Exception as e:
            self.logger.error(f"Error getting PDF info for {pdf_path}: {e}")
            info["error"] = str(e)
        
        return info
    
    def validate_pdf(self, pdf_path: str, dpi: Optional[int] = None) -> Dict[str, Any]:
        """
        Validate a PDF file for processing.

        Page count and rendered pixel size are hard failures. ``dpi`` is the
        resolution the OCR path will use, so the pixel check matches the
        pixmap that would be allocated. A file larger than 100MB is still
        only a warning.

        Args:
            pdf_path: Path to PDF file
            dpi: Render resolution for the pixel cap. ``None`` uses ``DEFAULT_DPI``.

        Returns:
            Validation result dictionary
        """
        result = {
            "valid": False,
            "errors": [],
            "warnings": [],
            "info": {}
        }
        doc = None

        try:
            if dpi is None:
                dpi = default_dpi()

            # Check if file exists
            if not os.path.exists(pdf_path):
                result["errors"].append(f"File does not exist: {pdf_path}")
                return result

            # Check file size
            file_size = os.path.getsize(pdf_path)
            if file_size == 0:
                result["errors"].append("File is empty")
                return result

            if file_size > 100 * 1024 * 1024:  # 100MB limit
                result["warnings"].append(f"Large file size: {file_size / (1024*1024):.1f}MB")

            # Try to open PDF
            try:
                doc = fitz.open(pdf_path)
            except Exception as e:
                result["errors"].append(f"Cannot open PDF: {str(e)}")
                return result

            # Check page count
            page_count = doc.page_count
            if page_count == 0:
                result["errors"].append("PDF has no pages")
                return result

            try:
                self._enforce_render_limits(doc, 0, page_count, dpi)
                # The processability probe below renders page 1 at 72 DPI.
                # Reject that draw too when it would exceed the pixel cap,
                # including when the OCR DPI is lower than 72.
                self._enforce_render_limits(doc, 0, 1, 72)
            except PDFLimitError as exc:
                result["errors"].append(str(exc))
                return result

            # Try to render first page to check if it's processable.
            # Limits have already rejected a page that cannot fit in memory.
            try:
                first_page = doc[0]
                pix = first_page.get_pixmap()
                if pix.width == 0 or pix.height == 0:
                    result["errors"].append("Cannot render PDF pages")
                    return result
                pix = None
            except Exception as e:
                result["errors"].append(f"Cannot render PDF pages: {str(e)}")
                return result

            # If we get here, PDF is valid
            result["valid"] = True
            result["info"] = {
                "page_count": page_count,
                "file_size": file_size,
                "file_path": pdf_path
            }

        except Exception as e:
            result["errors"].append(f"Validation error: {str(e)}")
        finally:
            if doc is not None:
                doc.close()

        return result
    

    
   # def split_pdf(self, pdf_path: str, output_dir: str, pages_per_chunk: int = 10) -> List[str]:
    



    ##del  this extract_text_direct
    # def extract_text_direct(self, pdf_path: str) -> Dict[str, Any]:
   