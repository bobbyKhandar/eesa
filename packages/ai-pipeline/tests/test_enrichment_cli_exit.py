"""The standalone S3 enrichment CLI must actually run its pipeline.

Running ``enrich_questions_s3_pipeline.py`` checked the S3 bucket, printed the
input directory and exited 0 without enriching anything. The entry point now
runs ``process_all_questions``, returns its counts, and exits nonzero when a
file failed or the run was incomplete.
"""

import ast
import importlib.util
import io
import json
import os
import shutil
import sys
import tempfile
import types
import unittest
from contextlib import ExitStack, redirect_stdout
from pathlib import Path
from unittest.mock import MagicMock, patch


def _ensure_boto_stubs():
    """The enrichment module builds AWS clients at import."""
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


def _load_pipeline():
    _ensure_boto_stubs()
    module_path = os.path.join(
        os.path.dirname(__file__), "..", "src", "enrich_questions_s3_pipeline.py"
    )
    spec = importlib.util.spec_from_file_location(
        "enrich_questions_s3_pipeline", module_path
    )
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load enrichment pipeline from {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["enrich_questions_s3_pipeline"] = module
    spec.loader.exec_module(module)
    return module


PIPELINE_PATH = os.path.join(
    os.path.dirname(__file__), "..", "src", "enrich_questions_s3_pipeline.py"
)

pipeline = _load_pipeline()


def _main_guard_source():
    """Source of the module's ``if __name__ == "__main__"`` block."""
    tree = ast.parse(Path(PIPELINE_PATH).read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.If) and "__main__" in ast.unparse(node.test):
            return ast.unparse(node)
    raise AssertionError("enrich_questions_s3_pipeline.py has no __main__ block")


def _write_questions(directory, name="questions.json"):
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, name)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump({"exams": [{"subject": "Physics", "questions": []}]}, handle)
    return path


def _fresh_state(**overrides):
    state = {"processed": [], "failed": [], "retry_counts": {}}
    state.update(overrides)
    return state


def _fake_summary(**overrides):
    """A summary dict shaped like the one process_all_questions returns."""
    summary = {
        "input_dir": "",
        "total_files": 1,
        "processed": 1,
        "newly_processed": 1,
        "failed": 0,
        "skipped": 0,
        "total_cost": 0.001,
        "incomplete_reasons": [],
        "success": True,
    }
    summary.update(overrides)
    return summary


def _identity(input_dir, filename):
    return pipeline.source_identity(input_dir, os.path.join(input_dir, filename))


class EnrichmentCliTestCase(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.input_dir = os.path.join(self.temp_dir, "parsedQuestions")
        _write_questions(self.input_dir)
        bucket = patch.object(pipeline, "_ensure_s3_bucket_exists", return_value=True)
        bucket.start()
        self.addCleanup(bucket.stop)

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _patch_aws(self, state=None, enrich_results=None, upload_ok=True, save_ok=True):
        """Mock the Bedrock, S3 and state boundaries, returning a call log."""
        calls = {"enriched": [], "uploaded": [], "state_saves": 0}
        loaded = _fresh_state(**(state or {}))

        def load_state():
            return loaded

        def save_state(state):
            calls["state_saves"] += 1
            return save_ok

        def enrich(file_path, filename, use_instructions=True):
            calls["enriched"].append(filename)
            return (enrich_results or {}).get(filename, {"exams": []})

        def upload(enriched_data, source_id):
            calls["uploaded"].append(source_id)
            return upload_ok

        stack = ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(
            patch.object(pipeline, "_load_state", side_effect=load_state)
        )
        stack.enter_context(patch.object(pipeline, "_save_state", side_effect=save_state))
        stack.enter_context(
            patch.object(pipeline, "_enrich_single_file", side_effect=enrich)
        )
        stack.enter_context(
            patch.object(pipeline, "_upload_enriched_to_s3", side_effect=upload)
        )
        return calls

    def _patch_input(self, answer):
        answer_patch = patch("builtins.input", return_value=answer)
        answer_patch.start()
        self.addCleanup(answer_patch.stop)

    def _missing_bucket(self):
        bucket = patch.object(pipeline, "_ensure_s3_bucket_exists", return_value=False)
        bucket.start()
        self.addCleanup(bucket.stop)

    def _run_pipeline(self, input_dir=None, **kwargs):
        """Run process_all_questions with the AWS boundaries mocked out."""
        skip_processed = kwargs.pop("skip_processed", True)
        calls = self._patch_aws(**kwargs)
        output = io.StringIO()
        with redirect_stdout(output):
            summary = pipeline.process_all_questions(
                input_dir or self.input_dir, skip_processed=skip_processed
            )
        return summary, calls, output.getvalue()

    def _run_cli(self, argv, **kwargs):
        """Run the CLI entry point, returning exit code, output and summary."""
        self._patch_aws(**kwargs)
        real_pipeline = pipeline.process_all_questions
        summary_holder = {}

        def recording_pipeline(input_dir, skip_processed=True):
            summary = real_pipeline(input_dir, skip_processed=skip_processed)
            summary_holder["summary"] = summary
            return summary

        output = io.StringIO()
        with patch.object(
            pipeline, "process_all_questions", side_effect=recording_pipeline
        ) as run_pipeline:
            with redirect_stdout(output):
                exit_code = pipeline.main(list(argv))
            called = run_pipeline.call_count
        return types.SimpleNamespace(
            exit_code=exit_code,
            output=output.getvalue(),
            summary=summary_holder.get("summary"),
            called=called,
        )


class SummaryTests(EnrichmentCliTestCase):
    def test_run_returns_processed_failed_and_skipped_counts(self):
        _write_questions(self.input_dir, "second.json")
        summary, calls, _ = self._run_pipeline()

        self.assertEqual(summary["input_dir"], self.input_dir)
        self.assertEqual(summary["total_files"], 2)
        self.assertEqual(summary["processed"], 2)
        self.assertEqual(summary["newly_processed"], 2)
        self.assertEqual(summary["failed"], 0)
        self.assertEqual(summary["skipped"], 0)
        self.assertEqual(summary["incomplete_reasons"], [])
        self.assertTrue(summary["success"])
        self.assertEqual(sorted(calls["enriched"]), ["questions.json", "second.json"])
        self.assertEqual(
            sorted(calls["uploaded"]),
            sorted(
                [
                    _identity(self.input_dir, "questions.json"),
                    _identity(self.input_dir, "second.json"),
                ]
            ),
        )
        self.assertGreater(calls["state_saves"], 0)

    def test_failed_enrichment_is_counted_and_the_run_is_not_successful(self):
        summary, calls, _ = self._run_pipeline(
            enrich_results={"questions.json": None}
        )

        self.assertEqual(summary["total_files"], 1)
        self.assertEqual(summary["failed"], 1)
        self.assertEqual(summary["processed"], 0)
        self.assertEqual(summary["newly_processed"], 0)
        self.assertEqual(summary["skipped"], 0)
        self.assertEqual(summary["incomplete_reasons"], [])
        self.assertFalse(summary["success"])
        self.assertEqual(calls["enriched"], ["questions.json"])
        self.assertEqual(calls["uploaded"], [])

    def test_failed_upload_is_counted_as_a_failed_file(self):
        summary, _, _ = self._run_pipeline(upload_ok=False)

        self.assertEqual(summary["failed"], 1)
        self.assertEqual(summary["processed"], 0)
        self.assertFalse(summary["success"])

    def test_already_processed_input_is_skipped_and_not_failed(self):
        identity = _identity(self.input_dir, "questions.json")
        summary, calls, _ = self._run_pipeline(state={"processed": [identity]})

        self.assertEqual(summary["total_files"], 1)
        self.assertEqual(summary["skipped"], 1)
        self.assertEqual(summary["processed"], 0)
        self.assertEqual(summary["failed"], 0)
        self.assertTrue(summary["success"])
        self.assertEqual(calls["enriched"], [])
        self.assertEqual(calls["uploaded"], [])

    def test_missing_input_directory_is_reported_as_incomplete(self):
        missing = os.path.join(self.temp_dir, "not-there")
        summary, _, _ = self._run_pipeline(input_dir=missing)

        self.assertEqual(summary["total_files"], 0)
        self.assertEqual(summary["processed"], 0)
        self.assertEqual(summary["failed"], 0)
        self.assertFalse(summary["success"])
        self.assertEqual(len(summary["incomplete_reasons"]), 1)
        self.assertIn("does not exist", summary["incomplete_reasons"][0])

    def test_input_directory_without_json_files_is_incomplete(self):
        empty_dir = os.path.join(self.temp_dir, "empty")
        os.makedirs(empty_dir)
        summary, _, _ = self._run_pipeline(input_dir=empty_dir)

        self.assertEqual(summary["total_files"], 0)
        self.assertFalse(summary["success"])
        self.assertEqual(len(summary["incomplete_reasons"]), 1)
        self.assertIn("no JSON files", summary["incomplete_reasons"][0])

    def test_file_stuck_at_the_retry_limit_is_incomplete(self):
        _write_questions(self.input_dir, "error_sheet.json")
        identity = _identity(self.input_dir, "error_sheet.json")
        summary, calls, _ = self._run_pipeline(
            state={"retry_counts": {identity: pipeline.MAX_RETRIES}}
        )

        self.assertEqual(summary["total_files"], 2)
        self.assertEqual(summary["processed"], 1)
        self.assertEqual(summary["failed"], 0)
        self.assertFalse(summary["success"])
        self.assertNotIn("error_sheet.json", calls["enriched"])
        self.assertEqual(
            summary["incomplete_reasons"],
            [f"1 file(s) exhausted the {pipeline.MAX_RETRIES} retry limit"],
        )

    def test_unsavable_state_is_reported_as_incomplete(self):
        summary, calls, _ = self._run_pipeline(save_ok=False)

        self.assertEqual(summary["processed"], 1)
        self.assertEqual(summary["failed"], 0)
        self.assertGreater(calls["state_saves"], 0)
        self.assertFalse(summary["success"])
        self.assertEqual(
            summary["incomplete_reasons"], ["enrichment state could not be saved"]
        )

    def test_processed_entries_use_the_source_identity(self):
        summary, calls, _ = self._run_pipeline()
        identity = _identity(self.input_dir, "questions.json")

        self.assertEqual(calls["uploaded"], [identity])
        self.assertIn("__ns", identity)
        self.assertTrue(summary["success"])


class IncompleteRunReasonsTests(unittest.TestCase):
    def setUp(self):
        self.existing_dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.existing_dir, ignore_errors=True)

    def test_complete_run_has_no_reasons(self):
        reasons = pipeline.incomplete_run_reasons(
            input_dir=self.existing_dir,
            total_files=5,
            retry_counts={},
            state_saved=True,
        )

        self.assertEqual(reasons, [])

    def test_missing_directory_is_reported_even_without_files(self):
        reasons = pipeline.incomplete_run_reasons(
            input_dir=os.path.join(self.existing_dir, "does-not-exist"),
            total_files=0,
            retry_counts={},
            state_saved=True,
        )

        self.assertEqual(len(reasons), 1)
        self.assertIn("does not exist", reasons[0])

    def test_empty_directory_is_reported(self):
        reasons = pipeline.incomplete_run_reasons(
            input_dir=self.existing_dir,
            total_files=0,
            retry_counts={},
            state_saved=True,
        )

        self.assertEqual(len(reasons), 1)
        self.assertIn("no JSON files", reasons[0])

    def test_only_files_at_the_retry_limit_are_reported(self):
        reasons = pipeline.incomplete_run_reasons(
            input_dir=self.existing_dir,
            total_files=4,
            retry_counts={
                "a.json__ns0123456789ab": pipeline.MAX_RETRIES,
                "b.json__ns0123456789ab": pipeline.MAX_RETRIES - 1,
            },
            state_saved=True,
        )

        self.assertEqual(reasons, [f"1 file(s) exhausted the {pipeline.MAX_RETRIES} retry limit"])

    def test_unsaved_state_is_reported(self):
        reasons = pipeline.incomplete_run_reasons(
            input_dir=self.existing_dir,
            total_files=1,
            retry_counts={},
            state_saved=False,
        )

        self.assertEqual(reasons, ["enrichment state could not be saved"])

    def test_every_problem_is_reported_together(self):
        reasons = pipeline.incomplete_run_reasons(
            input_dir=self.existing_dir,
            total_files=1,
            retry_counts={"a.json__ns0123456789ab": pipeline.MAX_RETRIES},
            state_saved=False,
        )

        self.assertEqual(len(reasons), 2)


class CliExitCodeTests(EnrichmentCliTestCase):
    def test_exits_zero_when_every_file_is_processed(self):
        run = self._run_cli([self.input_dir])

        self.assertEqual(run.exit_code, 0)
        self.assertEqual(run.called, 1)
        self.assertEqual(run.summary["processed"], 1)
        self.assertTrue(run.summary["success"])
        self.assertIn("success=True", run.output)

    def test_exits_nonzero_when_a_file_fails(self):
        run = self._run_cli(
            [self.input_dir], enrich_results={"questions.json": None}
        )

        self.assertEqual(run.exit_code, 1)
        self.assertEqual(run.summary["failed"], 1)
        self.assertFalse(run.summary["success"])
        self.assertIn("failed=1", run.output)

    def test_exits_nonzero_when_the_input_directory_is_missing(self):
        run = self._run_cli([os.path.join(self.temp_dir, "missing")])

        self.assertEqual(run.exit_code, 1)
        self.assertFalse(run.summary["success"])
        self.assertIn("does not exist", run.output)

    def test_exits_nonzero_when_the_input_directory_has_no_json(self):
        empty_dir = os.path.join(self.temp_dir, "empty")
        os.makedirs(empty_dir)
        run = self._run_cli([empty_dir])

        self.assertEqual(run.exit_code, 1)
        self.assertIn("no JSON files", run.output)

    def test_exits_nonzero_when_a_file_exhausted_its_retries(self):
        _write_questions(self.input_dir, "error_sheet.json")
        identity = _identity(self.input_dir, "error_sheet.json")
        run = self._run_cli(
            [self.input_dir],
            state={"retry_counts": {identity: pipeline.MAX_RETRIES}},
        )

        self.assertEqual(run.exit_code, 1)
        self.assertIn("retry limit", run.output)

    def test_exits_zero_when_everything_is_already_processed(self):
        identity = _identity(self.input_dir, "questions.json")
        run = self._run_cli([self.input_dir], state={"processed": [identity]})

        self.assertEqual(run.exit_code, 0)
        self.assertEqual(run.summary["skipped"], 1)
        self.assertIn("skipped=1", run.output)

    def test_runs_the_pipeline_once_with_the_given_directory(self):
        run = self._run_cli([self.input_dir + os.sep])

        self.assertEqual(run.exit_code, 0)
        self.assertEqual(run.summary["input_dir"], os.path.abspath(self.input_dir))
        self.assertEqual(run.summary["total_files"], 1)

    def test_aborts_without_running_the_pipeline_when_the_user_declines(self):
        self._missing_bucket()
        self._patch_input("n")
        with patch.object(
            pipeline, "process_all_questions", return_value=_fake_summary()
        ) as declined:
            run = self._run_cli([self.input_dir])

        self.assertEqual(run.exit_code, 1)
        self.assertEqual(declined.call_count, 0)
        self.assertEqual(run.called, 0)
        self.assertIn("Aborted by user", run.output)

    def test_continues_when_the_user_accepts_the_missing_bucket(self):
        self._missing_bucket()
        self._patch_input("y")
        run = self._run_cli([self.input_dir])

        self.assertEqual(run.exit_code, 0)
        self.assertEqual(run.called, 1)
        self.assertEqual(run.summary["processed"], 1)
        self.assertIn("not available", run.output)

    def test_exit_code_follows_a_summary_that_reports_failures(self):
        self._patch_aws()
        with patch.object(
            pipeline,
            "process_all_questions",
            return_value=_fake_summary(failed=2, success=False),
        ):
            run = self._run_cli([self.input_dir])

        self.assertEqual(run.exit_code, 1)
        self.assertIn("failed=2", run.output)


class MainGuardTests(EnrichmentCliTestCase):
    def _run_guard(self, argv):
        """Execute the module's ``__main__`` block in the module namespace."""
        guard = _main_guard_source()
        previous_name = pipeline.__name__
        previous_argv = sys.argv
        pipeline.__name__ = "__main__"
        sys.argv = ["enrich_questions_s3_pipeline.py"] + list(argv)
        output = io.StringIO()
        try:
            with redirect_stdout(output):
                exec(compile(guard, PIPELINE_PATH, "exec"), pipeline.__dict__)
        finally:
            pipeline.__name__ = previous_name
            sys.argv = previous_argv
        return output.getvalue()

    def test_guard_runs_main_with_the_command_line_arguments(self):
        self._patch_aws()
        with patch.object(
            pipeline, "process_all_questions", return_value=_fake_summary()
        ) as run_pipeline:
            with self.assertRaises(SystemExit) as caught:
                self._run_guard([self.input_dir])

        self.assertEqual(caught.exception.code, 0)
        self.assertEqual(run_pipeline.call_count, 1)
        self.assertEqual(
            run_pipeline.call_args.args, (os.path.abspath(self.input_dir),)
        )
        self.assertEqual(run_pipeline.call_args.kwargs, {"skip_processed": True})

    def test_guard_exits_nonzero_when_the_run_is_not_successful(self):
        self._patch_aws()
        with patch.object(
            pipeline,
            "process_all_questions",
            return_value=_fake_summary(
                input_dir=self.input_dir, failed=1, success=False
            ),
        ):
            with self.assertRaises(SystemExit) as caught:
                self._run_guard([self.input_dir])

        self.assertEqual(caught.exception.code, 1)


if __name__ == "__main__":
    unittest.main()
