"""A handled Textract failure must not strand a manual OCR job.

OCRProcessor.process_job used to log a polling or result-pagination
exception and return False without touching the job row. process_batch had
already set the row to in_progress, so the job left the pending and
retry_pending selection, and the only retry for a single job used
error_phase, which those paths never wrote.

Every unsuccessful result now funnels through
PhaseProcessor.record_failure, the batch records a returned failure the
processor did not record itself, a single-job retry validates its target
phase, and a stale in_progress row is reclaimed instead of stranded.
"""

import importlib.util
import io
import os
import sqlite3
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta
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
Job = _pipeline.Job
OCRProcessor = _pipeline.OCRProcessor
Phase = _pipeline.Phase
PhaseProcessor = _pipeline.PhaseProcessor
Status = _pipeline.Status

ORIGINAL_KEY = "manual_pipeline/job-1/original/paper.pdf"


class _FakeS3:
    """Duck-typed S3Manager that only answers file_exists."""

    def file_exists(self, s3_key):
        return True


class _FakeTextract:
    """Textract client whose calls fail on a chosen call."""

    def __init__(self, fail_on="poll"):
        self.fail_on = fail_on
        self.calls = []

    def start_document_text_detection(self, **_kwargs):
        return {"JobId": "textract-job-1"}

    def get_document_text_detection(self, **_kwargs):
        self.calls.append(1)
        if self.fail_on == "poll" and len(self.calls) == 1:
            raise RuntimeError("network unreachable")
        if self.fail_on == "results" and len(self.calls) > 1:
            raise RuntimeError("results pagination failed")
        return {"JobStatus": "SUCCEEDED", "Blocks": []}


class _NeverRecordingProcessor(PhaseProcessor):
    """Processor that returns False without recording any failure."""

    def __init__(self, db):
        super().__init__(db, MagicMock())
        self.phase = Phase.OCR
        self.seen = []

    def process_job(self, job):
        self.seen.append(job.job_id)
        return False, "some failure"


class _RecordingThenFailingProcessor(PhaseProcessor):
    """Processor that records its own failure and then returns False."""

    def __init__(self, db):
        super().__init__(db, MagicMock())
        self.phase = Phase.OCR

    def process_job(self, job):
        self.record_failure(job, "some failure", "RecordedByProcessor")
        return False, "some failure"


class _ExplodingProcessor(PhaseProcessor):
    """Processor that raises before returning anything."""

    def __init__(self, db):
        super().__init__(db, MagicMock())
        self.phase = Phase.OCR

    def process_job(self, job):
        raise RuntimeError("processor crashed")


class _SucceedingProcessor(PhaseProcessor):
    def __init__(self, db):
        super().__init__(db, MagicMock())
        self.phase = Phase.OCR
        self.seen = []

    def process_job(self, job):
        self.seen.append(job.job_id)
        return True, "ok"


class _PipelineTestCase(unittest.TestCase):
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
        self.db = DatabaseManager(_pipeline.DB_PATH)

    def _restore_paths(self):
        for name, value in self._saved_paths.items():
            setattr(_pipeline, name, value)

    def _job(self, job_id="job-1", status=Status.PENDING.value,
             current_phase=Phase.OCR.value, error_phase="", retry_count=0,
             updated_at=""):
        return Job(
            job_id=job_id,
            filename="paper.pdf",
            file_hash=job_id,
            file_size=1,
            current_phase=current_phase,
            status=status,
            s3_original_key=ORIGINAL_KEY,
            error_phase=error_phase,
            retry_count=retry_count,
            created_at="2026-01-01T00:00:00",
            updated_at=updated_at,
        )

    def _add(self, job):
        self.assertTrue(self.db.add_job(job))
        return job

    def _error_rows(self, job_id):
        with sqlite3.connect(_pipeline.DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            return [
                dict(row)
                for row in conn.execute(
                    "SELECT * FROM error_log WHERE job_id = ?", (job_id,)
                )
            ]

    def _ocr_processor(self, fail_on="poll"):
        processor = OCRProcessor(self.db, _FakeS3())
        processor.textract = _FakeTextract(fail_on=fail_on)
        return processor

    def _assert_failed_in_ocr(self, job_id, message_fragment):
        stored = self.db.get_job(job_id)
        self.assertEqual(stored.status, Status.FAILED.value)
        self.assertEqual(stored.error_phase, Phase.OCR.value)
        self.assertIn(message_fragment, stored.error_message)
        self.assertEqual(stored.retry_count, 1)
        # The job is selectable again as a failure ...
        self.assertEqual(
            [job.job_id for job in self.db.get_failed_jobs(phase=Phase.OCR.value)],
            [job_id],
        )
        self.assertEqual(
            [
                job.job_id
                for job in self.db.get_jobs_by_phase(
                    Phase.OCR.value, status=Status.FAILED.value, limit=10
                )
            ],
            [job_id],
        )
        # ... and by the phase selection, so it is no longer stuck in_progress.
        self.assertEqual(
            self.db.get_jobs_by_phase(
                Phase.OCR.value, status=Status.IN_PROGRESS.value, limit=10
            ),
            [],
        )
        return stored


class HandledTextractErrorTests(_PipelineTestCase):
    def test_poll_exception_records_a_durable_failure(self):
        job = self._job()
        self._add(job)
        self.db.update_job(job.job_id, status=Status.IN_PROGRESS.value)
        processor = self._ocr_processor(fail_on="poll")

        success, message = processor.process_job(job)

        self.assertFalse(success)
        self.assertIn("Textract poll error", message)
        stored = self._assert_failed_in_ocr(job.job_id, "Textract poll error")
        self.assertIn("network unreachable", stored.error_message)

        rows = self._error_rows(job.job_id)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["error_type"], "TextractPollError")
        self.assertEqual(rows[0]["phase"], Phase.OCR.value)
        self.assertEqual(rows[0]["retry_attempt"], 1)
        error_file = _pipeline.ERRORS_DIR / Phase.OCR.value / f"{job.job_id}_1.json"
        self.assertTrue(error_file.exists())

        # retry-errors picks the job up again instead of leaving it stranded.
        self.assertEqual(self.db.bulk_mark_for_retry(Phase.OCR.value), 1)
        self.assertEqual(
            self.db.get_job(job.job_id).status, Status.RETRY_PENDING.value
        )

    def test_result_pagination_exception_records_a_durable_failure(self):
        job = self._job()
        self._add(job)
        self.db.update_job(job.job_id, status=Status.IN_PROGRESS.value)
        processor = self._ocr_processor(fail_on="results")

        success, message = processor.process_job(job)

        self.assertFalse(success)
        self.assertIn("Error getting results", message)
        self._assert_failed_in_ocr(job.job_id, "Error getting results")

        rows = self._error_rows(job.job_id)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["error_type"], "TextractResultsError")
        self.assertEqual(rows[0]["retry_attempt"], 1)

    def test_textract_start_failure_records_a_durable_failure(self):
        job = self._job()
        self._add(job)
        processor = self._ocr_processor()
        processor.textract = MagicMock()
        processor.textract.start_document_text_detection.side_effect = RuntimeError(
            "throttled"
        )

        success, message = processor.process_job(job)

        self.assertFalse(success)
        self.assertIn("Textract start failed", message)
        self._assert_failed_in_ocr(job.job_id, "Textract start failed")


class ProcessBatchFailureTransitionTests(_PipelineTestCase):
    def test_returned_failure_without_a_recorded_transition_fails_the_job(self):
        job = self._add(self._job("job-1"))
        processor = _NeverRecordingProcessor(self.db)

        results = processor.process_batch(batch_size=1)

        self.assertEqual(results["processed"], 1)
        self.assertEqual(results["failed"], 1)
        self.assertEqual(processor.seen, [job.job_id])
        self._assert_failed_in_ocr(job.job_id, "some failure")

    def test_returned_failure_already_recorded_is_written_once(self):
        self._add(self._job("job-1"))
        processor = _RecordingThenFailingProcessor(self.db)

        results = processor.process_batch(batch_size=1)

        self.assertEqual(results["failed"], 1)
        stored = self.db.get_job("job-1")
        self.assertEqual(stored.status, Status.FAILED.value)
        self.assertEqual(stored.error_message, "some failure")
        self.assertEqual(stored.retry_count, 1)
        self.assertEqual(len(self._error_rows("job-1")), 1)
        self.assertEqual(self._error_rows("job-1")[0]["error_type"], "RecordedByProcessor")

    def test_exception_in_a_batch_fails_the_job(self):
        self._add(self._job("job-1"))
        processor = _ExplodingProcessor(self.db)

        results = processor.process_batch(batch_size=1)

        self.assertEqual(results["processed"], 1)
        self.assertEqual(results["failed"], 1)
        self.assertEqual(results["jobs"][0]["status"], "error")
        self._assert_failed_in_ocr("job-1", "processor crashed")
        rows = self._error_rows("job-1")
        self.assertEqual(rows[0]["error_type"], "RuntimeError")
        self.assertEqual(rows[0]["retry_attempt"], 1)

    def test_a_logging_failure_does_not_block_the_status_transition(self):
        self._add(self._job("job-1"))

        def boom(**_kwargs):
            raise OSError("error directory unwritable")

        self.db.log_error = boom
        processor = _NeverRecordingProcessor(self.db)

        with redirect_stdout(io.StringIO()):
            processor.process_batch(batch_size=1)

        self.assertEqual(self.db.get_job("job-1").status, Status.FAILED.value)

    def test_a_retry_in_a_later_batch_records_its_own_failure(self):
        self._add(self._job("job-1"))
        processor = _NeverRecordingProcessor(self.db)

        processor.process_batch(batch_size=1)
        self.assertEqual(self.db.get_job("job-1").retry_count, 1)
        # Only a job marked for retry is selected again.
        self.assertEqual(processor.process_batch(batch_size=1)["processed"], 0)
        self.db.mark_for_retry("job-1", Phase.OCR.value)
        processor.process_batch(batch_size=1)

        stored = self.db.get_job("job-1")
        self.assertEqual(stored.status, Status.FAILED.value)
        self.assertEqual(stored.retry_count, 2)
        self.assertEqual(len(self._error_rows("job-1")), 2)


class StaleInProgressReclaimTests(_PipelineTestCase):
    def test_reclaim_returns_a_stale_in_progress_job_to_pending(self):
        stale = self._add(
            self._job("stale-1", status=Status.IN_PROGRESS.value,
                      updated_at=(datetime.now() - timedelta(hours=2)).isoformat())
        )
        fresh = self._add(
            self._job("fresh-1", status=Status.IN_PROGRESS.value,
                      updated_at=datetime.now().isoformat())
        )

        reclaimed = self.db.reclaim_stale_in_progress(Phase.OCR.value)

        self.assertEqual(reclaimed, 1)
        self.assertEqual(
            self.db.get_job(stale.job_id).status, Status.PENDING.value
        )
        self.assertEqual(
            self.db.get_job(fresh.job_id).status, Status.IN_PROGRESS.value
        )

    def test_reclaim_ignores_other_phases_and_statuses(self):
        pending = self._add(
            self._job("pending-1",
                      updated_at=(datetime.now() - timedelta(hours=2)).isoformat())
        )
        other_phase = self._add(
            self._job("parse-1", current_phase=Phase.PARSE.value,
                      status=Status.IN_PROGRESS.value,
                      updated_at=(datetime.now() - timedelta(hours=2)).isoformat())
        )
        failed = self._add(
            self._job("failed-1", status=Status.FAILED.value,
                      updated_at=(datetime.now() - timedelta(hours=2)).isoformat())
        )

        self.assertEqual(self.db.reclaim_stale_in_progress(Phase.OCR.value), 0)
        self.assertEqual(self.db.get_job(pending.job_id).status, Status.PENDING.value)
        self.assertEqual(
            self.db.get_job(other_phase.job_id).status, Status.IN_PROGRESS.value
        )
        self.assertEqual(self.db.get_job(failed.job_id).status, Status.FAILED.value)

    def test_reclaim_rejects_unknown_phase_and_non_positive_age(self):
        self._add(self._job("stale-1", status=Status.IN_PROGRESS.value,
                            updated_at=(datetime.now() - timedelta(hours=2)).isoformat()))

        for bad_phase in (None, "", "upload", "complete", "nope"):
            with self.subTest(phase=bad_phase):
                with self.assertRaises(ValueError):
                    self.db.reclaim_stale_in_progress(bad_phase)

        for bad_age in (None, 0, -1):
            with self.subTest(age=bad_age):
                with self.assertRaises(ValueError):
                    self.db.reclaim_stale_in_progress(Phase.OCR.value, bad_age)

        self.assertEqual(
            self.db.get_job("stale-1").status, Status.IN_PROGRESS.value
        )

    def test_process_batch_processes_a_reclaimed_job(self):
        self._add(
            self._job("stale-1", status=Status.IN_PROGRESS.value,
                      updated_at=(datetime.now() - timedelta(hours=2)).isoformat())
        )
        self._add(
            self._job("fresh-1", status=Status.IN_PROGRESS.value,
                      updated_at=datetime.now().isoformat())
        )
        processor = _SucceedingProcessor(self.db)

        results = processor.process_batch(batch_size=10)

        self.assertEqual(processor.seen, ["stale-1"])
        self.assertEqual(results["processed"], 1)
        self.assertEqual(results["success"], 1)
        self.assertEqual(
            self.db.get_job("fresh-1").status, Status.IN_PROGRESS.value
        )

    def test_batch_runner_counts_a_reclaimed_job_as_pending(self):
        self._add(
            self._job("stale-1", status=Status.IN_PROGRESS.value,
                      updated_at=(datetime.now() - timedelta(hours=2)).isoformat())
        )
        self.db.reclaim_stale_in_progress(Phase.OCR.value)

        pending = self.db.get_jobs_by_phase(
            Phase.OCR.value, status=Status.PENDING.value, limit=1
        )

        self.assertEqual([job.job_id for job in pending], ["stale-1"])


class RetryTargetValidationTests(_PipelineTestCase):
    def test_normalize_retry_phase_accepts_only_processor_phases(self):
        for phase in _pipeline.RETRYABLE_PHASES:
            with self.subTest(phase=phase):
                self.assertEqual(_pipeline.normalize_retry_phase(phase), phase)
                self.assertEqual(_pipeline.normalize_retry_phase(phase.upper()), phase)

        for phase in (None, "", "   ", "upload", "complete", "unknown"):
            with self.subTest(invalid=phase):
                with self.assertRaises(ValueError):
                    _pipeline.normalize_retry_phase(phase)

    def test_retry_target_phase_prefers_a_valid_error_phase(self):
        self.assertEqual(
            _pipeline.retry_target_phase(
                self._job(error_phase="parse", current_phase="ocr")
            ),
            "parse",
        )

    def test_retry_target_phase_falls_back_to_the_current_phase(self):
        self.assertEqual(
            _pipeline.retry_target_phase(self._job(current_phase="enrich")),
            "enrich",
        )

    def test_retry_target_phase_is_none_when_no_phase_is_retryable(self):
        self.assertIsNone(
            _pipeline.retry_target_phase(
                self._job(current_phase="upload", error_phase="complete")
            )
        )
        self.assertIsNone(
            _pipeline.retry_target_phase(self._job(current_phase="upload"))
        )

    def test_mark_for_retry_rejects_a_target_no_processor_owns(self):
        job = self._add(self._job("job-1", status=Status.FAILED.value))

        for phase in (None, "", "upload", "complete"):
            with self.subTest(phase=phase):
                with self.assertRaises(ValueError):
                    self.db.mark_for_retry(job.job_id, phase)

        stored = self.db.get_job(job.job_id)
        self.assertEqual(stored.status, Status.FAILED.value)
        self.assertEqual(stored.current_phase, Phase.OCR.value)

    def test_bulk_mark_for_retry_rejects_an_unknown_phase(self):
        self._add(self._job("job-1", status=Status.FAILED.value,
                            error_phase=Phase.OCR.value))

        with self.assertRaises(ValueError):
            self.db.bulk_mark_for_retry("upload")

        self.assertEqual(self.db.get_job("job-1").status, Status.FAILED.value)

    def _run_retry_errors(self, argv):
        """Run retry-errors against the temporary database.

        DatabaseManager() inside the command binds the module-level DB_PATH
        as a default argument, so the command is driven with the test
        database instead of relying on that default.
        """
        output = io.StringIO()
        args = types.SimpleNamespace(
            all="--all" in argv,
            phase=next((a for i, a in enumerate(argv) if argv[i-1] == "--phase"), None),
            job_id=next((a for i, a in enumerate(argv) if argv[i-1] == "--job-id"), None),
        )
        original_manager = _pipeline.DatabaseManager
        _pipeline.DatabaseManager = lambda *a, **kw: self.db
        try:
            with redirect_stdout(output):
                _pipeline.cmd_retry_errors(args)
        finally:
            _pipeline.DatabaseManager = original_manager
        return output.getvalue()

    def test_single_job_retry_uses_the_current_phase_when_error_phase_is_empty(self):
        job = self._add(self._job("job-1", status=Status.FAILED.value))

        output = self._run_retry_errors(["--job-id", job.job_id])

        stored = self.db.get_job(job.job_id)
        self.assertEqual(stored.status, Status.RETRY_PENDING.value)
        self.assertEqual(stored.current_phase, Phase.OCR.value)
        self.assertIn(Phase.OCR.value, output)

    def test_single_job_retry_keeps_a_valid_error_phase(self):
        job = self._add(
            self._job("job-1", status=Status.FAILED.value,
                      current_phase=Phase.PARSE.value, error_phase="parse")
        )

        self._run_retry_errors(["--job-id", job.job_id])

        self.assertEqual(
            self.db.get_job(job.job_id).current_phase, Phase.PARSE.value
        )

    def test_single_job_retry_refuses_a_job_that_is_not_failed(self):
        for status in (Status.PENDING.value, Status.IN_PROGRESS.value,
                       Status.SUCCESS.value):
            with self.subTest(status=status):
                job = self._add(self._job(f"job-{status}", status=status))

                output = self._run_retry_errors(["--job-id", job.job_id])

                self.assertIn("not failed", output)
                self.assertEqual(self.db.get_job(job.job_id).status, status)

    def test_single_job_retry_of_a_retry_pending_job_is_idempotent(self):
        job = self._add(self._job("job-1", status=Status.RETRY_PENDING.value,
                                  error_phase=Phase.PARSE.value))

        output = self._run_retry_errors(["--job-id", job.job_id])

        stored = self.db.get_job(job.job_id)
        self.assertEqual(stored.status, Status.RETRY_PENDING.value)
        self.assertEqual(stored.current_phase, Phase.PARSE.value)
        self.assertIn("Marked job job-1 for retry", output)

    def test_single_job_retry_refuses_a_job_without_a_retryable_phase(self):
        job = self._add(self._job("job-1", status=Status.FAILED.value,
                                  current_phase="upload"))

        output = self._run_retry_errors(["--job-id", job.job_id])

        self.assertIn("no retryable phase", output)
        stored = self.db.get_job(job.job_id)
        self.assertEqual(stored.status, Status.FAILED.value)
        self.assertEqual(stored.current_phase, "upload")

    def test_single_job_retry_reports_an_unknown_job(self):
        output = self._run_retry_errors(["--job-id", "missing"])

        self.assertIn("Job not found", output)

    def test_phase_retry_rejects_a_phase_without_a_processor(self):
        self._add(self._job("job-1", status=Status.FAILED.value,
                            error_phase=Phase.OCR.value))

        output = self._run_retry_errors(["--phase", "complete"])

        self.assertIn("Cannot retry", output)
        self.assertEqual(self.db.get_job("job-1").status, Status.FAILED.value)

    def test_phase_retry_marks_failures_in_the_given_phase(self):
        self._add(self._job("job-1", status=Status.FAILED.value,
                            error_phase=Phase.OCR.value))

        output = self._run_retry_errors(["--phase", Phase.OCR.value])

        self.assertIn("Marked 1", output)
        stored = self.db.get_job("job-1")
        self.assertEqual(stored.status, Status.RETRY_PENDING.value)
        self.assertEqual(stored.current_phase, Phase.OCR.value)


if __name__ == "__main__":
    unittest.main()
