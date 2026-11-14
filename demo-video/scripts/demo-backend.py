"""Serve the real ArchMind backend against the isolated video database."""
import json
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from app.config import get_settings
from app.db import get_db, set_db

state = json.loads((ROOT / "demo-video/recording-state.json").read_text())
source = get_db()
set_db(source.client[state["database"]])
get_settings().session_secret = "archmind-isolated-video-session"
from app.main import app
import uvicorn

if __name__ == "__main__":
    logging.getLogger("httpx").setLevel(logging.WARNING)
    uvicorn.run(app, host="127.0.0.1", port=8011, log_level="warning", access_log=False)
