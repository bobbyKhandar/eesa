"""AWS WSGI startup must not require the optional local Redis pipeline.

The redis client library can be installed while no Redis server is listening.
Importing ``wsgi`` must still build the Flask app. ``GET /health`` stays up,
and a local OCR route reports that the local pipeline is unavailable.
"""

import importlib
import json
import os
import socket
import subprocess
import sys
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOKEN = "wsgi-optional-local-token"
RESULT_PREFIX = "WSGI_LOCAL_RESULT "


def _redis_port_accepts_connections() -> bool:
    try:
        with socket.create_connection(("127.0.0.1", 6379), timeout=0.5):
            return True
    except OSError:
        return False


class TestWsgiOptionalLocalPipeline(unittest.TestCase):
    def test_import_wsgi_when_redis_is_installed_but_unreachable(self):
        redis = importlib.import_module("redis")
        self.assertTrue(hasattr(redis, "Redis"))
        self.assertFalse(
            _redis_port_accepts_connections(),
            "127.0.0.1:6379 accepted a connection; this test needs Redis to be unreachable",
        )

        script = textwrap.dedent(
            """
            import json
            import sys
            import types

            pings = []

            try:
                import cv2  # noqa: F401
            except ModuleNotFoundError:
                # pipeline_manager imports cv2 before redis_client. The bug is
                # the Redis ping, which runs only after that import succeeds.
                sys.modules["cv2"] = types.ModuleType("cv2")

            import redis

            class RecordingRedis(redis.Redis):
                def __init__(self, *args, **kwargs):
                    kwargs.setdefault("socket_connect_timeout", 0.5)
                    super().__init__(*args, **kwargs)
                    pings.append("init")

                def ping(self, *args, **kwargs):
                    pings.append("ping")
                    return super().ping(*args, **kwargs)

            redis.Redis = RecordingRedis

            import wsgi

            pings_after_import = list(pings)
            client = wsgi.app.test_client()
            health = client.get("/health")
            pings_after_health = list(pings)
            aws_jobs = client.get(
                "/jobs/active",
                headers={"Authorization": "Bearer %s"},
            )
            local = client.post(
                "/submit-local",
                json={"file_locations": ["/tmp/paper.pdf"]},
                headers={"Authorization": "Bearer %s"},
            )
            print(RESULT_PREFIX + json.dumps({
                "pings_after_import": pings_after_import,
                "pings_after_health": pings_after_health,
                "pings_after_local": list(pings),
                "health_status": health.status_code,
                "health": health.get_json(),
                "aws_jobs_status": aws_jobs.status_code,
                "aws_jobs": aws_jobs.get_json(),
                "local_status": local.status_code,
                "local": local.get_json(),
            }))
            """
            % (TOKEN, TOKEN)
        )
        script = script.replace("RESULT_PREFIX + ", json.dumps(RESULT_PREFIX) + " + ")

        env = os.environ.copy()
        env["AI_PIPELINE_TOKEN"] = TOKEN
        env["AWS_EC2_METADATA_DISABLED"] = "true"
        env["AWS_ACCESS_KEY_ID"] = "testing"
        env["AWS_SECRET_ACCESS_KEY"] = "testing"
        env["AWS_DEFAULT_REGION"] = "us-east-1"

        completed = subprocess.run(
            [sys.executable, "-c", script],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
            timeout=90,
        )
        self.assertEqual(
            completed.returncode,
            0,
            "wsgi import failed:\n%s\n%s" % (completed.stdout, completed.stderr),
        )
        result_lines = [
            line[len(RESULT_PREFIX) :]
            for line in completed.stdout.splitlines()
            if line.startswith(RESULT_PREFIX)
        ]
        self.assertEqual(len(result_lines), 1, completed.stdout + completed.stderr)
        payload = json.loads(result_lines[0])

        self.assertEqual(payload["pings_after_import"], [])
        self.assertEqual(payload["pings_after_health"], [])
        self.assertTrue(payload["pings_after_local"])

        health = payload["health"]
        self.assertEqual(payload["health_status"], 200)
        self.assertEqual(health["status"], "healthy")
        self.assertIn("aws_pipeline", health)
        self.assertIs(health["local_pipeline"], False)
        self.assertEqual(payload["aws_jobs_status"], 200)
        self.assertIn("jobs", payload["aws_jobs"])

        self.assertEqual(payload["local_status"], 503)
        error = payload["local"]["error"]
        self.assertIn("Local pipeline not available", error)
        self.assertIn("Redis", error)


if __name__ == "__main__":
    unittest.main()
