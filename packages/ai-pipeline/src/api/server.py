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

    The package-relative import is tried first so the manager module is the
    same copy the route module loaded: ``api.routes`` and
    ``src.api.routes`` import their siblings differently, and a manager from
    the other copy would raise a different ``ProcessingOptionsError`` class
    than the local routes catch. A relative import that is not available
    (this module loaded as a top-level ``api`` package) falls back to the
    plain module name.

    An ``ImportError`` raised while the manager module loads (OpenCV,
    EasyOCR, and the rest of the local stack) is kept so the 503 names the
    missing dependency. Redis connection failures are ``RuntimeError`` and
    propagate unchanged.
    """
    try:
        from ..pipeline_manager import pipeline_manager as manager
        return manager
    except ImportError:
        pass

    from pipeline_manager import pipeline_manager as manager
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
    try:
        current = globals().get("_server")
        if current is not None and getattr(current, "is_running", False):
            # stop() shuts down the HTTP listener, joins its thread, and
            # stops background batch processing.
            current.stop()
        elif pipeline_manager:
            try:
                if hasattr(pipeline_manager, 'stop_server'):
                    pipeline_manager.stop_server()
            except Exception as e:
                print(f"Warning: Error stopping local pipeline: {e}")
    finally:
        aws_manager.cleanup()
    print("Server cleanup complete")


atexit.register(cleanup_resources)


# --- AIServer class (for start_server.py / non-blocking use) ---
class AIServer:
    """Non-blocking wrapper around the module-level Flask ``app``.

    The development interface runs a controllable Werkzeug WSGI server in a
    daemon thread so :meth:`stop` can actually release the listening socket.
    Production keeps using process-managed WSGI (``wsgi:app`` under Gunicorn);
    this class is never on that path.
    """

    def __init__(self, host="127.0.0.1", port=5000):
        self.host = host
        self.port = port
        self.server_thread = None
        self.is_running = False
        self._httpd = None
        self._lock = threading.Lock()

    def start(self):
        with self._lock:
            if self.is_running:
                return
            if self.server_thread is not None and self.server_thread.is_alive():
                self.is_running = True
                return
            host = assert_trusted_bind(self.host)
            # Local import so importing this module (wsgi/gunicorn path and
            # the stubbed package-export test) never requires the server.
            from werkzeug.serving import make_server
            try:
                httpd = make_server(host, self.port, app, threaded=True)
            except Exception:
                self._httpd = None
                self.server_thread = None
                self.is_running = False
                raise
            self._httpd = httpd
            self.server_thread = threading.Thread(target=self._serve, daemon=True)
            self.server_thread.start()
            # Only mark running after the socket is bound and the listener
            # thread has started.
            self.is_running = True
        print(f"AI Pipeline Server starting on http://{host}:{self.port}")

    def _serve(self):
        httpd = self._httpd
        if httpd is None:
            return
        try:
            httpd.serve_forever()
        except Exception as e:
            print(f"Server error: {e}")
            with self._lock:
                self.is_running = False
                try:
                    httpd.server_close()
                except Exception:
                    pass

    def _run_server(self):
        """Blocking legacy entry point (kept for backwards compatibility).

        New code should use :meth:`start`/:meth:`stop`. This runs the same
        controllable server in the calling thread so the trusted-bind check
        still applies to direct callers.
        """
        with self._lock:
            if self.is_running:
                return
            host = assert_trusted_bind(self.host)
            from werkzeug.serving import make_server
            httpd = make_server(host, self.port, app, threaded=True)
            self._httpd = httpd
            self.is_running = True
        try:
            httpd.serve_forever()
        except Exception as e:
            print(f"Server error: {e}")
        finally:
            try:
                httpd.server_close()
            except Exception:
                pass
            with self._lock:
                self._httpd = None
                self.is_running = False

    def stop_background_processing(self):
        """Stop only the local batch pipeline; leaves the HTTP listener alone."""
        if pipeline_manager:
            try:
                pipeline_manager.stop_server()
            except Exception as e:
                print(f"Warning: Error stopping local pipeline: {e}")

    def stop(self, timeout=5):
        with self._lock:
            httpd = self._httpd
            thread = self.server_thread
        if httpd is not None:
            try:
                httpd.shutdown()
            except Exception as e:
                print(f"Warning: Error shutting down HTTP server: {e}")
        if thread is not None and thread.is_alive():
            thread.join(timeout=timeout)
        if httpd is not None:
            try:
                httpd.server_close()
            except Exception as e:
                print(f"Warning: Error closing HTTP server: {e}")
        self.stop_background_processing()
        with self._lock:
            self._httpd = None
            self.server_thread = None
            # Only mark stopped after the listener is shut down, joined,
            # and its socket is closed.
            self.is_running = False
        print("AI Pipeline Server stopped")


def create_app(host="127.0.0.1", port=5000):
    return AIServer(host, port)


_server = None


def start_server(host="127.0.0.1", port=5000):
    global _server
    if _server is None or _server.host != host or _server.port != port:
        if _server is not None and getattr(_server, "is_running", False):
            # Do not orphan the previous listener when the bind changes.
            _server.stop()
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
