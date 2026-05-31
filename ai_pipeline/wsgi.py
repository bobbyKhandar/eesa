"""
WSGI entry point for Gunicorn
"""
import sys
from pathlib import Path

# Add src directory to path
current_dir = Path(__file__).parent
src_dir = current_dir / 'src'
sys.path.insert(0, str(src_dir))

from server import app

if __name__ == "__main__":
    app.run()
