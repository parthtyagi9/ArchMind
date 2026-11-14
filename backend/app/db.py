"""MongoDB access. Synchronous PyMongo is used deliberately: FastAPI runs sync endpoints in a
threadpool, agent sub-tasks run in plain threads, and mongomock can stand in for unit tests."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from pymongo import MongoClient
from pymongo.database import Database

from app.config import get_settings

_client: MongoClient | None = None
_db_override: Database | None = None

COLLECTIONS = [
    "users", "orgs", "memberships", "invites", "integrations", "repos", "source_documents", "repo_graphs",
    "memories", "agent_runs", "compares", "audit_events",
]
NEVER = datetime(9999, 12, 31, tzinfo=timezone.utc)  # "no expiry": keeps expires_at a plain filterable field


def utcnow() -> datetime:
    # Mongo stores millisecond precision; truncate so round-trips compare equal.
    now = datetime.now(timezone.utc)
    return now.replace(microsecond=(now.microsecond // 1000) * 1000)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


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
        _client = MongoClient(settings.mongodb_uri, tz_aware=True, appname="archmind", serverSelectionTimeoutMS=8000)
    return _client[settings.mongodb_database]


def ping() -> dict:
    db = get_db()
    db.command("ping")
    return {"ok": True, "database": db.name}
