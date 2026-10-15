"""Regression test for issue #165: documented direct launch must not fail.

`python src/api/server.py` used to fail before the main block with
"attempted relative import with no known parent package" because the file
used `from .aws_manager` / `from .routes` with no package context. The
canonical server now establishes the `api` package in-process before those
relative imports.
"""

import ast
import os
import socket
import subprocess
import sys
import time
import unittest
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER_FILE = ROOT / "src" / "api" / "server.py"


def _free_port():
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    _, port = sock.getsockname()
    sock.close()
    return port


def _wait_until_serving(port, timeout=20.0):
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
            time.sleep(0.2)
    raise AssertionError(
        "direct-file server on port %d never served /health: %r" % (port, last_error)
    )


class TestDirectServerLaunchBootstrap(unittest.TestCase):
    def test_package_bootstrap_precedes_relative_imports(self):
        tree = ast.parse(SERVER_FILE.read_text(encoding="utf-8"))
        first_relative = None
        bootstrap_lineno = None
        for node in tree.body:
            if isinstance(node, ast.If):
                text = ast.get_source_segment(
                    SERVER_FILE.read_text(encoding="utf-8"), node
                ) or ""
                if "__package__" in text:
                    bootstrap_lineno = node.lineno
            if isinstance(node, ast.ImportFrom) and node.level and node.level > 0:
                if first_relative is None:
                    first_relative = node.lineno
        self.assertIsNotNone(
            bootstrap_lineno, "server.py has no __package__ bootstrap block"
        )
        self.assertIsNotNone(first_relative, "server.py has no relative imports")
        self.assertLess(
            bootstrap_lineno,
            first_relative,
            "package bootstrap must run before the first relative import",
        )

    def test_bootstrap_establishes_api_package(self):
        text = SERVER_FILE.read_text(encoding="utf-8")
        self.assertIn('__package__ = "api"', text)
        self.assertIn('sys.modules["api"]', text)

    def test_direct_file_launch_serves_health(self):
        port = _free_port()
        env = os.environ.copy()
        env["AWS_EC2_METADATA_DISABLED"] = "true"
        env["AWS_DEFAULT_REGION"] = "ap-south-1"
        env.setdefault("AWS_ACCESS_KEY_ID", "testing")
        env.setdefault("AWS_SECRET_ACCESS_KEY", "testing")
        proc = subprocess.Popen(
            [sys.executable, "src/api/server.py", "127.0.0.1", str(port)],
            cwd=str(ROOT),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        try:
            _wait_until_serving(port)
        except AssertionError:
            try:
                proc.terminate()
            except Exception:  # noqa: BLE001 - best effort
                pass
            try:
                out, _ = proc.communicate(timeout=5)
            except Exception:  # noqa: BLE001 - best effort
                out = ""
            self.fail(
                "direct-file launch did not serve /health. Output:\n%s" % (out,)
            )
        finally:
            try:
                proc.terminate()
            except Exception:  # noqa: BLE001 - best effort
                pass
            try:
                out, _ = proc.communicate(timeout=5)
            except Exception:  # noqa: BLE001 - best effort
                try:
                    proc.kill()
                except Exception:  # noqa: BLE001 - best effort
                    pass
                out = ""
        self.assertNotIn(
            "attempted relative import with no known parent package",
            out,
            "direct-file launch still fails on relative imports",
        )


if __name__ == "__main__":
    unittest.main()
