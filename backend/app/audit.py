"""Append-only audit trail. Events carry ids, hashes and decisions, never memory content or secrets,
so purging a memory does not leave its text behind in the audit log."""
from __future__ import annotations

import logging
from typing import Any

from app.db import get_db, iso, new_id, utcnow

log = logging.getLogger("archmind.audit")


def record(event_type: str, actor, *, tenant_id: str | None = None, memory_id: str | None = None,
           run_id: str | None = None, details: dict[str, Any] | None = None) -> dict:
    """`actor` is a Principal, a {"id","name"} dict, or None for system events."""
    if actor is None:
        actor_id, actor_name = "system", "system"
    elif isinstance(actor, dict):
        actor_id, actor_name = actor.get("id", "system"), actor.get("name", "system")
    else:
        actor_id, actor_name = actor.user_id, actor.name
        tenant_id = tenant_id or actor.org_id
    event = {
        "_id": new_id("evt"), "type": event_type, "tenant_id": tenant_id, "actor_id": actor_id, "actor_name": actor_name,
        "memory_id": memory_id, "run_id": run_id, "details": details or {}, "created_at": utcnow(),
    }
    get_db().audit_events.insert_one(event)
    log.info("audit %s tenant=%s actor=%s memory=%s run=%s", event_type, tenant_id, actor_id, memory_id, run_id)
    return event


def to_api(e: dict) -> dict:
    return {"id": e["_id"], "type": e["type"], "actor": None if e["actor_id"] == "system" else {"id": e["actor_id"], "name": e["actor_name"]},
            "memory_id": e.get("memory_id"), "run_id": e.get("run_id"), "details": e.get("details", {}), "at": iso(e["created_at"])}


def list_events(tenant_id: str, *, memory_id: str | None = None, run_id: str | None = None, type_: str | None = None,
                limit: int = 200) -> list[dict]:
    q: dict[str, Any] = {"tenant_id": tenant_id}
    if memory_id:
        q["memory_id"] = memory_id
    if run_id:
        q["run_id"] = run_id
    if type_:
        q["type"] = {"$regex": f"^{type_}"} if type_.endswith(".") else type_
    return [to_api(e) for e in get_db().audit_events.find(q).sort("created_at", -1).limit(min(limit, 500))]
