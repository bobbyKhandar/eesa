"""Standalone orchestrator must import the supported enrichment helpers.

pipeline_orchestrator.py is a documented CLI. It used to import helper names
that enrich_questions_s3_pipeline.py no longer defined, so single-file, batch,
and resume modes never reached their handlers. Upload takes a source identity,
not a bare filename.
"""

import importlib.util
import inspect
import json
import os
import shutil
import sys
import tempfile
import types
import unittest
from unittest.mock import MagicMock, patch


def _ensure_boto_stubs():
    """Orchestrator and enrichment build AWS clients at import."""
    try:
        import boto3  # noqa: F401
        import botocore.config  # noqa: F401
        return
    except ImportError:
        pass

    boto3_mod = types.ModuleType("boto3")
    boto3_mod.client = MagicMock(name="boto3.client")
    botocore_mod = types.ModuleType("botocore")
    config_mod = types.ModuleType("botocore.config")
    config_mod.Config = MagicMock(name="Config")
    botocore_mod.config = config_mod
    sys.modules.setdefault("boto3", boto3_mod)
    sys.modules.setdefault("botocore", botocore_mod)
    sys.modules.setdefault("botocore.config", config_mod)


def _load_module(name, filename):
    _ensure_boto_stubs()
    module_path = os.path.join(os.path.dirname(__file__), "..", "src", filename)
    spec = importlib.util.spec_from_file_location(name, module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load {name} from {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _load_enrichment():
    existing = sys.modules.get("enrich_questions_s3_pipeline")
    if existing is not None and hasattr(existing, "source_identity"):
        return existing
    return _load_module("enrich_questions_s3_pipeline", "enrich_questions_s3_pipeline.py")


def _load_orchestrator():
    existing = sys.modules.get("pipeline_orchestrator")
    if existing is not None and hasattr(existing, "main"):
        return existing

    textract = types.ModuleType("aws_texttract_pipeline")
    textract.process_document_async = MagicMock(name="process_document_async")
    sys.modules["aws_texttract_pipeline"] = textract
    _load_enrichment()
    return _load_module("pipeline_orchestrator", "pipeline_orchestrator.py")


pipeline = _load_enrichment()

PUBLIC_HELPERS = (
    "ensure_s3_bucket_exists",
    "enrich_single_file",
    "upload_enriched_to_s3",
    "load_state",
    "save_state",
)


class PublicHelperApiTests(unittest.TestCase):
    def test_supported_helpers_match_current_signatures(self):
        missing = [name for name in PUBLIC_HELPERS if not callable(getattr(pipeline, name, None))]
        self.assertEqual(missing, [])

        self.assertEqual(
            list(inspect.signature(pipeline.ensure_s3_bucket_exists).parameters),
            [],
        )
        self.assertEqual(list(inspect.signature(pipeline.load_state).parameters), [])
        self.assertEqual(
            list(inspect.signature(pipeline.save_state).parameters),
            ["state"],
        )
        self.assertEqual(
            list(inspect.signature(pipeline.enrich_single_file).parameters),
            ["file_path", "filename", "use_instructions"],
        )
        self.assertEqual(
            list(inspect.signature(pipeline.upload_enriched_to_s3).parameters),
            ["enriched_data", "source_id"],
        )

    def test_public_upload_writes_the_source_identity_key(self):
        temp_dir = tempfile.mkdtemp()
        try:
            path = os.path.join(temp_dir, "questions.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump({"exams": []}, handle)
            identity = pipeline.source_identity(temp_dir, path)
            with patch.object(pipeline, "s3_client") as s3_client:
                uploaded = pipeline.upload_enriched_to_s3({"exams": []}, identity)
        finally:
            shutil.rmtree(temp_dir)

        self.assertTrue(uploaded)
        self.assertEqual(
            s3_client.put_object.call_args.kwargs["Key"],
            pipeline.enriched_output_key(identity),
        )
        self.assertNotEqual(
            s3_client.put_object.call_args.kwargs["Key"],
            "enriched_questions/questions_enriched.json",
        )


class OrchestratorImportTests(unittest.TestCase):
    def test_orchestrator_imports_the_public_helpers(self):
        try:
            orchestrator = _load_orchestrator()
        except ImportError as exc:
            self.fail(f"pipeline_orchestrator import failed: {exc}")

        enrichment = sys.modules["enrich_questions_s3_pipeline"]
        for name in PUBLIC_HELPERS:
            self.assertIs(getattr(orchestrator, name), getattr(enrichment, name))
        self.assertIs(orchestrator.source_identity, enrichment.source_identity)


class OrchestratorCliDispatchTests(unittest.TestCase):
    def setUp(self):
        try:
            self.orchestrator = _load_orchestrator()
        except ImportError as exc:
            self.fail(f"pipeline_orchestrator import failed: {exc}")

    def test_single_file_mode_reaches_handler(self):
        pdf = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
        pdf.close()
        try:
            with patch.object(self.orchestrator, "process_single_document") as handler:
                code = self.orchestrator.main(["pipeline_orchestrator.py", pdf.name])
            self.assertEqual(code, 0)
            handler.assert_called_once_with(pdf.name)
        finally:
            os.unlink(pdf.name)

    def test_batch_mode_reaches_handler(self):
        with patch.object(self.orchestrator, "process_batch") as handler:
            code = self.orchestrator.main(
                ["pipeline_orchestrator.py", "batch", "/tmp/papers", "2"]
            )
        self.assertEqual(code, 0)
        handler.assert_called_once_with("/tmp/papers", 2)

    def test_batch_mode_without_limit_reaches_handler(self):
        with patch.object(self.orchestrator, "process_batch") as handler:
            code = self.orchestrator.main(
                ["pipeline_orchestrator.py", "batch", "/tmp/papers"]
            )
        self.assertEqual(code, 0)
        handler.assert_called_once_with("/tmp/papers", None)

    def test_resume_mode_reaches_handler(self):
        with patch.object(self.orchestrator, "resume_failed_jobs") as handler:
            code = self.orchestrator.main(["pipeline_orchestrator.py", "resume"])
        self.assertEqual(code, 0)
        handler.assert_called_once_with()


class OrchestratorSourceIdentityTests(unittest.TestCase):
    def setUp(self):
        try:
            self.orchestrator = _load_orchestrator()
        except ImportError as exc:
            self.fail(f"pipeline_orchestrator import failed: {exc}")
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def _write_parsed(self, name="paper.json"):
        path = os.path.join(self.temp_dir, name)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(
                {
                    "exams": [
                        {
                            "subject": "Physics",
                            "questions": [{"question_text": "Define force"}],
                        }
                    ]
                },
                handle,
            )
        return path

    def test_single_document_uploads_with_source_identity(self):
        parsed_file = self._write_parsed()
        identity = pipeline.source_identity(self.temp_dir, parsed_file)
        pdf_path = os.path.join(self.temp_dir, "paper.pdf")

        with patch.object(self.orchestrator, "parsed_questions_dir", return_value=self.temp_dir), \
             patch.object(self.orchestrator, "upload_pdf_to_s3", return_value="jobs/1/original/paper.pdf"), \
             patch.object(self.orchestrator, "process_document_async", return_value=True), \
             patch.object(self.orchestrator, "download_ocr_output", return_value=None), \
             patch.object(self.orchestrator, "save_job_metadata", return_value=True), \
             patch.object(
                 self.orchestrator,
                 "enrich_single_file",
                 return_value={"exams": [{"questions": []}]},
             ) as enrich, \
             patch.object(self.orchestrator, "upload_enriched_to_s3", return_value=True) as upload:
            result = self.orchestrator.process_single_document(pdf_path, job_id="job-1")

        self.assertEqual(result["status"], "success")
        enrich.assert_called_once_with(parsed_file, "paper.json", use_instructions=True)
        upload.assert_called_once()
        self.assertEqual(upload.call_args.args[1], identity)
        self.assertNotEqual(upload.call_args.args[1], "paper.json")

    def test_resume_retries_failed_source_identity(self):
        parsed_file = self._write_parsed("exam.json")
        identity = pipeline.source_identity(self.temp_dir, parsed_file)
        state = {
            "processed": [],
            "failed": [identity],
            "retry_counts": {identity: 1},
        }

        with patch.object(self.orchestrator, "parsed_questions_dir", return_value=self.temp_dir), \
             patch.object(self.orchestrator, "load_state", return_value=state), \
             patch.object(self.orchestrator, "save_state", return_value=True) as save, \
             patch.object(
                 self.orchestrator,
                 "enrich_single_file",
                 return_value={"exams": []},
             ) as enrich, \
             patch.object(self.orchestrator, "upload_enriched_to_s3", return_value=True) as upload:
            self.orchestrator.resume_failed_jobs()

        enrich.assert_called_once_with(parsed_file, "exam.json", use_instructions=False)
        self.assertEqual(upload.call_args.args[1], identity)
        self.assertIn(identity, state["processed"])
        self.assertNotIn(identity, state["failed"])
        self.assertNotIn(identity, state["retry_counts"])
        save.assert_called_once_with(state)

    def test_resume_does_not_upload_an_unscoped_basename(self):
        self._write_parsed("exam.json")
        state = {
            "processed": [],
            "failed": ["exam.json"],
            "retry_counts": {"exam.json": 1},
        }

        with patch.object(self.orchestrator, "parsed_questions_dir", return_value=self.temp_dir), \
             patch.object(self.orchestrator, "load_state", return_value=state), \
             patch.object(self.orchestrator, "save_state", return_value=True), \
             patch.object(self.orchestrator, "enrich_single_file") as enrich, \
             patch.object(self.orchestrator, "upload_enriched_to_s3") as upload:
            self.orchestrator.resume_failed_jobs()

        enrich.assert_not_called()
        upload.assert_not_called()
        self.assertNotIn("exam.json", state["failed"])
        self.assertIn("exam.json", state["legacy_unscoped_failed"])


if __name__ == "__main__":
    unittest.main()
