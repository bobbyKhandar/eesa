"""A manual upload must not report success when the job cannot be saved.

UploadProcessor.add_files used to upload to S3 and then call
DatabaseManager.add_job without checking its return value. add_job returns
False when the insert fails, so the file was counted as "added" while no job
row existed: OCR never picked it up and the S3 object was orphaned.

Success now requires a durable job row. When the insert fails, the uploaded
object is deleted (best effort) and results["errors"] carries the source
path and S3 key so the failure is actionable.
"""

import importlib.util
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock


def _ensure_boto_stubs():
    """manual_pipeline builds AWS clients at import. Stub them when absent."""
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


def _load_manual_pipeline():
    """Load the CLI pipeline without importing src/__init__.py."""
    _ensure_boto_stubs()
    module_path = os.path.join(
        os.path.dirname(__file__), "..", "src", "manual_pipeline.py"
    )
    spec = importlib.util.spec_from_file_location("manual_pipeline", module_path)
    if spec is None or spec.loader is None:
        raise ImportError("Cannot load manual pipeline from manual_pipeline.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["manual_pipeline"] = module
    spec.loader.exec_module(module)
    return module


_pipeline = _load_manual_pipeline()
DatabaseManager = _pipeline.DatabaseManager
S3Manager = _pipeline.S3Manager
UploadProcessor = _pipeline.UploadProcessor


class _FakeS3:
    """Duck-typed S3Manager replacement that records compensation calls."""

    def __init__(self, upload_result=(True, "manual_pipeline/job/original/paper.pdf"),
                 delete_result=(True, "")):
        self.bucket = "test-bucket"
        self.prefix = "manual_pipeline/"
        self.upload_calls = []
        self.delete_calls = []
        self._upload_result = upload_result
        self._delete_result = delete_result

    def upload_pdf(self, local_path, job_id, stored_name=None):
        self.upload_calls.append((local_path, job_id, stored_name))
        return self._upload_result

    def delete_object(self, s3_key):
        self.delete_calls.append(s3_key)
        return self._delete_result


class _DbFailureDatabaseManager(DatabaseManager):
    """A real manager whose add_job always reports a failed insert."""

    def __init__(self, db_path):
        super().__init__(db_path)

    def add_job(self, job) -> bool:
        return False


class UploadPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self._saved_paths = {
            "DATA_DIR": _pipeline.DATA_DIR,
            "DB_PATH": _pipeline.DB_PATH,
            "ERRORS_DIR": _pipeline.ERRORS_DIR,
            "EXPORTS_DIR": _pipeline.EXPORTS_DIR,
            "LOGS_DIR": _pipeline.LOGS_DIR,
        }
        _pipeline.DATA_DIR = root
        _pipeline.DB_PATH = root / "pipeline.db"
        _pipeline.ERRORS_DIR = root / "errors"
        _pipeline.EXPORTS_DIR = root / "exports"
        _pipeline.LOGS_DIR = root / "logs"
        self.addCleanup(self._restore_paths)

        self.pdf = root / "papers" / "2024" / "it.pdf"
        self.pdf.parent.mkdir(parents=True)
        self.pdf.write_bytes(b"%PDF-1.4 fake")
        self.s3 = _FakeS3()
        self.db = DatabaseManager(_pipeline.DB_PATH)

    def _restore_paths(self):
        for name, value in self._saved_paths.items():
            setattr(_pipeline, name, value)

    def _add_files(self):
        processor = UploadProcessor(self.db, self.s3)
        return processor.add_files([self.pdf], batch_id="batch-test")

    def test_success_is_counted_only_after_the_job_row_exists(self):
        results = self._add_files()

        self.assertEqual(results["added"], 1)
        self.assertEqual(results["errors"], [])
        self.assertEqual(self.s3.delete_calls, [])
        self.assertEqual(len(self.s3.upload_calls), 1)

    def test_a_real_database_failure_is_not_counted_as_added(self):
        # Point the DB at a directory so sqlite3.connect fails for real and
        # add_job returns False.
        self.db.db_path = self.tmp.name + "/db-as-a-directory"
        os.mkdir(self.db.db_path)

        results = self._add_files()

        self.assertEqual(results["added"], 0)
        self.assertEqual(len(results["errors"]), 1)
        error = results["errors"][0]
        self.assertIn(str(self.pdf), error)
        self.assertIn("manual_pipeline/job/original/paper.pdf", error)
        self.assertIn("deleted the uploaded object", error)
        self.assertIn("re-run upload to retry", error)
        self.assertEqual(
            self.s3.delete_calls, ["manual_pipeline/job/original/paper.pdf"]
        )

    def test_tracking_failure_deletes_the_uploaded_object(self):
        self.db = _DbFailureDatabaseManager(_pipeline.DB_PATH)

        results = self._add_files()

        self.assertEqual(results["added"], 0)
        self.assertEqual(self.s3.delete_calls, ["manual_pipeline/job/original/paper.pdf"])
        self.assertEqual(len(results["errors"]), 1)
        error = results["errors"][0]
        self.assertIn(str(self.pdf), error)
        self.assertIn("manual_pipeline/job/original/paper.pdf", error)
        self.assertIn("re-run upload to retry", error)

    def test_failed_compensation_asks_for_manual_cleanup(self):
        self.db = _DbFailureDatabaseManager(_pipeline.DB_PATH)
        self.s3 = _FakeS3(delete_result=(False, "AccessDenied"))

        results = self._add_files()

        self.assertEqual(results["added"], 0)
        self.assertEqual(self.s3.delete_calls, ["manual_pipeline/job/original/paper.pdf"])
        self.assertEqual(len(results["errors"]), 1)
        error = results["errors"][0]
        self.assertIn(str(self.pdf), error)
        self.assertIn("manual_pipeline/job/original/paper.pdf", error)
        self.assertIn("Delete it manually", error)
        self.assertIn("AccessDenied", error)
        self.assertIn("re-run upload to retry", error)

    def test_upload_failure_is_reported_without_tracking_attempts(self):
        self.s3 = _FakeS3(upload_result=(False, "bucket unreachable"))

        results = self._add_files()

        self.assertEqual(results["added"], 0)
        self.assertEqual(self.s3.delete_calls, [])
        self.assertEqual(len(results["errors"]), 1)
        self.assertIn("Upload failed", results["errors"][0])
        self.assertIn("bucket unreachable", results["errors"][0])


class S3DeleteObjectTests(unittest.TestCase):
    def setUp(self):
        self.manager = S3Manager()
        self.client = MagicMock(name="s3-client")
        self.manager.s3 = self.client

    def test_delete_object_returns_success(self):
        ok, error = self.manager.delete_object("manual_pipeline/job/original/paper.pdf")

        self.assertTrue(ok)
        self.assertEqual(error, "")
        self.client.delete_object.assert_called_once_with(
            Bucket=self.manager.bucket,
            Key="manual_pipeline/job/original/paper.pdf",
        )

    def test_delete_object_reports_client_failure(self):
        self.client.delete_object.side_effect = Exception("AccessDenied")

        ok, error = self.manager.delete_object("manual_pipeline/job/original/paper.pdf")

        self.assertFalse(ok)
        self.assertIn("AccessDenied", error)


if __name__ == "__main__":
    unittest.main()
