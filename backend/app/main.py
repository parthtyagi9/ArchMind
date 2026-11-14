import logging

from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import agent, auth, groups, integrations, memories, org, repos
from app.config import get_settings
from app.db import get_db, ping, utcnow

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

log = logging.getLogger("archmind")


def recover_interrupted_work() -> None:
    """Indexing and agent runs execute in background threads, which die with the process. Anything still marked as in
    progress at startup was interrupted by a restart: say so instead of leaving it spinning forever."""
    db = get_db()
    r = db.repos.update_many({"status": "indexing"}, {"$set": {"status": "failed", "error": "Indexing was interrupted by a server restart. Click Reindex."}})
    a = db.agent_runs.update_many({"status": "running"}, {"$set": {"status": "failed", "finished_at": utcnow(), "error": "The run was interrupted by a server restart."}})
    c = db.compares.update_many({"status": "running"}, {"$set": {"status": "failed", "error": "The comparison was interrupted by a server restart."}})
    if r.modified_count or a.modified_count or c.modified_count:
        log.warning("recovered interrupted work: %d repos, %d runs, %d comparisons", r.modified_count, a.modified_count, c.modified_count)


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        recover_interrupted_work()
    except Exception:  # database unreachable at boot: /api/health will report it
        log.exception("could not run startup recovery")
    yield


app = FastAPI(title="ArchMind API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[get_settings().frontend_origin], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

api = APIRouter(prefix="/api")
for module in (auth, org, integrations, repos, groups, memories, agent):
    api.include_router(module.router)


@api.get("/health")
def health() -> dict:
    s = get_settings()
    out = {"status": "ok", "mongodb": {"ok": False, "database": s.mongodb_database},
           "llm": {"provider": s.llm_provider, "model": s.llm_model, "configured": bool(s.gemini_api_key)},
           "embeddings": {"provider": s.embedding_provider, "model": s.voyage_embedding_model if s.voyage_api_key else s.gemini_embedding_model,
                          "dimensions": s.embedding_dimensions, "configured": bool(s.voyage_api_key or s.gemini_api_key or s.embedding_provider == "local")},
           "github_oauth": s.github_oauth_configured}
    try:
        out["mongodb"] = ping()
    except Exception as e:
        out["status"] = "degraded"
        out["mongodb"]["error"] = str(e)[:200]
    if s.session_secret == "dev-only-change-me":
        out["warning"] = "SESSION_SECRET is the development default"
    return out


app.include_router(api)
