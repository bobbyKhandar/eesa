"""Manual enrichment must not record a partial model response as success.

EnrichProcessor.process_job used to merge whatever entries came back and fail
only when none of them applied. A short array, or a full array with invalid
Bloom fields, left questions unclassified and still advanced the job.
"""

import importlib.util
import json
import os
import sys
import types
import unittest
from unittest.mock import MagicMock


ENRICH_BATCH_MAX_ATTEMPTS = 3


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


def _load_manual_pipeline():
    """Load the CLI pipeline without importing src/__init__.py."""
    _ensure_boto_stubs()
    module_path = os.path.join(
        os.path.dirname(__file__), "..", "src", "manual_pipeline.py"
    )
    spec = importlib.util.spec_from_file_location("manual_pipeline", module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load manual pipeline from {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["manual_pipeline"] = module
    spec.loader.exec_module(module)
    return module


_pipeline = _load_manual_pipeline()
EnrichProcessor = _pipeline.EnrichProcessor
Job = _pipeline.Job
Phase = _pipeline.Phase
Status = _pipeline.Status


def _questions(count):
    return [
        {
            "question_number": f"Q{index + 1}",
            "question_text": f"Question {index + 1} about motion",
            "marks": "5",
        }
        for index in range(count)
    ]


def _valid_entry(level="Apply", difficulty="Medium"):
    return {
        "bloomLevel": level,
        "difficulty": difficulty,
        "keywords": ["motion"],
        "topicsCovered": ["kinematics"],
    }


def _parsed(question_count, subject="Physics"):
    return {
        "exams": [
            {
                "subject": subject,
                "questions": _questions(question_count),
            }
        ]
    }


def _job():
    return Job(
        job_id="job-98",
        filename="paper.pdf",
        file_hash="abc",
        file_size=12,
        current_phase=Phase.ENRICH.value,
        status=Status.PENDING.value,
        s3_parsed_key="manual_pipeline/job-98/parsed_output/paper_parsed.json",
    )


def _model_payload(payload):
    if isinstance(payload, str):
        text = payload
    else:
        text = json.dumps(payload)
    body = MagicMock()
    body.read.return_value = json.dumps({"content": [{"text": text}]}).encode()
    return {"body": body}


class ManualEnrichmentCoverageTest(unittest.TestCase):
    def setUp(self):
        self.db = MagicMock()
        self.s3 = MagicMock()
        self.processor = EnrichProcessor(self.db, self.s3)
        self.processor.bedrock = MagicMock()
        self.s3.upload_json.return_value = (
            True,
            "manual_pipeline/job-98/enriched_output/paper_enriched.json",
        )

    def _queue_model(self, payloads):
        responses = [_model_payload(payload) for payload in payloads]

        def invoke(**_kwargs):
            if not responses:
                raise AssertionError("model invoked more times than the test queued")
            return responses.pop(0)

        self.processor.bedrock.invoke_model.side_effect = invoke

    def _run(self, parsed):
        self.s3.download_json.return_value = (True, parsed)
        return self.processor.process_job(_job())

    def _assert_job_failed(self, ok, message):
        self.assertFalse(ok)
        self.assertIn("Incomplete enrichment", message)
        self.assertIn(f"{ENRICH_BATCH_MAX_ATTEMPTS} attempts", message)
        self.s3.upload_json.assert_not_called()
        failed = [
            call
            for call in self.db.update_job.call_args_list
            if call.kwargs.get("status") == Status.FAILED.value
            and call.kwargs.get("error_phase") == Phase.ENRICH.value
        ]
        self.assertTrue(failed, self.db.update_job.call_args_list)
        self.assertIn("Incomplete enrichment", failed[-1].kwargs["error_message"])
        advanced = [
            call
            for call in self.db.update_job.call_args_list
            if call.kwargs.get("current_phase") == Phase.ORGANIZE.value
            or call.kwargs.get("status") == Status.PENDING.value
            and call.kwargs.get("s3_enriched_key")
        ]
        self.assertEqual(advanced, [])

    def test_short_batch_is_retried_then_fails_the_job(self):
        parsed = _parsed(3)
        self._queue_model([[_valid_entry()]] * ENRICH_BATCH_MAX_ATTEMPTS)

        ok, message = self._run(parsed)

        self._assert_job_failed(ok, message)
        self.assertIn("expected 3", message)
        self.assertIn("got 1", message)
        self.assertEqual(
            self.processor.bedrock.invoke_model.call_count,
            ENRICH_BATCH_MAX_ATTEMPTS,
        )
        self.assertNotIn("bloomLevel", parsed["exams"][0]["questions"][0])

    def test_longer_batch_is_not_treated_as_full_coverage(self):
        self._queue_model([[_valid_entry()] * 4] * ENRICH_BATCH_MAX_ATTEMPTS)

        ok, message = self._run(_parsed(3))

        self._assert_job_failed(ok, message)
        self.assertIn("expected 3", message)
        self.assertIn("got 4", message)

    def test_invalid_enrichment_fields_are_retried_then_fail(self):
        invalid_sets = [
            [_valid_entry(), {"bloomLevel": "Remember", "difficulty": "Medium",
                              "keywords": ["a"], "topicsCovered": ["b"]}, _valid_entry()],
            [_valid_entry(difficulty="medium"), _valid_entry(), _valid_entry()],
            [{**_valid_entry(), "keywords": "motion"}, _valid_entry(), _valid_entry()],
            [{k: v for k, v in _valid_entry().items() if k != "topicsCovered"},
             _valid_entry(), _valid_entry()],
            [_valid_entry(), None, _valid_entry()],
        ]
        for entries in invalid_sets:
            with self.subTest(entries=entries):
                self.setUp()
                self._queue_model([entries] * ENRICH_BATCH_MAX_ATTEMPTS)
                ok, message = self._run(_parsed(3))
                self._assert_job_failed(ok, message)
                self.assertIn("invalid", message.lower())
                self.assertEqual(
                    self.processor.bedrock.invoke_model.call_count,
                    ENRICH_BATCH_MAX_ATTEMPTS,
                )

    def test_non_array_response_is_retried_then_fails(self):
        self._queue_model(["no json here"] * ENRICH_BATCH_MAX_ATTEMPTS)

        ok, message = self._run(_parsed(2))

        self._assert_job_failed(ok, message)
        self.assertIn("expected 2", message)
        self.assertIn("got 0", message)
        self.assertEqual(
            self.processor.bedrock.invoke_model.call_count,
            ENRICH_BATCH_MAX_ATTEMPTS,
        )

    def test_model_error_on_one_batch_does_not_succeed_the_job(self):
        parsed = _parsed(11)
        responses = [_model_payload([_valid_entry()] * 10)]

        def invoke(**_kwargs):
            if responses:
                return responses.pop(0)
            raise RuntimeError("bedrock unavailable")

        self.processor.bedrock.invoke_model.side_effect = invoke

        ok, message = self._run(parsed)

        self._assert_job_failed(ok, message)
        self.assertIn("batch 2", message)
        self.assertIn("bedrock unavailable", message)
        self.assertEqual(self.processor.bedrock.invoke_model.call_count, 1 + ENRICH_BATCH_MAX_ATTEMPTS)
        self.s3.upload_json.assert_not_called()

    def test_retry_accepts_a_later_complete_valid_batch(self):
        parsed = _parsed(3)
        complete = [
            _valid_entry("Understand"),
            _valid_entry("Apply"),
            _valid_entry("Analyze", "Hard"),
        ]
        self._queue_model([[_valid_entry("Recall")], complete])

        ok, message = self._run(parsed)

        self.assertTrue(ok)
        self.assertIn("3", message)
        self.assertEqual(self.processor.bedrock.invoke_model.call_count, 2)
        uploaded = self.s3.upload_json.call_args.args[0]
        questions = uploaded["exams"][0]["questions"]
        self.assertEqual(
            [question["bloomLevel"] for question in questions],
            ["Understand", "Apply", "Analyze"],
        )
        self.assertEqual(
            [question["difficulty"] for question in questions],
            ["Medium", "Medium", "Hard"],
        )
        self.assertEqual(questions[0]["question_text"], "Question 1 about motion")
        self.assertEqual(uploaded["total_enriched"], 3)
        self.db.update_job.assert_any_call(
            "job-98",
            s3_enriched_key="manual_pipeline/job-98/enriched_output/paper_enriched.json",
            current_phase=Phase.ORGANIZE.value,
            status=Status.PENDING.value,
            error_message="",
            error_phase="",
        )

    def test_empty_keyword_lists_are_valid_when_classification_is_present(self):
        entry = _valid_entry()
        entry["keywords"] = []
        entry["topicsCovered"] = []
        self._queue_model([[entry, entry]])

        ok, message = self._run(_parsed(2))

        self.assertTrue(ok, message)
        self.assertEqual(self.processor.bedrock.invoke_model.call_count, 1)
        uploaded = self.s3.upload_json.call_args.args[0]
        self.assertEqual(uploaded["total_enriched"], 2)

    def test_fenced_json_with_full_coverage_succeeds(self):
        entries = [_valid_entry("Recall", "Easy"), _valid_entry("Create", "Hard")]
        fenced = "```json\n" + json.dumps(entries) + "\n```"
        self._queue_model([fenced])

        ok, message = self._run(_parsed(2))

        self.assertTrue(ok, message)
        uploaded = self.s3.upload_json.call_args.args[0]
        levels = [question["bloomLevel"] for question in uploaded["exams"][0]["questions"]]
        self.assertEqual(levels, ["Recall", "Create"])

    def test_direct_batch_validation_rejects_partial_and_invalid_entries(self):
        questions = _questions(2)
        self._queue_model([[_valid_entry()]])
        with self.assertRaises(ValueError) as mismatched:
            self.processor._enrich_batch(questions, "Physics")
        self.assertIn("expected 2", str(mismatched.exception))
        self.assertIn("got 1", str(mismatched.exception))

        bad = [_valid_entry(), {**_valid_entry(), "bloomLevel": "apply"}]
        self._queue_model([bad])
        with self.assertRaises(ValueError) as invalid:
            self.processor._enrich_batch(questions, "Physics")
        self.assertIn("invalid", str(invalid.exception).lower())

        self._queue_model([[_valid_entry(), _valid_entry("Evaluate", "Easy")]])
        result = self.processor._enrich_batch(questions, "Physics")
        self.assertEqual(len(result), 2)
        self.assertEqual(result[1]["bloomLevel"], "Evaluate")
        self.assertEqual(result[1]["difficulty"], "Easy")


if __name__ == "__main__":
    unittest.main()
