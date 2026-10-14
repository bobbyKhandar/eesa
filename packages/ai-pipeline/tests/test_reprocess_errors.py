"""Parsing recovery must keep the exams envelope.

A shared extractor preferred the first nested array, so a valid parsing
response {"exams": [...]} was saved as a bare array and counted as success.
Enrichment recovery and organize_by_subject both require that exams root.
Enrichment responses are arrays, so each stage validates its own root.
"""

import importlib.util
import io
import json
import os
import re
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import MagicMock, patch


def _ensure_boto_stubs():
    """reprocess_errors builds a Bedrock client at import. Stub it when absent."""
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


def _load_reprocess_errors():
    """Load the recovery CLI without importing src/__init__.py."""
    _ensure_boto_stubs()
    _ensure_real_module("intelligent_chunking", "intelligent_chunking.py")
    _ensure_real_module("chunk_merger", "chunk_merger.py")
    module_path = os.path.join(SRC_DIR, "reprocess_errors.py")
    spec = importlib.util.spec_from_file_location("reprocess_errors", module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load reprocess_errors from {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["reprocess_errors"] = module
    spec.loader.exec_module(module)
    return module


reprocess = _load_reprocess_errors()


PARSING_ENVELOPE = {
    "exams": [
        {
            "subject": "S",
            "questions": [{"question_text": "Q"}],
        }
    ]
}

ENRICHMENT_ARRAY = [
    {
        "questionIndex": 0,
        "bloomLevel": "Apply",
        "bloomJustification": "Uses a known method on a new case",
        "confidence": 0.9,
        "difficulty": "Medium",
        "keywords": ["method"],
        "topicsCovered": ["application"],
    }
]


def _fenced(payload) -> str:
    return "```json\n" + json.dumps(payload) + "\n```"


class TestRecoveryJsonRoot(unittest.TestCase):
    def test_strips_fences_and_keeps_parsing_object_root(self):
        cleaned = reprocess.clean_json_response(_fenced(PARSING_ENVELOPE))
        payload = json.loads(cleaned)

        self.assertIsInstance(payload, dict)
        self.assertEqual(payload["exams"][0]["subject"], "S")
        self.assertEqual(payload["exams"][0]["questions"][0]["question_text"], "Q")

    def test_keeps_the_object_root_when_prose_precedes_the_exams_envelope(self):
        response = "Parsed exam follows:\n" + json.dumps(PARSING_ENVELOPE)
        cleaned = reprocess.clean_json_response(response)
        payload = json.loads(cleaned)

        self.assertEqual(payload, PARSING_ENVELOPE)

    def test_strips_fences_and_keeps_enrichment_array_root(self):
        cleaned = reprocess.clean_json_response(_fenced(ENRICHMENT_ARRAY))
        payload = json.loads(cleaned)

        self.assertIsInstance(payload, list)
        self.assertEqual(payload[0]["questionIndex"], 0)
        self.assertEqual(payload[0]["bloomLevel"], "Apply")

    def test_parsing_stage_rejects_a_bare_array(self):
        payload, error = reprocess.extract_stage_payload(
            json.dumps([{"subject": "S", "questions": [{"question_text": "Q"}]}]),
            "parsing",
        )

        self.assertIsNone(payload)
        self.assertIn("invalid parsing schema", error)

    def test_parsing_stage_rejects_an_object_without_an_exams_list(self):
        payload, error = reprocess.extract_stage_payload(
            json.dumps({"exams": {"subject": "S"}}),
            "parsing",
        )

        self.assertIsNone(payload)
        self.assertIn("invalid parsing schema", error)

    def test_parsing_stage_returns_the_exams_envelope(self):
        payload, error = reprocess.extract_stage_payload(
            _fenced(PARSING_ENVELOPE),
            "parsing",
        )

        self.assertIsNone(error)
        self.assertEqual(payload, PARSING_ENVELOPE)

    def test_enrichment_stage_returns_the_array(self):
        payload, error = reprocess.extract_stage_payload(
            _fenced(ENRICHMENT_ARRAY),
            "enrichment",
        )

        self.assertIsNone(error)
        self.assertEqual(payload, ENRICHMENT_ARRAY)

    def test_enrichment_stage_rejects_an_object(self):
        payload, error = reprocess.extract_stage_payload(
            json.dumps({"exams": []}),
            "enrichment",
        )

        self.assertIsNone(payload)
        self.assertIn("invalid enrichment schema", error)


class TestReprocessStageFiles(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.reprocessed = root / "reprocessed"
        self.parsed_questions = root / "parsedQuestions"
        (self.reprocessed / "parsed").mkdir(parents=True)
        (self.reprocessed / "enriched").mkdir(parents=True)
        (self.reprocessed / "failed").mkdir(parents=True)
        self.parsed_questions.mkdir()
        self.dir_patch = patch.multiple(
            reprocess,
            REPROCESSED_DIR=self.reprocessed,
            PARSED_QUESTIONS_DIR=self.parsed_questions,
        )
        self.dir_patch.start()

    def tearDown(self):
        self.dir_patch.stop()
        self.tmp.cleanup()

    def test_parsing_recovery_saves_the_exams_envelope(self):
        error_file = Path(self.tmp.name) / "paper.txt.error.txt"
        error_file.write_text("Q1 What is a compiler?\n", encoding="utf-8")

        with patch.object(reprocess, "call_bedrock_api", return_value=_fenced(PARSING_ENVELOPE)):
            with redirect_stdout(io.StringIO()):
                saved = reprocess.reprocess_parsed_error(error_file)

        output = self.reprocessed / "parsed" / "paper.json"
        self.assertTrue(saved)
        payload = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(payload["exams"], PARSING_ENVELOPE["exams"])
        self.assertEqual(payload["subjectsCreated"], [])
        self.assertFalse((self.reprocessed / "failed" / "paper_parse_failed.txt").exists())

    def test_parsing_recovery_reports_a_bare_array_as_failure(self):
        error_file = Path(self.tmp.name) / "paper.txt.error.txt"
        error_file.write_text("Q1 What is a compiler?\n", encoding="utf-8")
        bare_array = [{"subject": "S", "questions": [{"question_text": "Q"}]}]

        with patch.object(reprocess, "call_bedrock_api", return_value=json.dumps(bare_array)):
            with redirect_stdout(io.StringIO()) as stdout:
                saved = reprocess.reprocess_parsed_error(error_file)

        output = self.reprocessed / "parsed" / "paper.json"
        failure = self.reprocessed / "failed" / "paper_parse_failed.txt"
        self.assertFalse(saved)
        self.assertFalse(output.exists())
        self.assertIn("invalid parsing schema", stdout.getvalue())
        self.assertIn("invalid parsing schema", failure.read_text(encoding="utf-8"))

    def test_enrichment_recovery_keeps_array_classifications_on_the_exams_envelope(self):
        parsed = {
            "exams": [
                {
                    "subject": "Algorithms",
                    "questions": [{"question_text": "Apply Dijkstra", "marks": "10"}],
                }
            ]
        }
        (self.parsed_questions / "Algo.json").write_text(json.dumps(parsed), encoding="utf-8")
        error_file = Path(self.tmp.name) / "Algo_bloom.error.txt"
        error_file.write_text("previous failure", encoding="utf-8")

        with patch.object(reprocess, "call_bedrock_api", return_value=_fenced(ENRICHMENT_ARRAY)):
            with redirect_stdout(io.StringIO()):
                saved = reprocess.reprocess_enriched_error(error_file)

        output = self.reprocessed / "enriched" / "Algo_enriched.json"
        self.assertTrue(saved)
        data = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(data["exams"][0]["subject"], "Algorithms")
        self.assertEqual(data["exams"][0]["questions"][0]["bloomLevel"], "Apply")

    def test_enrichment_recovery_reports_an_object_root_as_failure(self):
        parsed = {
            "exams": [
                {
                    "subject": "Algorithms",
                    "questions": [{"question_text": "Apply Dijkstra"}],
                }
            ]
        }
        (self.parsed_questions / "Algo.json").write_text(json.dumps(parsed), encoding="utf-8")
        error_file = Path(self.tmp.name) / "Algo_bloom.error.txt"
        error_file.write_text("previous failure", encoding="utf-8")

        with patch.object(
            reprocess,
            "call_bedrock_api",
            return_value=json.dumps({"exams": parsed["exams"]}),
        ):
            with redirect_stdout(io.StringIO()) as stdout:
                saved = reprocess.reprocess_enriched_error(error_file)

        output = self.reprocessed / "enriched" / "Algo_enriched.json"
        failure = self.reprocessed / "failed" / "Algo_bloom_failed.txt"
        self.assertFalse(saved)
        self.assertFalse(output.exists())
        self.assertIn("invalid enrichment schema", stdout.getvalue())
        self.assertIn("invalid enrichment schema", failure.read_text(encoding="utf-8"))


def _long_ocr_text(count=40, chars_per_question=220):
    """OCR text long enough to need more than one bounded chunk."""
    lines = ["Subject: Physics", "Year: 2023"]
    for index in range(1, count + 1):
        lines.append(f"Question {index}: " + "x" * chars_per_question)
    return "\n".join(lines)


def _question_numbers_in(prompt):
    return sorted(int(match) for match in re.findall(r"Question (\d+):", prompt))


def _indexes_in(prompt):
    return sorted(int(match) for match in re.findall(r"\[Question (\d+)\]", prompt))


class TestRecoveryCoversTheWholeInput(unittest.TestCase):
    """Recovery must process every chunk/batch, not just the first prefix."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.reprocessed = root / "reprocessed"
        self.parsed_questions = root / "parsedQuestions"
        (self.reprocessed / "parsed").mkdir(parents=True)
        (self.reprocessed / "enriched").mkdir(parents=True)
        (self.reprocessed / "failed").mkdir(parents=True)
        self.parsed_questions.mkdir()
        self.dir_patch = patch.multiple(
            reprocess,
            REPROCESSED_DIR=self.reprocessed,
            PARSED_QUESTIONS_DIR=self.parsed_questions,
        )
        self.dir_patch.start()

    def tearDown(self):
        self.dir_patch.stop()
        self.tmp.cleanup()

    def _parse_every_chunk(self, prompt, system_prompt=""):
        numbers = _question_numbers_in(prompt)
        return json.dumps({
            "exams": [{
                "subject": "Physics",
                "questions": [
                    {
                        "question_number": f"Q{number}",
                        "question_text": f"text {number}",
                        "marks": "5",
                    }
                    for number in numbers
                ],
            }],
            "subjectsCreated": ["Physics"],
        })

    def test_long_document_is_parsed_in_chunks_and_merged(self):
        text = _long_ocr_text()
        error_file = Path(self.tmp.name) / "paper.txt.error.txt"
        error_file.write_text(text, encoding="utf-8")
        prompts = []

        def call(prompt, system_prompt=""):
            prompts.append(prompt)
            return self._parse_every_chunk(prompt, system_prompt)

        with patch.object(reprocess, "call_bedrock_api", side_effect=call):
            with redirect_stdout(io.StringIO()):
                saved = reprocess.reprocess_parsed_error(error_file)

        output = self.reprocessed / "parsed" / "paper.json"
        self.assertTrue(saved)
        payload = json.loads(output.read_text(encoding="utf-8"))
        questions = payload["exams"][0]["questions"]
        self.assertEqual(
            [question["question_number"] for question in questions],
            [f"Q{number}" for number in range(1, 41)],
        )
        self.assertIn("Physics", payload["subjectsCreated"])
        # The whole text reached the model across the chunk prompts.
        self.assertGreater(len(prompts), 1)
        requested = sorted({n for prompt in prompts for n in _question_numbers_in(prompt)})
        self.assertEqual(requested, list(range(1, 41)))

    def test_unprocessed_chunk_is_reported_and_nothing_is_saved(self):
        text = _long_ocr_text()
        error_file = Path(self.tmp.name) / "paper.txt.error.txt"
        error_file.write_text(text, encoding="utf-8")

        def call(prompt, system_prompt=""):
            numbers = _question_numbers_in(prompt)
            if numbers and numbers[0] > 1:
                return "not json at all"
            return self._parse_every_chunk(prompt, system_prompt)

        with patch.object(reprocess, "call_bedrock_api", side_effect=call):
            with redirect_stdout(io.StringIO()) as stdout:
                saved = reprocess.reprocess_parsed_error(error_file)

        output = self.reprocessed / "parsed" / "paper.json"
        self.assertFalse(saved)
        self.assertFalse(output.exists())
        printed = stdout.getvalue()
        self.assertIn("Incomplete recovery", printed)
        self.assertIn("unprocessed", printed)
        self.assertRegex(printed, r"chunk \d+:")

    def test_enrichment_classifies_every_question_across_batches(self):
        questions = [
            {
                "question_text": f"Question {index} about motion",
                "marks": "5",
                "questionType": "text",
            }
            for index in range(25)
        ]
        (self.parsed_questions / "Algo.json").write_text(
            json.dumps({"exams": [{"subject": "Physics", "questions": questions}]}),
            encoding="utf-8",
        )
        error_file = Path(self.tmp.name) / "Algo_bloom.error.txt"
        error_file.write_text("previous failure", encoding="utf-8")
        prompts = []

        def call(prompt, system_prompt=""):
            prompts.append(prompt)
            indexes = _indexes_in(prompt)
            return json.dumps([
                {
                    "questionIndex": index,
                    "bloomLevel": "Apply",
                    "bloomJustification": "Uses a known method",
                    "confidence": 0.9,
                    "difficulty": "Medium",
                    "keywords": ["motion"],
                    "topicsCovered": ["kinematics"],
                }
                for index in indexes
            ])

        with patch.object(reprocess, "call_bedrock_api", side_effect=call):
            with redirect_stdout(io.StringIO()):
                saved = reprocess.reprocess_enriched_error(error_file)

        output = self.reprocessed / "enriched" / "Algo_enriched.json"
        self.assertTrue(saved)
        enriched = json.loads(output.read_text(encoding="utf-8"))
        stored = enriched["exams"][0]["questions"]
        self.assertEqual(len(stored), 25)
        self.assertTrue(all(question["bloomLevel"] == "Apply" for question in stored))
        self.assertEqual(len(prompts), 3)
        covered = sorted({i for prompt in prompts for i in _indexes_in(prompt)})
        self.assertEqual(covered, list(range(25)))

    def test_enrichment_batch_that_does_not_cover_its_questions_fails(self):
        questions = [
            {"question_text": f"Question {index}", "marks": "5"} for index in range(12)
        ]
        (self.parsed_questions / "Algo.json").write_text(
            json.dumps({"exams": [{"subject": "Physics", "questions": questions}]}),
            encoding="utf-8",
        )
        error_file = Path(self.tmp.name) / "Algo_bloom.error.txt"
        error_file.write_text("previous failure", encoding="utf-8")

        def call(prompt, system_prompt=""):
            indexes = _indexes_in(prompt)
            if indexes[0] == 0:
                # A short batch: questions past the first prefix stay raw.
                return json.dumps([
                    {
                        "questionIndex": index,
                        "bloomLevel": "Apply",
                        "bloomJustification": "Uses a known method",
                        "confidence": 0.9,
                        "difficulty": "Medium",
                        "keywords": ["motion"],
                        "topicsCovered": ["kinematics"],
                    }
                    for index in indexes[:2]
                ])
            return json.dumps([
                {
                    "questionIndex": index,
                    "bloomLevel": "Apply",
                    "bloomJustification": "Uses a known method",
                    "confidence": 0.9,
                    "difficulty": "Medium",
                    "keywords": ["motion"],
                    "topicsCovered": ["kinematics"],
                }
                for index in indexes
            ])

        with patch.object(reprocess, "call_bedrock_api", side_effect=call):
            with redirect_stdout(io.StringIO()) as stdout:
                saved = reprocess.reprocess_enriched_error(error_file)

        output = self.reprocessed / "enriched" / "Algo_enriched.json"
        failure = self.reprocessed / "failed" / "Algo_bloom_failed.txt"
        self.assertFalse(saved)
        self.assertFalse(output.exists())
        printed = stdout.getvalue()
        self.assertIn("Incomplete enrichment", printed)
        self.assertIn("questions 0-9", printed)
        self.assertIn("expected 10 enrichment entries, got 2", printed)
        self.assertIn("expected 10 enrichment entries, got 2", failure.read_text(encoding="utf-8"))
        # The untouched parsed file must not gain partial classifications.
        stored = json.loads((self.parsed_questions / "Algo.json").read_text(encoding="utf-8"))
        self.assertNotIn("bloomLevel", stored["exams"][0]["questions"][0])

    def test_enrichment_batches_stay_within_the_bounds(self):
        short = [{"question_text": "short", "marks": "5"} for _ in range(25)]
        batches = reprocess._enrichment_batches(
            short, reprocess.RECOVERY_ENRICH_BATCH_SIZE, reprocess.RECOVERY_ENRICH_MAX_CHARS
        )
        self.assertEqual([len(batch) for batch in batches], [10, 10, 5])

        oversized = [
            {"question_text": "y" * 20000, "marks": "5"},
            {"question_text": "short", "marks": "5"},
        ]
        batches = reprocess._enrichment_batches(
            oversized, reprocess.RECOVERY_ENRICH_BATCH_SIZE, reprocess.RECOVERY_ENRICH_MAX_CHARS
        )
        self.assertEqual(batches, [[0], [1]])


if __name__ == "__main__":
    unittest.main()
