"""Sensitive AI pipeline routes require a service credential.

The Next.js app already decides which user may read a job
(`jobContentAccessDecision`) or upload papers (`requireAdminCaller`).
These tests cover the Flask service itself: a caller who can reach the
process must still present the shared service token, and the listener
must not accept public binds by default.
"""

import os
import sys
import unittest
from unittest.mock import MagicMock, Mock, patch

from flask import Flask

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "src"))
# routes imports the package __init__, which constructs the server and boto3.
sys.modules.setdefault("boto3", MagicMock())
sys.modules.setdefault("botocore", MagicMock())
sys.modules.setdefault("botocore.config", MagicMock())

from api.routes import register_routes


TOKEN = "test-pipeline-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


class TestSensitiveRoutesRequireAuth(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config["TESTING"] = True
        self.aws = Mock()
        self.aws.is_aws_available.return_value = True
        self.aws.s3_bucket = "test-bucket"
        self.aws.s3_jobs_prefix = "jobs/"
        self.aws.s3_client.head_object.return_value = {"ContentLength": 10}
        self.aws.executor.submit.return_value = None
        self.aws.load_job_metadata.return_value = None
        self.aws.get_job_status.return_value = None
        self.aws.get_active_jobs_count.return_value = 0
        self.aws.get_active_jobs.return_value = []
        self.pipeline = Mock()
        self.pipeline.is_running = False
        self.pipeline.get_batch_status.return_value = None
        self.pipeline.get_batch_result.return_value = None
        register_routes(self.app, self.aws, self.pipeline)
        self.client = self.app.test_client()
        self._env = patch.dict(os.environ, {"AI_PIPELINE_TOKEN": TOKEN}, clear=False)
        self._env.start()

    def tearDown(self):
        self._env.stop()

    def test_health_stays_open_without_a_token(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["status"], "healthy")

    def test_health_stays_open_from_a_remote_address(self):
        response = self.client.get("/health", environ_base={"REMOTE_ADDR": "203.0.113.8"})
        self.assertEqual(response.status_code, 200)

    def test_process_without_credentials_does_not_start_a_job(self):
        response = self.client.post("/process", json={"s3_key": "uploads/paper.pdf"})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"], "Unauthorized")
        self.aws.executor.submit.assert_not_called()

    def test_process_rejects_a_wrong_token(self):
        response = self.client.post(
            "/process",
            json={"s3_key": "uploads/paper.pdf"},
            headers={"Authorization": "Bearer not-the-token"},
        )
        self.assertEqual(response.status_code, 401)
        self.aws.executor.submit.assert_not_called()

    def test_batch_submit_aws_and_upload_require_the_token(self):
        batch = self.client.post("/process/batch", json={"jobs": [{"s3_key": "uploads/a.pdf"}]})
        submit = self.client.post("/submit-aws", json={"bucket": "b", "files": ["a.pdf"]})
        upload = self.client.post(
            "/upload/question-papers",
            data={"files": (b"%PDF-1.4", "paper.pdf")},
            content_type="multipart/form-data",
        )
        self.assertEqual(batch.status_code, 401)
        self.assertEqual(submit.status_code, 401)
        self.assertEqual(upload.status_code, 401)
        self.aws.executor.submit.assert_not_called()
        self.aws.submit_job.assert_not_called()
        self.aws.s3_client.put_object.assert_not_called()
        self.aws.s3_client.upload_fileobj.assert_not_called()

    def test_job_reads_require_the_token_before_loading_metadata(self):
        status = self.client.get("/job/job-1/status")
        metadata = self.client.get("/job/job-1/metadata")
        questions = self.client.get("/job/job-1/questions")
        legacy = self.client.get("/status-aws/job-1")
        active = self.client.get("/jobs/active")
        for response in (status, metadata, questions, legacy, active):
            self.assertEqual(response.status_code, 401, response.data)
        self.aws.load_job_metadata.assert_not_called()
        self.aws.get_job_status.assert_not_called()

    def test_local_submit_status_and_result_require_the_token(self):
        submit = self.client.post("/submit-local", json={"file_locations": ["/tmp/a.pdf"]})
        legacy = self.client.post("/submit", json={"file_locations": ["/tmp/a.pdf"]})
        status = self.client.get("/status/batch-1")
        result = self.client.get("/result/batch-1")
        for response in (submit, legacy, status, result):
            self.assertEqual(response.status_code, 401, response.data)
        self.pipeline.submit_batch.assert_not_called()
        self.pipeline.get_batch_status.assert_not_called()
        self.pipeline.get_batch_result.assert_not_called()

    def test_missing_server_token_fails_closed(self):
        with patch.dict(os.environ, {"AI_PIPELINE_TOKEN": ""}, clear=False):
            response = self.client.post("/process", json={"s3_key": "uploads/paper.pdf"})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["error"], "AI pipeline authentication is not configured")
        self.aws.executor.submit.assert_not_called()

    def test_remote_caller_is_rejected_even_with_a_valid_token(self):
        response = self.client.post(
            "/process",
            json={"s3_key": "uploads/paper.pdf"},
            headers=AUTH,
            environ_base={"REMOTE_ADDR": "203.0.113.8"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["error"], "Forbidden")
        self.aws.executor.submit.assert_not_called()

    def test_trusted_remote_host_with_the_token_reaches_the_handler(self):
        self.aws.is_aws_available.return_value = False
        with patch.dict(os.environ, {"AI_PIPELINE_TRUSTED_HOSTS": "203.0.113.9"}, clear=False):
            response = self.client.post(
                "/process",
                json={"s3_key": "uploads/paper.pdf"},
                headers=AUTH,
                environ_base={"REMOTE_ADDR": "203.0.113.9"},
            )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["error"], "AWS pipeline not configured")

    def test_valid_loopback_token_reaches_the_handler(self):
        response = self.client.post(
            "/process",
            json={"s3_key": "uploads/paper.pdf", "filename": "paper.pdf"},
            headers=AUTH,
        )
        self.assertEqual(response.status_code, 202)
        self.aws.executor.submit.assert_called_once()

    def test_explicit_remote_opt_in_still_requires_the_token(self):
        with patch.dict(os.environ, {"AI_PIPELINE_ALLOW_REMOTE": "1"}, clear=False):
            rejected = self.client.post(
                "/process",
                json={"s3_key": "uploads/paper.pdf"},
                environ_base={"REMOTE_ADDR": "203.0.113.8"},
            )
            self.aws.is_aws_available.return_value = False
            accepted = self.client.post(
                "/process",
                json={"s3_key": "uploads/paper.pdf"},
                headers=AUTH,
                environ_base={"REMOTE_ADDR": "203.0.113.8"},
            )
        self.assertEqual(rejected.status_code, 401)
        self.assertEqual(accepted.status_code, 503)
        self.assertEqual(accepted.get_json()["error"], "AWS pipeline not configured")


class TestProductionBind(unittest.TestCase):
    def test_public_bind_is_refused_unless_explicitly_allowed(self):
        from api.service_auth import assert_trusted_bind

        with patch.dict(os.environ, {"AI_PIPELINE_ALLOW_PUBLIC_BIND": ""}, clear=False):
            with self.assertRaises(RuntimeError):
                assert_trusted_bind("0.0.0.0")
            with self.assertRaises(RuntimeError):
                assert_trusted_bind("::")

        self.assertEqual(assert_trusted_bind("127.0.0.1"), "127.0.0.1")
        self.assertEqual(assert_trusted_bind("localhost"), "localhost")

        with patch.dict(os.environ, {"AI_PIPELINE_ALLOW_PUBLIC_BIND": "1"}, clear=False):
            self.assertEqual(assert_trusted_bind("0.0.0.0"), "0.0.0.0")

    def test_server_does_not_listen_on_a_public_address(self):
        from api.server import AIServer

        server = AIServer(host="0.0.0.0", port=5999)
        with patch("api.server.app.run") as run:
            with patch.dict(os.environ, {"AI_PIPELINE_ALLOW_PUBLIC_BIND": ""}, clear=False):
                with self.assertRaises(RuntimeError):
                    server._run_server()
            run.assert_not_called()

        loopback = AIServer(host="127.0.0.1", port=5999)
        with patch("api.server.app.run") as run:
            loopback._run_server()
            run.assert_called_once()
            self.assertEqual(run.call_args.kwargs["host"], "127.0.0.1")

    def test_gunicorn_config_defaults_to_loopback(self):
        import importlib.util

        config_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            "gunicorn.conf.py",
        )
        spec = importlib.util.spec_from_file_location("ai_pipeline_gunicorn_conf", config_path)
        module = importlib.util.module_from_spec(spec)
        with patch.dict(os.environ, {"AI_PIPELINE_BIND": "", "AI_PIPELINE_ALLOW_PUBLIC_BIND": ""}, clear=False):
            os.environ.pop("AI_PIPELINE_BIND", None)
            spec.loader.exec_module(module)
        self.assertEqual(module.bind, "127.0.0.1:5000")


if __name__ == "__main__":
    unittest.main()
