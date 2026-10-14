"""Batch processing options: validation, stage mapping, and propagation.

The local OCR pipeline used to store per-batch options and then ignore them.
These tests pin the fixed behavior: submission rejects options the pipeline
cannot honor, the batch passes its options to the file stage, and those options
reach the PDF, preprocessing, and OCR parameters.
"""

import os
import sys
import unittest
from unittest.mock import MagicMock, Mock, patch

from flask import Flask

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "src"))
# routes imports the api package, which constructs the server and boto3.
sys.modules.setdefault("boto3", MagicMock())
sys.modules.setdefault("botocore", MagicMock())
sys.modules.setdefault("botocore.config", MagicMock())

from api.routes import register_routes

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__))))

from src.pipeline_manager import PipelineManager
from src.processing_options import (
    ProcessingOptionsError,
    SUPPORTED_OPTIONS,
    ocr_options,
    pdf_render_options,
    preprocessing_options,
    validate_batch_options,
)
# ``api.routes`` is imported as a top-level package here, so it loads
# ``processing_options`` (not ``src.processing_options``) for the error class
# it catches. Import that same class so a route test raises what the route
# catches.
from processing_options import ProcessingOptionsError as RouteOptionsError


def _make_manager() -> PipelineManager:
    """A PipelineManager whose heavy OCR dependencies are doubles."""
    with patch("src.pipeline_manager.OCREngine"), \
         patch("src.pipeline_manager.ImageProcessor"), \
         patch("src.pipeline_manager.PDFHandler"):
        return PipelineManager()


class TestValidateBatchOptions(unittest.TestCase):
    """Submission accepts only options the pipeline honors."""

    def test_missing_options_are_valid(self):
        self.assertEqual(validate_batch_options(None), {})

    def test_empty_options_are_valid(self):
        self.assertEqual(validate_batch_options({}), {})

    def test_unsupported_option_is_rejected(self):
        with self.assertRaises(ProcessingOptionsError) as caught:
            validate_batch_options({"ocr_language": "en"})
        message = str(caught.exception)
        self.assertIn("ocr_language", message)
        self.assertIn("Unsupported processing options", message)
        for option in SUPPORTED_OPTIONS:
            self.assertIn(option, message)

    def test_options_must_be_an_object(self):
        for payload in ([], "dpi=300", 5):
            with self.assertRaises(ProcessingOptionsError):
                validate_batch_options(payload)

    def test_dpi_must_be_a_positive_integer(self):
        self.assertEqual(validate_batch_options({"dpi": 300})["dpi"], 300)
        for value in (0, -400, 1.5, True, "300", None):
            with self.assertRaises(ProcessingOptionsError):
                validate_batch_options({"dpi": value})

    def test_page_range_accepts_an_ordered_pair(self):
        self.assertEqual(validate_batch_options({"page_range": [1, 4]})["page_range"], [1, 4])
        self.assertEqual(validate_batch_options({"page_range": (0, 2)})["page_range"], [0, 2])
        for value in ([4, 1], [1, 1], [-1, 3], [1], ["1", 3], 3, [1.5, 3]):
            with self.assertRaises(ProcessingOptionsError):
                validate_batch_options({"page_range": value})

    def test_resize_bounds_must_be_positive_integers(self):
        for key in ("max_width", "max_height", "min_width", "min_height"):
            self.assertEqual(validate_batch_options({key: 1200})[key], 1200)
            with self.assertRaises(ProcessingOptionsError):
                validate_batch_options({key: 0})
            with self.assertRaises(ProcessingOptionsError):
                validate_batch_options({key: True})

    def test_boolean_options_reject_non_booleans(self):
        for key in ("skip_quality_analysis", "enhance_contrast", "denoise", "binarize"):
            self.assertIs(validate_batch_options({key: True})[key], True)
            self.assertIs(validate_batch_options({key: False})[key], False)
            for value in (1, 0, "true", None):
                with self.assertRaises(ProcessingOptionsError):
                    validate_batch_options({key: value})

    def test_confidence_threshold_stays_within_zero_and_one(self):
        self.assertEqual(validate_batch_options({"confidence_threshold": 0.9})["confidence_threshold"], 0.9)
        self.assertEqual(validate_batch_options({"confidence_threshold": 1})["confidence_threshold"], 1.0)
        for value in (-0.1, 1.1, "0.9", True, None):
            with self.assertRaises(ProcessingOptionsError):
                validate_batch_options({"confidence_threshold": value})

    def test_file_type_is_normalized_and_restricted(self):
        self.assertEqual(validate_batch_options({"file_type": "DOCX"})["file_type"], "docx")
        self.assertEqual(validate_batch_options({"file_type": " pdf "})["file_type"], "pdf")
        for value in ("txt", "", "   ", 5, None):
            with self.assertRaises(ProcessingOptionsError):
                validate_batch_options({"file_type": value})

    def test_validated_options_keep_only_recognized_keys(self):
        options = {
            "dpi": 200,
            "page_range": [0, 1],
            "max_width": 1500,
            "max_height": 1500,
            "min_width": 300,
            "min_height": 300,
            "skip_quality_analysis": True,
            "enhance_contrast": True,
            "denoise": True,
            "binarize": True,
            "confidence_threshold": 0.8,
            "file_type": "pdf",
        }
        self.assertEqual(validate_batch_options(options), options)


class TestOptionMapping(unittest.TestCase):
    """Validated options map onto the parameters each stage reads."""

    def test_pdf_render_options_are_empty_without_pdf_keys(self):
        self.assertEqual(pdf_render_options({}), {})
        self.assertEqual(pdf_render_options(None), {})
        self.assertEqual(pdf_render_options({"confidence_threshold": 0.9}), {})

    def test_pdf_render_options_pass_dpi_and_page_span(self):
        render = pdf_render_options({"dpi": 200, "page_range": [1, 4], "denoise": True})
        self.assertEqual(render, {"dpi": 200, "page_range": (1, 4)})

    def test_preprocessing_options_pass_bounds_and_flags(self):
        mapped = preprocessing_options({
            "max_width": 1200,
            "max_height": 1200,
            "min_width": 600,
            "min_height": 600,
            "skip_quality_analysis": True,
        })
        self.assertEqual(mapped, {
            "max_width": 1200,
            "max_height": 1200,
            "min_width": 600,
            "min_height": 600,
            "skip_quality_analysis": True,
        })

    def test_preprocessing_options_map_onto_processor_parameters(self):
        mapped = preprocessing_options({"enhance_contrast": True, "denoise": True, "binarize": True})
        self.assertEqual(mapped, {
            "force_contrast": True,
            "force_denoise": True,
            "force_binarize": True,
        })

    def test_preprocessing_options_drop_non_preprocessing_keys(self):
        self.assertEqual(preprocessing_options({"dpi": 300, "confidence_threshold": 0.7}), {})

    def test_ocr_options_pass_the_confidence_threshold(self):
        self.assertEqual(ocr_options({"confidence_threshold": 0.9}), {"confidence_threshold": 0.9})
        self.assertEqual(ocr_options({"dpi": 300}), {})


class TestSubmitBatchValidatesOptions(unittest.TestCase):
    """The manager rejects a bad batch before it is queued."""

    def setUp(self):
        self.manager = _make_manager()

    @patch("src.pipeline_manager.redis_client")
    def test_submitted_options_are_stored_for_processing(self, mock_redis):
        batch_id = self.manager.submit_batch(
            ["/tmp/paper.pdf"], {"confidence_threshold": 0.9, "dpi": 150}
        )

        stored = mock_redis.hash_set.call_args_list[0][0]
        self.assertEqual(stored[0], f"batch:{batch_id}")
        self.assertEqual(stored[1], "metadata")
        self.assertEqual(stored[2]["options"], {"confidence_threshold": 0.9, "dpi": 150})
        self.assertEqual(self.manager.active_batches[batch_id].options,
                         {"confidence_threshold": 0.9, "dpi": 150})
        mock_redis.queue_push.assert_called_once()

    @patch("src.pipeline_manager.redis_client")
    def test_unsupported_option_never_reaches_redis(self, mock_redis):
        with self.assertRaises(ProcessingOptionsError) as caught:
            self.manager.submit_batch(["/tmp/paper.pdf"], {"sharpen": True})

        self.assertIn("sharpen", str(caught.exception))
        mock_redis.hash_set.assert_not_called()
        mock_redis.queue_push.assert_not_called()

    @patch("src.pipeline_manager.redis_client")
    def test_malformed_option_value_never_reaches_redis(self, mock_redis):
        with self.assertRaises(ProcessingOptionsError) as caught:
            self.manager.submit_batch(["/tmp/paper.pdf"], {"confidence_threshold": 1.5})

        self.assertIn("confidence_threshold", str(caught.exception))
        mock_redis.hash_set.assert_not_called()
        mock_redis.queue_push.assert_not_called()


class TestBatchProcessingAppliesOptions(unittest.TestCase):
    """File stages receive the batch options and map them to their parameters."""

    def setUp(self):
        self.manager = _make_manager()

    def _metadata(self, options):
        return {
            "batch_id": "batch-1",
            "file_locations": ["/tmp/paper.pdf"],
            "status": "pending",
            "total_files": 1,
            "processed_files": 0,
            "failed_files": 0,
            "options": options,
        }

    @patch("src.pipeline_manager.redis_client")
    def test_batch_options_flow_into_the_pdf_stage(self, mock_redis):
        options = {"confidence_threshold": 0.9, "dpi": 150, "enhance_contrast": True}
        mock_redis.hash_get_json.return_value = self._metadata(options)

        with patch.object(self.manager, "_process_pdf_file") as mock_process:
            mock_process.return_value = {
                "success": True,
                "status": "success",
                "total_pages": 1,
                "successful_pages": 1,
            }
            self.manager._process_single_batch("batch-1")

        mock_process.assert_called_once_with("/tmp/paper.pdf", "batch-1", options)

    @patch("src.pipeline_manager.redis_client")
    def test_normalized_file_type_routes_docx_before_the_pdf_stage(self, mock_redis):
        mock_redis.hash_get_json.return_value = self._metadata({"file_type": "DOCX"})

        with patch.object(self.manager, "_process_docx_file") as mock_docx, \
             patch.object(self.manager, "_process_pdf_file") as mock_pdf:
            mock_docx.return_value = {
                "success": True,
                "status": "success",
                "total_pages": 1,
                "successful_pages": 1,
            }
            self.manager._process_single_batch("batch-1")

        mock_docx.assert_called_once_with("/tmp/paper.pdf")
        mock_pdf.assert_not_called()

    @patch("src.pipeline_manager.redis_client")
    def test_stored_unsupported_option_fails_the_batch(self, mock_redis):
        mock_redis.hash_get_json.return_value = self._metadata({"ocr_language": "en"})

        self.manager._process_single_batch("batch-1")

        stored_statuses = [
            call[0][2].get("status") for call in mock_redis.hash_set.call_args_list
            if call[0][1] == "metadata"
        ]
        self.assertIn("failed", stored_statuses)
        stored_errors = [
            message for call in mock_redis.hash_set.call_args_list
            if call[0][1] == "errors" for message in call[0][2]
        ]
        self.assertTrue(
            any("Unsupported processing options: ocr_language" in message
                for message in stored_errors),
            stored_errors,
        )

    @patch("src.pipeline_manager.redis_client")
    def test_pdf_stage_maps_options_onto_stage_parameters(self, mock_redis):
        self.manager.pdf_handler.validate_pdf = Mock(return_value={"valid": True, "errors": []})
        self.manager.pdf_handler.iter_pages = Mock(
            return_value=[{"page_number": 1, "image": "mock_image"}]
        )
        self.manager.image_processor.preprocess_image = Mock(return_value="processed_image")
        self.manager.ocr_engine.process_image = Mock(
            return_value={"success": True, "text": "Question 1", "confidence": 0.95}
        )

        result = self.manager._process_pdf_file("/tmp/paper.pdf", "batch-1", {
            "dpi": 150,
            "page_range": [1, 4],
            "max_width": 1200,
            "enhance_contrast": True,
            "confidence_threshold": 0.9,
        })

        self.assertTrue(result["success"])
        self.assertEqual(result["successful_pages"], 1)
        self.manager.pdf_handler.validate_pdf.assert_called_once_with("/tmp/paper.pdf", dpi=150)
        self.manager.pdf_handler.iter_pages.assert_called_once_with(
            "/tmp/paper.pdf", dpi=150, page_range=(1, 4)
        )
        self.manager.image_processor.preprocess_image.assert_called_once_with(
            "mock_image", {"max_width": 1200, "force_contrast": True}
        )
        self.manager.ocr_engine.process_image.assert_called_once_with(
            "processed_image", confidence_threshold=0.9
        )

    @patch("src.pipeline_manager.redis_client")
    def test_pdf_stage_keeps_stage_defaults_without_options(self, mock_redis):
        from src.pdf_handler import default_dpi

        self.manager.pdf_handler.validate_pdf = Mock(return_value={"valid": True, "errors": []})
        self.manager.pdf_handler.iter_pages = Mock(
            return_value=[{"page_number": 1, "image": "mock_image"}]
        )
        self.manager.image_processor.preprocess_image = Mock(return_value="processed_image")
        self.manager.ocr_engine.process_image = Mock(
            return_value={"success": True, "text": "Question 1", "confidence": 0.95}
        )

        self.assertTrue(self.manager._process_pdf_file("/tmp/paper.pdf")["success"])

        self.manager.pdf_handler.iter_pages.assert_called_once_with(
            "/tmp/paper.pdf", dpi=default_dpi(), page_range=None
        )
        self.manager.image_processor.preprocess_image.assert_called_once_with("mock_image", {})
        self.manager.ocr_engine.process_image.assert_called_once_with("processed_image")


TOKEN = "processing-options-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


class TestSubmitLocalRouteRejectsBadOptions(unittest.TestCase):
    """``POST /submit-local`` answers 400 for options the pipeline cannot honor."""

    def setUp(self):
        self.app = Flask(__name__)
        self.app.config["TESTING"] = True
        self.aws = Mock()
        self.aws.is_aws_available.return_value = True
        self.aws.s3_bucket = "test-bucket"
        self.aws.s3_jobs_prefix = "jobs/"
        self.aws.get_active_jobs_count.return_value = 0
        self.aws.get_active_jobs.return_value = []
        self.pipeline = Mock()
        self.pipeline.is_running = False
        self.pipeline.submit_batch.return_value = "batch-1"
        register_routes(self.app, self.aws, self.pipeline)
        self.client = self.app.test_client()
        self._env = patch.dict(os.environ, {"AI_PIPELINE_TOKEN": TOKEN}, clear=False)
        self._env.start()

    def tearDown(self):
        self._env.stop()

    def test_unsupported_option_is_a_client_error(self):
        self.pipeline.submit_batch.side_effect = RouteOptionsError(
            "Unsupported processing options: sharpen. Supported options: binarize"
        )

        response = self.client.post(
            "/submit-local",
            json={"file_locations": ["/tmp/paper.pdf"], "options": {"sharpen": True}},
            headers=AUTH,
        )

        self.assertEqual(response.status_code, 400)
        body = response.get_json()
        self.assertFalse(body["success"])
        self.assertIn("Unsupported processing options: sharpen", body["error"])

    def test_malformed_option_value_is_a_client_error(self):
        self.pipeline.submit_batch.side_effect = RouteOptionsError(
            "Option 'confidence_threshold' must be a number between 0 and 1, got 2"
        )

        response = self.client.post(
            "/submit-local",
            json={"file_locations": ["/tmp/paper.pdf"], "options": {"confidence_threshold": 2}},
            headers=AUTH,
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("confidence_threshold", response.get_json()["error"])

    def test_supported_options_are_forwarded_and_accepted(self):
        options = {"confidence_threshold": 0.9, "dpi": 150, "file_type": "pdf"}

        response = self.client.post(
            "/submit-local",
            json={"file_locations": ["/tmp/paper.pdf"], "options": options},
            headers=AUTH,
        )

        self.assertEqual(response.status_code, 202)
        body = response.get_json()
        self.assertTrue(body["success"])
        self.assertEqual(body["batch_id"], "batch-1")
        self.assertEqual(body["files_queued"], 1)
        self.pipeline.submit_batch.assert_called_once_with(["/tmp/paper.pdf"], options)

    def test_missing_files_still_rejected_before_submission(self):
        response = self.client.post(
            "/submit-local", json={"file_locations": [], "options": {"sharpen": True}}, headers=AUTH
        )

        self.assertEqual(response.status_code, 400)
        self.pipeline.submit_batch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
