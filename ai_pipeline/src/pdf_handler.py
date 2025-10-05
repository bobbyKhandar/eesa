"""
PDF Handler - Manages PDF file processing and page extraction
Clean implementation focused on PDF operations
"""

import fitz  # PyMuPDF
import numpy as np
from typing import List, Dict, Any, Optional
import os
import logging
from PIL import Image
import io


class PDFHandler:
    """
    PDF handler for extracting pages and converting to images
    """
    
    def __init__(self):
        """Initialize PDF handler"""
        self.logger = logging.getLogger(__name__)
    
    def extract_pages(self, pdf_path: str, dpi: int = 400, page_range: Optional[tuple] = None) -> List[Dict[str, Any]]:
        """
        Extract pages from PDF as images
        
        Args:
            pdf_path: Path to PDF file
            dpi: Resolution for image conversion
            page_range: Optional tuple (start, end) for page range
            
        Returns:
            List of page data dictionaries
        """
        pages_data = []
        try:
            if not os.path.exists(pdf_path):
                self.logger.error(f"PDF file not found: {pdf_path}")
                return pages_data
            
            # Open PDF document
            doc = fitz.open(pdf_path)
            
            if doc.page_count == 0:
                self.logger.warning(f"PDF has no pages: {pdf_path}")
                doc.close()
                return pages_data
            
            # Determine page range
            start_page = 0
            end_page = doc.page_count
            
            if page_range:
                start_page = max(0, page_range[0])
                end_page = min(doc.page_count, page_range[1])
            
            self.logger.info(f"Extracting pages {start_page} to {end_page-1} from {pdf_path}")
            
            # Extract each page
            for page_num in range(start_page, end_page):
                try:
                    page_data = self._extract_single_page(doc, page_num, dpi)
                    if page_data:
                        pages_data.append(page_data)
                        
                except Exception as e:
                    self.logger.error(f"Error extracting page {page_num}: {e}")
                    # Continue with other pages
                    continue
            
            doc.close()
            
        except Exception as e:
            self.logger.error(f"Error processing PDF {pdf_path}: {e}")
        
        return pages_data
    
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
            
            # Render page as image
            pix = page.get_pixmap(matrix=matrix)
            
            # Convert to numpy array
            img_data = pix.tobytes("png")
            img = Image.open(io.BytesIO(img_data))
            img_array = np.array(img)
            
            # Convert RGB to BGR for OpenCV compatibility
            if len(img_array.shape) == 3 and img_array.shape[2] == 3:
                img_array = img_array[:, :, ::-1]  # RGB to BGR
            
            # Get page information
            page_info = {
                "page_number": page_num + 1,  # 1-indexed for user display
                "image": img_array,
                "width": pix.width,
                "height": pix.height,
                "dpi": dpi,
                "rotation": page.rotation
            }
            
            # Clean up
            pix = None
            
            return page_info
            
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
    
    def validate_pdf(self, pdf_path: str) -> Dict[str, Any]:
        """
        Validate a PDF file for processing
        
        Args:
            pdf_path: Path to PDF file
            
        Returns:
            Validation result dictionary
        """
        result = {
            "valid": False,
            "errors": [],
            "warnings": [],
            "info": {}
        }
        
        try:
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
                doc.close()
                return result
            
            if page_count > 1000:
                result["warnings"].append(f"Large page count: {page_count}")
            
            # Try to render first page to check if it's processable
            try:
                first_page = doc[0]
                pix = first_page.get_pixmap()
                if pix.width == 0 or pix.height == 0:
                    result["errors"].append("Cannot render PDF pages")
                    doc.close()
                    return result
                pix = None
            except Exception as e:
                result["errors"].append(f"Cannot render PDF pages: {str(e)}")
                doc.close()
                return result
            
            # If we get here, PDF is valid
            result["valid"] = True
            result["info"] = {
                "page_count": page_count,
                "file_size": file_size,
                "file_path": pdf_path
            }
            
            doc.close()
            
        except Exception as e:
            result["errors"].append(f"Validation error: {str(e)}")
        
        return result
    
    def split_pdf(self, pdf_path: str, output_dir: str, pages_per_chunk: int = 10) -> List[str]:
        """
        Split a large PDF into smaller chunks
        
        Args:
            pdf_path: Path to source PDF
            output_dir: Directory to save chunks
            pages_per_chunk: Number of pages per chunk
            
        Returns:
            List of created chunk file paths
        """
        chunk_paths = []
        
        try:
            if not os.path.exists(pdf_path):
                self.logger.error(f"Source PDF not found: {pdf_path}")
                return chunk_paths
            
            # Create output directory
            os.makedirs(output_dir, exist_ok=True)
            
            # Open source document
            doc = fitz.open(pdf_path)
            total_pages = doc.page_count
            
            if total_pages <= pages_per_chunk:
                # No need to split
                doc.close()
                return [pdf_path]
            
            # Create chunks
            base_name = os.path.splitext(os.path.basename(pdf_path))[0]
            
            for start_page in range(0, total_pages, pages_per_chunk):
                end_page = min(start_page + pages_per_chunk, total_pages)
                
                # Create new document for chunk
                chunk_doc = fitz.open()
                chunk_doc.insert_pdf(doc, from_page=start_page, to_page=end_page - 1)
                
                # Save chunk
                chunk_filename = f"{base_name}_chunk_{start_page + 1}-{end_page}.pdf"
                chunk_path = os.path.join(output_dir, chunk_filename)
                chunk_doc.save(chunk_path)
                chunk_doc.close()
                
                chunk_paths.append(chunk_path)
                self.logger.info(f"Created chunk: {chunk_filename}")
            
            doc.close()
            
        except Exception as e:
            self.logger.error(f"Error splitting PDF: {e}")
        
        return chunk_paths
    
    def extract_text_direct(self, pdf_path: str) -> Dict[str, Any]:
        """
        Extract text directly from PDF without OCR (for text-based PDFs)
        
        Args:
            pdf_path: Path to PDF file
            
        Returns:
            Direct text extraction result
        """
        result = {
            "success": False,
            "text": "",
            "page_count": 0,
            "has_text": False
        }
        
        try:
            if not os.path.exists(pdf_path):
                result["error"] = f"File not found: {pdf_path}"
                return result
            
            doc = fitz.open(pdf_path)
            result["page_count"] = doc.page_count
            
            all_text = []
            text_found = False
            
            for page_num in range(doc.page_count):
                page = doc[page_num]
                page_text = page.get_text()
                
                if page_text.strip():
                    text_found = True
                    all_text.append(f"--- Page {page_num + 1} ---\n{page_text}")
            
            doc.close()
            
            result["success"] = True
            result["has_text"] = text_found
            result["text"] = "\n\n".join(all_text)
            
        except Exception as e:
            result["error"] = str(e)
        
        return result