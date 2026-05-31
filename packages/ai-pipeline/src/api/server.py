"""
AI Pipeline Server - Unified HTTP server for Local and AWS pipelines
Provides REST API for batch processing requests
"""

import sys
import threading
import time
from pathlib import Path
from flask import Flask

from .aws_manager import AWSPipelineManager
from .routes import register_routes

# Add current directory to Python path for imports
current_dir = Path(__file__).parent.parent
sys.path.insert(0, str(current_dir))

# --- Import Local Pipeline ---
try:
    from pipeline_manager import pipeline_manager
except ImportError:
    try:
        from .pipeline_manager import pipeline_manager
    except ImportError:
        print("Warning: Local pipeline_manager not found. Local routes may fail.")
        pipeline_manager = None


class AIServer:
    def __init__(self, host="127.0.0.1", port=5000):
        self.host = host
        self.port = port
        self.app = Flask(__name__)
        self.server_thread = None
        self.is_running = False
        self.aws_manager = AWSPipelineManager()
        register_routes(self.app, self.aws_manager, pipeline_manager)
        if pipeline_manager:
            pipeline_manager.start_server()

    def start(self):
        if self.is_running:
            return
        self.is_running = True
        self.server_thread = threading.Thread(target=self._run_server, daemon=True)
        self.server_thread.start()
        print(f"AI Pipeline Server starting on http://{self.host}:{self.port}")

    def _run_server(self):
        try:
            self.app.run(host=self.host, port=self.port, debug=False, use_reloader=False, threaded=True)
        except Exception as e:
            print(f"Server error: {e}")
        finally:
            self.is_running = False

    def stop(self):
        self.is_running = False
        if pipeline_manager:
            pipeline_manager.stop_server()
        print("AI Pipeline Server stopped")


def create_app(host="127.0.0.1", port=5000):
    return AIServer(host, port)


# Global server instance
_server = None


def start_server(host="127.0.0.1", port=5000):
    global _server
    if _server is None or _server.host != host or _server.port != port:
        _server = AIServer(host, port)
    _server.start()
    return _server


def stop_server():
    global _server
    if _server:
        _server.stop()


if __name__ == "__main__":
    host = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1"
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 5000
    server = start_server(host, port)
    try:
        while server.is_running:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nShutting down server...")
        stop_server()
