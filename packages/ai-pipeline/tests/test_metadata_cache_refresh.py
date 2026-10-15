"""Cross-worker job metadata freshness (issue #155).

The metadata cache is process-local. Under multiple WSGI worker processes a
poll handled by a worker that does not own the job must not be served an
``in_progress`` snapshot it cached earlier once the processing worker has saved
the completed or failed state. load_job_metadata refreshes nonterminal records
from S3 on every poll and only reuses a cached terminal record within its TTL.
"""

import io
import json
import os
import sys
import time
import unittest
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "src"))
sys.modules.setdefault("boto3", MagicMock())
sys.modules.setdefault("botocore", MagicMock())
sys.modules.setdefault("botocore.config", MagicMock())

from api.aws_manager import (  # noqa: E402
    AWSPipelineManager,
    TERMINAL_JOB_STATUSES,
    is_terminal_job_metadata,
)


class _NoSuchKey(Exception):
    """Stands in for botocore's ClientError on a missing metadata object."""


class _FakeS3:
    """Minimal in-memory metadata store shared by every manager in a test.

    Sharing one instance across two managers models two workers reading and
    writing the same S3 while each keeps its own process-local cache.
    """

    def __init__(self):
        self.store = {}
        self.get_calls = 0
        self.put_calls = 0

    def put_object(self, Bucket, Key, Body, **kwargs):
        self.put_calls += 1
        self.store[(Bucket, Key)] = Body if isinstance(Body, bytes) else Body.encode()
        return {"ResponseMetadata": {"HTTPStatusCode": 200}}

    def get_object(self, Bucket, Key):
        self.get_calls += 1
        if (Bucket, Key) in self.store:
            return {"Body": io.BytesIO(self.store[(Bucket, Key)])}
        raise _NoSuchKey(Key)


def _manager(s3):
    manager = AWSPipelineManager()
    manager.s3_client = s3
    return manager


class TestTerminalStatusHelper(unittest.TestCase):
    def test_terminal_and_nonterminal_statuses(self):
        for status in TERMINAL_JOB_STATUSES:
            self.assertTrue(is_terminal_job_metadata({"status": status}), status)
        for status in ("in_progress", "processing", "queued", "", None):
            self.assertFalse(is_terminal_job_metadata({"status": status}), status)
        # Missing or non-dict metadata is treated as still moving.
        self.assertFalse(is_terminal_job_metadata({}))
        self.assertFalse(is_terminal_job_metadata(None))
        self.assertFalse(is_terminal_job_metadata("in_progress"))


class TestCrossWorkerPolling(unittest.TestCase):
    def test_poller_sees_terminal_save_from_owning_worker(self):
        """Regression for #155: a poll must not stay stuck in_progress."""
        s3 = _FakeS3()
        owning = _manager(s3)
        polling = _manager(s3)
        job_id = "job-1"

        self.assertTrue(
            owning.save_job_metadata(job_id, {"job_id": job_id, "status": "in_progress"})
        )

        # Polling worker caches the in_progress snapshot.
        self.assertEqual(polling.load_job_metadata(job_id)["status"], "in_progress")
        self.assertEqual(polling.jobs[job_id]["status"], "in_progress")
        reads_before = s3.get_calls

        # Owning worker advances the job to success in S3.
        owning.save_job_metadata(job_id, {"job_id": job_id, "status": "success"})

        # The polling worker must re-read S3 rather than serve its stale cache.
        fresh = polling.load_job_metadata(job_id)
        self.assertEqual(fresh["status"], "success")
        self.assertEqual(s3.get_calls, reads_before + 1)

    def test_poll_sees_failure_saved_by_owning_worker(self):
        s3 = _FakeS3()
        owning = _manager(s3)
        polling = _manager(s3)
        job_id = "job-2"

        owning.save_job_metadata(job_id, {"job_id": job_id, "status": "in_progress"})
        self.assertEqual(polling.load_job_metadata(job_id)["status"], "in_progress")

        owning.save_job_metadata(job_id, {"job_id": job_id, "status": "failed"})
        self.assertEqual(polling.load_job_metadata(job_id)["status"], "failed")

    def test_questions_guard_sees_completion(self):
        """The /questions endpoint gates on status == success; a stale poll
        would reject a job the owning worker already completed."""
        s3 = _FakeS3()
        owning = _manager(s3)
        polling = _manager(s3)
        job_id = "job-3"

        owning.save_job_metadata(job_id, {"job_id": job_id, "status": "in_progress"})
        self.assertEqual(polling.load_job_metadata(job_id)["status"], "in_progress")
        owning.save_job_metadata(job_id, {"job_id": job_id, "status": "success"})

        status = polling.load_job_metadata(job_id).get("status")
        self.assertEqual(status, "success")


class TestTerminalCacheAndTtl(unittest.TestCase):
    def _key(self, manager, job_id):
        return (manager.s3_bucket, f"{manager.s3_jobs_prefix}{job_id}/metadata.json")

    def test_fresh_terminal_served_from_cache(self):
        s3 = _FakeS3()
        manager = _manager(s3)
        job_id = "job-ok"

        manager.save_job_metadata(job_id, {"job_id": job_id, "status": "success"})
        manager.jobs_cached_at[job_id] = time.monotonic()
        reads_before = s3.get_calls

        result = manager.load_job_metadata(job_id)
        self.assertEqual(result["status"], "success")
        self.assertEqual(s3.get_calls, reads_before)

    def test_terminal_revalidated_after_ttl(self):
        s3 = _FakeS3()
        manager = _manager(s3)
        job_id = "job-ok"

        manager.save_job_metadata(job_id, {"job_id": job_id, "status": "success"})
        # A retry (from any worker) rewrites the shared record to failed.
        s3.store[self._key(manager, job_id)] = json.dumps(
            {"job_id": job_id, "status": "failed"}
        ).encode()

        # Fresh: still served from cache.
        manager.jobs_cached_at[job_id] = time.monotonic()
        self.assertEqual(manager.load_job_metadata(job_id)["status"], "success")

        # Past the TTL: revalidated from S3.
        manager.jobs_cached_at[job_id] = time.monotonic() - (manager.metadata_cache_ttl + 1)
        self.assertEqual(manager.load_job_metadata(job_id)["status"], "failed")


class TestFallbackBehavior(unittest.TestCase):
    def test_falls_back_to_cache_without_s3_client(self):
        s3 = _FakeS3()
        manager = _manager(s3)
        manager.jobs["job-x"] = {"job_id": "job-x", "status": "in_progress"}
        manager.s3_client = None

        result = manager.load_job_metadata("job-x")
        self.assertEqual(result["status"], "in_progress")

    def test_falls_back_to_cache_on_missing_key(self):
        s3 = _FakeS3()
        manager = _manager(s3)
        manager.jobs["job-y"] = {"job_id": "job-y", "status": "queued"}

        # No S3 object exists -> get_object raises -> serve last known value.
        self.assertEqual(manager.load_job_metadata("job-y")["status"], "queued")

    def test_returns_none_when_unknown_and_no_s3_object(self):
        s3 = _FakeS3()
        manager = _manager(s3)
        self.assertIsNone(manager.load_job_metadata("missing"))


class TestEvictionBoundsCache(unittest.TestCase):
    def test_eviction_drops_oldest_and_clears_timestamps(self):
        manager = _manager(_FakeS3())
        for i in range(130):
            job_id = f"job-{i:04d}"
            manager.jobs[job_id] = {"job_id": job_id, "status": "success"}
            manager.jobs_cached_at[job_id] = float(i)

        with manager.jobs_lock:
            manager._evict_job_cache_locked()

        self.assertEqual(len(manager.jobs), 110)
        for i in range(20):
            job_id = f"job-{i:04d}"
            self.assertNotIn(job_id, manager.jobs)
            self.assertNotIn(job_id, manager.jobs_cached_at)


if __name__ == "__main__":
    unittest.main()
