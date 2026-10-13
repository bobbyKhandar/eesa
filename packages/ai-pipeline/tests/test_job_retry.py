"""Retrying a failed question-paper job must re-queue the original S3 object.

The admin UI posts to the Next.js proxy, which calls POST /job/<job_id>/retry.
User ownership stays in the Next.js helper. This route only checks the service
token (via the shared before_request hook) and starts the existing pipeline.
"""

import os
import sys
import unittest
from unittest.mock import MagicMock, Mock, patch

from flask import Flask

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "src"))
sys.modules.setdefault("boto3", MagicMock())
sys.modules.setdefault("botocore", MagicMock())
sys.modules.setdefault("botocore.config", MagicMock())

from api.job_retry import plan_job_retry
from api.routes import register_routes


TOKEN = "test-pipeline-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


def failed_metadata(**overrides):
    metadata = {
        "job_id": "job-1",
        "filename": "paper.pdf",
        "s3_pdf_key": "jobs/job-1/original/paper.pdf",
        "status": "failed",
        "error": "OCR processing failed",
        "error_type": "ocr_failed",
        "failed_stage": "ocr",
        "completed_at": "2026-01-01T00:00:00",
        "stages": {"ocr": {"status": "failed"}},
    }
    metadata.update(overrides)
    return metadata


class TestPlanJobRetry(unittest.TestCase):
    def test_missing_metadata_is_not_found(self):
        plan = plan_job_retry(None, "job-1")
        self.assertFalse(plan["ok"])
        self.assertEqual(plan["status"], 404)
        self.assertEqual(plan["error"], "Job not found")

    def test_failed_job_reuses_the_stored_pdf_key(self):
        plan = plan_job_retry(failed_metadata(), "job-1")
        self.assertTrue(plan["ok"])
        self.assertEqual(plan["s3_key"], "jobs/job-1/original/paper.pdf")
        self.assertEqual(plan["filename"], "paper.pdf")
        self.assertEqual(plan["metadata"]["status"], "in_progress")
        self.assertEqual(plan["metadata"]["stages"], {})
        self.assertNotIn("error", plan["metadata"])
        self.assertNotIn("error_type", plan["metadata"])
        self.assertNotIn("failed_stage", plan["metadata"])
        self.assertNotIn("completed_at", plan["metadata"])

    def test_partial_success_is_retryable(self):
        plan = plan_job_retry(failed_metadata(status="partial_success"), "job-1")
        self.assertTrue(plan["ok"])
        self.assertEqual(plan["metadata"]["status"], "in_progress")

    def test_derives_the_upload_key_when_metadata_has_only_a_filename(self):
        metadata = failed_metadata()
        del metadata["s3_pdf_key"]
        plan = plan_job_retry(metadata, "job-1", jobs_prefix="jobs/")
        self.assertTrue(plan["ok"])
        self.assertEqual(plan["s3_key"], "jobs/job-1/original/paper.pdf")

    def test_running_and_successful_jobs_are_not_requeued(self):
        for status in ("in_progress", "processing", "queued", "success"):
            plan = plan_job_retry(failed_metadata(status=status), "job-1")
            self.assertFalse(plan["ok"], status)
            self.assertEqual(plan["status"], 409, status)

    def test_a_job_without_a_file_cannot_be_retried(self):
        plan = plan_job_retry({"status": "failed", "job_id": "job-1"}, "job-1")
        self.assertFalse(plan["ok"])
        self.assertEqual(plan["status"], 400)
        self.assertEqual(plan["error"], "Original file is not available for retry")


class TestJobRetryRoute(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config["TESTING"] = True
        self.aws = Mock()
        self.aws.is_aws_available.return_value = True
        self.aws.s3_bucket = "test-bucket"
        self.aws.s3_jobs_prefix = "jobs/"
        self.aws.s3_client.head_object.return_value = {"ContentLength": 10}
        self.aws.save_job_metadata.return_value = True
        self.aws.load_job_metadata.return_value = failed_metadata()
        self.aws.executor.submit.return_value = None
        self.pipeline = Mock()
        register_routes(self.app, self.aws, self.pipeline)
        self.client = self.app.test_client()
        self._env = patch.dict(os.environ, {"AI_PIPELINE_TOKEN": TOKEN}, clear=False)
        self._env.start()

    def tearDown(self):
        self._env.stop()

    def test_retry_requires_the_service_token_before_loading_the_job(self):
        response = self.client.post("/job/job-1/retry")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"], "Unauthorized")
        self.aws.load_job_metadata.assert_not_called()
        self.aws.executor.submit.assert_not_called()

    def test_failed_job_is_marked_in_progress_and_resubmitted_from_s3(self):
        response = self.client.post("/job/job-1/retry", headers=AUTH)
        self.assertEqual(response.status_code, 202)
        body = response.get_json()
        self.assertTrue(body["success"])
        self.assertEqual(body["job"]["job_id"], "job-1")
        self.assertEqual(body["job"]["filename"], "paper.pdf")
        self.assertEqual(body["job"]["status"], "in_progress")
        self.assertEqual(body["job"]["s3_key"], "jobs/job-1/original/paper.pdf")

        self.aws.s3_client.head_object.assert_called_once_with(
            Bucket="test-bucket",
            Key="jobs/job-1/original/paper.pdf",
        )
        saved = self.aws.save_job_metadata.call_args[0][1]
        self.assertEqual(saved["status"], "in_progress")
        self.assertNotIn("error", saved)
        self.aws.executor.submit.assert_called_once_with(
            self.aws.process_aws_job_pipeline,
            "job-1",
            "jobs/job-1/original/paper.pdf",
            "paper.pdf",
        )
        submit_order = [call[0] for call in self.aws.mock_calls]
        self.assertLess(
            submit_order.index("save_job_metadata"),
            submit_order.index("executor.submit"),
        )

    def test_missing_s3_object_does_not_start_a_job(self):
        self.aws.s3_client.head_object.side_effect = Exception("NoSuchKey")
        response = self.client.post("/job/job-1/retry", headers=AUTH)
        self.assertEqual(response.status_code, 404)
        self.assertIn("File not found in S3", response.get_json()["error"])
        self.aws.save_job_metadata.assert_not_called()
        self.aws.executor.submit.assert_not_called()

    def test_a_successful_job_is_not_requeued(self):
        self.aws.load_job_metadata.return_value = failed_metadata(status="success")
        response = self.client.post("/job/job-1/retry", headers=AUTH)
        self.assertEqual(response.status_code, 409)
        self.assertFalse(response.get_json()["success"])
        self.aws.executor.submit.assert_not_called()
        self.aws.s3_client.head_object.assert_not_called()

    def test_an_unknown_job_is_not_found(self):
        self.aws.load_job_metadata.return_value = None
        response = self.client.post("/job/job-1/retry", headers=AUTH)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.get_json()["error"], "Job not found")
        self.aws.executor.submit.assert_not_called()

    def test_aws_unavailable_does_not_load_metadata(self):
        self.aws.is_aws_available.return_value = False
        response = self.client.post("/job/job-1/retry", headers=AUTH)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["error"], "AWS pipeline not configured")
        self.aws.load_job_metadata.assert_not_called()
        self.aws.executor.submit.assert_not_called()

    def test_metadata_save_failure_does_not_start_a_job(self):
        self.aws.save_job_metadata.return_value = False
        response = self.client.post("/job/job-1/retry", headers=AUTH)
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.get_json()["error"], "Failed to record retry")
        self.aws.executor.submit.assert_not_called()


if __name__ == "__main__":
    unittest.main()
