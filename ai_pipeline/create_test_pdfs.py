"""
Create simple test PDF files for the AI Pipeline
"""

from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
import os
from pathlib import Path

def create_test_pdf(filename, title, content_lines):
    """Create a simple PDF with text content"""
    
    # Create the file path
    test_files_dir = Path(__file__).parent / "test_files"
    test_files_dir.mkdir(exist_ok=True)
    filepath = test_files_dir / filename
    
    # Create PDF
    c = canvas.Canvas(str(filepath), pagesize=letter)
    width, height = letter
    
    # Add title
    c.setFont("Helvetica-Bold", 16)
    c.drawString(50, height - 50, title)
    
    # Add content lines
    c.setFont("Helvetica", 12)
    y_position = height - 100
    
    for line in content_lines:
        c.drawString(50, y_position, line)
        y_position -= 20
        
        # Start new page if needed
        if y_position < 50:
            c.showPage()
            c.setFont("Helvetica", 12)
            y_position = height - 50
    
    c.save()
    print(f"Created: {filepath}")
    return filepath

def main():
    """Create test PDF files"""
    
    print("📄 Creating test PDF files...")
    
    # Document 1: Technical content
    doc1_content = [
        "This is a test document for the AI Pipeline OCR system.",
        "",
        "Technical Specifications:",
        "- OCR Engine: EasyOCR with GPU acceleration",
        "- Image Processing: OpenCV with CLAHE enhancement", 
        "- PDF Processing: PyMuPDF with 400 DPI rendering",
        "- Queue Management: Redis-based job distribution",
        "",
        "Key Features:",
        "1. Batch processing of multiple PDF files",
        "2. Real-time status tracking and progress monitoring",
        "3. Configurable image preprocessing pipeline",
        "4. Node.js integration via HTTP API and Redis",
        "5. Comprehensive error handling and logging",
        "",
        "This document contains clear text that should be",
        "easily recognized by the OCR engine with high",
        "confidence scores above 0.9 for most text regions.",
        "",
        "Performance benchmarks show processing speeds of",
        "2.2 pages per second on NVIDIA RTX hardware."
    ]
    
    # Document 2: Business content
    doc2_content = [
        "AI Pipeline Business Case Study",
        "",
        "Executive Summary:",
        "The AI Pipeline system revolutionizes document processing",
        "by automating text extraction from PDF files using",
        "state-of-the-art OCR technology and machine learning.",
        "",
        "Market Opportunities:",
        "- Legal document processing: $2.3B market",
        "- Healthcare records digitization: $1.8B market", 
        "- Financial document automation: $3.1B market",
        "- Academic research indexing: $0.7B market",
        "",
        "Competitive Advantages:",
        "• 90%+ accuracy on complex documents",
        "• 5x faster than manual data entry",
        "• 60% cost reduction vs. outsourced services",
        "• Real-time processing with instant results",
        "",
        "Implementation Timeline:",
        "Phase 1: Core system deployment (4 weeks)",
        "Phase 2: Integration and testing (2 weeks)", 
        "Phase 3: Production rollout (1 week)",
        "",
        "Expected ROI: 340% within first year"
    ]
    
    # Document 3: Sample invoice
    doc3_content = [
        "INVOICE #INV-2025-001",
        "",
        "Date: October 4, 2025",
        "Due Date: November 4, 2025",
        "",
        "Bill To:",
        "ABC Corporation",
        "123 Business Street",
        "City, State 12345",
        "",
        "Services Provided:",
        "",
        "Item                          Qty    Rate      Total",
        "AI Pipeline Development        40    $150.00   $6,000.00",
        "System Integration             20    $125.00   $2,500.00", 
        "Testing & Documentation        15    $100.00   $1,500.00",
        "Deployment Support             10    $175.00   $1,750.00",
        "",
        "                              Subtotal:  $11,750.00",
        "                              Tax (8%):   $940.00", 
        "                              Total:     $12,690.00",
        "",
        "Payment Terms: Net 30 days",
        "Thank you for your business!"
    ]
    
    # Create the test PDFs
    create_test_pdf("document1.pdf", "AI Pipeline Technical Documentation", doc1_content)
    create_test_pdf("document2.pdf", "AI Pipeline Business Case", doc2_content) 
    create_test_pdf("document3.pdf", "Sample Invoice", doc3_content)
    
    print("\n✅ Test PDF files created successfully!")
    print("📁 Location: tests/test_files/")
    print("📄 Files: document1.pdf, document2.pdf, document3.pdf")

if __name__ == "__main__":
    main()