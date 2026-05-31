"""
AI Pipeline Server - Thin bootstrap that delegates to the api/ module.
"""

import sys
import time

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
