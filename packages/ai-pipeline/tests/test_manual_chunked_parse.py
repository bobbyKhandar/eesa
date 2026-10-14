"""Manual parsing must process the whole document, not a truncated prefix.

ParseProcessor used to replace longer OCR text with its first 30,000
characters, warn on the console, and advance the job as an ordinary
success. Questions past the prefix were lost and retries re-sent the
same prefix. Parsing now splits the text into bounded chunks, merges
only after every chunk parsed, and fails the job with the unprocessed
portion when a chunk cannot be parsed.
"""

import importlib.util
import json
import os
import re
import sys
import types
import unittest
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


SRC_DIR = os.path.join(os.path.dirname(__file__), "..", "src")


def _ensure_real_module(name, filename):
    """Load a real sibling module, replacing a stub another test left behind.

    test_master_server binds a MagicMock to ``intelligent_chunking`` and
    never restores it, so a later module-level import would bind the mock.
    """
    existing = sys.modules.get(name)
    if existing is not None and getattr(existing, "__file__", None):
        return existing
    module_path = os.path.join(SRC_DIR, filename)
    spec = importlib.util.spec_from_file_location(name, module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load {name} from {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _load_manual_pipeline():
    """Load the CLI pipeline without importing src/__init__.py."""
    _ensure_boto_stubs()
    _ensure_real_module("intelligent_chunking", "intelligent_chunking.py")
    _ensure_real_module("chunk_merger", "chunk_merger.py")
    module_path = os.path.join(SRC_DIR, "manual_pipeline.py")
    spec = importlib.util.spec_from_file_location("manual_pipeline", module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load manual pipeline from {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["manual_pipeline"] = module
    spec.loader.exec_module(module)
    return module


_pipeline = _load_manual_pipeline()
ParseProcessor = _pipeline.ParseProcessor
Job = _pipeline.Job
Phase = _pipeline.Phase
Status = _pipeline.Status


def _job():
    return Job(
        job_id="job-121",
        filename="paper.pdf",
        file_hash="abc",
        file_size=12,
        current_phase=Phase.PARSE.value,
        status=Status.PENDING.value,
        s3_ocr_key="manual_pipeline/job-121/ocr_output/paper_ocr.json",
    )


def _model_payload(text):
    body = MagicMock()
    body.read.return_value = json.dumps({"content": [{"text": text}]}).encode()
    return {"body": body}


def _question_numbers_in(prompt):
    return sorted(int(match) for match in re.findall(r"Question (\d+):", prompt))


def _long_ocr_text(count=150, chars_per_question=300):
    """OCR text long enough to need more than one bounded chunk."""
    lines = ["Subject: Physics", "Max Marks: 100", "Year: 2023"]
    for index in range(1, count + 1):
        lines.append(f"Question {index}: " + "x" * chars_per_question)
    return "\n".join(lines)


def _exams_envelope(numbers, subject="Physics"):
    return {
        "exams": [{
            "subject": subject,
            "questions": [
                {
                    "question_number": f"Q{number}",
                    "question_text": f"text {number}",
                    "marks": "5",
                }
                for number in numbers
            ],
        }],
        "subjectsCreated": [subject],
    }


class ManualChunkedParseTest(unittest.TestCase):
    def setUp(self):
        self.db = MagicMock()
        self.s3 = MagicMock()
        self.processor = ParseProcessor(self.db, self.s3)
        self.processor.bedrock = MagicMock()
        self.s3.upload_json.return_value = (
            True,
            "manual_pipeline/job-121/parsed_output/paper_parsed.json",
        )
        self.prompts = []

    def _queue_model(self, handler):
        def invoke(**kwargs):
            body = json.loads(kwargs["body"])
            prompt = body["messages"][0]["content"]
            self.prompts.append(prompt)
            return _model_payload(handler(prompt))

        self.processor.bedrock.invoke_model.side_effect = invoke

    def _run(self, ocr_text):
        self.s3.download_json.return_value = (True, {"extracted_text": ocr_text})
        return self.processor.process_job(_job())

    def _uploaded(self):
        self.assertTrue(self.s3.upload_json.called, self.s3.upload_json.call_args_list)
        return self.s3.upload_json.call_args.args[0]

    def _assert_not_advanced(self):
        advanced = [
            call
            for call in self.db.update_job.call_args_list
            if call.kwargs.get("current_phase") == Phase.ENRICH.value
        ]
        self.assertEqual(advanced, [])
        self.assertFalse(self.s3.upload_json.called)

    def test_every_chunk_of_a_long_document_is_parsed_and_merged(self):
        def handler(prompt):
            return json.dumps(_exams_envelope(_question_numbers_in(prompt)))

        self._queue_model(handler)
        ok, message = self._run(_long_ocr_text())

        self.assertTrue(ok, message)
        self.assertGreater(len(self.prompts), 1)
        # Every question in the document reached the model and was kept.
        requested = sorted({
            number for prompt in self.prompts for number in _question_numbers_in(prompt)
        })
        self.assertEqual(requested, list(range(1, 151)))
        uploaded = self._uploaded()
        self.assertEqual(uploaded["total_questions"], 150)
        self.assertEqual(uploaded["total_exams"], 1)
        self.assertEqual(
            [question["question_number"] for question in uploaded["exams"][0]["questions"]],
            [f"Q{number}" for number in range(1, 151)],
        )
        self.assertEqual(uploaded["job_id"], "job-121")
        self.db.update_job.assert_any_call(
            "job-121",
            s3_parsed_key="manual_pipeline/job-121/parsed_output/paper_parsed.json",
            current_phase=Phase.ENRICH.value,
            status=Status.PENDING.value,
            questions_count=150,
            exams_count=1,
            error_message="",
            error_phase="",
        )

    def test_text_within_the_limit_stays_a_single_model_call(self):
        self._queue_model(lambda prompt: json.dumps(_exams_envelope([1, 2])))

        ok, message = self._run("Question 1: a\nQuestion 2: b\n")

        self.assertTrue(ok, message)
        self.assertEqual(len(self.prompts), 1)
        uploaded = self._uploaded()
        self.assertEqual(uploaded["total_questions"], 2)

    def test_unparsed_chunk_fails_the_job_with_the_unprocessed_portion(self):
        def handler(prompt):
            numbers = _question_numbers_in(prompt)
            if numbers and numbers[0] > 1:
                return "not json at all"
            return json.dumps(_exams_envelope(numbers))

        self._queue_model(handler)
        ok, message = self._run(_long_ocr_text())

        self.assertFalse(ok)
        self.assertIn("Parsing incomplete", message)
        self.assertIn("1 of", message)
        self.assertIn("unprocessed", message)
        self.assertIn("characters", message)
        self.assertIn("chunk 1", message)
        self.assertIn("JSON parse error", message)
        self._assert_not_advanced()
        failed = [
            call
            for call in self.db.update_job.call_args_list
            if call.kwargs.get("status") == Status.FAILED.value
            and call.kwargs.get("error_phase") == Phase.PARSE.value
        ]
        self.assertTrue(failed, self.db.update_job.call_args_list)
        self.assertIn("Parsing incomplete", failed[-1].kwargs["error_message"])
        self.assertEqual(failed[-1].kwargs["retry_count"], 1)

    def test_model_error_on_a_later_chunk_does_not_advance_the_job(self):
        def handler(prompt):
            numbers = _question_numbers_in(prompt)
            if numbers and numbers[0] > 1:
                raise RuntimeError("bedrock unavailable")
            return json.dumps(_exams_envelope(numbers))

        self._queue_model(handler)
        ok, message = self._run(_long_ocr_text())

        self.assertFalse(ok)
        self.assertIn("bedrock unavailable", message)
        self.assertIn("unprocessed", message)
        self._assert_not_advanced()

    def test_chunk_without_an_exams_envelope_fails_the_job(self):
        def handler(prompt):
            numbers = _question_numbers_in(prompt)
            if numbers and numbers[0] > 1:
                return json.dumps([{"subject": "Physics", "questions": []}])
            return json.dumps(_exams_envelope(numbers))

        self._queue_model(handler)
        ok, message = self._run(_long_ocr_text())

        self.assertFalse(ok)
        self.assertIn("exams list", message)
        self._assert_not_advanced()

    def test_continuation_chunks_merge_into_one_exam(self):
        first = _exams_envelope([1, 2, 3])
        second = _exams_envelope([4, 5, 6])
        self._queue_model(
            lambda prompt: json.dumps(first if _question_numbers_in(prompt)[0] == 1 else second)
        )

        ok, message = self._run(_long_ocr_text())

        self.assertTrue(ok, message)
        uploaded = self._uploaded()
        self.assertEqual(len(uploaded["exams"]), 1)
        self.assertEqual(
            [question["question_number"] for question in uploaded["exams"][0]["questions"]],
            ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"],
        )

    def test_continuation_chunk_that_starts_a_new_subject_keeps_its_exam(self):
        first = _exams_envelope([1, 2, 3])
        second = _exams_envelope([1, 2], subject="Mathematics")
        self._queue_model(
            lambda prompt: json.dumps(first if _question_numbers_in(prompt)[0] == 1 else second)
        )

        ok, message = self._run(_long_ocr_text())

        self.assertTrue(ok, message)
        uploaded = self._uploaded()
        self.assertEqual(
            [exam["subject"] for exam in uploaded["exams"]],
            ["Physics", "Mathematics"],
        )
        self.assertEqual(
            [len(exam["questions"]) for exam in uploaded["exams"]], [3, 2]
        )
        self.assertIn("Mathematics", uploaded["subjectsCreated"])

    def test_question_split_across_a_boundary_is_merged_once(self):
        first = {
            "exams": [{
                "subject": "Physics",
                "questions": [
                    {"question_number": "Q1", "question_text": "What is inertia?", "marks": "5"},
                    {"question_number": "Q2", "question_text": "Explain momentum and its"},
                ],
            }]
        }
        second = {
            "exams": [{
                "subject": "Physics",
                "questions": [
                    {"question_number": "Q2", "question_text": "conservation in detail."},
                    {"question_number": "Q3", "question_text": "Define force.", "marks": "5"},
                ],
            }]
        }

        def handler(prompt):
            numbers = _question_numbers_in(prompt)
            return json.dumps(first if numbers[0] == 1 else second)

        self._queue_model(handler)
        ok, message = self._run(_long_ocr_text())

        self.assertTrue(ok, message)
        questions = self._uploaded()["exams"][0]["questions"]
        self.assertEqual(
            [question["question_number"] for question in questions], ["Q1", "Q2", "Q3"]
        )
        self.assertEqual(
            questions[1]["question_text"],
            "Explain momentum and its conservation in detail.",
        )


if __name__ == "__main__":
    unittest.main()
