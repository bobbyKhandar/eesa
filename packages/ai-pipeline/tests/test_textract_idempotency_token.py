"""Multi-file AWS batches must not reuse one Textract idempotency token.

Regression tests for issue #162: ``/submit-aws`` and
``process_batch_with_retry`` may share one job ID across several S3 keys.
The Textract ``ClientRequestToken`` must therefore be derived per document
(job ID + bucket + key + source version), reused for retries of the same
document, and distinct across documents. A token-reuse rejection
(``IdempotentParameterMismatchException``) is non-retryable.
"""

import importlib.util
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "src"))
sys.modules.setdefault("boto3", MagicMock())
sys.modules.setdefault("botocore", MagicMock())
sys.modules.setdefault("botocore.config", MagicMock())


def _load_real_pipeline():
    """Load the real ``aws_texttract_pipeline`` module from ``src``.

    Other test modules (e.g. ``test_master_server``) replace
    ``sys.modules['aws_texttract_pipeline']`` with a ``MagicMock`` at import
    time. Loading the file under a private name keeps these regression tests
    independent of that stub without disturbing it.
    """
    module_name = "real_aws_texttract_pipeline_under_test"
    existing = sys.modules.get(module_name)
    if existing is not None and hasattr(existing, "build_textract_client_token"):
        return existing
    src_file = os.path.join(
        os.path.dirname(os.path.dirname(__file__)), "src", "aws_texttract_pipeline.py"
    )
    spec = importlib.util.spec_from_file_location(module_name, src_file)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


pipeline = _load_real_pipeline()
build_textract_client_token = pipeline.build_textract_client_token
is_idempotent_parameter_mismatch = pipeline.is_idempotent_parameter_mismatch
process_document_async = pipeline.process_document_async
start_textract_job = pipeline.start_textract_job


def mismatch_error():
    err = Exception(
        "An error occurred (IdempotentParameterMismatchException) "
        "when calling the StartDocumentTextDetection operation: "
        "DocumentLocation changed for token"
    )
    err.response = {
        "Error": {"Code": "IdempotentParameterMismatchException", "Message": "mismatch"}
    }
    return err


class TestBuildTextractClientToken(unittest.TestCase):
    def test_stable_for_same_document(self):
        first = build_textract_client_token("job1", "bucket", "a.pdf")
        second = build_textract_client_token("job1", "bucket", "a.pdf")
        self.assertEqual(first, second)

    def test_distinct_keys_sharing_one_job_id_use_distinct_tokens(self):
        first = build_textract_client_token(
            "job1", "bucket", "jobs/job1/original/file1.pdf"
        )
        second = build_textract_client_token(
            "job1", "bucket", "jobs/job1/original/file2.pdf"
        )
        self.assertNotEqual(first, second)

    def test_distinct_bucket_and_version_change_token(self):
        base = build_textract_client_token("job1", "bucket-a", "a.pdf")
        other_bucket = build_textract_client_token("job1", "bucket-b", "a.pdf")
        versioned = build_textract_client_token(
            "job1", "bucket-a", "a.pdf", source_version="v2"
        )
        self.assertNotEqual(base, other_bucket)
        self.assertNotEqual(base, versioned)

    def test_token_fits_textract_limit(self):
        token = build_textract_client_token("job1", "bucket", "a.pdf")
        self.assertLessEqual(len(token), 64)
        self.assertGreater(len(token), 0)


class TestIsIdempotentParameterMismatch(unittest.TestCase):
    def test_detects_error_code(self):
        self.assertTrue(is_idempotent_parameter_mismatch(mismatch_error()))

    def test_detects_message_without_response(self):
        self.assertTrue(
            is_idempotent_parameter_mismatch(
                Exception("IdempotentParameterMismatch: token reused")
            )
        )

    def test_generic_errors_are_not_mismatch(self):
        self.assertFalse(is_idempotent_parameter_mismatch(Exception("Throttling")))
        self.assertFalse(is_idempotent_parameter_mismatch(Exception("")))


class TestStartTextractJobToken(unittest.TestCase):
    def test_uses_per_document_token_not_raw_job_id(self):
        with patch.object(pipeline, "textract") as mock_textract:
            mock_textract.start_document_text_detection.return_value = {
                "JobId": "textract-1"
            }
            job_id = start_textract_job("bucket", "jobs/job1/original/file1.pdf", "job1")
            self.assertEqual(job_id, "textract-1")
            _, kwargs = mock_textract.start_document_text_detection.call_args
            expected = build_textract_client_token(
                "job1", "bucket", "jobs/job1/original/file1.pdf"
            )
            self.assertEqual(kwargs["ClientRequestToken"], expected)
            self.assertNotEqual(kwargs["ClientRequestToken"], "job1")

    def test_different_keys_get_different_tokens(self):
        seen = []

        def fake_start(**kwargs):
            seen.append(kwargs["ClientRequestToken"])
            return {"JobId": f"textract-{len(seen)}"}

        with patch.object(pipeline, "textract") as mock_textract:
            mock_textract.start_document_text_detection.side_effect = fake_start
            start_textract_job("bucket", "file1.pdf", "shared-job")
            start_textract_job("bucket", "file2.pdf", "shared-job")
        self.assertEqual(len(seen), 2)
        self.assertNotEqual(seen[0], seen[1])

    def test_explicit_token_is_honored(self):
        with patch.object(pipeline, "textract") as mock_textract:
            mock_textract.start_document_text_detection.return_value = {
                "JobId": "textract-1"
            }
            start_textract_job(
                "bucket", "file1.pdf", "job1", client_request_token="explicit-token"
            )
            _, kwargs = mock_textract.start_document_text_detection.call_args
            self.assertEqual(kwargs["ClientRequestToken"], "explicit-token")

    def test_mismatch_is_reraised_not_swallowed(self):
        with patch.object(pipeline, "textract") as mock_textract:
            mock_textract.start_document_text_detection.side_effect = mismatch_error()
            with self.assertRaises(Exception) as ctx:
                start_textract_job("bucket", "file1.pdf", "job1")
            self.assertTrue(is_idempotent_parameter_mismatch(ctx.exception))

    def test_generic_start_failure_returns_none(self):
        with patch.object(pipeline, "textract") as mock_textract:
            mock_textract.start_document_text_detection.side_effect = Exception("boom")
            self.assertIsNone(start_textract_job("bucket", "file1.pdf", "job1"))


class TestProcessDocumentAsyncToken(unittest.TestCase):
    def test_retries_reuse_the_same_per_document_token(self):
        tokens = []
        real_build = build_textract_client_token

        def fake_build(job_id, bucket, key, version=None):
            token = real_build(job_id, bucket, key, version)
            tokens.append(token)
            return token

        with patch.object(
            pipeline, "build_textract_client_token", side_effect=fake_build
        ), patch.object(pipeline, "start_textract_job") as mock_start, patch.object(
            pipeline, "get_textract_results"
        ) as mock_results, patch.object(
            pipeline, "_save_ocr_output", return_value=True
        ), patch.object(
            pipeline.time, "sleep"
        ):
            mock_start.side_effect = [None, "textract-1"]
            mock_results.return_value = {
                "extracted_text": "text",
                "page_count": 1,
                "line_count": 1,
                "processing_cost": 0.0015,
            }
            ok = process_document_async("bucket", "file1.pdf", "job1")
            self.assertTrue(ok)
            # One derivation for the document; the retry reuses it.
            self.assertEqual(len(tokens), 1)
            self.assertEqual(mock_start.call_count, 2)
            first_token = mock_start.call_args_list[0][1]["client_request_token"]
            second_token = mock_start.call_args_list[1][1]["client_request_token"]
            self.assertEqual(first_token, second_token)
            self.assertEqual(first_token, tokens[0])

    def test_mismatch_does_not_retry_start(self):
        with patch.object(pipeline, "start_textract_job") as mock_start, patch.object(
            pipeline.time, "sleep"
        ) as mock_sleep:
            mock_start.side_effect = mismatch_error()
            ok = process_document_async("bucket", "file1.pdf", "job1")
            self.assertFalse(ok)
            self.assertEqual(mock_start.call_count, 1)
            mock_sleep.assert_not_called()

    def test_generic_start_exception_is_retried(self):
        with patch.object(pipeline, "start_textract_job") as mock_start, patch.object(
            pipeline, "get_textract_results"
        ) as mock_results, patch.object(
            pipeline, "_save_ocr_output", return_value=True
        ), patch.object(
            pipeline.time, "sleep"
        ):
            mock_start.side_effect = [Exception("throttled"), "textract-1"]
            mock_results.return_value = {
                "extracted_text": "text",
                "page_count": 1,
                "line_count": 1,
                "processing_cost": 0.0015,
            }
            self.assertTrue(process_document_async("bucket", "file1.pdf", "job1"))
            self.assertEqual(mock_start.call_count, 2)


if __name__ == "__main__":
    unittest.main()
