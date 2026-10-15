"""
AI Pipeline Server - Thin bootstrap that delegates to the api/ module.
"""

import sys
import time

from pathlib import Path

_src_dir = Path(__file__).resolve().parent
if str(_src_dir) not in sys.path:
    sys.path.insert(0, str(_src_dir))

# Load packages/ai-pipeline/.env and resolve the AWS region before the Flask
# app (and its boto3 clients) is imported. See aws_region.py.
try:
    from aws_region import ensure_aws_region_configured
except ImportError:  # pragma: no cover - unexpected path layout
    ensure_aws_region_configured = None  # type: ignore[assignment]

if ensure_aws_region_configured is not None:
    ensure_aws_region_configured()

from api import start_server, stop_server

if __name__ == "__main__":
    host = sys.argv[1] if len(sys.argv) > 1 else "127.0.0.1"
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 5000
    server = start_server(host, port)
    try:
        while server.is_running:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nShutting down server...")
        stop_server()
