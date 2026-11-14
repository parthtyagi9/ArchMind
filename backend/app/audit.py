"""Append-only audit trail. Events carry ids, hashes and decisions, never memory content or secrets,
so purging a memory does not leave its text behind in the audit log."""
from __future__ import annotations

import logging
import uuid
from typing import Any

from app.db import get_db, utcnow

log = logging.getLogger("recallops.audit")


def record(event_type: str, *, tenant_id: str, actor: str, run_id: str | None = None,
           incident_id: str | None = None, memory_id: str | None = None, details: dict[str, Any] | None = None) -> dict:
    event = {
        "_id": f"evt_{uuid.uuid4().hex[:16]}",
        "event_type": event_type,
        "tenant_id": tenant_id,
        "actor": actor,
        "run_id": run_id,
        "incident_id": incident_id,
        "memory_id": memory_id,
        "details": details or {},
        "created_at": utcnow(),
    }
    get_db().audit_events.insert_one(event)
    log.info("audit %s tenant=%s run=%s memory=%s", event_type, tenant_id, run_id, memory_id)
    return event


def list_events(tenant_id: str, *, run_id: str | None = None, incident_id: str | None = None,
                memory_id: str | None = None, limit: int = 200) -> list[dict]:
    q: dict[str, Any] = {"tenant_id": tenant_id}
    if run_id:
        q["run_id"] = run_id
    if incident_id:
        q["incident_id"] = incident_id
    if memory_id:
        q["memory_id"] = memory_id
    return list(get_db().audit_events.find(q).sort("created_at", 1).limit(limit))
