"""Regression test for issue #159: stop_server must stop the HTTP listener.

The documented ``start_server``/``stop_server`` interface used to flip only
``is_running`` while the daemon thread stayed inside ``app.run``. Stopping
reported success while the socket and routes stayed active, and starting
again launched a second listener on the same port.
"""

import os
import socket
import sys
import time
import unittest
import urllib.request
import urllib.error

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "src"))
os.environ.setdefault("AWS_EC2_METADATA_DISABLED", "true")
os.environ.setdefault("AWS_DEFAULT_REGION", "ap-south-1")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")

import api.server as api_server
from api.server import AIServer, start_server, stop_server


def _free_port():
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    _, port = sock.getsockname()
    sock.close()
    return port


def _wait_until_serving(port, timeout=10.0):
    deadline = time.time() + timeout
    last_error = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(
                "http://127.0.0.1:%d/health" % port, timeout=2
            ) as response:
                if response.status == 200:
                    return True
        except Exception as exc:  # noqa: BLE001 - poll until ready
            last_error = exc
            time.sleep(0.1)
    raise AssertionError(
        "server on port %d never served /health: %r" % (port, last_error)
    )


def _wait_until_closed(port, timeout=10.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        try:
            sock.connect(("127.0.0.1", port))
        except OSError:
            return True
        else:
            sock.close()
            time.sleep(0.1)
        finally:
            try:
                sock.close()
            except Exception:  # noqa: BLE001 - best effort
                pass
    raise AssertionError("server on port %d still accepts connections" % port)


class TestAIServerStopReleasesListener(unittest.TestCase):
    def tearDown(self):
        # Never leak a listener into the next test.
        try:
            stop_server()
        except Exception:  # noqa: BLE001 - cleanup must not fail the test
            pass
        api_server._server = None

    def test_stop_closes_listener_and_joins_thread(self):
        port = _free_port()
        server = AIServer(host="127.0.0.1", port=port)
        server.start()
        try:
            self.assertTrue(server.is_running)
            self.assertIsNotNone(server._httpd)
            _wait_until_serving(port)

            thread = server.server_thread
            self.assertIsNotNone(thread)

            server.stop()

            self.assertFalse(server.is_running)
            self.assertIsNone(server._httpd)
            self.assertIsNone(server.server_thread)
            self.assertFalse(thread.is_alive())
            _wait_until_closed(port)
        finally:
            try:
                server.stop()
            except Exception:  # noqa: BLE001 - cleanup
                pass

    def test_restart_after_stop_serves_again(self):
        port = _free_port()
        server = AIServer(host="127.0.0.1", port=port)
        server.start()
        _wait_until_serving(port)
        first_thread = server.server_thread

        server.stop()
        _wait_until_closed(port)
        self.assertFalse(server.is_running)

        # Restarting the same instance must bind cleanly, not collide with a
        # listener leaked by the previous start.
        server.start()
        try:
            self.assertTrue(server.is_running)
            self.assertIsNot(server.server_thread, first_thread)
            _wait_until_serving(port)
        finally:
            server.stop()
        _wait_until_closed(port)
        self.assertFalse(server.is_running)

    def test_double_start_does_not_add_listener(self):
        port = _free_port()
        server = AIServer(host="127.0.0.1", port=port)
        server.start()
        try:
            _wait_until_serving(port)
            thread = server.server_thread
            server.start()
            self.assertTrue(server.is_running)
            self.assertIs(server.server_thread, thread)
            _wait_until_serving(port)
        finally:
            server.stop()
        _wait_until_closed(port)

    def test_double_stop_is_idempotent(self):
        port = _free_port()
        server = AIServer(host="127.0.0.1", port=port)
        server.start()
        _wait_until_serving(port)
        server.stop()
        _wait_until_closed(port)
        # Second stop must not raise and must keep the stopped state.
        server.stop()
        self.assertFalse(server.is_running)
        self.assertIsNone(server._httpd)
        self.assertIsNone(server.server_thread)

    def test_module_start_stop_restarts_cleanly(self):
        port = _free_port()
        first = start_server("127.0.0.1", port)
        try:
            self.assertTrue(first.is_running)
            _wait_until_serving(port)

            stop_server()
            self.assertFalse(first.is_running)
            _wait_until_closed(port)

            second = start_server("127.0.0.1", port)
            self.assertTrue(second.is_running)
            _wait_until_serving(port)
        finally:
            stop_server()
        _wait_until_closed(port)

    def test_stop_background_processing_leaves_listener_alone(self):
        from unittest.mock import Mock, patch

        port = _free_port()
        server = AIServer(host="127.0.0.1", port=port)
        server.start()
        try:
            _wait_until_serving(port)
            with patch.object(api_server, "pipeline_manager") as pipeline:
                pipeline.stop_server = Mock()
                server.stop_background_processing()
                pipeline.stop_server.assert_called_once()
            # Background cleanup alone must not stop the HTTP listener.
            self.assertTrue(server.is_running)
            self.assertIsNotNone(server._httpd)
            _wait_until_serving(port)
        finally:
            server.stop()
        _wait_until_closed(port)

    def test_public_bind_is_refused_without_listener(self):
        port = _free_port()
        server = AIServer(host="0.0.0.0", port=port)
        with self.assertRaises(RuntimeError):
            server.start()
        self.assertFalse(server.is_running)
        self.assertIsNone(server._httpd)
        self.assertIsNone(server.server_thread)


if __name__ == "__main__":
    unittest.main()
