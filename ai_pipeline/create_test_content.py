"""
Create simple test text files that can be used as sample content
These can be converted to PDFs or used to test the text processing logic
"""

from pathlib import Path
import os

def create_test_files():
    """Create test content files"""
    
    # Create test files directory
    test_files_dir = Path(__file__).parent / "tests" / "test_files"
    test_files_dir.mkdir(parents=True, exist_ok=True)
    
    # Document 1: Technical content
    doc1_content = """AI Pipeline Technical Documentation

This is a test document for the AI Pipeline OCR system.

Technical Specifications:
- OCR Engine: EasyOCR with GPU acceleration
- Image Processing: OpenCV with CLAHE enhancement
- PDF Processing: PyMuPDF with 400 DPI rendering
- Queue Management: Redis-based job distribution

Key Features:
1. Batch processing of multiple PDF files
2. Real-time status tracking and progress monitoring
3. Configurable image preprocessing pipeline
4. Node.js integration via HTTP API and Redis
5. Comprehensive error handling and logging

This document contains clear text that should be
easily recognized by the OCR engine with high
confidence scores above 0.9 for most text regions.

Performance benchmarks show processing speeds of
2.2 pages per second on NVIDIA RTX hardware.
"""

    # Document 2: Business content  
    doc2_content = """AI Pipeline Business Case Study

Executive Summary:
The AI Pipeline system revolutionizes document processing
by automating text extraction from PDF files using
state-of-the-art OCR technology and machine learning.

Market Opportunities:
- Legal document processing: $2.3B market
- Healthcare records digitization: $1.8B market
- Financial document automation: $3.1B market
- Academic research indexing: $0.7B market

Competitive Advantages:
• 90%+ accuracy on complex documents
• 5x faster than manual data entry
• 60% cost reduction vs. outsourced services
• Real-time processing with instant results

Implementation Timeline:
Phase 1: Core system deployment (4 weeks)
Phase 2: Integration and testing (2 weeks)
Phase 3: Production rollout (1 week)

Expected ROI: 340% within first year
"""

    # Create text files
    with open(test_files_dir / "document1.txt", "w", encoding="utf-8") as f:
        f.write(doc1_content)
    
    with open(test_files_dir / "document2.txt", "w", encoding="utf-8") as f:
        f.write(doc2_content)
    
    print(f"✅ Created test content files in: {test_files_dir}")
    print("📄 Files: document1.txt, document2.txt")
    print("\n💡 To create actual PDF files:")
    print("1. Install reportlab: pip install reportlab")
    print("2. Use online tools to convert TXT to PDF")
    print("3. Or use any existing PDF files for testing")
    
    return test_files_dir

if __name__ == "__main__":
    create_test_files()