"""Question-paper uploads stop before S3 when a batch is too large.

The Next.js proxy and this Flask route share the same caps. Defaults are
25 MB per file, 20 files, and 200 MB for the whole request. Oversized
bodies return 413 or 400 and never call S3 or start a job.
"""

import io
import os
import sys
import unittest
from unittest.mock import MagicMock, Mock, patch

from flask import Flask
from werkzeug.exceptions import RequestEntityTooLarge

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "src"))
sys.modules.setdefault("boto3", MagicMock())
sys.modules.setdefault("botocore", MagicMock())
sys.modules.setdefault("botocore.config", MagicMock())

from api.routes import register_routes
from api.upload_limits import (
    DEFAULT_MAX_FILE_BYTES,
    DEFAULT_MAX_FILE_COUNT,
    DEFAULT_MAX_REQUEST_BYTES,
    content_length_rejection,
    question_paper_upload_limits,
    stored_files_rejection,
)


TOKEN = "test-pipeline-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
ENV_KEYS = (
    "QUESTION_PAPER_MAX_FILE_BYTES",
    "QUESTION_PAPER_MAX_FILE_COUNT",
    "QUESTION_PAPER_MAX_REQUEST_BYTES",
)


class TrackingStream(io.BytesIO):
    def __init__(self, data):
        super().__init__(data)
        self.reads = 0

    def read(self, *args, **kwargs):
        self.reads += 1
        return super().read(*args, **kwargs)


class FakeUpload:
    def __init__(self, data, filename="paper.pdf", position=0):
        self.filename = filename
        self.stream = TrackingStream(data)
        if position:
            self.stream.seek(position)


class TestQuestionPaperUploadLimitConfig(unittest.TestCase):
    def test_defaults_are_25mb_20_files_and_200mb(self):
        with patch.dict(os.environ, {}, clear=False):
            for key in ENV_KEYS:
                os.environ.pop(key, None)
            limits = question_paper_upload_limits()
        self.assertEqual(limits["max_file_bytes"], 25 * 1024 * 1024)
        self.assertEqual(limits["max_file_bytes"], DEFAULT_MAX_FILE_BYTES)
        self.assertEqual(limits["max_file_count"], 20)
        self.assertEqual(limits["max_file_count"], DEFAULT_MAX_FILE_COUNT)
        self.assertEqual(limits["max_request_bytes"], 200 * 1024 * 1024)
        self.assertEqual(limits["max_request_bytes"], DEFAULT_MAX_REQUEST_BYTES)

    def test_positive_integer_overrides_are_read(self):
        with patch.dict(
            os.environ,
            {
                "QUESTION_PAPER_MAX_FILE_BYTES": "1024",
                "QUESTION_PAPER_MAX_FILE_COUNT": "3",
                "QUESTION_PAPER_MAX_REQUEST_BYTES": "4096",
            },
            clear=False,
        ):
            self.assertEqual(
                question_paper_upload_limits(),
                {
                    "max_file_bytes": 1024,
                    "max_file_count": 3,
                    "max_request_bytes": 4096,
                },
            )

    def test_blank_zero_and_non_integer_overrides_use_defaults(self):
        with patch.dict(
            os.environ,
            {
                "QUESTION_PAPER_MAX_FILE_BYTES": "  ",
                "QUESTION_PAPER_MAX_FILE_COUNT": "0",
                "QUESTION_PAPER_MAX_REQUEST_BYTES": "12.5",
            },
            clear=False,
        ):
            limits = question_paper_upload_limits()
        self.assertEqual(limits["max_file_bytes"], DEFAULT_MAX_FILE_BYTES)
        self.assertEqual(limits["max_file_count"], DEFAULT_MAX_FILE_COUNT)
        self.assertEqual(limits["max_request_bytes"], DEFAULT_MAX_REQUEST_BYTES)


class TestUploadLimitDecisions(unittest.TestCase):
    def setUp(self):
        self.limits = {
            "max_file_bytes": 10,
            "max_file_count": 2,
            "max_request_bytes": 15,
        }

    def test_content_length_over_the_cap_is_413(self):
        body, status = content_length_rejection(16, self.limits)
        self.assertEqual(status, 413)
        self.assertIn("16 bytes", body["error"])
        self.assertIn("15 byte request limit", body["error"])
        self.assertFalse(body["success"])

    def test_missing_content_length_is_allowed(self):
        self.assertIsNone(content_length_rejection(None, self.limits))

    def test_too_many_files_is_400_and_does_not_read_streams(self):
        files = [FakeUpload(b"a", "a.pdf"), FakeUpload(b"b", "b.pdf"), FakeUpload(b"c", "c.pdf")]
        body, status = stored_files_rejection(files, self.limits)
        self.assertEqual(status, 400)
        self.assertIn("received 3", body["error"])
        self.assertIn("maximum is 2", body["error"])
        self.assertEqual(sum(item.stream.reads for item in files), 0)

    def test_one_oversized_file_is_413(self):
        files = [FakeUpload(b"1234", "small.pdf"), FakeUpload(b"12345678901", "huge.pdf")]
        body, status = stored_files_rejection(files, self.limits)
        self.assertEqual(status, 413)
        self.assertIn("huge.pdf", body["error"])
        self.assertIn("11 bytes", body["error"])
        self.assertIn("per-file limit", body["error"])
        self.assertEqual(sum(item.stream.reads for item in files), 0)

    def test_combined_file_bytes_over_the_cap_are_413(self):
        files = [FakeUpload(b"12345678", "a.pdf"), FakeUpload(b"12345678", "b.pdf")]
        body, status = stored_files_rejection(files, self.limits)
        self.assertEqual(status, 413)
        self.assertIn("16 bytes", body["error"])
        self.assertIn("15 byte request limit", body["error"])
        self.assertEqual(sum(item.stream.reads for item in files), 0)

    def test_a_batch_on_each_limit_is_allowed_and_stream_position_is_restored(self):
        first = FakeUpload(b"0123456789", "a.pdf", position=2)
        second = FakeUpload(b"01234", "b.pdf", position=1)
        self.assertIsNone(stored_files_rejection([first, second], self.limits))
        self.assertEqual(first.stream.tell(), 2)
        self.assertEqual(second.stream.tell(), 1)
        self.assertEqual(first.stream.reads, 0)
        self.assertEqual(second.stream.reads, 0)

    def test_an_unmeasurable_stream_is_400(self):
        class BadStream:
            def tell(self):
                raise OSError("not seekable")

            def seek(self, *_args):
                raise OSError("not seekable")

        class BadFile:
            filename = "paper.pdf"
            stream = BadStream()

        body, status = stored_files_rejection([BadFile()], self.limits)
        self.assertEqual(status, 400)
        self.assertIn("paper.pdf", body["error"])
        self.assertIn("measure", body["error"])


class TestQuestionPaperUploadRoute(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config["TESTING"] = True
        self.aws = Mock()
        self.aws.is_aws_available.return_value = True
        self.aws.s3_bucket = "test-bucket"
        self.aws.s3_jobs_prefix = "jobs/"
        self.aws.executor.submit.return_value = None
        # Multipart framing is larger than the file bytes, so the route-level
        # request cap stays above that overhead unless a test lowers it.
        self._env = patch.dict(
            os.environ,
            {
                "AI_PIPELINE_TOKEN": TOKEN,
                "QUESTION_PAPER_MAX_FILE_BYTES": "100",
                "QUESTION_PAPER_MAX_FILE_COUNT": "20",
                "QUESTION_PAPER_MAX_REQUEST_BYTES": "100000",
            },
            clear=False,
        )
        self._env.start()
        register_routes(self.app, self.aws, Mock())
        self.client = self.app.test_client()

    def tearDown(self):
        self._env.stop()

    def post_files(self, files, headers=None):
        # BytesIO is a real stream. A bare bytes tuple is not stored as a file.
        data = {"files": [(io.BytesIO(payload), name) for name, payload in files]}
        return self.client.post(
            "/upload/question-papers",
            data=data,
            headers=headers if headers is not None else AUTH,
        )

    def test_max_content_length_matches_the_request_cap(self):
        self.assertEqual(self.app.config["MAX_CONTENT_LENGTH"], 100000)

    def test_a_pdf_within_the_limits_streams_to_s3_and_starts_a_job(self):
        seen = {}

        def capture(stream, bucket, key, ExtraArgs=None):
            # The test client closes the upload after the response returns.
            seen["is_bytes"] = isinstance(stream, (bytes, bytearray))
            seen["readable"] = hasattr(stream, "read")
            seen["position"] = stream.tell()
            seen["bucket"] = bucket
            seen["key"] = key
            seen["extra"] = ExtraArgs

        self.aws.s3_client.upload_fileobj.side_effect = capture
        with patch("api.routes.uuid.uuid4", return_value="job-fixed"):
            response = self.post_files([("paper.pdf", b"%PDF-1234")])

        self.assertEqual(response.status_code, 202, response.data)
        body = response.get_json()
        self.assertTrue(body["success"])
        self.assertEqual(body["jobs"][0]["filename"], "paper.pdf")
        self.assertEqual(body["jobs"][0]["job_id"], "job-fixed")
        self.assertEqual(body["jobs"][0]["s3_key"], "jobs/job-fixed/original/paper.pdf")
        self.assertEqual(body["jobs"][0]["status"], "processing")
        self.aws.s3_client.put_object.assert_not_called()
        self.assertFalse(seen["is_bytes"])
        self.assertTrue(seen["readable"])
        self.assertEqual(seen["position"], 0)
        self.assertEqual(seen["bucket"], "test-bucket")
        self.assertEqual(seen["key"], "jobs/job-fixed/original/paper.pdf")
        self.assertEqual(seen["extra"], {"ContentType": "application/pdf"})
        self.aws.executor.submit.assert_called_once_with(
            self.aws.process_aws_job_pipeline,
            "job-fixed",
            "jobs/job-fixed/original/paper.pdf",
            "paper.pdf",
        )

    def test_a_non_pdf_within_the_limits_is_still_rejected(self):
        response = self.post_files([("notes.txt", b"hello")])
        self.assertEqual(response.status_code, 400, response.data)
        body = response.get_json()
        self.assertFalse(body["success"])
        self.assertIn("notes.txt: Only PDF files are allowed", body["errors"])
        self.aws.s3_client.upload_fileobj.assert_not_called()
        self.aws.s3_client.put_object.assert_not_called()
        self.aws.executor.submit.assert_not_called()

    def test_too_many_files_return_400_before_s3(self):
        with patch.dict(os.environ, {"QUESTION_PAPER_MAX_FILE_COUNT": "2"}, clear=False):
            response = self.post_files(
                [("a.pdf", b"a"), ("b.pdf", b"b"), ("c.pdf", b"c")]
            )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("received 3", response.get_json()["error"])
        self.aws.s3_client.upload_fileobj.assert_not_called()
        self.aws.executor.submit.assert_not_called()

    def test_an_oversized_file_returns_413_before_s3(self):
        with patch.dict(os.environ, {"QUESTION_PAPER_MAX_FILE_BYTES": "10"}, clear=False):
            response = self.post_files([("huge.pdf", b"12345678901")])
        self.assertEqual(response.status_code, 413, response.data)
        self.assertIn("huge.pdf", response.get_json()["error"])
        self.assertIn("per-file limit", response.get_json()["error"])
        self.aws.s3_client.upload_fileobj.assert_not_called()
        self.aws.executor.submit.assert_not_called()

    def test_a_request_over_the_byte_cap_returns_413_before_s3(self):
        with patch.dict(
            os.environ,
            {
                "QUESTION_PAPER_MAX_FILE_BYTES": "100000",
                "QUESTION_PAPER_MAX_REQUEST_BYTES": "80",
            },
            clear=False,
        ):
            response = self.post_files([("paper.pdf", b"x" * 200)])
        self.assertEqual(response.status_code, 413, response.data)
        self.assertIn("byte request limit", response.get_json()["error"])
        self.aws.s3_client.upload_fileobj.assert_not_called()
        self.aws.executor.submit.assert_not_called()

    def test_a_valid_pdf_still_uploads_when_another_file_is_not_a_pdf(self):
        with patch("api.routes.uuid.uuid4", return_value="job-fixed"):
            response = self.post_files([("paper.pdf", b"%PDF-1"), ("notes.txt", b"hello")])
        self.assertEqual(response.status_code, 202, response.data)
        body = response.get_json()
        self.assertTrue(body["success"])
        self.assertEqual(len(body["jobs"]), 1)
        self.assertEqual(body["jobs"][0]["filename"], "paper.pdf")
        self.assertIn("notes.txt: Only PDF files are allowed", body["errors"])
        self.aws.s3_client.upload_fileobj.assert_called_once()

    def test_request_entity_too_large_stays_a_json_413(self):
        with self.app.test_request_context("/upload/question-papers", method="POST"):
            response = self.app.handle_user_exception(RequestEntityTooLarge())
        if isinstance(response, tuple):
            raw, status = response
            self.assertEqual(status, 413)
            payload = raw.get_json()
        else:
            self.assertEqual(response.status_code, 413)
            payload = response.get_json()
        self.assertIn(
            f"{self.app.config['MAX_CONTENT_LENGTH']} byte upload limit",
            payload["error"],
        )
        self.assertFalse(payload["success"])

    def test_upload_without_the_service_token_does_not_store_the_file(self):
        response = self.post_files([("paper.pdf", b"%PDF-1")], headers={})
        self.assertEqual(response.status_code, 401, response.data)
        self.aws.s3_client.upload_fileobj.assert_not_called()
        self.aws.s3_client.put_object.assert_not_called()
        self.aws.executor.submit.assert_not_called()


if __name__ == "__main__":
    unittest.main()
