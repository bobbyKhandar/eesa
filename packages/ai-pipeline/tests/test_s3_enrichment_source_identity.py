"""Standalone S3 enrichment must not alias inputs by basename.

dir_a/questions.json and dir_b/questions.json used to share one processed
entry and one enriched_questions object. Identity is the input-relative path
plus a short hash of the input directory. Legacy basename state is not applied
to a different directory.
"""

import copy
import hashlib
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import types
import unittest
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


pipeline = _load_pipeline()


def _write_questions(directory, name="questions.json"):
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, name)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump({"exams": [{"subject": "Physics", "questions": []}]}, handle)
    return path


def _expected_hash(input_dir):
    namespace = pipeline.normalize_input_namespace(input_dir)
    return hashlib.sha256(namespace.encode("utf-8")).hexdigest()[:12]


class SourceIdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.dir_a = os.path.join(self.temp_dir, "dir_a")
        self.dir_b = os.path.join(self.temp_dir, "dir_b")
        self.file_a = _write_questions(self.dir_a)
        self.file_b = _write_questions(self.dir_b)

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_same_basename_in_different_directories_has_distinct_identities(self):
        identity_a = pipeline.source_identity(self.dir_a, self.file_a)
        identity_b = pipeline.source_identity(self.dir_b, self.file_b)

        self.assertNotEqual(identity_a, identity_b)
        self.assertNotEqual(identity_a, "questions.json")
        self.assertTrue(identity_a.startswith("questions.json__ns"))
        self.assertTrue(identity_b.startswith("questions.json__ns"))
        self.assertTrue(identity_a.endswith(_expected_hash(self.dir_a)))
        self.assertTrue(identity_b.endswith(_expected_hash(self.dir_b)))

    def test_identity_is_stable_for_equivalent_paths(self):
        direct = pipeline.source_identity(self.dir_a, self.file_a)
        trailing = pipeline.source_identity(self.dir_a + os.sep, self.file_a)

        parent = os.path.dirname(self.dir_a)
        previous = os.getcwd()
        os.chdir(parent)
        try:
            relative = pipeline.source_identity("dir_a", os.path.join("dir_a", "questions.json"))
        finally:
            os.chdir(previous)

        self.assertEqual(direct, trailing)
        self.assertEqual(direct, relative)

    def test_nested_relative_path_is_part_of_the_identity(self):
        nested_dir = os.path.join(self.dir_a, "semester")
        nested_file = _write_questions(nested_dir)
        identity = pipeline.source_identity(self.dir_a, nested_file)

        self.assertTrue(identity.startswith("semester/questions.json__ns"))
        self.assertNotEqual(identity, pipeline.source_identity(self.dir_a, self.file_a))

    def test_output_key_includes_identity_and_not_bare_basename(self):
        identity_a = pipeline.source_identity(self.dir_a, self.file_a)
        identity_b = pipeline.source_identity(self.dir_b, self.file_b)
        key_a = pipeline.enriched_output_key(identity_a)
        key_b = pipeline.enriched_output_key(identity_b)

        self.assertEqual(key_a, f"enriched_questions/{identity_a}_enriched.json")
        self.assertNotEqual(key_a, key_b)
        self.assertNotEqual(key_a, "enriched_questions/questions_enriched.json")
        self.assertNotIn(key_b, key_a)

    def test_upload_writes_the_namespaced_key(self):
        identity = pipeline.source_identity(self.dir_a, self.file_a)
        with patch.object(pipeline, "s3_client") as s3_client:
            uploaded = pipeline._upload_enriched_to_s3({"exams": []}, identity)

        self.assertTrue(uploaded)
        key = s3_client.put_object.call_args.kwargs["Key"]
        self.assertEqual(key, pipeline.enriched_output_key(identity))


class LegacyStateMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.dir_a = os.path.join(self.temp_dir, "dir_a")
        self.dir_b = os.path.join(self.temp_dir, "dir_b")
        self.file_a = _write_questions(self.dir_a)
        self.file_b = _write_questions(self.dir_b)
        self.nested = _write_questions(os.path.join(self.dir_a, "nested"))

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def _legacy_state(self, **overrides):
        state = {
            "processed": ["questions.json"],
            "failed": ["error_questions.json"],
            "retry_counts": {"error_questions.json": 2},
            "last_updated": "2026-01-01T00:00:00",
        }
        state.update(overrides)
        return state

    def test_unscoped_legacy_basename_does_not_become_current_identity(self):
        state = self._legacy_state()
        migrated = pipeline.migrate_legacy_enrichment_state(
            state, self.dir_b, [self.file_b]
        )
        identity_b = pipeline.source_identity(self.dir_b, self.file_b)

        self.assertNotIn(identity_b, migrated["processed"])
        self.assertNotIn("questions.json", migrated["processed"])
        self.assertIn("questions.json", migrated["legacy_unscoped_processed"])
        self.assertIn("error_questions.json", migrated["legacy_unscoped_failed"])
        self.assertEqual(
            migrated["legacy_unscoped_retry_counts"]["error_questions.json"], 2
        )
        self.assertNotIn("error_questions.json", migrated["retry_counts"])

    def test_matching_source_namespace_adopts_a_unique_basename(self):
        state = self._legacy_state(
            source_namespace=self.dir_a + os.sep,
            failed=[],
            retry_counts={},
        )
        migrated = pipeline.migrate_legacy_enrichment_state(
            state, self.dir_a, [self.file_a]
        )
        identity_a = pipeline.source_identity(self.dir_a, self.file_a)

        self.assertEqual(migrated["processed"], [identity_a])
        self.assertEqual(migrated["legacy_unscoped_processed"], [])
        self.assertEqual(
            pipeline.normalize_input_namespace(migrated["source_namespace"]),
            pipeline.normalize_input_namespace(self.dir_a),
        )

    def test_adoption_does_not_apply_to_a_different_directory(self):
        state = self._legacy_state(source_namespace=self.dir_a, failed=[], retry_counts={})
        migrated = pipeline.migrate_legacy_enrichment_state(
            state, self.dir_b, [self.file_b]
        )
        identity_b = pipeline.source_identity(self.dir_b, self.file_b)

        self.assertNotIn(identity_b, migrated["processed"])
        self.assertIn("questions.json", migrated["legacy_unscoped_processed"])

    def test_ambiguous_basename_is_not_adopted(self):
        state = self._legacy_state(
            source_namespace=self.dir_a,
            failed=[],
            retry_counts={},
        )
        migrated = pipeline.migrate_legacy_enrichment_state(
            state, self.dir_a, [self.file_a, self.nested]
        )

        self.assertEqual(migrated["processed"], [])
        self.assertIn("questions.json", migrated["legacy_unscoped_processed"])
        self.assertNotIn(
            pipeline.source_identity(self.dir_a, self.file_a), migrated["processed"]
        )
        self.assertNotIn(
            pipeline.source_identity(self.dir_a, self.nested), migrated["processed"]
        )

    def test_namespaced_entries_are_preserved(self):
        identity_a = pipeline.source_identity(self.dir_a, self.file_a)
        state = {
            "processed": [identity_a],
            "failed": [],
            "retry_counts": {identity_a: 1},
        }
        migrated = pipeline.migrate_legacy_enrichment_state(
            state, self.dir_b, [self.file_b]
        )

        self.assertEqual(migrated["processed"], [identity_a])
        self.assertEqual(migrated["retry_counts"], {identity_a: 1})

    def test_later_adoption_reads_previously_unscoped_entries(self):
        state = self._legacy_state(failed=["error_questions.json"], retry_counts={"error_questions.json": 1})
        parked = pipeline.migrate_legacy_enrichment_state(
            state, self.dir_b, [self.file_b]
        )
        parked["source_namespace"] = self.dir_a
        error_file = _write_questions(self.dir_a, "error_questions.json")
        adopted = pipeline.migrate_legacy_enrichment_state(
            parked, self.dir_a, [self.file_a, error_file]
        )

        self.assertEqual(
            adopted["processed"], [pipeline.source_identity(self.dir_a, self.file_a)]
        )
        self.assertEqual(
            adopted["failed"], [pipeline.source_identity(self.dir_a, error_file)]
        )
        self.assertEqual(
            adopted["retry_counts"][pipeline.source_identity(self.dir_a, error_file)],
            1,
        )
        self.assertEqual(adopted["legacy_unscoped_processed"], [])
        self.assertEqual(adopted["legacy_unscoped_failed"], [])

    def test_migration_is_idempotent(self):
        state = self._legacy_state(source_namespace=self.dir_a)
        error_file = _write_questions(self.dir_a, "error_questions.json")
        once = pipeline.migrate_legacy_enrichment_state(
            state, self.dir_a, [self.file_a, error_file]
        )
        snapshot = copy.deepcopy(once)
        twice = pipeline.migrate_legacy_enrichment_state(
            once, self.dir_a, [self.file_a, error_file]
        )

        self.assertEqual(snapshot, twice)


class ProcessAllQuestionsIdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.dir_a = os.path.join(self.temp_dir, "dir_a")
        self.dir_b = os.path.join(self.temp_dir, "dir_b")
        self.file_a = _write_questions(self.dir_a)
        self.file_b = _write_questions(self.dir_b)

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def _run(self, input_dir, state):
        enriched = []
        uploaded = []

        def enrich(file_path, filename, use_instructions=True):
            enriched.append(os.path.abspath(file_path))
            return {"exams": []}

        def upload(enriched_data, source_id):
            uploaded.append(source_id)
            return True

        with patch.object(pipeline, "_load_state", return_value=state), patch.object(
            pipeline, "_save_state", return_value=True
        ), patch.object(pipeline, "_enrich_single_file", side_effect=enrich), patch.object(
            pipeline, "_upload_enriched_to_s3", side_effect=upload
        ):
            pipeline.process_all_questions(input_dir, skip_processed=True)
        return enriched, uploaded

    def test_legacy_basename_does_not_skip_a_new_directory(self):
        state = {
            "processed": ["questions.json"],
            "failed": [],
            "retry_counts": {},
        }
        enriched, uploaded = self._run(self.dir_b, state)
        identity_b = pipeline.source_identity(self.dir_b, self.file_b)

        self.assertEqual(enriched, [os.path.abspath(self.file_b)])
        self.assertEqual(uploaded, [identity_b])
        self.assertIn(identity_b, state["processed"])
        self.assertNotIn("questions.json", state["processed"])

    def test_namespaced_identity_skips_only_that_input(self):
        identity_a = pipeline.source_identity(self.dir_a, self.file_a)
        state = {
            "processed": [identity_a],
            "failed": [],
            "retry_counts": {},
        }
        enriched_a, uploaded_a = self._run(self.dir_a, state)
        enriched_b, uploaded_b = self._run(self.dir_b, dict(state))

        self.assertEqual(enriched_a, [])
        self.assertEqual(uploaded_a, [])
        self.assertEqual(uploaded_b, [pipeline.source_identity(self.dir_b, self.file_b)])
        self.assertEqual(enriched_b, [os.path.abspath(self.file_b)])

    def test_adopted_legacy_state_skips_the_pinned_directory_only(self):
        state = {
            "processed": ["questions.json"],
            "failed": [],
            "retry_counts": {},
            "source_namespace": self.dir_a,
        }
        enriched_a, _uploaded_a = self._run(self.dir_a, state)
        enriched_b, uploaded_b = self._run(self.dir_b, {
            "processed": list(state["processed"]),
            "failed": [],
            "retry_counts": {},
            "source_namespace": state["source_namespace"],
            "legacy_unscoped_processed": list(state.get("legacy_unscoped_processed", [])),
            "legacy_unscoped_failed": list(state.get("legacy_unscoped_failed", [])),
            "legacy_unscoped_retry_counts": dict(state.get("legacy_unscoped_retry_counts", {})),
        })

        self.assertEqual(enriched_a, [])
        self.assertEqual(uploaded_b, [pipeline.source_identity(self.dir_b, self.file_b)])
        self.assertEqual(enriched_b, [os.path.abspath(self.file_b)])


if __name__ == "__main__":
    unittest.main()
