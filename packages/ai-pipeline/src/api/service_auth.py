"""Service authentication for the AI pipeline HTTP API.

Who may read a job or upload a paper is decided in the Next.js routes
(`jobContentAccessDecision`, upload-session ownership, `requireAdminCaller`).
This module does not repeat those checks. It only accepts the Next.js server:
a shared `AI_PIPELINE_TOKEN` presented from loopback or an explicitly trusted
address. `/health` stays open so a probe does not need the credential.
"""

import hashlib
import hmac
import os

LOOPBACK_HOSTS = frozenset({"127.0.0.1", "::1", "localhost", "::ffff:127.0.0.1"})


def configured_token() -> str:
    return os.environ.get("AI_PIPELINE_TOKEN", "").strip()


def trusted_hosts() -> set[str]:
    raw = os.environ.get("AI_PIPELINE_TRUSTED_HOSTS", "")
    return {part.strip() for part in raw.split(",") if part.strip()}


def allow_remote() -> bool:
    return os.environ.get("AI_PIPELINE_ALLOW_REMOTE", "").strip() == "1"


def presented_bearer(authorization: str | None) -> str:
    if not authorization:
        return ""
    scheme, _, rest = authorization.partition(" ")
    if scheme.lower() != "bearer":
        return ""
    return rest.strip()


def tokens_match(presented: str, expected: str) -> bool:
    if not presented or not expected:
        return False
    return hmac.compare_digest(
        hashlib.sha256(presented.encode("utf-8")).digest(),
        hashlib.sha256(expected.encode("utf-8")).digest(),
    )


def service_auth_decision(
    path: str,
    method: str,
    authorization: str | None,
    remote_addr: str | None,
):
    """Return None when the request may proceed, else (status, error)."""
    if method in {"GET", "HEAD"} and path == "/health":
        return None

    remote = (remote_addr or "").strip()
    if not allow_remote() and remote not in LOOPBACK_HOSTS and remote not in trusted_hosts():
        return 403, "Forbidden"

    token = configured_token()
    if not token:
        return 503, "AI pipeline authentication is not configured"

    if not tokens_match(presented_bearer(authorization), token):
        return 401, "Unauthorized"

    return None


def assert_trusted_bind(host: str) -> str:
    """Refuse to listen on every interface unless the operator opts in."""
    normalized = (host or "").strip()
    if os.environ.get("AI_PIPELINE_ALLOW_PUBLIC_BIND", "").strip() == "1":
        return normalized
    if normalized in {"127.0.0.1", "::1", "localhost"}:
        return normalized
    raise RuntimeError(
        f"Refusing to listen on {normalized or '(empty)'}. "
        "Bind the AI pipeline to 127.0.0.1, or set AI_PIPELINE_ALLOW_PUBLIC_BIND=1."
    )


def install_service_auth(app) -> None:
    from flask import jsonify, request

    @app.before_request
    def _require_service_auth():
        decision = service_auth_decision(
            request.path,
            request.method,
            request.headers.get("Authorization"),
            request.remote_addr,
        )
        if decision is None:
            return None
        status, message = decision
        return jsonify({"error": message}), status
