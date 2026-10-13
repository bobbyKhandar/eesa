"""
WSGI entry point for Gunicorn
"""
import sys
from pathlib import Path

# Add src directory to path
current_dir = Path(__file__).parent
src_dir = current_dir / 'src'
sys.path.insert(0, str(src_dir))

from api.server import app
from api.service_auth import assert_trusted_bind

if __name__ == "__main__":
    app.run(host=assert_trusted_bind("127.0.0.1"), port=5000)
