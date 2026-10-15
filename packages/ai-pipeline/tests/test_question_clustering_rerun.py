"""Issue #160: rerunning clustering for an existing job must not append copies.

Repeat execution uses stable ids and replaces the job's rows, deduplicates
neighbor identities before counting, preserves earlier jobs, and allows
recovery after an S3/summary failure without inserting copies.
"""

import importlib.util
import io
import json
import os
import sys
import types
import unittest
from unittest.mock import MagicMock

import numpy as np


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


def _load_question_clustering():
    _ensure_boto_stubs()
    module_path = os.path.join(
        os.path.dirname(__file__), "..", "src", "question_clustering.py"
    )
    spec = importlib.util.spec_from_file_location(
        "question_clustering_rerun", module_path
    )
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load question clustering from {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_clustering = _load_question_clustering()


class _FakeQuery:
    def __init__(self, results):
        self._results = results

    def limit(self, _n):
        return self

    def where(self, _clause):
        return self

    def to_list(self):
        return [dict(r) for r in self._results]


class _FakeTable:
    """Minimal in-memory LanceDB table: delete(where job_id=...) + add + search."""

    def __init__(self, rows=None):
        self.rows = list(rows or [])
        self.delete_calls = []

    def delete(self, where):
        self.delete_calls.append(where)
        # Very small parser for "job_id = '...'" with '' escaping.
        prefix = "job_id = '"
        if where.startswith(prefix) and where.endswith("'"):
            wanted = where[len(prefix):-1].replace("''", "'")
            self.rows = [r for r in self.rows if r.get("job_id") != wanted]

    def add(self, records):
        self.rows.extend(records)

    def search(self, _vector):
        return _FakeQuery([])


def _organized_source(job_id, key):
    return {
        "exams": [
            {
                "subject": "Operating Systems",
                "year": "2021",
                "semester": "V",
                "examType": "main",
                "branch": "CSE",
                "questions": [
                    {
                        "question_number": "Q1",
                        "question_text": "process scheduling question",
                        "year": "2021",
                        "marks": 10,
                        "keywords": ["os"],
                    },
                    {
                        "question_number": "Q2",
                        "question_text": "deadlock detection question",
                        "year": "2021",
                        "marks": 10,
                        "keywords": ["os"],
                    },
                ],
            }
        ]
    }


class TestRerunIsIdempotent(unittest.TestCase):
    def _run_job(self, module, table, job_id, key, source):
        module.get_or_create_lancedb_table = lambda table_name="questions": table
        module.generate_embedding = lambda text: np.array(
            [1.0, 0.0, 0.0], dtype=np.float32
        )
        module.find_similar_questions_lancedb = lambda *a, **k: []
        module.cluster_with_hdbscan = lambda vectors: np.array([0] * len(vectors))
        module.s3_client = MagicMock()
        module.s3_client.list_objects_v2.return_value = {
            "Contents": [{"Key": key}]
        }

        def get_object(Bucket, Key):
            return {"Body": io.BytesIO(json.dumps(source).encode("utf-8"))}

        written = {}

        def put_object(Bucket, Key, Body, ContentType=None):
            written[Key] = json.loads(Body)

        module.s3_client.get_object.side_effect = get_object
        module.s3_client.put_object.side_effect = put_object
        result = module.cluster_questions_for_job(job_id, "paper.pdf")
        self.assertIsNotNone(result)
        return result

    def test_rerun_same_job_replaces_instead_of_appending(self):
        module = _clustering
        job_id = "job-rerun-160"
        key = f"jobs/{job_id}/organized_output/os.json"
        source = _organized_source(job_id, key)
        table = _FakeTable()

        self._run_job(module, table, job_id, key, source)
        first_count = len(table.rows)
        self.assertEqual(first_count, 2)
        self.assertTrue(table.delete_calls)

        self._run_job(module, table, job_id, key, source)
        self.assertEqual(len(table.rows), first_count)

        ids = [r["id"] for r in table.rows]
        self.assertEqual(len(ids), len(set(ids)))

    def test_rerun_preserves_earlier_jobs(self):
        module = _clustering
        job_id = "job-rerun-160"
        key = f"jobs/{job_id}/organized_output/os.json"
        source = _organized_source(job_id, key)
        other = {
            "id": "other-job::other-key::0::Q1",
            "question_number": "Q1",
            "job_id": "other-job",
            "vector": [1.0, 0.0, 0.0],
        }
        table = _FakeTable(rows=[other])

        self._run_job(module, table, job_id, key, source)
        self._run_job(module, table, job_id, key, source)

        by_job = {}
        for row in table.rows:
            by_job.setdefault(row["job_id"], 0)
            by_job[row["job_id"]] += 1
        self.assertEqual(by_job.get("other-job"), 1)
        self.assertEqual(by_job.get(job_id), 2)

    def test_replace_falls_back_to_add_when_delete_unsupported(self):
        module = _clustering
        added = {}

        class NoDeleteTable:
            def add(self, records):
                added["records"] = list(records)

        module.replace_job_records(NoDeleteTable(), "job-x", [{"id": "a"}])
        self.assertEqual(added["records"], [{"id": "a"}])

    def test_records_deduplicated_by_id(self):
        module = _clustering
        records = [{"id": "a"}, {"id": "a"}, {"id": "b"}]
        unique = module._deduplicate_records_by_id(records)
        self.assertEqual([r["id"] for r in unique], ["a", "b"])


class TestNeighborDeduplication(unittest.TestCase):
    def test_find_similar_dedupes_repeated_copies(self):
        module = _clustering
        query_id = "job-160::key::0::Q1"
        dup = {
            "id": "dup-id",
            "question_number": "Q9",
            "_distance": 0.05,
            "year": "2019",
        }
        distinct = {
            "id": "other-id",
            "question_number": "Q8",
            "_distance": 0.06,
            "year": "2020",
        }
        table = MagicMock()
        table.search.return_value.limit.return_value.where.return_value.to_list.return_value = [
            {"id": query_id, "_distance": 0.0, "question_number": "Q1"},
            dict(dup),
            dict(dup),
            dict(distinct),
            dict(distinct),
        ]
        # search().limit() chain: search returns object with limit; simplify
        fake = _FakeQuery(
            [
                {"id": query_id, "_distance": 0.0, "question_number": "Q1"},
                dict(dup),
                dict(dup),
                dict(distinct),
            ]
        )
        table.search = lambda _vec: fake

        similar = module.find_similar_questions_lancedb(
            table, np.array([1.0, 0.0, 0.0]), query_id, k=5
        )
        ids = [s["id"] for s in similar]
        self.assertEqual(ids, ["dup-id", "other-id"])

    def test_appearance_frequency_counts_unique_identities(self):
        module = _clustering
        similar = [
            {"id": "dup-id", "year": "2019"},
            {"id": "dup-id", "year": "2019"},
            {"id": "other-id", "year": "2020"},
        ]
        freq = module.calculate_appearance_frequency(
            None, {"year": "2021"}, similar
        )
        self.assertEqual(freq["count"], 3)  # self + 2 unique neighbors
        self.assertEqual(freq["years"], [2019, 2020, 2021])


if __name__ == "__main__":
    unittest.main()
