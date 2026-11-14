"""Memory persistence. Memories are immutable versions grouped by a lineage `memory_id`.
Exactly one version per lineage may be `active` (enforced by a partial unique index)."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

from app.config import get_settings
from app.db import get_db, utcnow
from app.memory.embeddings import get_embedder

# Status lifecycle: active -> superseded (by a correction) | invalidated (logical forget) | purged (tombstone)
ACTIVE, SUPERSEDED, INVALIDATED, PURGED = "active", "superseded", "invalidated", "purged"

PUBLIC_FIELDS_EXCLUDE = {"embedding": 0}


def embedding_text(doc: dict) -> str:
    """What gets embedded: the narrative plus key structured facts."""
    parts = [doc.get("content", ""), f"service {doc.get('service', '')}", f"error {doc.get('error_code', '')}",
             f"resolution {doc.get('resolution_action', '')}"]
    return " | ".join(p for p in parts if p)


def create_memory(*, tenant_id: str, content: str, service: str, error_code: str, resolution_action: str | None,
                  outcome: str, memory_type: str = "incident_resolution", confidence: float = 0.8,
                  verification_status: str = "unverified", source_incident_id: str | None = None,
                  source_run_id: str | None = None, created_by: str = "system", expires_at: datetime | None = None,
                  resolution_params: dict | None = None, memory_id: str | None = None, version: int = 1,
                  supersedes: str | None = None, status: str = ACTIVE, now: datetime | None = None) -> dict:
    now = now or utcnow()
    doc: dict[str, Any] = {
        "_id": f"memv_{uuid.uuid4().hex[:16]}",
        "memory_id": memory_id or f"mem_{uuid.uuid4().hex[:12]}",
        "version": version,
        "supersedes": supersedes,
        "tenant_id": tenant_id,
        "memory_type": memory_type,
        "service": service,
        "error_code": error_code,
        "content": content,
        "resolution_action": resolution_action,
        "resolution_params": resolution_params or {},
        "outcome": outcome,
        "confidence": confidence,
        "verification_status": verification_status,
        "verification_count": 1 if verification_status == "verified" else 0,
        "status": status,
        "source_incident_id": source_incident_id,
        "source_run_id": source_run_id,
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
        "expires_at": expires_at or (now + timedelta(days=get_settings().default_memory_ttl_days)),
        "retrieval_count": 0,
        "last_retrieved_at": None,
        "embedding_model": get_settings().embedding_model,
    }
    doc["embedding"] = get_embedder().embed(embedding_text(doc), kind="document")
    get_db().memories.insert_one(doc)
    return doc


def get_version(tenant_id: str, version_id: str) -> dict | None:
    # tenant_id is ALWAYS part of the lookup: a foreign id simply does not exist for this caller.
    return get_db().memories.find_one({"_id": version_id, "tenant_id": tenant_id}, PUBLIC_FIELDS_EXCLUDE)


def get_active(tenant_id: str, memory_id: str) -> dict | None:
    return get_db().memories.find_one({"memory_id": memory_id, "tenant_id": tenant_id, "status": ACTIVE})


def history(tenant_id: str, memory_id: str) -> list[dict]:
    return list(get_db().memories.find({"memory_id": memory_id, "tenant_id": tenant_id},
                                       PUBLIC_FIELDS_EXCLUDE).sort("version", 1))


def list_memories(tenant_id: str, include_inactive: bool = True) -> list[dict]:
    q: dict[str, Any] = {"tenant_id": tenant_id}
    if not include_inactive:
        q["status"] = ACTIVE
    return list(get_db().memories.find(q, PUBLIC_FIELDS_EXCLUDE).sort([("memory_id", 1), ("version", 1)]))


def find_equivalent_active(tenant_id: str, service: str, error_code: str, resolution_action: str) -> dict | None:
    now = utcnow()
    return get_db().memories.find_one({"tenant_id": tenant_id, "status": ACTIVE, "service": service,
                                       "error_code": error_code, "resolution_action": resolution_action,
                                       "expires_at": {"$gt": now}})


def mark_retrieved(version_ids: list[str], tenant_id: str, run_id: str | None) -> None:
    if not version_ids:
        return
    get_db().memories.update_many({"_id": {"$in": version_ids}, "tenant_id": tenant_id},
                                  {"$inc": {"retrieval_count": 1}, "$set": {"last_retrieved_at": utcnow()},
                                   "$push": {"retrieval_log": {"$each": [{"run_id": run_id, "at": utcnow()}],
                                                               "$slice": -20}}})
