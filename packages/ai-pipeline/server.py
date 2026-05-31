"""
DEPRECATED - Canonical server has moved to src/api/server.py.

This shim re-exports `app` for backward compatibility with existing tests.
New code should import directly from `api.server`:
    from api.server import app
"""
import sys
from pathlib import Path

_src_dir = Path(__file__).parent / 'src'
if str(_src_dir) not in sys.path:
    sys.path.insert(0, str(_src_dir))

from api.server import app

__all__ = ['app']
