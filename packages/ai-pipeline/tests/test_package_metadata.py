"""The AI pipeline must be installable from its project metadata."""

import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYPROJECT = ROOT / "pyproject.toml"
REQUIREMENTS = ROOT / "requirements.txt"

# Direct imports on the production WSGI path (wsgi.py -> api.server -> routes
# and aws_manager), plus the WSGI server itself. numpy is imported at module
# scope by the AWS clustering stage, which that path loads when it can.
CORE = {
    "flask",
    "flask-cors",
    "werkzeug",
    "boto3",
    "botocore",
    "gunicorn",
    "numpy",
    "redis",
    "pillow",
    "opencv-python-headless",
    "pymupdf",
    "openpyxl",
}

# Heavy or test-only imports. They must not be required to import wsgi.
OPTIONAL = {
    "local": {"easyocr", "torch"},
    "clustering": {"lancedb", "pyarrow", "hdbscan", "scikit-learn"},
    "dev": {"pytest", "pytest-cov", "requests"},
}


def _norm(requirement: str) -> str:
    name = re.split(r"[<>=!\s\[]", requirement.strip(), maxsplit=1)[0]
    return name.lower().replace("_", "-")


def _load_toml(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    try:
        import tomllib
    except ModuleNotFoundError:  # Python 3.10
        return _load_toml_fallback(text)
    return tomllib.loads(text)


def _load_toml_fallback(text: str) -> dict:
    """Read the tables this package writes when tomllib is unavailable."""
    requires = re.search(r'(?m)^requires-python\s*=\s*"([^"]+)"', text)
    if requires is None:
        raise AssertionError("requires-python is not declared")

    def _array_after(header: str) -> list[str]:
        match = re.search(
            rf"(?m)^{re.escape(header)}\s*=\s*\[(.*?)\]",
            text,
            re.S,
        )
        if match is None:
            raise AssertionError(f"missing {header}")
        return re.findall(r'"([^"]+)"', match.group(1))

    optional = {}
    for group in OPTIONAL:
        header = f"{group} = ["
        start = text.find(header)
        if start < 0:
            raise AssertionError(f"missing optional group {group}")
        body = text[start + len(group) + 3 :]
        end = body.find("]")
        optional[group] = re.findall(r'"([^"]+)"', body[:end])

    return {
        "project": {
            "requires-python": requires.group(1),
            "dependencies": _array_after("dependencies"),
            "optional-dependencies": optional,
        }
    }


class TestPackageMetadata(unittest.TestCase):
    def test_python_floor_and_runtime_dependencies(self):
        project = _load_toml(PYPROJECT)["project"]
        self.assertGreaterEqual(tuple(sys.version_info[:2]), (3, 10))
        self.assertEqual(project["requires-python"], ">=3.10")

        names = {_norm(dep) for dep in project["dependencies"]}
        self.assertTrue(CORE <= names, sorted(CORE - names))
        for heavy in set().union(*OPTIONAL.values()):
            self.assertNotIn(heavy, names)

        extras = project["optional-dependencies"]
        for group, expected in OPTIONAL.items():
            got = {_norm(dep) for dep in extras[group]}
            self.assertTrue(expected <= got, (group, sorted(expected - got)))

    def test_dev_requirements_include_runtime_and_test_dependencies(self):
        lines = (ROOT / "requirements-dev.txt").read_text(encoding="utf-8").splitlines()
        self.assertIn("-r requirements.txt", lines)
        names = {_norm(line) for line in lines if line and not line.startswith(("#", "-r"))}
        self.assertTrue(OPTIONAL["dev"] <= names)
        self.assertTrue(names.isdisjoint(CORE))

    def test_requirements_txt_matches_runtime_dependencies(self):
        project = _load_toml(PYPROJECT)["project"]
        expected = {dep.strip() for dep in project["dependencies"]}
        listed = set()
        for line in REQUIREMENTS.read_text(encoding="utf-8").splitlines():
            requirement = line.split("#", 1)[0].strip()
            if requirement:
                listed.add(requirement)
        self.assertEqual(listed, expected)


if __name__ == "__main__":
    unittest.main()
