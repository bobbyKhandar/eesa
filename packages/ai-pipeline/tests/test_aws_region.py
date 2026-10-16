"""Issue #166: documented Python AWS region (aws_location) was ignored.

The canonical ``AWS_REGION`` setting, ``AWS_DEFAULT_REGION``, and the legacy
``aws_location`` .env entry must resolve to one region that every
Textract/Bedrock/S3 client uses, with the .env file actually loaded and a
clear startup diagnostic.
"""

import importlib
import io
import os
import sys
import unittest
import tempfile
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "src"))

import aws_region
from aws_region import (
    DEFAULT_AWS_REGION,
    ensure_aws_region_configured,
    get_aws_region,
    load_pipeline_dotenv,
    resolve_aws_region,
)

REGION_KEYS = ("AWS_REGION", "AWS_DEFAULT_REGION", "aws_location")


def _clear_region_env():
    for key in REGION_KEYS:
        os.environ.pop(key, None)


class IsolatedRegionTest(unittest.TestCase):
    def setUp(self):
        # Never read or write the developer's real .env, even when it sets AWS_REGION.
        self._environment = patch.dict(os.environ)
        self._environment.start()
        self.addCleanup(self._environment.stop)
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.dotenv = Path(directory.name) / ".env"
        self._dotenv_path = patch.object(aws_region, "_pipeline_env_path", return_value=self.dotenv)
        self._dotenv_path.start()
        self.addCleanup(self._dotenv_path.stop)


class TestResolveAwsRegion(IsolatedRegionTest):
    def setUp(self):
        super().setUp()
        self._saved = {k: os.environ.get(k) for k in REGION_KEYS}
        _clear_region_env()
        aws_region._loaded_dotenv_paths.clear()

    def tearDown(self):
        _clear_region_env()
        for key, value in self._saved.items():
            if value is not None:
                os.environ[key] = value
        aws_region._loaded_dotenv_paths.clear()

    def test_precedence_aws_region_first(self):
        with patch.dict(os.environ, {"AWS_REGION": "eu-west-1", "AWS_DEFAULT_REGION": "us-east-1", "aws_location": "ap-south-1"}):
            region, source = resolve_aws_region()
        self.assertEqual((region, source), ("eu-west-1", "AWS_REGION"))

    def test_falls_back_to_aws_default_region(self):
        with patch.dict(os.environ, {"AWS_DEFAULT_REGION": "us-east-1", "aws_location": "ap-south-1"}, clear=False):
            os.environ.pop("AWS_REGION", None)
            region, source = resolve_aws_region()
        self.assertEqual((region, source), ("us-east-1", "AWS_DEFAULT_REGION"))

    def test_legacy_aws_location_is_honoured(self):
        with patch.dict(os.environ, {"aws_location": "eu-central-1"}, clear=False):
            os.environ.pop("AWS_REGION", None)
            os.environ.pop("AWS_DEFAULT_REGION", None)
            region, source = resolve_aws_region()
        self.assertEqual((region, source), ("eu-central-1", "aws_location"))

    def test_blank_values_do_not_shadow(self):
        with patch.dict(os.environ, {"AWS_REGION": "   ", "AWS_DEFAULT_REGION": "", "aws_location": "ap-south-2"}, clear=False):
            region, source = resolve_aws_region()
        self.assertEqual((region, source), ("ap-south-2", "aws_location"))

    def test_default_when_nothing_configured(self):
        region, source = resolve_aws_region()
        self.assertEqual((region, source), (DEFAULT_AWS_REGION, "default"))
        self.assertEqual(get_aws_region(), DEFAULT_AWS_REGION)

    def test_dotenv_is_loaded_without_overriding_environment(self):
        self.dotenv.write_text("aws_location=eu-west-1\n", encoding="utf-8")
        with patch.dict(os.environ, {"aws_location": "us-west-2"}):
            region, source = resolve_aws_region()
            self.assertEqual((region, source), ("us-west-2", "aws_location"))
        _clear_region_env()
        aws_region._loaded_dotenv_paths.clear()
        self.assertEqual(resolve_aws_region(), ("eu-west-1", "aws_location"))

    def test_load_pipeline_dotenv_never_overrides(self):
        import tempfile

        with tempfile.NamedTemporaryFile("w", suffix=".env", delete=False, encoding="utf-8") as handle:
            handle.write("AWS_REGION=eu-west-1\nNEW_TEST_KEY_166=hello\n")
            tmp = handle.name
        self.addCleanup(lambda: Path(tmp).unlink(missing_ok=True))
        aws_region._loaded_dotenv_paths.discard(tmp)
        with patch.dict(os.environ, {"AWS_REGION": "us-west-2"}, clear=False):
            os.environ.pop("NEW_TEST_KEY_166", None)
            load_pipeline_dotenv(tmp)
            self.assertEqual(os.environ["AWS_REGION"], "us-west-2")
            self.assertEqual(os.environ.get("NEW_TEST_KEY_166"), "hello")
        os.environ.pop("NEW_TEST_KEY_166", None)


class TestEnsureAwsRegionConfigured(IsolatedRegionTest):
    def setUp(self):
        super().setUp()
        self._saved = {k: os.environ.get(k) for k in REGION_KEYS}
        _clear_region_env()
        aws_region._loaded_dotenv_paths.clear()

    def tearDown(self):
        _clear_region_env()
        for key, value in self._saved.items():
            if value is not None:
                os.environ[key] = value
        aws_region._loaded_dotenv_paths.clear()

    def test_mirrors_resolved_region_into_sdk_chain(self):
        with patch.dict(os.environ, {"aws_location": "eu-west-1"}, clear=False):
            buf = io.StringIO()
            with redirect_stdout(buf):
                region = ensure_aws_region_configured()
            self.assertEqual(region, "eu-west-1")
            self.assertEqual(os.environ["AWS_REGION"], "eu-west-1")
            self.assertEqual(os.environ["AWS_DEFAULT_REGION"], "eu-west-1")
            self.assertIn("eu-west-1", buf.getvalue())
            self.assertIn("aws_location", buf.getvalue())

    def test_missing_configuration_logs_clear_diagnostic(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            region = ensure_aws_region_configured()
        self.assertEqual(region, DEFAULT_AWS_REGION)
        output = buf.getvalue()
        self.assertIn(DEFAULT_AWS_REGION, output)
        self.assertIn("AWS_REGION", output)
        self.assertIn("aws_location", output)

    def test_does_not_override_explicit_sdk_region(self):
        with patch.dict(
            os.environ,
            {"AWS_REGION": "us-east-1", "AWS_DEFAULT_REGION": "us-east-1"},
            clear=False,
        ):
            buf = io.StringIO()
            with redirect_stdout(buf):
                region = ensure_aws_region_configured()
            self.assertEqual(region, "us-east-1")
            self.assertEqual(os.environ["AWS_REGION"], "us-east-1")


class TestPipelineClientsUseResolvedRegion(IsolatedRegionTest):
    def setUp(self):
        super().setUp()
        self._saved = {k: os.environ.get(k) for k in REGION_KEYS}
        _clear_region_env()
        for module in (
            "aws_texttract_pipeline",
            "parsing_pipeline",
            "enrich_questions_job_based",
            "question_clustering",
        ):
            sys.modules.pop(module, None)
        aws_region._loaded_dotenv_paths.clear()

    def tearDown(self):
        _clear_region_env()
        for key, value in self._saved.items():
            if value is not None:
                os.environ[key] = value
        for module in (
            "aws_texttract_pipeline",
            "parsing_pipeline",
            "enrich_questions_job_based",
            "question_clustering",
        ):
            sys.modules.pop(module, None)
        aws_region._loaded_dotenv_paths.clear()

    def test_texttract_and_bedrock_clients_share_resolved_region(self):
        os.environ["aws_location"] = "eu-west-1"
        os.environ.pop("AWS_REGION", None)
        os.environ.pop("AWS_DEFAULT_REGION", None)
        calls = []

        import boto3

        real_client = boto3.client

        def recording_client(service, *args, **kwargs):
            calls.append((service, kwargs.get("region_name")))
            # Return a stub so module import never touches AWS.
            class _Stub:
                meta = type("meta", (), {"region_name": kwargs.get("region_name")})()

            return _Stub()

        with patch.object(boto3, "client", side_effect=recording_client):
            # boto3 is already imported; patch the attribute the pipeline
            # modules dereference at import time.
            import aws_texttract_pipeline  # noqa: F401
            import parsing_pipeline  # noqa: F401
            import enrich_questions_job_based  # noqa: F401
            import question_clustering  # noqa: F401
            importlib.reload(aws_texttract_pipeline)
            importlib.reload(parsing_pipeline)
            importlib.reload(enrich_questions_job_based)
            importlib.reload(question_clustering)

        by_service = {}
        for service, region in calls:
            by_service.setdefault(service, set()).add(region)
        self.assertIn("textract", by_service)
        self.assertIn("bedrock-runtime", by_service)
        for service in ("textract", "bedrock-runtime", "s3"):
            self.assertEqual(
                by_service.get(service),
                {"eu-west-1"},
                "%s clients must all use the resolved region" % service,
            )
        # Module-level constants expose the same region.
        self.assertEqual(aws_texttract_pipeline.AWS_REGION, "eu-west-1")
        self.assertEqual(parsing_pipeline.AWS_REGION, "eu-west-1")

        # Restore real boto3 for the rest of the suite.
        with patch.object(boto3, "client", real_client):
            pass


class TestUtilityScriptsUseSharedResolver(IsolatedRegionTest):
    """The standalone extraction utilities must adopt the shared resolver.

    They build Textract/Bedrock clients too, so they must honour the same
    contract (and the legacy ``aws_location`` .env entry) instead of reading
    ``os.environ`` on their own.
    """

    def test_textract_extract_text_uses_shared_resolver(self):
        import textract_extract_text

        self.assertIs(textract_extract_text.get_aws_region, aws_region.get_aws_region)

    def test_compare_script_uses_shared_resolver(self):
        try:
            # This CLI also has a legacy dotenv bootstrap. Do not read real files.
            with patch.object(Path, "is_file", return_value=False):
                import compare_pdf_textract_vs_bedrock_tokens as compare
        except ImportError as exc:  # pragma: no cover - optional deps
            self.skipTest("compare script dependencies unavailable: %s" % exc)
        self.assertIs(compare.get_aws_region, aws_region.get_aws_region)


if __name__ == "__main__":
    unittest.main()
