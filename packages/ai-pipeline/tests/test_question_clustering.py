"""HDBSCAN labels must stay with the question they were computed for.

questions_with_similarity drops records that have no similar matches, but
cluster_with_hdbscan labels every embedded record. Assigning those labels by
position in the filtered list shifts later cluster ids onto the wrong questions.
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
    """question_clustering builds AWS clients at import. Stub them when absent."""
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
    """Load the module without importing src/__init__.py (that pulls in cv2)."""
    _ensure_boto_stubs()
    module_path = os.path.join(
        os.path.dirname(__file__), "..", "src", "question_clustering.py"
    )
    spec = importlib.util.spec_from_file_location("question_clustering", module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load question clustering from {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_clustering = _load_question_clustering()


def _question(number, text, year):
    return {
        "question_number": number,
        "question_text": text,
        "year": year,
        "marks": 10,
        "keywords": ["os"],
    }


class TestHdbscanLabelAssignment(unittest.TestCase):
    def test_labels_follow_question_id_when_an_earlier_question_has_no_matches(self):
        """A leading question with no matches must not shift later cluster ids.

        records_to_add order, and the HDBSCAN label for each record:
          Q1 no matches  -> 11
          Q2 matches     -> 22
          Q3 no matches  -> 33
          Q4 matches     -> 44

        The filtered similarity list is [Q2, Q4]. Positional indexing would
        write 11 onto Q2 and 22 onto Q4.
        """
        job_id = "job-63"
        organized_key = f"jobs/{job_id}/organized_output/os.json"
        source = {
            "exams": [
                {
                    "subject": "Operating Systems",
                    "year": "2024",
                    "semester": "V",
                    "examType": "main",
                    "branch": "CSE",
                    "questions": [
                        _question("Q1", "Unique question with no neighbors", "2020"),
                        _question("Q2", "Repeated question about processes", "2021"),
                        _question("Q3", "Another unique question", "2022"),
                        _question("Q4", "Repeated question about threads", "2023"),
                    ],
                }
            ]
        }
        labels_by_question = {
            f"{job_id}_Q1": 11,
            f"{job_id}_Q2": 22,
            f"{job_id}_Q3": 33,
            f"{job_id}_Q4": 44,
        }
        written = {}

        def get_object(Bucket, Key):
            return {"Body": io.BytesIO(json.dumps(source).encode("utf-8"))}

        def put_object(Bucket, Key, Body, ContentType=None):
            written[Key] = json.loads(Body)

        def question_id_for(number):
            return module.cluster_question_id(job_id, organized_key, "0", number)

        def find_similar(table, query_vector, question_id, filters=None, k=5):
            if question_id in (question_id_for("Q1"), question_id_for("Q3")):
                return []
            return [
                {
                    "id": "prior-question",
                    "question_number": "Q9",
                    "similarity": 0.91,
                    "year": "2019",
                }
            ]

        def cluster(vectors):
            self.assertEqual(len(vectors), 4)
            return np.array([11, 22, 33, 44])

        module = _clustering
        module.get_or_create_lancedb_table = lambda table_name="questions": MagicMock()
        module.generate_embedding = lambda text: np.array([1.0, 0.0, 0.0], dtype=np.float32)
        module.find_similar_questions_lancedb = find_similar
        module.cluster_with_hdbscan = cluster
        module.s3_client = MagicMock()
        module.s3_client.list_objects_v2.return_value = {
            "Contents": [{"Key": organized_key}]
        }
        module.s3_client.get_object.side_effect = get_object
        module.s3_client.put_object.side_effect = put_object

        result = module.cluster_questions_for_job(job_id, "paper.pdf")

        self.assertIsNotNone(result)
        updated = written[organized_key]["exams"][0]["questions"]
        by_number = {q["question_number"]: q for q in updated}

        self.assertNotIn("clusterId", by_number["Q1"])
        self.assertNotIn("clusterId", by_number["Q3"])
        self.assertEqual(by_number["Q2"]["clusterId"], labels_by_question[f"{job_id}_Q2"])
        self.assertEqual(by_number["Q4"]["clusterId"], labels_by_question[f"{job_id}_Q4"])
        self.assertEqual(by_number["Q2"]["similarQuestionIds"], ["Q9"])
        self.assertEqual(by_number["Q4"]["similarQuestionIds"], ["Q9"])


class TestRepeatedQuestionNumbersAcrossExams(unittest.TestCase):
    def test_repeated_q1_in_two_exams_keeps_its_own_similarity(self):
        """One file with two exams must not alias both Q1 rows.

        LanceDB ids used to be ``{job_id}_{question_number}``. Write-back then
        matched only that number, so the later exam's similarity landed on
        every Q1 in the file and frequency was computed from the first Q1.
        """
        job_id = "job-repeat"
        organized_key = f"jobs/{job_id}/organized_output/papers.json"
        source = {
            "exams": [
                {
                    "subject": "Operating Systems",
                    "year": "2020",
                    "semester": "V",
                    "examType": "main",
                    "branch": "CSE",
                    "questions": [
                        _question("Q1", "exam-a process scheduling", "2020"),
                    ],
                },
                {
                    "subject": "Operating Systems",
                    "year": "2024",
                    "semester": "V",
                    "examType": "kt",
                    "branch": "CSE",
                    "questions": [
                        _question("Q1", "exam-b deadlock detection", "2024"),
                    ],
                },
            ]
        }
        expected_ids = {
            "exam-a": f"{job_id}::{organized_key}::0::Q1",
            "exam-b": f"{job_id}::{organized_key}::1::Q1",
        }
        written = {}
        added_records = {}

        def get_object(Bucket, Key):
            return {"Body": io.BytesIO(json.dumps(source).encode("utf-8"))}

        def put_object(Bucket, Key, Body, ContentType=None):
            written[Key] = json.loads(Body)

        def generate_embedding(text):
            if "exam-a" in text:
                return np.array([1.0, 0.0, 0.0], dtype=np.float32)
            if "exam-b" in text:
                return np.array([0.0, 1.0, 0.0], dtype=np.float32)
            return np.array([0.0, 0.0, 1.0], dtype=np.float32)

        def find_similar(table, query_vector, question_id, filters=None, k=5):
            if query_vector[0] == 1.0:
                return [
                    {
                        "id": "prior-a",
                        "question_number": "Q9",
                        "similarity": 0.91,
                        "year": "2011",
                    }
                ]
            if query_vector[1] == 1.0:
                return [
                    {
                        "id": "prior-b",
                        "question_number": "Q8",
                        "similarity": 0.92,
                        "year": "2012",
                    }
                ]
            return []

        table = MagicMock()

        def add(records):
            added_records["records"] = records

        table.add.side_effect = add

        module = _clustering
        module.get_or_create_lancedb_table = lambda table_name="questions": table
        module.generate_embedding = generate_embedding
        module.find_similar_questions_lancedb = find_similar
        module.cluster_with_hdbscan = lambda vectors: np.array([7, 8])
        module.s3_client = MagicMock()
        module.s3_client.list_objects_v2.return_value = {
            "Contents": [{"Key": organized_key}]
        }
        module.s3_client.get_object.side_effect = get_object
        module.s3_client.put_object.side_effect = put_object

        result = module.cluster_questions_for_job(job_id, "papers.pdf")

        self.assertIsNotNone(result)
        ids = [record["id"] for record in added_records["records"]]
        self.assertEqual(ids, [expected_ids["exam-a"], expected_ids["exam-b"]])

        exams = written[organized_key]["exams"]
        first = exams[0]["questions"][0]
        second = exams[1]["questions"][0]
        self.assertEqual(first["similarQuestionIds"], ["Q9"])
        self.assertEqual(first["appearanceFrequency"]["years"], [2011, 2020])
        self.assertEqual(first["clusterId"], 7)
        self.assertEqual(second["similarQuestionIds"], ["Q8"])
        self.assertEqual(second["appearanceFrequency"]["years"], [2012, 2024])
        self.assertEqual(second["clusterId"], 8)
        self.assertNotIn("cluster_question_id", first)
        self.assertNotIn("cluster_question_id", second)

    def test_exam_id_is_used_when_the_exam_has_one(self):
        module = _clustering
        self.assertEqual(module.exam_cluster_identity({"examId": "kt-2024"}, 1), "kt-2024")
        self.assertEqual(module.exam_cluster_identity({"year": "2020"}, 1), "1")
        self.assertEqual(
            module.question_cluster_identity({"questionId": "q-42", "question_number": "Q1"}, 0),
            "q-42",
        )
        self.assertEqual(
            module.cluster_question_id(
                "job-repeat",
                "jobs/job-repeat/organized_output/papers.json",
                "kt-2024",
                "Q1",
            ),
            "job-repeat::jobs/job-repeat/organized_output/papers.json::kt-2024::Q1",
        )


def _organized_exam(question_text, year):
    return {
        "exams": [
            {
                "subject": "Operating Systems",
                "year": year,
                "semester": "V",
                "examType": "main",
                "branch": "CSE",
                "questions": [_question("Q1", question_text, year)],
            }
        ]
    }


class TestClusteringSourceFileUpdates(unittest.TestCase):
    """S3 write-back failures must be returned, not printed and ignored."""

    def _run(self, sources, get_object, put_object, find_similar=None):
        job_id = "job-s3-updates"
        module = _clustering
        module.get_or_create_lancedb_table = lambda table_name="questions": MagicMock()
        module.generate_embedding = lambda text: np.array([1.0, 0.0, 0.0], dtype=np.float32)
        if find_similar is None:
            def find_similar(*args, **kwargs):
                return [
                    {
                        "id": "prior-question",
                        "question_number": "Q9",
                        "similarity": 0.91,
                        "year": "2019",
                    }
                ]
        module.find_similar_questions_lancedb = find_similar
        module.cluster_with_hdbscan = lambda vectors: np.array([1] * len(vectors))
        module.s3_client = MagicMock()
        module.s3_client.list_objects_v2.return_value = {
            "Contents": [{"Key": key} for key in sources]
        }
        module.s3_client.get_object.side_effect = get_object
        module.s3_client.put_object.side_effect = put_object
        return module.cluster_questions_for_job(job_id, "paper.pdf")

    def test_one_failed_source_update_is_partial_and_names_the_key(self):
        job_id = "job-s3-updates"
        kept_key = f"jobs/{job_id}/organized_output/os.json"
        failed_key = f"jobs/{job_id}/organized_output/db.json"
        sources = {
            kept_key: _organized_exam("process scheduling", "2021"),
            failed_key: _organized_exam("deadlock detection", "2022"),
        }
        reads = {}
        written = {}

        def get_object(Bucket, Key):
            reads[Key] = reads.get(Key, 0) + 1
            if Key == failed_key and reads[Key] > 1:
                raise RuntimeError("S3 read failed")
            return {"Body": io.BytesIO(json.dumps(sources[Key]).encode("utf-8"))}

        def put_object(Bucket, Key, Body, ContentType=None):
            written[Key] = json.loads(Body)

        result = self._run(sources, get_object, put_object)

        self.assertIsInstance(result, dict)
        self.assertFalse(result["success"])
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["failed_keys"], [failed_key])
        self.assertEqual(result["updated_files"], 1)
        self.assertEqual(result["expected_files"], 2)
        outcomes = {item["source_key"]: item for item in result["file_updates"]}
        self.assertEqual(outcomes[kept_key]["status"], "updated")
        self.assertEqual(outcomes[failed_key]["status"], "failed")
        self.assertIn("S3 read failed", outcomes[failed_key]["error"])
        self.assertIn(kept_key, written)
        self.assertNotIn(failed_key, written)
        summary_key = f"jobs/{job_id}/clustering_summary.json"
        self.assertEqual(written[summary_key]["failed_keys"], [failed_key])
        self.assertEqual(written[summary_key]["status"], "partial")

    def test_every_source_update_failing_is_failed_and_lists_every_key(self):
        job_id = "job-s3-updates"
        first_key = f"jobs/{job_id}/organized_output/os.json"
        second_key = f"jobs/{job_id}/organized_output/db.json"
        sources = {
            first_key: _organized_exam("process scheduling", "2021"),
            second_key: _organized_exam("deadlock detection", "2022"),
        }
        written = {}

        def get_object(Bucket, Key):
            return {"Body": io.BytesIO(json.dumps(sources[Key]).encode("utf-8"))}

        def put_object(Bucket, Key, Body, ContentType=None):
            if Key.endswith("clustering_summary.json"):
                written[Key] = json.loads(Body)
                return
            raise RuntimeError("S3 upload failed")

        result = self._run(sources, get_object, put_object)

        self.assertIsInstance(result, dict)
        self.assertFalse(result["success"])
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["failed_keys"], [first_key, second_key])
        self.assertEqual(result["updated_files"], 0)
        self.assertEqual(result["expected_files"], 2)
        self.assertEqual(
            [item["status"] for item in result["file_updates"]],
            ["failed", "failed"],
        )
        self.assertIn("S3 upload failed", result["file_updates"][0]["error"])
        summary_key = f"jobs/{job_id}/clustering_summary.json"
        self.assertEqual(written[summary_key]["status"], "failed")
        self.assertEqual(written[summary_key]["failed_keys"], [first_key, second_key])

    def test_successful_updates_stay_success_with_no_failed_keys(self):
        job_id = "job-s3-updates"
        source_key = f"jobs/{job_id}/organized_output/os.json"
        sources = {source_key: _organized_exam("process scheduling", "2021")}
        written = {}

        def get_object(Bucket, Key):
            return {"Body": io.BytesIO(json.dumps(sources[Key]).encode("utf-8"))}

        def put_object(Bucket, Key, Body, ContentType=None):
            written[Key] = json.loads(Body)

        result = self._run(sources, get_object, put_object)

        self.assertTrue(result["success"])
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["failed_keys"], [])
        self.assertEqual(result["updated_files"], 1)
        self.assertEqual(result["expected_files"], 1)
        self.assertEqual(result["file_updates"], [{"source_key": source_key, "status": "updated"}])
        self.assertIn(source_key, written)

    def test_questions_with_no_matches_are_not_failed_updates(self):
        job_id = "job-s3-updates"
        source_key = f"jobs/{job_id}/organized_output/os.json"
        sources = {source_key: _organized_exam("unique question", "2021")}

        def get_object(Bucket, Key):
            return {"Body": io.BytesIO(json.dumps(sources[Key]).encode("utf-8"))}

        def put_object(Bucket, Key, Body, ContentType=None):
            return None

        result = self._run(
            sources,
            get_object,
            put_object,
            find_similar=lambda *args, **kwargs: [],
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["failed_keys"], [])
        self.assertEqual(result["file_updates"], [])
        self.assertEqual(result["expected_files"], 0)


if __name__ == "__main__":
    unittest.main()
