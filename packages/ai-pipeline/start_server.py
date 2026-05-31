#!/usr/bin/env python3
"""
Simple server starter script for AI Pipeline
This script handles all import path issues and starts the server correctly
"""

import sys
import os
from pathlib import Path

# Add src directory to Python path
current_dir = Path(__file__).parent
src_dir = current_dir / 'src'
sys.path.insert(0, str(src_dir))

def main():
    """Start the AI Pipeline server with proper imports"""
    
    print("🚀 Starting AI Pipeline Server...")
    
    try:
        # Import after setting up the path
        from server import start_server
        
        # Get host and port from command line or use defaults
        host = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1"
        port = int(sys.argv[2]) if len(sys.argv) > 2 else 5000
        
        print(f"📡 Host: {host}")
        print(f"🔌 Port: {port}")
        
        # Start the server
        server = start_server(host, port)
        
        print("✅ Server started successfully!")
        print(f"🌐 Access the server at: http://{host}:{port}")
        print("📚 Available endpoints:")
        print(f"  • GET  http://{host}:{port}/health")
        print(f"  • POST http://{host}:{port}/submit")
        print(f"  • GET  http://{host}:{port}/status/<batch_id>")
        print(f"  • GET  http://{host}:{port}/result/<batch_id>")
        print(f"  • GET  http://{host}:{port}/stats")
        print("\n🔄 Server is running... Press Ctrl+C to stop")
        
        # Keep the server running
        try:
            while server.is_running:
                import time
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n⏹️  Shutting down server...")
            from server import stop_server
            stop_server()
            print("👋 Server stopped successfully!")
            
    except ImportError as e:
        print(f"❌ Import Error: {e}")
        print("\n🛠️  Possible solutions:")
        print("1. Install missing dependencies:")
        print("   pip install flask flask-cors redis numpy opencv-python easyocr PyMuPDF")
        print("2. Make sure you're in the ai_pipeline directory")
        print("3. Check that all required files exist in src/")
        return 1
        
    except Exception as e:
        print(f"❌ Error starting server: {e}")
        return 1
    
    return 0

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)