"""
AI Pipeline Server - Canonical Flask server for Local and AWS pipelines.

Module-level Flask app with CORS serves as the WSGI entry point.
AIServer class provides thread lifecycle management for non-blocking use.
"""

import sys
import os
import atexit
import threading
import time
from pathlib import Path
from flask import Flask
from flask_cors import CORS

from .aws_manager import AWSPipelineManager
from .routes import register_routes

# Add parent directory to Python path for pipeline module imports
current_dir = Path(__file__).parent.parent
sys.path.insert(0, str(current_dir))

# --- Local Pipeline ---
try:
    from pipeline_manager import pipeline_manager
except ImportError:
    try:
        from .pipeline_manager import pipeline_manager
    except ImportError:
        print("Warning: Local pipeline_manager not found. Local routes will not work.")
        pipeline_manager = None

# --- Module-level Flask app (for WSGI) ---
app = Flask(__name__)
CORS(app)

aws_manager = AWSPipelineManager()
register_routes(app, aws_manager, pipeline_manager)

# Start local pipeline if available
if pipeline_manager:
    try:
        if hasattr(pipeline_manager, 'start_server'):
            pipeline_manager.start_server()
    except Exception as e:
        print(f"Warning: Could not start local pipeline: {e}")


def cleanup_resources():
    """Cleanup resources on shutdown."""
    print("Cleaning up server resources...")
    aws_manager.cleanup()
    if pipeline_manager:
        try:
            if hasattr(pipeline_manager, 'stop_server'):
                pipeline_manager.stop_server()
        except Exception as e:
            print(f"Warning: Error stopping local pipeline: {e}")
    print("Server cleanup complete")


atexit.register(cleanup_resources)


# --- AIServer class (for start_server.py / non-blocking use) ---
class AIServer:
    def __init__(self, host="127.0.0.1", port=5000):
        self.host = host
        self.port = port
        self.server_thread = None
        self.is_running = False

    def start(self):
        if self.is_running:
            return
        self.is_running = True
        self.server_thread = threading.Thread(target=self._run_server, daemon=True)
        self.server_thread.start()
        print(f"AI Pipeline Server starting on http://{self.host}:{self.port}")

    def _run_server(self):
        try:
            app.run(host=self.host, port=self.port, debug=False, use_reloader=False, threaded=True)
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
