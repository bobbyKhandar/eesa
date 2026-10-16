#!/usr/bin/env bash
# macOS/Linux: npm run setup. Windows: use WSL or Git Bash with Python on PATH.
set -euo pipefail
cd "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
fail() { printf 'Setup error: %s\n' "$*" >&2; exit 1; }
command -v node >/dev/null 2>&1 || fail 'Node.js is missing. Install Node 22 (nvm install && nvm use).'
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || fail "Node >=22 required; found $(node --version). Run nvm install && nvm use."
command -v npm >/dev/null 2>&1 || fail 'npm is missing. Install npm >=10 with Node 22.'
npm_version="$(npm --version)"
[[ "${npm_version%%.*}" -ge 10 ]] || fail "npm >=10 required; found $npm_version. Debian npm 9 cannot read the dependency graph. Install Node 22 with its bundled npm."
python_command=''
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
    python_command="$candidate"
    break
  fi
done
[[ -n "$python_command" ]] || fail 'Python >=3.10 is required. Install Python with pip and venv support.'
printf 'Using Node %s, npm %s, %s\n' "$(node --version)" "$npm_version" "$("$python_command" --version)"
npm install
pipeline='packages/ai-pipeline'
"$python_command" -m venv "$pipeline/.venv" || fail 'Could not create venv. On Debian/Ubuntu install python3-venv (matching your Python version).'
venv_python="$pipeline/.venv/bin/python"
[[ -f "$venv_python" ]] || venv_python="$pipeline/.venv/Scripts/python.exe"
"$venv_python" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || fail 'Existing .venv uses Python <3.10; recreate it with a supported Python.'
"$venv_python" -m pip install -r "$pipeline/requirements-dev.txt"
for directory in . packages/backend packages/frontend packages/ai-pipeline; do
  if [[ ! -e "$directory/.env" ]]; then
    cp "$directory/.env.example" "$directory/.env"
    printf 'Created %s/.env\n' "$directory"
  else
    printf 'Keeping existing %s/.env\n' "$directory"
  fi
done
printf '\nSetup complete. Configure Clerk/AWS/Gemini as needed in the .env files.\nSet the same AI_PIPELINE_TOKEN in frontend and ai-pipeline .env files.\nStart MongoDB and Redis: docker compose up -d\nStart the app: npm run dev\n'
