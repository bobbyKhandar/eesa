"""
Test import script to verify all modules can be imported correctly
"""

import sys
from pathlib import Path

# Add src directory to Python path
current_dir = Path(__file__).parent
src_dir = current_dir / 'src'
sys.path.insert(0, str(src_dir))

def test_imports():
    """Test that all modules can be imported"""
    
    print("🧪 Testing imports...")
    
    try:
        print("📦 Testing redis_client...")
        import redis_client
        print("✅ redis_client imported successfully")
        
        print("📦 Testing ocr_engine...")
        from ocr_engine import OCREngine
        print("✅ OCREngine imported successfully")
        
        print("📦 Testing image_processor...")
        from image_processor import ImageProcessor
        print("✅ ImageProcessor imported successfully")
        
        print("📦 Testing pdf_handler...")
        from pdf_handler import PDFHandler
        print("✅ PDFHandler imported successfully")
        
        print("📦 Testing pipeline_manager...")
        from pipeline_manager import PipelineManager, pipeline_manager
        print("✅ PipelineManager imported successfully")
        
        print("📦 Testing server...")
        from server import AIServer, start_server, stop_server
        print("✅ Server components imported successfully")
        
        print("\n🎉 All imports successful!")
        print("✅ Your environment is properly configured!")
        
        return True
        
    except ImportError as e:
        print(f"❌ Import failed: {e}")
        print("\n🛠️  Missing dependencies. Please install:")
        print("pip install -r requirements.txt")
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return False

if __name__ == "__main__":
    success = test_imports()
    if not success:
        sys.exit(1)
    
    print("\n🚀 You can now start the server with:")
    print("python start_server.py")