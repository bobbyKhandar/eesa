"""Decide whether a failed pipeline job can be retried from its original PDF.

The Next.js route decides which user may retry. This helper only looks at the
job metadata the pipeline already stored in S3.
"""

import os


RETRYABLE_STATUSES = frozenset({"failed", "partial_success"})
ACTIVE_STATUSES = frozenset({"in_progress", "processing", "queued"})


def _clean(value):
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def plan_job_retry(metadata, job_id, jobs_prefix="jobs/"):
    """Return a start plan or an error plan.

    A start plan carries the S3 key and the metadata to save before the worker
    runs, so a status poll cannot keep reporting the previous failure.
    """
    if not isinstance(metadata, dict):
        return {"ok": False, "status": 404, "error": "Job not found"}

    status = metadata.get("status")
    if status in ACTIVE_STATUSES:
        return {"ok": False, "status": 409, "error": "Job is already running"}
    if status not in RETRYABLE_STATUSES:
        return {"ok": False, "status": 409, "error": "Only failed jobs can be retried"}

    filename = _clean(metadata.get("filename"))
    s3_key = _clean(metadata.get("s3_pdf_key")) or _clean(metadata.get("s3_key"))
    if s3_key is None and filename:
        prefix = jobs_prefix if str(jobs_prefix).endswith("/") else "{}/".format(jobs_prefix)
        s3_key = "{}{}/original/{}".format(prefix, job_id, filename)
    if filename is None and s3_key:
        filename = os.path.basename(s3_key.rstrip("/")) or None

    if not s3_key or not filename:
        return {
            "ok": False,
            "status": 400,
            "error": "Original file is not available for retry",
        }

    return {
        "ok": True,
        "job_id": job_id,
        "filename": filename,
        "s3_key": s3_key,
        "metadata": {
            "job_id": job_id,
            "filename": filename,
            "s3_pdf_key": s3_key,
            "status": "in_progress",
            "stages": {},
        },
    }
