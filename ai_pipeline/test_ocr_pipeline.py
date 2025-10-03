#!/usr/bin/env python3
"""
Test script for OCR Pipeline
"""

import os
import sys
from pathlib import Path

# Add the current directory to path to import modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    from imagePreprocess import OcrPipeline
    import constants
    print("✅ Successfully imported OcrPipeline")
except ImportError as e:
    print(f"❌ Import error: {e}")
    sys.exit(1)

def test_ocr_pipeline():
    """Test the OCR pipeline with a sample directory"""
    
    # Create test directory structure
    test_dir = Path("test_pdfs")
    test_dir.mkdir(exist_ok=True)
    
    print(f"📁 Test directory: {test_dir.absolute()}")
    
    # Check if test directory has any PDFs
    pdf_files = list(test_dir.glob("*.pdf"))
    if not pdf_files:
        print("⚠️  No PDF files found in test directory")
        print("   Please add some PDF files to test_pdfs/ directory")
        return
    
    print(f"📄 Found {len(pdf_files)} PDF files:")
    for pdf in pdf_files:
        print(f"   - {pdf.name}")
    
    try:
        # Initialize OCR Pipeline
        print("\n🚀 Initializing OCR Pipeline...")
        pipeline = OcrPipeline(
            resource_level=constants.resource_level.MEDIUM,
            inputFilePath=str(test_dir)
        )
        
        print("✅ OCR Pipeline initialized successfully")
        
        # Start OCR processing
        print("\n📝 Starting OCR processing...")
        pipeline.startOcr()
        
        print("✅ OCR processing completed")
        
    except Exception as e:
        print(f"❌ Error during OCR processing: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    print("🧪 OCR Pipeline Test")
    print("=" * 50)
    test_ocr_pipeline()