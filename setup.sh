#!/usr/bin/env bash
# One-shot local setup for RecallOps. Run from the repo root:  ./setup.sh
# Prompts for secrets (hidden input) and writes them only to backend/.env (git-ignored).
set -euo pipefail
cd "$(dirname "$0")"
ENV=backend/.env

command -v uv >/dev/null || { echo "Installing uv..."; curl -LsSf https://astral.sh/uv/install.sh | sh; export PATH="$HOME/.local/bin:$PATH"; }
command -v npm >/dev/null || { echo "Node.js/npm is required: https://nodejs.org"; exit 1; }

if [ ! -f "$ENV" ]; then
  cp backend/.env.example "$ENV"
fi
get() { grep -E "^$1=" "$ENV" | head -1 | cut -d= -f2-; }
setv() { python3 - "$ENV" "$1" "$2" <<'PY'
import sys, re
path, key, val = sys.argv[1:]
txt = open(path).read()
line = f"{key}={val}"
txt = re.sub(rf"^{key}=.*$", line, txt, flags=re.M) if re.search(rf"^{key}=", txt, re.M) else txt + f"\n{line}\n"
open(path, "w").write(txt)
PY
}

if [ -z "$(get MONGODB_URI)" ]; then
  read -rsp "Paste MONGODB_URI (input hidden): " v; echo; setv MONGODB_URI "$v"
fi
if [ -z "$(get GEMINI_API_KEY)" ]; then
  read -rsp "Paste GEMINI_API_KEY (input hidden): " v; echo; setv GEMINI_API_KEY "$v"
fi
if [ -z "$(get SESSION_SECRET)" ]; then
  setv SESSION_SECRET "$(python3 -c 'import secrets;print(secrets.token_hex(32))')"
fi

echo "== Installing backend dependencies"
(cd backend && uv sync -q)

echo "== Checking MongoDB connection"
(cd backend && uv run python -c "from app.db import ping; print(ping())") || {
  echo "Could not reach Atlas. Check: your IP is in Network Access of the project that owns the cluster, and the user/password in MONGODB_URI."; exit 1; }

echo "== Checking Gemini"
(cd backend && uv run python -c "
from app.memory.embeddings import GeminiEmbedder; from app.agents.llm import GeminiLLM, Classification
print('embedding dims:', len(GeminiEmbedder().embed('hello')))
print('llm ok:', GeminiLLM().structured('Classify.', 'payment-service AccessDeniedException reading secret', Classification).failure_category)
") || { echo "Gemini check failed: verify GEMINI_API_KEY and LLM_MODEL in backend/.env"; exit 1; }

echo "== Creating collections, validators, indexes and the vector index"
(cd backend && uv run python -m scripts.create_indexes)

echo "== Seeding demo data"
(cd backend && uv run python -m scripts.seed_demo)

echo "== Unit tests"
(cd backend && uv run pytest -q)

echo "== Live Atlas + Gemini integration tests"
(cd backend && RUN_LIVE=1 uv run pytest tests/integration -m integration -q -s) || echo "!! Live tests failed: paste the output above to Claude"

echo "== Installing frontend dependencies"
(cd frontend && npm install --silent)

echo
echo "Setup complete. Start the app with two terminals:"
echo "  cd backend  && uv run uvicorn app.main:app --port 8000"
echo "  cd frontend && npm run dev      # then open http://localhost:3000"
