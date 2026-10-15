"""Issue #156: processed-question retrieval must preserve MCQ types and choices.

Parsing extracts ``questionType`` ("text"/"mcq") and MCQ ``options``,
enrichment preserves them via ``question.copy()``, and organization writes
the whole exam. The retriever rebuilt each question with a fixed projection
that omitted those fields, so clients received the stem without its choices.
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
    spec = importlib.util.spec_from_file_location("question_retriever_156", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_retriever = _load_retriever()


def _mcq(number="Q1", text="Which planet is known as the Red Planet?",
         options=("A) Earth", "B) Mars", "C) Jupiter", "D) Venus")):
    return {
        "question_number": number,
        "question_text": text,
        "marks": "2",
        "questionType": "mcq",
        "options": list(options),
    }


def _text(number="Q2", text="Explain Newton's first law."):
    return {
        "question_number": number,
        "question_text": text,
        "marks": "5",
        "questionType": "text",
    }


def _exam(questions, subject="Physics"):
    return {
        "subject": subject,
        "year": "2023",
        "semester": "V",
        "examType": "main",
        "questions": questions,
    }


class FakeS3:
    def __init__(self, objects):
        self.objects = dict(objects)

    def list_objects_v2(self, Bucket, Prefix):
        keys = [k for k in self.objects if k.startswith(Prefix)]
        if not keys:
            return {}
        return {"Contents": [{"Key": k} for k in keys]}

    def get_object(self, Bucket, Key):
        if Key not in self.objects:
            raise RuntimeError(f"No such key: {Key}")
        return {"Body": io.BytesIO(json.dumps(self.objects[Key]).encode("utf-8"))}


class TestMcqProjection(unittest.TestCase):
    def test_organized_path_preserves_mcq_and_text(self):
        job_id = "job-156-organized"
        key = f"jobs/{job_id}/organized_output/Physics/Physics_2023_V_main.json"
        s3 = FakeS3({key: {"exams": [_exam([_mcq(), _text()])]}})
        result = _retriever.get_job_questions(
            s3, "bucket", "jobs/", job_id, {"filename": "paper.pdf"}
        )
        self.assertIsNotNone(result)
        questions = result["exams"][0]["questions"]
        self.assertEqual(questions[0]["questionType"], "mcq")
        self.assertEqual(
            questions[0]["options"], ["A) Earth", "B) Mars", "C) Jupiter", "D) Venus"]
        )
        self.assertEqual(questions[1]["questionType"], "text")
        self.assertNotIn("options", questions[1])
        # Existing normalization still applies.
        self.assertEqual(questions[0]["questionNumber"], "Q1")
        self.assertEqual(questions[0]["marks"], 2)

    def test_enriched_fallback_preserves_mcq(self):
        job_id = "job-156-enriched"
        key = f"jobs/{job_id}/enriched_output/paper_enriched.json"
        s3 = FakeS3({key: {"exams": [_exam([_mcq()])]}})
        result = _retriever.get_job_questions(
            s3, "bucket", "jobs/", job_id, {"filename": "paper.pdf"}
        )
        self.assertIsNotNone(result)
        q = result["exams"][0]["questions"][0]
        self.assertEqual(q["questionType"], "mcq")
        self.assertEqual(len(q["options"]), 4)

    def test_parsed_fallback_preserves_mcq(self):
        job_id = "job-156-parsed"
        key = f"jobs/{job_id}/parsed_output/paper_parsed.json"
        s3 = FakeS3({key: {"exams": [_exam([_mcq(), _text()])]}})
        result = _retriever.get_job_questions(
            s3, "bucket", "jobs/", job_id, {"filename": "paper.pdf"}
        )
        self.assertIsNotNone(result)
        questions = result["exams"][0]["questions"]
        self.assertEqual(questions[0]["questionType"], "mcq")
        self.assertEqual(questions[0]["options"][1], "B) Mars")

    def test_field_name_and_type_aliases_normalize(self):
        exam = _exam([{
            "question_number": "Q1",
            "question_text": "Pick one.",
            "marks": "1",
            "question_type": "MCQ",
            "choices": ["a", "b"],
        }])
        _retriever._normalize_exam_questions(exam)
        q = exam["questions"][0]
        self.assertEqual(q["questionType"], "mcq")
        self.assertEqual(q["options"], ["a", "b"])

    def test_choices_without_type_infer_mcq(self):
        exam = _exam([{
            "question_number": "Q1",
            "question_text": "Pick one.",
            "marks": "1",
            "options": ["a", "b"],
        }])
        _retriever._normalize_exam_questions(exam)
        q = exam["questions"][0]
        self.assertEqual(q["questionType"], "mcq")
        self.assertEqual(q["options"], ["a", "b"])

    def test_stage_to_retrieval_round_trip(self):
        # Parsing contract -> enrichment copy -> organization payload ->
        # retriever projection must keep the MCQ intact.
        parsed = _exam([_mcq(), _text()])
        enriched_questions = [q.copy() for q in parsed["questions"]]
        for q in enriched_questions:
            q["bloomLevel"] = "Recall"
            q["bloomJustification"] = "Recall of a fact."
            q["confidence"] = 0.9
            q["difficulty"] = "Easy"
            q["keywords"] = ["planet"]
            q["topicsCovered"] = ["Solar system"]
        organized = _exam(enriched_questions)
        _retriever._normalize_exam_questions(organized)
        mcq, text = organized["questions"]
        self.assertEqual(mcq["questionType"], "mcq")
        self.assertEqual(
            mcq["options"], ["A) Earth", "B) Mars", "C) Jupiter", "D) Venus"]
        )
        self.assertEqual(mcq["bloomLevel"], "Recall")
        self.assertEqual(text["questionType"], "text")
        self.assertNotIn("options", text)


if __name__ == "__main__":
    unittest.main()
