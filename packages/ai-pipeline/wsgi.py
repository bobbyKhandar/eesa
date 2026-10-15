"""
WSGI entry point for Gunicorn
"""
import sys
from pathlib import Path

# Add src directory to path
current_dir = Path(__file__).parent
src_dir = current_dir / 'src'
sys.path.insert(0, str(src_dir))

# Load packages/ai-pipeline/.env and resolve the AWS region before the Flask
# app (and its boto3 clients) is imported. See src/aws_region.py.
try:
    from aws_region import ensure_aws_region_configured
except ImportError:  # pragma: no cover - unexpected path layout
    ensure_aws_region_configured = None  # type: ignore[assignment]

if ensure_aws_region_configured is not None:
    ensure_aws_region_configured()

from api.server import app
from api.service_auth import assert_trusted_bind

if __name__ == "__main__":
    app.run(host=assert_trusted_bind("127.0.0.1"), port=5000)
