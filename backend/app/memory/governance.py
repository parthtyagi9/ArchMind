"""Correction, invalidation (logical forgetting) and purge (physical deletion of content+embedding).

Semantics, stated precisely:
- correct:    old version -> status "superseded" (kept for history); new active version with a fresh
              embedding. Only the active version is retrievable.
- invalidate: active version -> status "invalidated". Immediately excluded from retrieval. Content
              and embedding are still stored (reversible, auditable). This is NOT deletion.
- purge:      every version of the lineage has content, embedding and resolution details removed
              ($unset) and status set to "purged". What remains is a tombstone: ids, tenant, version
              numbers, timestamps and a SHA-256 of the former content. Audit events never held content.
              Caveat: Atlas backups/snapshots taken before the purge may still contain the data.
"""
from __future__ import annotations

import hashlib

from fastapi import HTTPException, status
from pymongo.errors import DuplicateKeyError

from app import audit
from app.auth import Principal, require
from app.db import get_db, utcnow
from app.memory import repository as repo


def _active_or_404(p: Principal, memory_id: str) -> dict:
    doc = repo.get_active(p.tenant_id, memory_id)
    if not doc:
        # Same response whether it belongs to another tenant or does not exist: no existence oracle.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Active memory not found")
    return doc


def correct_memory(p: Principal, memory_id: str, *, content: str, resolution_action: str | None = None,
                   reason: str = "") -> dict:
    require(p, "memory_admin")
    old = _active_or_404(p, memory_id)
    db = get_db()
    now = utcnow()
    res = db.memories.update_one({"_id": old["_id"], "tenant_id": p.tenant_id, "status": repo.ACTIVE},
                                 {"$set": {"status": repo.SUPERSEDED, "updated_at": now, "superseded_at": now}})
    if res.modified_count != 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "Memory changed concurrently; retry")
    try:
        new = repo.create_memory(
            tenant_id=p.tenant_id, content=content, service=old["service"], error_code=old["error_code"],
            resolution_action=resolution_action if resolution_action is not None else old.get("resolution_action"),
            resolution_params=old.get("resolution_params"), outcome=old["outcome"], memory_type=old["memory_type"],
            confidence=old.get("confidence", 0.8), verification_status="human_corrected",
            source_incident_id=old.get("source_incident_id"), source_run_id=old.get("source_run_id"),
            created_by=p.user_id, expires_at=old["expires_at"], memory_id=memory_id, version=old["version"] + 1,
            supersedes=old["_id"], now=now)
    except DuplicateKeyError:
        db.memories.update_one({"_id": old["_id"]}, {"$set": {"status": repo.ACTIVE}})
        raise HTTPException(status.HTTP_409_CONFLICT, "Another active version exists")
    audit.record("memory.corrected", tenant_id=p.tenant_id, actor=p.user_id, memory_id=memory_id,
                 details={"from_version_id": old["_id"], "to_version_id": new["_id"],
                          "from_version": old["version"], "to_version": new["version"], "reason": reason[:300],
                          "resolution_action_changed": old.get("resolution_action") != new.get("resolution_action")})
    new.pop("embedding", None)
    return new


def invalidate_memory(p: Principal, memory_id: str, reason: str = "") -> dict:
    require(p, "memory_admin")
    old = _active_or_404(p, memory_id)
    now = utcnow()
    get_db().memories.update_one({"_id": old["_id"], "tenant_id": p.tenant_id},
                                 {"$set": {"status": repo.INVALIDATED, "updated_at": now, "invalidated_at": now,
                                           "invalidated_by": p.user_id, "invalidation_reason": reason[:300]}})
    audit.record("memory.invalidated", tenant_id=p.tenant_id, actor=p.user_id, memory_id=memory_id,
                 details={"version_id": old["_id"], "reason": reason[:300]})
    return {"memory_id": memory_id, "version_id": old["_id"], "status": repo.INVALIDATED}


def purge_memory(p: Principal, memory_id: str, reason: str = "") -> dict:
    require(p, "memory_admin")
    db = get_db()
    versions = list(db.memories.find({"memory_id": memory_id, "tenant_id": p.tenant_id}))
    if not versions:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Memory not found")
    now = utcnow()
    for v in versions:
        digest = hashlib.sha256((v.get("content") or "").encode()).hexdigest() if v.get("content") else v.get("content_sha256")
        db.memories.update_one({"_id": v["_id"], "tenant_id": p.tenant_id},
                               {"$set": {"status": repo.PURGED, "purged_at": now, "updated_at": now,
                                         "purged_by": p.user_id, "content_sha256": digest},
                                "$unset": {"content": "", "embedding": "", "resolution_params": "",
                                           "retrieval_log": "", "invalidation_reason": ""}})
    audit.record("memory.purged", tenant_id=p.tenant_id, actor=p.user_id, memory_id=memory_id,
                 details={"versions_purged": len(versions), "reason": reason[:300]})
    return {"memory_id": memory_id, "versions_purged": len(versions), "status": repo.PURGED}
