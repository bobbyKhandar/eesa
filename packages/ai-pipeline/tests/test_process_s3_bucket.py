"""POST /process must read the PDF from the bucket it just verified.

A caller can name s3_bucket. The route checks that object, then the worker
must open the same bucket. When the request omits the bucket, both steps use
the configured bucket. Batch submission has to carry the same value.
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

from api.aws_manager import AWSPipelineManager
from api.routes import register_routes


TOKEN = "test-pipeline-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


class TestProcessRouteBucket(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config["TESTING"] = True
        self.aws = Mock()
        self.aws.is_aws_available.return_value = True
        self.aws.s3_bucket = "configured-bucket"
        self.aws.s3_jobs_prefix = "jobs/"
        self.aws.s3_client.head_object.return_value = {"ContentLength": 10}
        self.aws.executor.submit.return_value = None
        register_routes(self.app, self.aws, Mock())
        self.client = self.app.test_client()
        self._env = patch.dict(os.environ, {"AI_PIPELINE_TOKEN": TOKEN}, clear=False)
        self._env.start()

    def tearDown(self):
        self._env.stop()

    def test_process_submits_the_same_bucket_it_verified(self):
        response = self.client.post(
            "/process",
            json={
                "s3_key": "uploads/paper.pdf",
                "filename": "paper.pdf",
                "job_id": "job-9",
                "s3_bucket": "caller-bucket",
            },
            headers=AUTH,
        )

        self.assertEqual(response.status_code, 202)
        self.aws.s3_client.head_object.assert_called_once_with(
            Bucket="caller-bucket",
            Key="uploads/paper.pdf",
        )
        self.aws.executor.submit.assert_called_once_with(
            self.aws.process_aws_job_pipeline,
            "job-9",
            "uploads/paper.pdf",
            "paper.pdf",
            "caller-bucket",
        )

    def test_process_without_a_bucket_uses_the_configured_bucket(self):
        response = self.client.post(
            "/process",
            json={
                "s3_key": "uploads/paper.pdf",
                "filename": "paper.pdf",
                "job_id": "job-8",
            },
            headers=AUTH,
        )

        self.assertEqual(response.status_code, 202)
        self.aws.s3_client.head_object.assert_called_once_with(
            Bucket="configured-bucket",
            Key="uploads/paper.pdf",
        )
        self.aws.executor.submit.assert_called_once_with(
            self.aws.process_aws_job_pipeline,
            "job-8",
            "uploads/paper.pdf",
            "paper.pdf",
            "configured-bucket",
        )

    def test_process_treats_a_blank_bucket_as_omitted(self):
        response = self.client.post(
            "/process",
            json={
                "s3_key": "uploads/paper.pdf",
                "filename": "paper.pdf",
                "job_id": "job-7",
                "s3_bucket": "   ",
            },
            headers=AUTH,
        )

        self.assertEqual(response.status_code, 202)
        self.aws.s3_client.head_object.assert_called_once_with(
            Bucket="configured-bucket",
            Key="uploads/paper.pdf",
        )
        self.aws.executor.submit.assert_called_once_with(
            self.aws.process_aws_job_pipeline,
            "job-7",
            "uploads/paper.pdf",
            "paper.pdf",
            "configured-bucket",
        )

    def test_batch_submits_each_job_with_the_request_bucket(self):
        response = self.client.post(
            "/process/batch",
            json={
                "s3_bucket": "caller-bucket",
                "jobs": [
                    {"s3_key": "uploads/a.pdf", "filename": "a.pdf", "job_id": "job-a"},
                    {"s3_key": "uploads/b.pdf", "job_id": "job-b"},
                ],
            },
            headers=AUTH,
        )

        self.assertEqual(response.status_code, 202)
        self.assertEqual(self.aws.executor.submit.call_count, 2)
        self.aws.executor.submit.assert_any_call(
            self.aws.process_aws_job_pipeline,
            "job-a",
            "uploads/a.pdf",
            "a.pdf",
            "caller-bucket",
        )
        self.aws.executor.submit.assert_any_call(
            self.aws.process_aws_job_pipeline,
            "job-b",
            "uploads/b.pdf",
            "b.pdf",
            "caller-bucket",
        )

    def test_batch_without_a_bucket_uses_the_configured_bucket(self):
        response = self.client.post(
            "/process/batch",
            json={"jobs": [{"s3_key": "uploads/a.pdf", "job_id": "job-a"}]},
            headers=AUTH,
        )

        self.assertEqual(response.status_code, 202)
        self.aws.executor.submit.assert_called_once_with(
            self.aws.process_aws_job_pipeline,
            "job-a",
            "uploads/a.pdf",
            "a.pdf",
            "configured-bucket",
        )


class TestProcessAwsJobPipelineBucket(unittest.TestCase):
    def _manager(self):
        manager = AWSPipelineManager()
        manager.s3_client = Mock()
        manager.s3_bucket = "configured-bucket"
        return manager

    def test_pipeline_reads_the_supplied_bucket(self):
        manager = self._manager()
        with patch("api.aws_manager.process_document_async", return_value=False) as ocr:
            metadata = manager.process_aws_job_pipeline(
                "job-1",
                "uploads/paper.pdf",
                "paper.pdf",
                s3_bucket="caller-bucket",
            )

        ocr.assert_called_once_with("caller-bucket", "uploads/paper.pdf", "job-1")
        self.assertEqual(metadata["status"], "failed")
        self.assertEqual(metadata["failed_stage"], "ocr")

    def test_pipeline_reads_the_configured_bucket_when_none_is_given(self):
        manager = self._manager()
        with patch("api.aws_manager.process_document_async", return_value=False) as ocr:
            manager.process_aws_job_pipeline(
                "job-2",
                "uploads/paper.pdf",
                "paper.pdf",
            )

        ocr.assert_called_once_with("configured-bucket", "uploads/paper.pdf", "job-2")


if __name__ == "__main__":
    unittest.main()
