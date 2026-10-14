"""Non-positive batch sizes must not drop the job query limit.

PhaseProcessor.process_batch used to pass batch_size, including zero, straight
to DatabaseManager.get_jobs_by_phase. That method added a SQLite LIMIT only
when the value was truthy, and a negative LIMIT is unlimited in SQLite. Both
CLIs accepted any integer.
"""

import contextlib
import importlib.util
import io
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch


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


def _load_module(name, relative_path):
    _ensure_boto_stubs()
    module_path = os.path.join(os.path.dirname(__file__), relative_path)
    spec = importlib.util.spec_from_file_location(name, module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load {name} from {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


_pipeline = _load_module("manual_pipeline", os.path.join("..", "src", "manual_pipeline.py"))
_batch_runner = _load_module("batch_runner", os.path.join("..", "src", "batch_runner.py"))

DatabaseManager = _pipeline.DatabaseManager
Job = _pipeline.Job
Phase = _pipeline.Phase
PhaseProcessor = _pipeline.PhaseProcessor
Status = _pipeline.Status


class _RecordingProcessor(PhaseProcessor):
    def __init__(self, db):
        super().__init__(db, MagicMock())
        self.phase = Phase.OCR
        self.seen = []

    def process_job(self, job):
        self.seen.append((job.job_id, job.status))
        return True, "ok"


def _job(job_id, status, created_at):
    return Job(
        job_id=job_id,
        filename=f"{job_id}.pdf",
        file_hash=job_id,
        file_size=1,
        current_phase=Phase.OCR.value,
        status=status,
        created_at=created_at,
    )


class BatchLimitTests(unittest.TestCase):
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
        _batch_runner.DATA_DIR = root
        _batch_runner.PROGRESS_FILE = root / "batch_progress.json"
        self.addCleanup(self._restore_paths)
        self.db = DatabaseManager(_pipeline.DB_PATH)

    def _restore_paths(self):
        for name, value in self._saved_paths.items():
            setattr(_pipeline, name, value)

    def _add(self, job_id, status, created_at):
        self.assertTrue(self.db.add_job(_job(job_id, status, created_at)))

    def test_get_jobs_by_phase_rejects_missing_or_non_positive_limit(self):
        self._add("pending-1", Status.PENDING.value, "2026-01-01T00:00:00")
        self._add("pending-2", Status.PENDING.value, "2026-01-01T00:00:01")

        for limit in (None, 0, -1, -5):
            with self.subTest(limit=limit):
                with self.assertRaises(ValueError):
                    self.db.get_jobs_by_phase(
                        Phase.OCR.value,
                        status=Status.PENDING.value,
                        limit=limit,
                    )
                self.assertEqual(
                    self.db.get_job("pending-1").status,
                    Status.PENDING.value,
                )

    def test_get_jobs_by_phase_uses_a_finite_limit(self):
        for index in range(5):
            self._add(
                f"pending-{index}",
                Status.PENDING.value,
                f"2026-01-01T00:00:0{index}",
            )

        jobs = self.db.get_jobs_by_phase(
            Phase.OCR.value,
            status=Status.PENDING.value,
            limit=2,
        )

        self.assertEqual([job.job_id for job in jobs], ["pending-0", "pending-1"])

    def test_process_batch_rejects_non_positive_batch_size(self):
        self._add("pending-1", Status.PENDING.value, "2026-01-01T00:00:00")
        self._add("retry-1", Status.RETRY_PENDING.value, "2026-01-01T00:00:01")
        processor = _RecordingProcessor(self.db)

        for batch_size in (0, -1):
            with self.subTest(batch_size=batch_size):
                with self.assertRaises(ValueError):
                    processor.process_batch(batch_size=batch_size)
                self.assertEqual(processor.seen, [])
                self.assertEqual(
                    self.db.get_job("pending-1").status,
                    Status.PENDING.value,
                )
                self.assertEqual(
                    self.db.get_job("retry-1").status,
                    Status.RETRY_PENDING.value,
                )

    def test_process_batch_skips_retry_query_when_pending_fills_the_batch(self):
        self._add("pending-1", Status.PENDING.value, "2026-01-01T00:00:00")
        self._add("pending-2", Status.PENDING.value, "2026-01-01T00:00:01")
        self._add("retry-1", Status.RETRY_PENDING.value, "2026-01-01T00:00:02")
        self._add("retry-2", Status.RETRY_PENDING.value, "2026-01-01T00:00:03")
        calls = []
        original = self.db.get_jobs_by_phase

        def wrapped(phase, status=None, limit=None):
            calls.append((status, limit))
            return original(phase, status=status, limit=limit)

        self.db.get_jobs_by_phase = wrapped
        processor = _RecordingProcessor(self.db)

        result = processor.process_batch(batch_size=2)

        self.assertEqual(result["processed"], 2)
        self.assertEqual(
            [job_id for job_id, _status in processor.seen],
            ["pending-1", "pending-2"],
        )
        self.assertEqual(calls, [(Status.PENDING.value, 2)])
        self.assertEqual(
            self.db.get_job("retry-1").status,
            Status.RETRY_PENDING.value,
        )

    def test_process_batch_uses_only_remaining_capacity_for_retries(self):
        self._add("pending-1", Status.PENDING.value, "2026-01-01T00:00:00")
        self._add("retry-1", Status.RETRY_PENDING.value, "2026-01-01T00:00:01")
        self._add("retry-2", Status.RETRY_PENDING.value, "2026-01-01T00:00:02")
        processor = _RecordingProcessor(self.db)

        result = processor.process_batch(batch_size=2)

        self.assertEqual(result["processed"], 2)
        self.assertEqual(
            [job_id for job_id, _status in processor.seen],
            ["pending-1", "retry-1"],
        )
        self.assertEqual(
            self.db.get_job("retry-2").status,
            Status.RETRY_PENDING.value,
        )


class BatchSizeCliTests(unittest.TestCase):
    def _assert_argparse_rejects(self, module, argv):
        stderr = io.StringIO()
        previous = sys.argv
        sys.argv = argv
        try:
            with contextlib.redirect_stderr(stderr):
                with self.assertRaises(SystemExit) as caught:
                    module.main()
        finally:
            sys.argv = previous
        self.assertEqual(caught.exception.code, 2)
        message = stderr.getvalue().lower()
        self.assertIn("batch size", message)
        self.assertIn(">= 1", message)

    def test_positive_batch_size_accepts_positive_integers(self):
        self.assertIs(_batch_runner.positive_batch_size, _pipeline.positive_batch_size)
        self.assertEqual(_pipeline.positive_batch_size("1"), 1)
        self.assertEqual(_pipeline.positive_batch_size("10"), 10)

    def test_manual_cli_rejects_non_positive_batch_size(self):
        for value in ("0", "-1"):
            with self.subTest(value=value):
                self._assert_argparse_rejects(
                    _pipeline,
                    ["manual_pipeline.py", "ocr", "--batch-size", value],
                )

    def test_batch_runner_cli_rejects_non_positive_batch_size(self):
        for value in ("0", "-3"):
            with self.subTest(value=value):
                with patch("time.sleep", return_value=None):
                    self._assert_argparse_rejects(
                        _batch_runner,
                        [
                            "batch_runner.py",
                            "--phase",
                            "ocr",
                            "--batch-size",
                            value,
                        ],
                    )

if __name__ == "__main__":
    unittest.main()
