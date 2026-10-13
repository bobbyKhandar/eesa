"""Gunicorn config for the AI pipeline.

The default listener is loopback. Set AI_PIPELINE_BIND only for a trusted
address, and AI_PIPELINE_ALLOW_PUBLIC_BIND=1 to listen on every interface.
Sensitive routes still require AI_PIPELINE_TOKEN; see src/api/service_auth.py.
"""

import importlib.util
import os
from pathlib import Path

# Load the bind check as a file. Importing the api package builds the Flask
# app, and Gunicorn loads this config in the master process before the app.
_auth_path = Path(__file__).resolve().parent / "src" / "api" / "service_auth.py"
_spec = importlib.util.spec_from_file_location("ai_pipeline_service_auth", _auth_path)
_auth = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_auth)
assert_trusted_bind = _auth.assert_trusted_bind

_configured = os.environ.get("AI_PIPELINE_BIND", "127.0.0.1:5000").strip()
if _configured.startswith("["):
    _host, _, _rest = _configured[1:].partition("]")
    _port = _rest.lstrip(":") or "5000"
else:
    _host, _sep, _port = _configured.rpartition(":")
    if not _sep:
        _host, _port = _configured, "5000"

_host = assert_trusted_bind(_host)
bind = f"[{_host}]:{_port}" if ":" in _host else f"{_host}:{_port}"
