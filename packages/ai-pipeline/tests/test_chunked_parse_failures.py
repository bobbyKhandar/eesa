"""Chunked parsing must report chunks that failed instead of a clean success.

A document is a clean success only when every chunk parses. Some failed chunks
are status ``partial`` and list ``failed_chunks``. Every chunk failing is
status ``failed``. The AWS job then ends ``partial_success`` or ``failed``.
Continuation markers on chunks that did parse stay under ``chunk_metadata``.
"""

import importlib.util
import json
import os
import sys
import types
import unittest
from unittest.mock import MagicMock, Mock, patch


_STUBBED_MODULES = {}


def _push_module(name, module):
    if name not in _STUBBED_MODULES:
        _STUBBED_MODULES[name] = sys.modules.get(name)
    sys.modules[name] = module


def _install_import_stubs():
    """Load the pipeline modules without boto3, Flask, or OCR native deps."""
    _push_module("boto3", MagicMock())
    botocore = types.ModuleType("botocore")
    botocore.config = types.ModuleType("botocore.config")
    botocore.config.Config = MagicMock()
    _push_module("botocore", botocore)
    _push_module("botocore.config", botocore.config)

    for name, attrs in {
        "aws_texttract_pipeline": {"process_document_async": Mock(return_value=True)},
        "enrich_questions_job_based": {
            "enrich_questions_for_job": Mock(return_value=None),
            "enrich_chunked_questions": Mock(return_value=None),
        },
        "organize_by_subject_job_based": {"organize_by_subject_for_job": Mock(return_value=None)},
        "intelligent_chunking": {"chunk_ocr_text": Mock(return_value=[])},
        "question_clustering": {"cluster_questions_for_job": Mock(return_value=[])},
    }.items():
        module = types.ModuleType(name)
        for key, value in attrs.items():
            setattr(module, key, value)
        _push_module(name, module)


def _load_module(module_name, relative_path):
    module_path = os.path.join(os.path.dirname(__file__), "..", "src", relative_path)
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load {module_name} from {module_path}")
    module = importlib.util.module_from_spec(spec)
    _push_module(module_name, module)
    spec.loader.exec_module(module)
    return module


def _restore_stubbed_modules():
    for name, previous in _STUBBED_MODULES.items():
        if previous is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = previous


_install_import_stubs()
parsing_pipeline = _load_module("parsing_pipeline", "parsing_pipeline.py")
aws_manager = _load_module("aws_manager_under_test", os.path.join("api", "aws_manager.py"))
_enrich_module = sys.modules["enrich_questions_job_based"]
# Drop stubs before other test modules are imported. The job tests put the
# two modules they import back in setUpModule.
_restore_stubbed_modules()


def setUpModule():
    sys.modules["parsing_pipeline"] = parsing_pipeline
    sys.modules["enrich_questions_job_based"] = _enrich_module


def tearDownModule():
    _restore_stubbed_modules()


def _chunk(chunk_id, *, continuation=False):
    return {
        "chunk_id": chunk_id,
        "text": f"question text {chunk_id}",
        "is_continuation": continuation,
        "start_question": 6 if continuation else 1,
    }


def _parsed_from_chunk(chunk, question_count=1):
    return {
        "exams": [
            {
                "subject": "Databases",
                "questions": [
                    {"question_number": f"Q{index}", "question_text": "kept"}
                    for index in range(1, question_count + 1)
                ],
            }
        ],
        "chunk_id": chunk["chunk_id"],
        "chunk_metadata": dict(chunk),
        "parsing_cost": 0.01,
    }


def _saved_chunk_bodies():
    bodies = []
    for call in parsing_pipeline.s3_client.put_object.call_args_list:
        key = call.kwargs.get("Key", "")
        if "/parsed_chunks/chunk_" in key:
            bodies.append(json.loads(call.kwargs["Body"]))
    return bodies


class TestParseChunkedDocument(unittest.TestCase):
    def setUp(self):
        parsing_pipeline.s3_client = Mock()
        self.parse_chunk = Mock()
        self._patch = patch.object(parsing_pipeline, "parse_chunk", self.parse_chunk)
        self._patch.start()

    def tearDown(self):
        self._patch.stop()

    def test_every_chunk_succeeding_is_a_clean_success(self):
        first = _chunk(0)
        second = _chunk(1, continuation=True)
        self.parse_chunk.side_effect = [
            _parsed_from_chunk(first),
            _parsed_from_chunk(second, question_count=2),
        ]

        result = parsing_pipeline.parse_chunked_document(
            [first, second], "job-1", "paper.pdf"
        )

        self.assertEqual(result.get("success"), True)
        self.assertEqual(result.get("status"), "success")
        self.assertEqual(result.get("failed_chunks"), [])
        self.assertEqual(result["chunks_processed"], 2)
        self.assertEqual(result["total_questions"], 3)
        self.assertTrue(result["is_chunked"])
        self.assertIn("chunk_metadata_key", result)
        saved = _saved_chunk_bodies()
        self.assertEqual(len(saved), 2)
        self.assertTrue(saved[1]["chunk_metadata"]["is_continuation"])
        self.assertEqual(saved[1]["chunk_metadata"]["start_question"], 6)
        self.assertNotIn("is_continuation", saved[1])

    def test_some_failed_chunks_are_partial_and_name_the_failures(self):
        kept = _chunk(0)
        blank = _chunk(1, continuation=True)
        limited = _chunk(2, continuation=True)
        self.parse_chunk.side_effect = [
            _parsed_from_chunk(kept, question_count=2),
            None,
            {"error": "Chunk exceeds token limit", "chunk_id": 2, "cost": 0.2},
        ]

        result = parsing_pipeline.parse_chunked_document(
            [kept, blank, limited], "job-2", "long.pdf"
        )

        self.assertFalse(result["success"])
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["chunks_processed"], 1)
        self.assertEqual(result["total_questions"], 2)
        self.assertEqual(
            result["failed_chunks"],
            [
                {"chunk_id": 1, "index": 1, "error": "Chunk failed to parse"},
                {"chunk_id": 2, "index": 2, "error": "Chunk exceeds token limit"},
            ],
        )
        self.assertIn("chunk_metadata_key", result)
        self.assertIn("1", result["error"])
        saved = _saved_chunk_bodies()
        self.assertEqual(len(saved), 1)
        self.assertEqual(saved[0]["chunk_metadata"]["chunk_id"], 0)
        self.assertIn("chunk_metadata", saved[0])

    def test_all_failed_chunks_are_failed_and_not_a_silent_empty_success(self):
        chunks = [_chunk(0), _chunk(1)]
        self.parse_chunk.side_effect = [None, {"error": "invalid json", "chunk_id": 1}]

        result = parsing_pipeline.parse_chunked_document(chunks, "job-3", "blank.pdf")

        self.assertIsInstance(result, dict)
        self.assertFalse(result["success"])
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["chunks_processed"], 0)
        self.assertEqual(len(result["failed_chunks"]), 2)
        self.assertEqual(result["failed_chunks"][0]["chunk_id"], 0)
        self.assertEqual(result["failed_chunks"][1]["error"], "invalid json")
        self.assertNotIn("chunk_metadata_key", result)
        parsing_pipeline.s3_client.put_object.assert_not_called()


def _pipeline_manager():
    manager = aws_manager.AWSPipelineManager()
    manager.s3_client = Mock()
    manager.process_ocr_with_chunking = Mock(
        return_value={
            "needs_chunking": True,
            "chunks": [_chunk(0), _chunk(1)],
            "total_chunks": 2,
        }
    )
    aws_manager.process_document_async = Mock(return_value=True)
    aws_manager.parse_questions_for_job = Mock()
    aws_manager.enrich_questions_for_job = Mock()
    aws_manager.organize_by_subject_for_job = Mock(
        return_value={"total_subjects": 1, "total_exams": 1, "total_questions": 1, "subjects": {}}
    )
    aws_manager.cluster_questions_for_job = Mock(
        return_value={
            "total_questions": 1,
            "total_similar_pairs": 0,
            "n_clusters": 1,
            "embedding_model": "test",
        }
    )
    enrich = sys.modules["enrich_questions_job_based"]
    enrich.enrich_chunked_questions = Mock(
        return_value={
            "total_questions": 1,
            "total_enriched": 1,
            "processing_cost": 0,
            "retry_count": 0,
        }
    )
    return manager


class TestChunkedParseJobStatus(unittest.TestCase):
    def test_partial_chunk_failure_marks_the_job_partial_success(self):
        manager = _pipeline_manager()
        with patch.object(
            parsing_pipeline,
            "parse_chunked_document",
            return_value={
                "success": False,
                "status": "partial",
                "failed_chunks": [
                    {"chunk_id": 1, "index": 1, "error": "Chunk failed to parse"}
                ],
                "chunks_processed": 1,
                "total_questions": 4,
                "total_exams": 1,
                "processing_cost": 0.01,
                "is_chunked": True,
                "chunk_metadata_key": "jobs/job-4/parsed_chunks/_metadata.json",
                "error": "1 of 2 chunks failed to parse",
            },
        ):
            metadata = manager.process_aws_job_pipeline(
                "job-4", "jobs/job-4/original/paper.pdf", "paper.pdf"
            )

        self.assertEqual(metadata["status"], "partial_success")
        self.assertEqual(metadata["failed_stage"], "parsing")
        self.assertEqual(metadata["stages"]["parsing"]["status"], "partial")
        self.assertEqual(
            metadata["stages"]["parsing"]["failed_chunks"],
            [{"chunk_id": 1, "index": 1, "error": "Chunk failed to parse"}],
        )
        self.assertIn("chunks failed", metadata["error"])
        self.assertEqual(metadata["stages"]["enrichment"]["status"], "success")
        sys.modules["enrich_questions_job_based"].enrich_chunked_questions.assert_called_once()
        aws_manager.organize_by_subject_for_job.assert_called_once()

    def test_every_chunk_failing_marks_the_job_failed(self):
        manager = _pipeline_manager()
        with patch.object(
            parsing_pipeline,
            "parse_chunked_document",
            return_value={
                "success": False,
                "status": "failed",
                "failed_chunks": [
                    {"chunk_id": 0, "index": 0, "error": "Chunk failed to parse"},
                    {"chunk_id": 1, "index": 1, "error": "Chunk failed to parse"},
                ],
                "chunks_processed": 0,
                "is_chunked": True,
                "error": "All chunks failed to parse",
            },
        ):
            metadata = manager.process_aws_job_pipeline(
                "job-5", "jobs/job-5/original/paper.pdf", "paper.pdf"
            )

        self.assertEqual(metadata["status"], "failed")
        self.assertEqual(metadata["stages"]["parsing"]["status"], "failed")
        self.assertEqual(len(metadata["stages"]["parsing"]["failed_chunks"]), 2)
        sys.modules["enrich_questions_job_based"].enrich_chunked_questions.assert_not_called()

    def test_clean_chunked_parse_still_finishes_as_success(self):
        manager = _pipeline_manager()
        with patch.object(
            parsing_pipeline,
            "parse_chunked_document",
            return_value={
                "success": True,
                "status": "success",
                "failed_chunks": [],
                "chunks_processed": 2,
                "total_questions": 3,
                "total_exams": 1,
                "processing_cost": 0.02,
                "is_chunked": True,
                "chunk_metadata_key": "jobs/job-6/parsed_chunks/_metadata.json",
            },
        ):
            metadata = manager.process_aws_job_pipeline(
                "job-6", "jobs/job-6/original/paper.pdf", "paper.pdf"
            )

        self.assertEqual(metadata["status"], "success")
        self.assertEqual(metadata["stages"]["parsing"]["status"], "success")
        self.assertNotIn("failed_stage", metadata)
        sys.modules["enrich_questions_job_based"].enrich_chunked_questions.assert_called_once()

    def test_non_chunked_token_limit_stays_partial_success(self):
        manager = _pipeline_manager()
        manager.process_ocr_with_chunking.return_value = {
            "needs_chunking": False,
            "ocr_text": "short",
        }
        aws_manager.parse_questions_for_job.return_value = {
            "success": False,
            "error": "Text exceeds token limit",
            "error_type": "token_limit_exceeded",
        }

        with patch.object(parsing_pipeline, "parse_chunked_document") as parse_chunked:
            metadata = manager.process_aws_job_pipeline(
                "job-7", "jobs/job-7/original/paper.pdf", "paper.pdf"
            )

        self.assertEqual(metadata["status"], "partial_success")
        self.assertEqual(metadata["error_type"], "token_limit_exceeded")
        self.assertEqual(metadata["stages"]["parsing"]["status"], "failed")
        parse_chunked.assert_not_called()


if __name__ == "__main__":
    unittest.main()
