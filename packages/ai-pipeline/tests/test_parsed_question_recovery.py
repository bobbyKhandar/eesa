"""Issue #163: parsed-question recovery must read the producer's actual keys.

The parsing producer writes ``parsed_output/{stem}_parsed.json`` (and one
artifact per chunk under ``parsed_chunks/`` for chunked jobs), but the
retriever's Level-3 fallback read ``parsed_output.json``. Recovered exams
must also go through the same normalization contract as higher stages.
"""

import importlib.util
import io
import json
import os
import unittest

_TESTS_DIR = os.path.dirname(__file__)
_SRC_DIR = os.path.join(_TESTS_DIR, "..", "src")


def _load_retriever():
    path = os.path.join(_SRC_DIR, "api", "question_retriever.py")
    spec = importlib.util.spec_from_file_location("question_retriever_163", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_retriever = _load_retriever()


def _parsed_exam(subject="Physics"):
    return {
        "subject": subject,
        "year": "2023",
        "semester": "V",
        "examType": "main",
        "questions": [
            {
                "question_number": "Q1",
                "question_text": "Define force.",
                "marks": "10",
            }
        ],
    }


class FakeS3:
    """Minimal S3 double keyed by exact object key, recording reads."""

    def __init__(self, objects):
        self.objects = dict(objects)
        self.got_keys = []

    def list_objects_v2(self, Bucket, Prefix):
        keys = [k for k in self.objects if k.startswith(Prefix)]
        if not keys:
            return {}
        return {"Contents": [{"Key": k} for k in keys]}

    def get_object(self, Bucket, Key):
        self.got_keys.append(Key)
        if Key not in self.objects:
            raise RuntimeError(f"No such key: {Key}")
        return {"Body": io.BytesIO(json.dumps(self.objects[Key]).encode("utf-8"))}


class TestParsedRecovery(unittest.TestCase):
    def test_recovers_filename_scoped_key_and_normalizes(self):
        job_id = "job-163-parsed"
        key = f"jobs/{job_id}/parsed_output/paper_parsed.json"
        s3 = FakeS3({key: {"exams": [_parsed_exam()]}})
        result = _retriever.get_job_questions(
            s3, "bucket", "jobs/", job_id, {"filename": "paper.pdf"}
        )
        self.assertIsNotNone(result)
        self.assertEqual(result["job_id"], job_id)
        self.assertEqual(len(result["exams"]), 1)
        q = result["exams"][0]["questions"][0]
        # Same output contract as organized/enriched stages.
        self.assertEqual(q["questionNumber"], "Q1")
        self.assertEqual(q["questionText"], "Define force.")
        self.assertEqual(q["marks"], 10)
        self.assertIn("bloomLevel", q)
        self.assertEqual(result["summary"]["totalQuestions"], 1)
        self.assertIn(key, s3.got_keys)

    def test_legacy_root_key_is_not_read(self):
        job_id = "job-163-legacy"
        legacy_key = f"jobs/{job_id}/parsed_output.json"
        s3 = FakeS3({legacy_key: {"exams": [_parsed_exam()]}})
        result = _retriever.get_job_questions(
            s3, "bucket", "jobs/", job_id, {"filename": "paper.pdf"}
        )
        self.assertIsNone(result)
        self.assertNotIn(legacy_key, s3.got_keys)

    def test_missing_filename_falls_back_to_prefix_listing(self):
        job_id = "job-163-nometa"
        key = f"jobs/{job_id}/parsed_output/paper_parsed.json"
        s3 = FakeS3({key: {"exams": [_parsed_exam()]}})
        result = _retriever.get_job_questions(s3, "bucket", "jobs/", job_id, {})
        self.assertIsNotNone(result)
        self.assertEqual(len(result["exams"]), 1)
        self.assertEqual(
            result["exams"][0]["questions"][0]["questionNumber"], "Q1"
        )

    def test_malicious_filename_does_not_escape_prefix(self):
        job_id = "job-163-traversal"
        good_key = f"jobs/{job_id}/parsed_output/paper_parsed.json"
        s3 = FakeS3({good_key: {"exams": [_parsed_exam()]}})
        result = _retriever.get_job_questions(
            s3, "bucket", "jobs/", job_id, {"filename": "../../paper.pdf"}
        )
        self.assertIsNotNone(result)
        for key in s3.got_keys:
            self.assertTrue(key.startswith(f"jobs/{job_id}/"))

    def test_chunked_recovers_via_manifest(self):
        job_id = "job-163-chunked"
        chunk0 = f"jobs/{job_id}/parsed_chunks/chunk_0_paper.json"
        chunk1 = f"jobs/{job_id}/parsed_chunks/chunk_1_paper.json"
        meta = f"jobs/{job_id}/parsed_chunks/_metadata.json"
        objects = {
            chunk0: {"exams": [_parsed_exam("Physics")]},
            chunk1: {"exams": [_parsed_exam("Chemistry")]},
            meta: {"chunk_keys": [chunk0, chunk1]},
        }
        s3 = FakeS3(objects)
        result = _retriever.get_job_questions(
            s3, "bucket", "jobs/", job_id, {"filename": "paper.pdf"}
        )
        self.assertIsNotNone(result)
        subjects = sorted(e["subject"] for e in result["exams"])
        self.assertEqual(subjects, ["Chemistry", "Physics"])
        # Chunk artifacts are normalized too, not appended raw.
        for exam in result["exams"]:
            self.assertIn("questionNumber", exam["questions"][0])
        self.assertEqual(result["summary"]["totalExams"], 2)

    def test_chunked_recovers_via_listing_without_manifest(self):
        job_id = "job-163-chunklist"
        chunk0 = f"jobs/{job_id}/parsed_chunks/chunk_0_paper.json"
        s3 = FakeS3({chunk0: {"exams": [_parsed_exam()]}})
        result = _retriever.get_job_questions(
            s3, "bucket", "jobs/", job_id, {"filename": "paper.pdf"}
        )
        self.assertIsNotNone(result)
        self.assertEqual(len(result["exams"]), 1)
        self.assertEqual(
            result["exams"][0]["questions"][0]["questionText"], "Define force."
        )

    def test_no_parsed_artifacts_returns_none(self):
        s3 = FakeS3({})
        result = _retriever.get_job_questions(
            s3, "bucket", "jobs/", "job-163-empty", {"filename": "paper.pdf"}
        )
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
