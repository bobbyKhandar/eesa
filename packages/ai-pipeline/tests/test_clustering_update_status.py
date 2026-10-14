"""Clustering S3 write-back failures must not be reported as stage success.

cluster_questions_for_job returns per-file outcomes. AWSPipelineManager marks
the clustering stage partial or failed when any expected source file was not
updated, and stores the failed keys on the job metadata.
"""

import importlib.util
import os
import sys
import types
import unittest
from unittest.mock import MagicMock, Mock


_STUBBED_MODULES = {}


def _push_module(name, module):
    if name not in _STUBBED_MODULES:
        _STUBBED_MODULES[name] = sys.modules.get(name)
    sys.modules[name] = module


def _install_import_stubs():
    _push_module("boto3", MagicMock())
    botocore = types.ModuleType("botocore")
    botocore.config = types.ModuleType("botocore.config")
    botocore.config.Config = MagicMock()
    _push_module("botocore", botocore)
    _push_module("botocore.config", botocore.config)

    for name, attrs in {
        "aws_texttract_pipeline": {"process_document_async": Mock(return_value=True)},
        "parsing_pipeline": {"parse_questions_for_job": Mock(return_value=None)},
        "enrich_questions_job_based": {"enrich_questions_for_job": Mock(return_value=None)},
        "organize_by_subject_job_based": {"organize_by_subject_for_job": Mock(return_value=None)},
        "intelligent_chunking": {"chunk_ocr_text": Mock(return_value=[])},
        "question_clustering": {"cluster_questions_for_job": Mock(return_value=None)},
    }.items():
        module = types.ModuleType(name)
        for key, value in attrs.items():
            setattr(module, key, value)
        _push_module(name, module)


def _load_aws_manager():
    module_path = os.path.join(
        os.path.dirname(__file__), "..", "src", "api", "aws_manager.py"
    )
    spec = importlib.util.spec_from_file_location("aws_manager_clustering_status", module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load aws_manager from {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["aws_manager_clustering_status"] = module
    spec.loader.exec_module(module)
    return module


def _restore_stubbed_modules():
    for name, previous in _STUBBED_MODULES.items():
        if previous is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = previous


_install_import_stubs()
aws_manager = _load_aws_manager()
_restore_stubbed_modules()


def _manager():
    manager = aws_manager.AWSPipelineManager()
    manager.s3_client = Mock()
    manager.process_ocr_with_chunking = Mock(return_value={"needs_chunking": False, "ocr_text": "short"})
    aws_manager.process_document_async = Mock(return_value=True)
    aws_manager.parse_questions_for_job = Mock(
        return_value={
            "success": True,
            "total_questions": 2,
            "total_exams": 1,
            "processing_cost": 0,
        }
    )
    aws_manager.enrich_questions_for_job = Mock(
        return_value={
            "total_questions": 2,
            "total_enriched": 2,
            "processing_cost": 0,
            "retry_count": 0,
        }
    )
    aws_manager.organize_by_subject_for_job = Mock(
        return_value={
            "total_subjects": 1,
            "total_exams": 1,
            "total_questions": 2,
            "subjects": {"Operating Systems": 2},
        }
    )
    aws_manager.cluster_questions_for_job = Mock()
    return manager


def _run(clustering_result):
    manager = _manager()
    aws_manager.cluster_questions_for_job.return_value = clustering_result
    return manager.process_aws_job_pipeline(
        "job-cluster", "jobs/job-cluster/original/paper.pdf", "paper.pdf"
    )


class TestClusteringUpdateJobStatus(unittest.TestCase):
    def test_partial_source_updates_mark_the_stage_partial_and_store_failed_keys(self):
        failed_key = "jobs/job-cluster/organized_output/db.json"
        kept_key = "jobs/job-cluster/organized_output/os.json"
        metadata = _run(
            {
                "success": False,
                "status": "partial",
                "failed_keys": [failed_key],
                "file_updates": [
                    {"source_key": kept_key, "status": "updated"},
                    {"source_key": failed_key, "status": "failed", "error": "S3 timeout"},
                ],
                "updated_files": 1,
                "expected_files": 2,
                "total_questions": 2,
                "total_similar_pairs": 1,
                "n_clusters": 1,
                "embedding_model": "test-embed",
                "error": "1 of 2 organized files failed to update",
            }
        )

        self.assertEqual(metadata["status"], "partial_success")
        self.assertEqual(metadata["failed_stage"], "clustering")
        self.assertEqual(metadata["stages"]["clustering"]["status"], "partial")
        self.assertEqual(metadata["stages"]["clustering"]["failed_keys"], [failed_key])
        self.assertEqual(
            metadata["stages"]["clustering"]["file_updates"][1]["error"],
            "S3 timeout",
        )
        self.assertEqual(metadata["error"], "1 of 2 organized files failed to update")

    def test_every_source_update_failing_marks_the_stage_failed(self):
        failed_keys = [
            "jobs/job-cluster/organized_output/os.json",
            "jobs/job-cluster/organized_output/db.json",
        ]
        metadata = _run(
            {
                "success": False,
                "status": "failed",
                "failed_keys": failed_keys,
                "file_updates": [
                    {"source_key": failed_keys[0], "status": "failed", "error": "S3 upload failed"},
                    {"source_key": failed_keys[1], "status": "failed", "error": "S3 upload failed"},
                ],
                "updated_files": 0,
                "expected_files": 2,
                "total_questions": 2,
                "total_similar_pairs": 1,
                "n_clusters": 1,
                "embedding_model": "test-embed",
                "error": "Failed to update 2 organized files",
            }
        )

        self.assertEqual(metadata["status"], "partial_success")
        self.assertEqual(metadata["failed_stage"], "clustering")
        self.assertEqual(metadata["stages"]["clustering"]["status"], "failed")
        self.assertEqual(metadata["stages"]["clustering"]["failed_keys"], failed_keys)
        self.assertNotEqual(metadata["stages"]["clustering"]["status"], "success")

    def test_failed_keys_without_status_are_not_stage_success(self):
        failed_key = "jobs/job-cluster/organized_output/db.json"
        metadata = _run(
            {
                "total_questions": 2,
                "total_similar_pairs": 1,
                "n_clusters": 1,
                "embedding_model": "test-embed",
                "failed_keys": [failed_key],
            }
        )

        self.assertNotEqual(metadata["stages"]["clustering"]["status"], "success")
        self.assertEqual(metadata["stages"]["clustering"]["failed_keys"], [failed_key])
        self.assertEqual(metadata["status"], "partial_success")

    def test_clean_clustering_result_stays_success(self):
        metadata = _run(
            {
                "success": True,
                "status": "success",
                "failed_keys": [],
                "file_updates": [
                    {"source_key": "jobs/job-cluster/organized_output/os.json", "status": "updated"}
                ],
                "total_questions": 2,
                "total_similar_pairs": 1,
                "n_clusters": 1,
                "embedding_model": "test-embed",
            }
        )

        self.assertEqual(metadata["status"], "success")
        self.assertEqual(metadata["stages"]["clustering"]["status"], "success")
        self.assertNotIn("failed_stage", metadata)
        self.assertEqual(metadata["stages"]["clustering"].get("failed_keys", []), [])
