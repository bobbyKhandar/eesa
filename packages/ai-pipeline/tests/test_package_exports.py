"""The documented ``src`` package interface must resolve to real modules.

``src/__init__.py`` used to export ``.ocr_engine`` and ``.image_processor``.
Local renames moved those modules to ``local_ocr_engine`` and
``local_image_processor_pipeline``, so every ``src.*`` import — including the
documented ``from src.pipeline_manager import pipeline_manager`` — died in the
package initializer with ``ModuleNotFoundError`` before reaching the requested
module.

The package must also expose the server names without bootstrapping the Flask
app, so ``AIServer``, ``start_server``, and ``stop_server`` stay lazy.
"""

import ast
import json
import os
import re
import subprocess
import sys
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
PACKAGE_INIT = SRC / "__init__.py"
DOCS = [ROOT / "README.md", ROOT / "INTEGRATION_GUIDE.md"]

RESULT_PREFIX = "SRC_PACKAGE_RESULT "

# Names the package resolves lazily: importing them would build the Flask app
# and its AWS clients.
SERVER_EXPORTS = ("AIServer", "start_server", "stop_server")

# ``src/__init__.py`` binds these from the modules the renames left behind.
CORE_EXPORTS = {
    "PipelineManager": "pipeline_manager",
    "pipeline_manager": "pipeline_manager",
    "OCREngine": "local_ocr_engine",
    "ImageProcessor": "local_image_processor_pipeline",
    "PDFHandler": "pdf_handler",
    "redis_client": "redis_client",
}

# Names that must keep working on the documented package API.
DOCUMENTED_API = {
    "PipelineManager",
    "pipeline_manager",
    "OCREngine",
    "ImageProcessor",
    "PDFHandler",
    "AIServer",
    "start_server",
    "stop_server",
    "redis_client",
}


def _module_file(module: str) -> Path:
    return SRC / Path(*module.split("."))


def _python_files():
    """Every Python file the ai-pipeline package ships, keyed by filename."""
    files = {}
    for path in ROOT.rglob("*.py"):
        if "__pycache__" not in path.parts:
            files.setdefault(path.name, path)
    return files


def _parse_package_init():
    """Return ``(imported_modules, eager_names, lazy_names, exported)``."""
    tree = ast.parse(PACKAGE_INIT.read_text(encoding="utf-8"))
    imported_modules = []
    eager_names = {}
    lazy_names = {}
    exported = None
    for node in tree.body:
        if isinstance(node, ast.ImportFrom) and node.level:
            # ``from .local_ocr_engine import OCREngine`` and ``from . import
            # redis_client`` both count as package-relative module imports.
            module = node.module or ""
            for alias in node.names:
                name = alias.asname or alias.name
                if module:
                    imported_modules.append(module)
                    eager_names[name] = module
                else:
                    imported_modules.append(name)
                    eager_names[name] = name
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if not isinstance(target, ast.Name):
                    continue
                if target.id == "__all__":
                    exported = ast.literal_eval(node.value)
                elif target.id == "_SERVER_EXPORTS":
                    lazy_names = list(ast.literal_eval(node.value))
    return imported_modules, eager_names, lazy_names, exported


def _module_file(module: str) -> Path:
    return SRC / Path(*module.split("."))


class TestPackageExportsAreRealModules(unittest.TestCase):
    def test_every_relative_import_resolves_to_an_existing_module(self):
        imported_modules, _eager, _lazy, _exported = _parse_package_init()
        self.assertTrue(imported_modules, "package initializer imports nothing")
        for module in imported_modules:
            base = _module_file(module)
            self.assertTrue(
                base.with_suffix(".py").is_file() or (base / "__init__.py").is_file(),
                "%s is imported by %s but does not exist in %s"
                % (module, PACKAGE_INIT.name, SRC),
            )

    def test_core_classes_come_from_the_current_module_names(self):
        _modules, eager, _lazy, _exported = _parse_package_init()
        self.assertEqual({k: eager.get(k) for k in CORE_EXPORTS}, CORE_EXPORTS)

    def test_every_exported_name_is_bound(self):
        _modules, eager, lazy, exported = _parse_package_init()
        self.assertIsNotNone(exported, "%s does not define __all__" % PACKAGE_INIT)
        bound = set(eager) | set(lazy)
        self.assertEqual(
            sorted(bound), sorted(exported), "names bound by the initializer differ from __all__"
        )

    def test_documented_package_api_stays_exported(self):
        _modules, _eager, _lazy, exported = _parse_package_init()
        self.assertTrue(DOCUMENTED_API <= set(exported), sorted(DOCUMENTED_API - set(exported)))

    def test_server_exports_are_not_imported_eagerly(self):
        _modules, eager, lazy, _exported = _parse_package_init()
        for name in SERVER_EXPORTS:
            self.assertNotIn(name, eager)
        self.assertEqual(sorted(lazy), sorted(SERVER_EXPORTS))


class TestDocumentedModuleReferences(unittest.TestCase):
    """The documented module names must be files that exist."""

    def test_referenced_python_files_exist(self):
        """Docs may only name Python files that ship, not renamed-away ones."""
        shipped = _python_files()
        for doc in DOCS:
            text = doc.read_text(encoding="utf-8", errors="ignore")
            for match in re.finditer(r"([A-Za-z0-9_-]+\.py)\b", text):
                self.assertTrue(
                    match.group(1) in shipped,
                    "%s mentions %s, which the package no longer ships"
                    % (doc.name, match.group(1)),
                )

    def test_referenced_src_modules_exist(self):
        """``from src.<module> import ...`` names a module that exists."""
        shipped = _python_files()
        for doc in DOCS:
            text = doc.read_text(encoding="utf-8", errors="ignore")
            for match in re.finditer(r"from src\.([a-z_][a-z0-9_]*) import", text):
                self.assertTrue(
                    "%s.py" % match.group(1) in shipped,
                    "%s imports src.%s, which does not exist" % (doc.name, match.group(1)),
                )
            for match in re.finditer(r"src/([a-z_][a-z0-9_]*)\.py", text):
                self.assertTrue(
                    "%s.py" % match.group(1) in shipped,
                    "%s references src/%s.py, which does not exist"
                    % (doc.name, match.group(1)),
                )

    def test_documented_package_entrypoint_is_importable(self):
        """``from src.pipeline_manager import pipeline_manager`` stays documented."""
        for doc in DOCS:
            text = doc.read_text(encoding="utf-8")
            self.assertIn(
                "from src.pipeline_manager import pipeline_manager",
                text,
                "%s no longer documents the package entrypoint" % doc.name,
            )
        self.assertTrue((SRC / "pipeline_manager.py").is_file())


# The local pipeline imports its optional extras at module scope. Proving the
# package initializer resolves does not need them installed, so a run without
# them stubs just enough for the imports to finish.
STUB_SCRIPT = textwrap.dedent(
    """
    import json
    import sys
    import types


    class _StubRedis:
        def __init__(self, *args, **kwargs):
            pass

        def ping(self):
            return True


    def _module(name, **attrs):
        module = types.ModuleType(name)
        for key, value in attrs.items():
            setattr(module, key, value)
        sys.modules.setdefault(name, module)
        return module


    _module("cv2")
    _module("torch", cuda=types.SimpleNamespace(is_available=lambda: False))
    _module("easyocr", Reader=lambda *args, **kwargs: None)
    _module("fitz", Document=type("Document", (), {}))

    redis_module = _module("redis", Redis=_StubRedis)
    redis_module.exceptions = types.SimpleNamespace(ConnectionError=ConnectionError)

    from src.pipeline_manager import pipeline_manager

    import src

    payload = {
        "classes": {
            "PipelineManager": src.PipelineManager.__module__,
            "OCREngine": src.OCREngine.__module__,
            "ImageProcessor": src.ImageProcessor.__module__,
            "PDFHandler": src.PDFHandler.__module__,
            "pipeline_manager": type(pipeline_manager).__module__,
        },
        "no_server_modules": [
            name
            for name in ("flask", "flask_cors", "api", "api.server", "src.api", "src.api.server")
            if name in sys.modules
        ],
        "dir_covers_all": set(dir(src)) >= set(src.__all__),
        "unknown_attribute": "no error",
    }
    try:
        src.DoesNotExist
    except AttributeError as exc:
        payload["unknown_attribute"] = str(exc)

    class _StubApp:
        def __init__(self, *args, **kwargs):
            self.config = {}

        def route(self, *args, **kwargs):
            return lambda fn: fn

        def errorhandler(self, *args, **kwargs):
            return lambda fn: fn

        def before_request(self, fn):
            return fn


    # The server names may be used only once the HTTP stack is importable.
    _module("flask", Flask=_StubApp, request=object(), jsonify=lambda *a, **k: None)
    _module("flask_cors", CORS=lambda app: None)
    _module("werkzeug")
    _module("werkzeug.exceptions", RequestEntityTooLarge=type("R", (Exception,), {}))
    _module("boto3", client=lambda *args, **kwargs: None)
    _module("botocore")
    _module("botocore.config", Config=lambda *args, **kwargs: None)

    import src.api.server as api_server

    payload["server_exports"] = {
        name: getattr(src, name) is getattr(api_server, name)
        for name in ("AIServer", "start_server", "stop_server")
    }
    payload["api_server_imported_after_access"] = "src.api.server" in sys.modules

    print(RESULT_PREFIX + json.dumps(payload))
    """
)


class TestPackageEntrypointImport(unittest.TestCase):
    """Import the documented entrypoint in a clean interpreter."""

    def test_documented_entrypoint_imports_with_stubbed_extras(self):
        script = STUB_SCRIPT.replace(
            "print(RESULT_PREFIX + ", "print(%s + " % json.dumps(RESULT_PREFIX)
        )

        env = os.environ.copy()
        env.pop("AI_PIPELINE_TOKEN", None)
        env["AWS_EC2_METADATA_DISABLED"] = "true"

        completed = subprocess.run(
            [sys.executable, "-c", script],
            cwd=str(ROOT),
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
        )
        self.assertEqual(
            completed.returncode,
            0,
            "importing src failed:\n%s\n%s" % (completed.stdout, completed.stderr),
        )
        lines = [
            line[len(RESULT_PREFIX) :]
            for line in completed.stdout.splitlines()
            if line.startswith(RESULT_PREFIX)
        ]
        self.assertEqual(len(lines), 1, completed.stdout + completed.stderr)
        payload = json.loads(lines[0])

        self.assertEqual(
            payload["classes"],
            {
                "PipelineManager": "src.pipeline_manager",
                "OCREngine": "src.local_ocr_engine",
                "ImageProcessor": "src.local_image_processor_pipeline",
                "PDFHandler": "src.pdf_handler",
                "pipeline_manager": "src.pipeline_manager",
            },
        )
        self.assertEqual(payload["no_server_modules"], [])
        self.assertTrue(payload["dir_covers_all"])
        self.assertIn("DoesNotExist", payload["unknown_attribute"])
        self.assertEqual(
            payload["server_exports"],
            {"AIServer": True, "start_server": True, "stop_server": True},
        )
        self.assertTrue(payload["api_server_imported_after_access"])


if __name__ == "__main__":
    unittest.main()
