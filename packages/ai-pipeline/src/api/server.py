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
from .service_auth import assert_trusted_bind

# Add parent directory to Python path for pipeline module imports
current_dir = Path(__file__).parent.parent
sys.path.insert(0, str(current_dir))


class LazyLocalPipeline:
    """Load the optional local OCR pipeline the first time a local route needs it.

    Importing ``pipeline_manager`` imports ``redis_client``, which pings
    localhost Redis and raises ``RuntimeError`` when that ping fails. The
    module then constructs the OCR singleton. Doing either while the Flask
    app is created takes AWS WSGI down with the local queue. A missing Redis
    server or OCR dependency is reported by the local routes as a 503 instead.
    """

    def __init__(self):
        self._manager = None
        self._error = None
        self._loaded = False
        self._lock = threading.Lock()

    def __bool__(self):
        return self._manager is not None

    @property
    def is_running(self):
        manager = self._manager
        if manager is None:
            return False
        return bool(getattr(manager, "is_running", False))

    def resolve_local_pipeline(self):
        """Return ``(manager, error)``. ``error`` is set when local OCR cannot start."""
        with self._lock:
            if self._loaded:
                return self._manager, self._error
            self._loaded = True
            try:
                manager = _import_pipeline_manager()
                if hasattr(manager, "start_server"):
                    manager.start_server()
            except Exception as exc:
                self._manager = None
                self._error = "Local pipeline not available: %s" % (exc,)
                print("Warning: %s" % (self._error,))
                return None, self._error
            self._manager = manager
            self._error = None
            return manager, None

    def stop_server(self):
        manager = self._manager
        if manager is None or not hasattr(manager, "stop_server"):
            return
        try:
            manager.stop_server()
        except Exception as exc:
            print("Warning: Error stopping local pipeline: %s" % (exc,))


def _import_pipeline_manager():
    """Import the local singleton.

    A missing ``pipeline_manager`` module tries the package-relative import.
    An ``ImportError`` raised while that module loads (OpenCV, EasyOCR, and
    the rest of the local stack) is kept so the 503 names the missing
    dependency. Redis connection failures are ``RuntimeError`` and propagate
    unchanged.
    """
    try:
        from pipeline_manager import pipeline_manager as manager
    except ImportError as first_error:
        if getattr(first_error, "name", None) != "pipeline_manager":
            raise
        try:
            from .pipeline_manager import pipeline_manager as manager
        except ImportError:
            raise first_error from None
    return manager


# Resolved on the first local route. Importing it here would ping Redis.
pipeline_manager = LazyLocalPipeline()

# --- Module-level Flask app (for WSGI) ---
app = Flask(__name__)
CORS(app)

aws_manager = AWSPipelineManager()
# register_routes caps every request body with MAX_CONTENT_LENGTH.
register_routes(app, aws_manager, pipeline_manager)


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
        assert_trusted_bind(self.host)
        self.is_running = True
        self.server_thread = threading.Thread(target=self._run_server, daemon=True)
        self.server_thread.start()
        print(f"AI Pipeline Server starting on http://{self.host}:{self.port}")

    def _run_server(self):
        host = assert_trusted_bind(self.host)
        try:
            app.run(host=host, port=self.port, debug=False, use_reloader=False, threaded=True)
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
