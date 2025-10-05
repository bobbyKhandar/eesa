"""
AI Pipeline Server - Simple HTTP server for Node.js integration
Provides REST API for batch processing requests
"""

import sys
import os
from pathlib import Path

# Add current directory to Python path for imports
current_dir = Path(__file__).parent
sys.path.insert(0, str(current_dir))

from flask import Flask, request, jsonify
import threading
import time
import json
from typing import Dict, Any, Optional

try:
    from .pipeline_manager import pipeline_manager
except ImportError:
    from pipeline_manager import pipeline_manager


class AIServer:
    """
    Simple HTTP server for AI Pipeline integration with Node.js
    """
    
    def __init__(self, host: str = "127.0.0.1", port: int = 5000):
        """
        Initialize the AI Pipeline server
        
        Args:
            host: Server host address
            port: Server port number
        """
        self.host = host
        self.port = port
        self.app = Flask(__name__)
        self.server_thread = None
        self.is_running = False
        
        # Configure routes
        self._setup_routes()
        
        # Initialize pipeline manager
        pipeline_manager.start_server()
    
    def _setup_routes(self):
        """Set up Flask routes"""
        
        @self.app.route('/health', methods=['GET'])
        def health_check():
            """Health check endpoint"""
            return jsonify({
                "status": "healthy",
                "timestamp": time.time(),
                "pipeline_running": pipeline_manager.is_running
            })
        
        @self.app.route('/submit', methods=['POST'])
        def submit_batch():
            """Submit a batch of PDF files for processing"""
            try:
                data = request.get_json()
                
                if not data:
                    return jsonify({"error": "No JSON data provided"}), 400
                
                file_locations = data.get('file_locations', [])
                if not file_locations:
                    return jsonify({"error": "No file_locations provided"}), 400
                
                options = data.get('options', {})
                
                # Submit batch to pipeline manager
                batch_id = pipeline_manager.submit_batch(file_locations, options)
                
                return jsonify({
                    "success": True,
                    "batch_id": batch_id,
                    "message": f"Batch submitted with {len(file_locations)} files"
                })
                
            except Exception as e:
                return jsonify({"error": str(e)}), 500
        
        @self.app.route('/status/<batch_id>', methods=['GET'])
        def get_batch_status(batch_id: str):
            """Get status of a specific batch"""
            try:
                status = pipeline_manager.get_batch_status(batch_id)
                
                if status is None:
                    return jsonify({"error": "Batch not found"}), 404
                
                return jsonify({
                    "success": True,
                    "status": status
                })
                
            except Exception as e:
                return jsonify({"error": str(e)}), 500
        
        @self.app.route('/result/<batch_id>', methods=['GET'])
        def get_batch_result(batch_id: str):
            """Get final result of a completed batch"""
            try:
                result = pipeline_manager.get_batch_result(batch_id)
                
                if result is None:
                    return jsonify({"error": "Batch not found or not completed"}), 404
                
                return jsonify({
                    "success": True,
                    "result": result.to_dict()
                })
                
            except Exception as e:
                return jsonify({"error": str(e)}), 500
        
        @self.app.route('/stats', methods=['GET'])
        def get_pipeline_stats():
            """Get pipeline statistics"""
            try:
                with pipeline_manager.processing_lock:
                    active_batches = len(pipeline_manager.active_batches)
                
                return jsonify({
                    "success": True,
                    "stats": {
                        "pipeline_running": pipeline_manager.is_running,
                        "active_batches": active_batches,
                        "server_uptime": time.time()
                    }
                })
                
            except Exception as e:
                return jsonify({"error": str(e)}), 500
    
    def start(self):
        """Start the server"""
        if self.is_running:
            print("⚠️ Server is already running")
            return
        
        self.is_running = True
        
        # Start server in a separate thread
        self.server_thread = threading.Thread(
            target=self._run_server,
            daemon=True
        )
        self.server_thread.start()
        
        print(f"🚀 AI Pipeline Server starting on http://{self.host}:{self.port}")
        
        # Wait a moment for server to start
        time.sleep(1)
        print("✅ Server is ready to accept requests")
    
    def _run_server(self):
        """Run the Flask server"""
        try:
            self.app.run(
                host=self.host,
                port=self.port,
                debug=False,
                use_reloader=False,
                threaded=True
            )
        except Exception as e:
            print(f"❌ Server error: {e}")
        finally:
            self.is_running = False
    
    def stop(self):
        """Stop the server"""
        if not self.is_running:
            print("⚠️ Server is not running")
            return
        
        self.is_running = False
        pipeline_manager.stop_server()
        
        print("🛑 AI Pipeline Server stopped")
    
    def get_server_info(self) -> Dict[str, Any]:
        """Get server information"""
        return {
            "host": self.host,
            "port": self.port,
            "running": self.is_running,
            "pipeline_running": pipeline_manager.is_running
        }


# Global server instance
server = AIServer()


def start_server(host: str = "127.0.0.1", port: int = 5000):
    """
    Start the AI Pipeline server
    
    Args:
        host: Server host address
        port: Server port number
    """
    global server
    
    if server.is_running:
        print("⚠️ Server is already running")
        return server
    
    # Create new server instance if needed
    if server.host != host or server.port != port:
        server = AIServer(host, port)
    
    server.start()
    return server


def stop_server():
    """Stop the AI Pipeline server"""
    global server
    server.stop()


if __name__ == "__main__":
    # Start server when run directly
    import sys
    
    host = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1"
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 5000
    
    server = start_server(host, port)
    
    try:
        # Keep the main thread alive
        while server.is_running:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n🛑 Shutting down server...")
        stop_server()