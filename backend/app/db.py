"""MongoDB access. Synchronous PyMongo is used deliberately: FastAPI runs sync endpoints in a
threadpool, LangGraph nodes stay simple, and mongomock can stand in for unit tests."""
from __future__ import annotations

from datetime import datetime, timezone

from pymongo import MongoClient
from pymongo.database import Database

from app.config import get_settings

_client: MongoClient | None = None
_db_override: Database | None = None

COLLECTIONS = ["memories", "incidents", "simulator_states", "agent_runs", "audit_events", "approvals"]


def utcnow() -> datetime:
    # Mongo stores millisecond precision; truncate so round-trips compare equal.
    now = datetime.now(timezone.utc)
    return now.replace(microsecond=(now.microsecond // 1000) * 1000)


def set_db(db: Database | None) -> None:
    """Test hook: inject a mongomock database."""
    global _db_override
    _db_override = db


def get_db() -> Database:
    global _client
    if _db_override is not None:
        return _db_override
    settings = get_settings()
    if not settings.mongodb_uri:
        raise RuntimeError("MONGODB_URI is not set (see backend/.env.example)")
    if _client is None:
        _client = MongoClient(settings.mongodb_uri, tz_aware=True, appname="recallops",
                              serverSelectionTimeoutMS=8000)
    return _client[settings.mongodb_database]


def ping() -> dict:
    db = get_db()
    db.command("ping")
    return {"ok": True, "database": db.name}
