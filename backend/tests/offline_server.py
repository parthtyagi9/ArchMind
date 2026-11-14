"""DEV-ONLY smoke server: mongomock + hash embedder + scripted LLM, so the UI can be exercised with no
network. NOT the demo path (the demo uses Atlas $vectorSearch + Gemini). Run: python tests/offline_server.py"""
import sys, pathlib
sys.path[:0] = [str(pathlib.Path(__file__).parent.parent), str(pathlib.Path(__file__).parent)]
import mongomock, uvicorn
from app.config import get_settings
from app.db import set_db
from app.memory.embeddings import HashEmbedder, set_embedder
from app.agents.llm import set_llm
from conftest import ScriptedLLM

s = get_settings(); s.vector_backend = "local"; s.memory_min_score = 0.55
set_db(mongomock.MongoClient(tz_aware=True).db); set_embedder(HashEmbedder()); set_llm(ScriptedLLM())
from scripts.seed_demo import seed; seed()
from app.main import app
uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")
