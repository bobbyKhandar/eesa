"""Issue #158: subjects containing "index" must not be mistaken for metadata.

Organization puts the subject into both the folder and the exam filename, so a
substring check for "index" skips ordinary exams such as "Index Numbers" or
"Database Indexing". Only the exact reserved basenames ``_index.json`` and
``_master_index.json`` are index metadata.
"""

import importlib.util
import io
import json
import os
import sys
import types
import unittest
from unittest.mock import MagicMock, Mock


def _ensure_boto_stubs():
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


def _load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load {name} from {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


_TESTS_DIR = os.path.dirname(__file__)
_SRC_DIR = os.path.join(_TESTS_DIR, "..", "src")

_ensure_boto_stubs()
_retriever = _load_module(
    "question_retriever_index_158",
    os.path.join(_SRC_DIR, "api", "question_retriever.py"),
)
_clustering = _load_module(
    "question_clustering_index_158",
    os.path.join(_SRC_DIR, "question_clustering.py"),
)


def _exam(subject, year="2023"):
    return {
        "subject": subject,
        "year": year,
        "semester": "V",
        "examType": "main",
        "branch": "CSE",
        "questions": [
            {
                "question_number": "Q1",
                "question_text": f"{subject} question",
                "marks": 10,
                "bloomLevel": "Recall",
                "difficulty": "Easy",
                "keywords": [],
            }
        ],
    }


def _organized_payload(subject):
    return {"exams": [_exam(subject)]}


class FakeS3:
    """Minimal S3 double keyed by exact object key."""

    def __init__(self, objects, prefix_lists=None):
        # objects: {key: python-json-serializable payload}
        self.objects = dict(objects)
        # prefix_lists: {prefix: [keys]} to simulate a listing that omits keys.
        self.prefix_lists = dict(prefix_lists or {})

    def list_objects_v2(self, Bucket, Prefix):
        if Prefix in self.prefix_lists:
            keys = self.prefix_lists[Prefix]
        else:
            keys = [k for k in self.objects if k.startswith(Prefix)]
        if not keys:
            return {}
        return {"Contents": [{"Key": k} for k in keys]}

    def get_object(self, Bucket, Key):
        if Key not in self.objects:
            raise RuntimeError(f"No such key: {Key}")
        return {"Body": io.BytesIO(json.dumps(self.objects[Key]).encode("utf-8"))}


class TestIndexBasenameFilter(unittest.TestCase):
    def test_retriever_keeps_index_named_exams_and_drops_only_reserved(self):
        self.assertTrue(
            _retriever.is_organized_exam_key(
                "jobs/j/organized_output/Index Numbers/Index Numbers_2023_V_main.json"
            )
        )
        self.assertTrue(
            _retriever.is_organized_exam_key(
                "jobs/j/organized_output/Database Indexing/Database Indexing_2023_V_main.json"
            )
        )
        self.assertFalse(
            _retriever.is_organized_exam_key(
                "jobs/j/organized_output/Index Numbers/_index.json"
            )
        )
        self.assertFalse(
            _retriever.is_organized_exam_key(
                "jobs/j/organized_output/_master_index.json"
            )
        )

    def test_clustering_keeps_index_named_exams_and_drops_only_reserved(self):
        self.assertTrue(
            _clustering.is_organized_exam_key(
                "jobs/j/organized_output/Index Numbers/Index Numbers_2023_V_main.json"
            )
        )
        self.assertTrue(
            _clustering.is_organized_exam_key(
                "jobs/j/organized_output/Database Indexing/Database Indexing_2023_V_main.json"
            )
        )
        self.assertFalse(
            _clustering.is_organized_exam_key(
                "jobs/j/organized_output/Index Numbers/_index.json"
            )
        )
        self.assertFalse(
            _clustering.is_organized_exam_key(
                "jobs/j/organized_output/_master_index.json"
            )
        )


class TestRetrieverIndexSubjects(unittest.TestCase):
    def _job_objects(self, job_id):
        index_key = f"jobs/{job_id}/organized_output/Index Numbers/Index Numbers_2023_V_main.json"
        os_key = f"jobs/{job_id}/organized_output/Operating Systems/Operating Systems_2023_V_main.json"
        subject_index = f"jobs/{job_id}/organized_output/Index Numbers/_index.json"
        master_key = f"jobs/{job_id}/organized_output/_master_index.json"
        manifest = {
            "job_id": job_id,
            "total_subjects": 2,
            "total_exams": 2,
            "total_questions": 2,
            "subjects": {
                "Index Numbers": {
                    "folder": "Index Numbers",
                    "exam_count": 1,
                    "files": [{"filename": "Index Numbers_2023_V_main.json", "s3_key": index_key}],
                },
                "Operating Systems": {
                    "folder": "Operating Systems",
                    "exam_count": 1,
                    "files": [{"filename": "Operating Systems_2023_V_main.json", "s3_key": os_key}],
                },
            },
        }
        objects = {
            index_key: _organized_payload("Index Numbers"),
            os_key: _organized_payload("Operating Systems"),
            subject_index: {"subject": "Index Numbers", "files": []},
            master_key: manifest,
        }
        return objects, index_key, os_key, master_key

    def test_returns_both_affected_and_unaffected_subjects(self):
        job_id = "job-index-158"
        objects, _, _, _ = self._job_objects(job_id)
        s3 = FakeS3(objects)
        result = _retriever.get_job_questions(s3, "bucket", "jobs/", job_id, {"filename": "paper.pdf"})
        self.assertIsNotNone(result)
        subjects = sorted(e.get("subject") for e in result["exams"])
        self.assertEqual(subjects, ["Index Numbers", "Operating Systems"])
        self.assertEqual(result["summary"]["totalExams"], 2)

    def test_manifest_missing_from_listing_is_loaded_directly(self):
        job_id = "job-index-manifest"
        objects, index_key, os_key, _ = self._job_objects(job_id)
        # Simulate a listing that omits the affected exam (old substring bug).
        organized_prefix = f"jobs/{job_id}/organized_output/"
        s3 = FakeS3(
            objects,
            prefix_lists={
                organized_prefix: [
                    k for k in objects if k.startswith(organized_prefix) and k != index_key
                ]
            },
        )
        result = _retriever.get_job_questions(s3, "bucket", "jobs/", job_id, {"filename": "paper.pdf"})
        self.assertIsNotNone(result)
        subjects = sorted(e.get("subject") for e in result["exams"])
        self.assertIn("Index Numbers", subjects)
        self.assertIn("Operating Systems", subjects)

    def test_incomplete_organized_set_is_supplemented_from_enriched(self):
        job_id = "job-index-enriched"
        index_key = f"jobs/{job_id}/organized_output/Index Numbers/Index Numbers_2023_V_main.json"
        os_key = f"jobs/{job_id}/organized_output/Operating Systems/Operating Systems_2023_V_main.json"
        master_key = f"jobs/{job_id}/organized_output/_master_index.json"
        # Organized listing has only the unaffected exam; the manifest expects
        # two exams but the affected manifest key is absent from S3, so the
        # direct manifest load cannot fill it. Enriched has both exams.
        objects = {
            os_key: _organized_payload("Operating Systems"),
            master_key: {
                "job_id": job_id,
                "total_exams": 2,
                "subjects": {
                    "Index Numbers": {"files": [{"s3_key": index_key}]},
                    "Operating Systems": {"files": [{"s3_key": os_key}]},
                },
            },
            f"jobs/{job_id}/enriched_output/paper_enriched.json": {
                "exams": [_exam("Index Numbers"), _exam("Operating Systems")]
            },
        }
        s3 = FakeS3(objects)
        result = _retriever.get_job_questions(s3, "bucket", "jobs/", job_id, {"filename": "paper.pdf"})
        self.assertIsNotNone(result)
        subjects = sorted(e.get("subject") for e in result["exams"])
        self.assertEqual(subjects, ["Index Numbers", "Operating Systems"])
        # The unaffected exam must not be duplicated by the supplement.
        self.assertEqual(result["summary"]["totalExams"], 2)


class TestClusteringIndexSubjects(unittest.TestCase):
    def test_index_named_exam_file_is_clustered(self):
        import numpy as np

        job_id = "job-cluster-index"
        index_key = f"jobs/{job_id}/organized_output/Index Numbers/Index Numbers_2023_V_main.json"
        other_key = f"jobs/{job_id}/organized_output/Operating Systems/Operating Systems_2023_V_main.json"
        subject_index = f"jobs/{job_id}/organized_output/Index Numbers/_index.json"
        master_key = f"jobs/{job_id}/organized_output/_master_index.json"
        sources = {
            index_key: _organized_payload("Index Numbers"),
            other_key: _organized_payload("Operating Systems"),
            subject_index: {"subject": "Index Numbers"},
            master_key: {
                "job_id": job_id,
                "total_exams": 2,
                "subjects": {
                    "Index Numbers": {"files": [{"s3_key": index_key}]},
                    "Operating Systems": {"files": [{"s3_key": other_key}]},
                },
            },
        }
        written = {}
        seen_sources = []

        def get_object(Bucket, Key):
            return {"Body": io.BytesIO(json.dumps(sources[Key]).encode("utf-8"))}

        def put_object(Bucket, Key, Body, ContentType=None):
            written[Key] = json.loads(Body)

        def find_similar(table, query_vector, question_id, filters=None, k=5):
            return [
                {"id": "prior", "question_number": "Q9", "similarity": 0.91, "year": "2019"}
            ]

        module = _clustering
        orig_table = module.get_or_create_lancedb_table
        orig_embed = module.generate_embedding
        orig_similar = module.find_similar_questions_lancedb
        orig_cluster = module.cluster_with_hdbscan
        orig_s3 = module.s3_client
        try:
            module.get_or_create_lancedb_table = lambda table_name="questions": MagicMock()
            module.generate_embedding = lambda text: np.array([1.0, 0.0], dtype=np.float32)
            module.find_similar_questions_lancedb = find_similar
            module.cluster_with_hdbscan = lambda vectors: np.array([1] * len(vectors))
            module.s3_client = MagicMock()
            module.s3_client.list_objects_v2.return_value = {
                "Contents": [{"Key": k} for k in sources]
            }
            module.s3_client.get_object.side_effect = get_object
            module.s3_client.put_object.side_effect = put_object

            result = module.cluster_questions_for_job(job_id, "paper.pdf")
        finally:
            module.get_or_create_lancedb_table = orig_table
            module.generate_embedding = orig_embed
            module.find_similar_questions_lancedb = orig_similar
            module.cluster_with_hdbscan = orig_cluster
            module.s3_client = orig_s3

        self.assertIsNotNone(result)
        self.assertIn(index_key, written)
        self.assertIn(other_key, written)
        # Index metadata must never be treated as an exam payload.
        self.assertNotIn(subject_index, written)
        self.assertNotIn(master_key, written)


class TestClusteringFailureJobStatus(unittest.TestCase):
    def _load_manager(self):
        stubbed = {}
        for name in ("boto3", "botocore", "botocore.config"):
            stubbed[name] = sys.modules.get(name)
        sys.modules["boto3"] = MagicMock()
        botocore = types.ModuleType("botocore")
        botocore.config = types.ModuleType("botocore.config")
        botocore.config.Config = MagicMock()
        sys.modules["botocore"] = botocore
        sys.modules["botocore.config"] = botocore.config
        for name, attrs in {
            "aws_texttract_pipeline": {"process_document_async": Mock(return_value=True)},
            "parsing_pipeline": {"parse_questions_for_job": Mock(return_value=None)},
            "enrich_questions_job_based": {"enrich_questions_for_job": Mock(return_value=None)},
            "organize_by_subject_job_based": {"organize_by_subject_for_job": Mock(return_value=None)},
            "intelligent_chunking": {"chunk_ocr_text": Mock(return_value=[])},
            "question_clustering": {"cluster_questions_for_job": Mock(return_value=None)},
        }.items():
            if name not in stubbed:
                stubbed[name] = sys.modules.get(name)
            mod = types.ModuleType(name)
            for k, v in attrs.items():
                setattr(mod, k, v)
            sys.modules[name] = mod
        try:
            path = os.path.join(_SRC_DIR, "api", "aws_manager.py")
            return _load_module("aws_manager_index_158", path)
        finally:
            for name, prev in stubbed.items():
                if prev is None:
                    sys.modules.pop(name, None)
                else:
                    sys.modules[name] = prev

    def test_none_clustering_result_is_not_overall_success(self):
        aws_manager = self._load_manager()
        manager = aws_manager.AWSPipelineManager()
        manager.s3_client = Mock()
        manager.process_ocr_with_chunking = Mock(
            return_value={"needs_chunking": False, "ocr_text": "short"}
        )
        aws_manager.process_document_async = Mock(return_value=True)
        aws_manager.parse_questions_for_job = Mock(
            return_value={"success": True, "total_questions": 2, "total_exams": 1, "processing_cost": 0}
        )
        aws_manager.enrich_questions_for_job = Mock(
            return_value={"total_questions": 2, "total_enriched": 2, "processing_cost": 0, "retry_count": 0}
        )
        aws_manager.organize_by_subject_for_job = Mock(
            return_value={"total_subjects": 1, "total_exams": 1, "total_questions": 2, "subjects": {}}
        )
        aws_manager.cluster_questions_for_job = Mock(return_value=None)
        metadata = manager.process_aws_job_pipeline(
            "job-cluster-none", "jobs/job-cluster-none/original/paper.pdf", "paper.pdf"
        )
        self.assertEqual(metadata["stages"]["clustering"]["status"], "failed")
        self.assertEqual(metadata["status"], "partial_success")
        self.assertEqual(metadata["failed_stage"], "clustering")


if __name__ == "__main__":
    unittest.main()
