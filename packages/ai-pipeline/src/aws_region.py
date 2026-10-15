"""Central AWS region configuration for the AI pipeline.

Contract (documented in README.md and context.md):

- ``AWS_REGION`` is the canonical setting (standard boto3/SDK name).
- ``AWS_DEFAULT_REGION`` is accepted as an alias (standard SDK name).
- ``aws_location`` is accepted as a legacy alias for the documented
  ``packages/ai-pipeline/.env`` entry. Existing operators who followed the
  setup guide keep working without renaming.
- Precedence: ``AWS_REGION`` > ``AWS_DEFAULT_REGION`` > ``aws_location``.
- When none is set, the service uses ``ap-south-1`` and logs where the
  value came from, so a missing configuration is visible at startup instead
  of surfacing later as a cryptic ``NoRegionError`` during client creation.
- The ``packages/ai-pipeline/.env`` file is loaded (without overriding real
  environment variables) before any boto3 client is created, so the
  documented ``aws_location`` entry is actually honoured.

This module has no third-party dependencies so every entry point
(``wsgi.py``, ``start_server.py``, ``src/server.py``, ``src/api/server.py``)
and every pipeline module can import it before creating boto3 clients.
"""

import os
from pathlib import Path

DEFAULT_AWS_REGION = "ap-south-1"

_PIPELINE_ENV_FILENAME = ".env"

_loaded_dotenv_paths: set[str] = set()


def _pipeline_env_path() -> Path:
    """Return the documented ``packages/ai-pipeline/.env`` location."""
    return Path(__file__).resolve().parent.parent / _PIPELINE_ENV_FILENAME


def load_pipeline_dotenv(path: Path | str | None = None) -> Path | None:
    """Load ``packages/ai-pipeline/.env`` into ``os.environ`` (no override).

    Minimal ``KEY=VALUE`` parsing: blank lines and ``#`` comments are
    skipped, surrounding quotes are stripped, and keys already present in
    the environment are left untouched. Returns the path when it was read,
    otherwise ``None``. Never raises: a missing or unreadable file simply
    means environment/exported configuration is used.
    """
    candidate = Path(path) if path is not None else _pipeline_env_path()
    key = str(candidate)
    if key in _loaded_dotenv_paths:
        return candidate if candidate.is_file() else None
    _loaded_dotenv_paths.add(key)
    try:
        if not candidate.is_file():
            return None
        for raw_line in candidate.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, _, value = line.partition("=")
            name = name.strip()
            # Allow `export KEY=value` as written by some operators.
            if name.lower().startswith("export "):
                name = name[7:].strip()
            if not name or name in os.environ:
                continue
            value = value.strip().strip('"').strip("'").strip()
            # Skip empty assignments so precedence falls through cleanly.
            if not value:
                continue
            os.environ[name] = value
    except OSError:
        return None
    return candidate


def _clean(value: str | None) -> str:
    return (value or "").strip()


def resolve_aws_region() -> tuple[str, str]:
    """Return ``(region, source)`` without side effects (except dotenv load).

    Sources: ``"AWS_REGION"``, ``"AWS_DEFAULT_REGION"``, ``"aws_location"``,
    or ``"default"``. Blank values are ignored so an empty assignment does
    not shadow a lower-precedence setting.
    """
    load_pipeline_dotenv()
    for name in ("AWS_REGION", "AWS_DEFAULT_REGION", "aws_location"):
        value = _clean(os.environ.get(name))
        if value:
            return value, name
    return DEFAULT_AWS_REGION, "default"


def get_aws_region() -> str:
    """Return the resolved AWS region for boto3 clients."""
    region, _ = resolve_aws_region()
    return region


def ensure_aws_region_configured() -> str:
    """Load dotenv, mirror the resolved region into the SDK chain, diagnose.

    After resolving, ``AWS_REGION`` and ``AWS_DEFAULT_REGION`` are filled in
    (never overridden) so boto3's default region chain agrees with the
    explicit ``region_name`` passed to every client. Prints one startup line
    naming the region and its source; when nothing was configured it names
    the settings the operator should export. Returns the resolved region.
    """
    load_pipeline_dotenv()
    region, source = resolve_aws_region()
    # Fill in blank SDK entries too (setdefault keeps empty strings, which
    # boto3 treats as unset). A non-blank explicit value is never overridden.
    if not _clean(os.environ.get("AWS_REGION")):
        os.environ["AWS_REGION"] = region
    if not _clean(os.environ.get("AWS_DEFAULT_REGION")):
        os.environ["AWS_DEFAULT_REGION"] = region
    if source == "default":
        print(
            "AWS region is not configured (checked AWS_REGION, "
            "AWS_DEFAULT_REGION, aws_location in packages/ai-pipeline/.env); "
            "using default '%s'. To override, export AWS_REGION or set "
            "aws_location in packages/ai-pipeline/.env." % (region,)
        )
    else:
        print("AWS region '%s' (from %s)." % (region, source))
    return region


__all__ = [
    "DEFAULT_AWS_REGION",
    "ensure_aws_region_configured",
    "get_aws_region",
    "load_pipeline_dotenv",
    "resolve_aws_region",
]
