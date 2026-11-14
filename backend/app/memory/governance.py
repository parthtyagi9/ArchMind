"""Memory governance: proposal, approval, correction, revocation (logical forgetting) and purge (physical deletion).

- propose:  members create `pending` memories (never retrievable); admins/owners create `active` ones directly.
- approve:  pending -> active (embedded now, so only approved text is ever vectorized). Edits are audited.
- correct:  active version -> `superseded` (kept for history); a new active version with a fresh embedding.
- revoke:   active -> `invalidated`. Immediately excluded from retrieval; content stays for audit (reversible by re-proposing).
- purge:    every version loses content, title, source refs and embedding ($unset); a tombstone keeps ids, tenant, version
            numbers, timestamps and a SHA-256 of the former content. Audit events never held content.
            Caveat: Atlas backups/snapshots taken before the purge may still contain the data.
"""
from __future__ import annotations

import hashlib
from typing import Any

from fastapi import HTTPException, status
from pymongo.errors import DuplicateKeyError

from app import audit
from app.db import get_db, new_id, utcnow
from app.deps import Principal, require
from app.memory import repository as repo


def _scope_args(p: Principal, scope: str, team: str | None, repo_id: str | None) -> tuple[str | None, str | None, str | None]:
    if scope not in repo.SCOPES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "scope must be org, repo or team")
    team = (team or "").strip() or None
    repo_name = None
    if scope == "team":
        if not team:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A team-scoped memory needs a team name")
    if scope == "repo":
        r = get_db().repos.find_one({"_id": repo_id, "org_id": p.org_id}) if repo_id else None
        if not r:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A repo-scoped memory needs one of this organization's repositories")
        repo_name = r["full_name"]
    return team, repo_id, repo_name


def propose(p: Principal, *, title: str, content: str, memory_type: str, scope: str, team: str | None = None, repo_id: str | None = None,
            components: list[str] | None = None, source_refs: list[dict] | None = None, expires_in_days: int | None = None,
            authority: str = "human", force_pending: bool = False) -> dict:
    require(p, "propose_memory")
    if not title.strip() or not content.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Title and content are required")
    if memory_type not in repo.TYPES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"memory_type must be one of {', '.join(repo.TYPES)}")
    team, repo_id, repo_name = _scope_args(p, scope, team, repo_id)
    direct = p.can("approve_memory") and not force_pending  # agent proposals always wait for a human decision
    try:
        doc = repo.create_version(
            tenant_id=p.org_id, title=title, content=content, memory_type=memory_type, scope=scope, team=team, repo_id=repo_id, repo_name=repo_name,
            components=components or [], source_refs=_clean_refs(source_refs), authority=authority, status=repo.ACTIVE if direct else repo.PENDING,
            created_by=p.actor, approved_by=p.actor if direct else None, expires_at=repo.expiry_from_days(expires_in_days))
    except DuplicateKeyError:
        raise HTTPException(status.HTTP_409_CONFLICT, "Memory already exists")
    audit.record("memory.created", p, memory_id=doc["memory_id"], details={"status": doc["status"], "scope": scope, "type": memory_type,
                                                                           "authority": authority, "content_sha256": _sha(content)})
    return doc


def _clean_refs(refs: list[dict] | None) -> list[dict]:
    out = []
    for r in refs or []:
        if r.get("type") in ("jira", "confluence", "github", "human", "agent_run") and r.get("id"):
            out.append({"type": r["type"], "id": str(r["id"])[:120], "label": str(r.get("label") or r["id"])[:200], "url": r.get("url")})
    return out


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _pending_or_404(p: Principal, memory_id: str) -> dict:
    doc = repo.current(p.org_id, memory_id, repo.PENDING)
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pending memory not found")  # same answer for foreign ids: no existence oracle
    return doc


def _active_or_404(p: Principal, memory_id: str) -> dict:
    doc = repo.current(p.org_id, memory_id, repo.ACTIVE)
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Active memory not found")
    return doc


def approve(p: Principal, memory_id: str, *, content: str | None = None, title: str | None = None, reason: str = "") -> dict:
    require(p, "approve_memory")
    doc = _pending_or_404(p, memory_id)
    edited = bool((content and content.strip() != doc["content"]) or (title and title.strip() != doc["title"]))
    if content and content.strip():
        doc["content"] = content.strip()
    if title and title.strip():
        doc["title"] = title.strip()[:160]
    doc.update({"status": repo.ACTIVE, "approved_by": p.actor, "authority": "verified", "updated_at": utcnow()})
    repo.attach_embedding(doc)  # raises before any state change if the embedding provider is down
    res = get_db().memories.replace_one({"_id": doc["_id"], "tenant_id": p.org_id, "status": repo.PENDING}, doc)
    if res.modified_count != 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "Memory changed concurrently; reload and retry")
    audit.record("memory.approved", p, memory_id=memory_id, details={"version": doc["version"], "edited": edited, "reason": reason[:300],
                                                                     "content_sha256": _sha(doc["content"])})
    return doc


def reject(p: Principal, memory_id: str, reason: str = "") -> dict:
    require(p, "approve_memory")
    doc = _pending_or_404(p, memory_id)
    now = utcnow()
    get_db().memories.update_one({"_id": doc["_id"], "tenant_id": p.org_id},
                                 {"$set": {"status": repo.REJECTED, "updated_at": now, "rejected_by": p.actor, "rejection_reason": reason[:300]}})
    audit.record("memory.rejected", p, memory_id=memory_id, details={"reason": reason[:300]})
    return repo.current(p.org_id, memory_id)


def correct(p: Principal, memory_id: str, *, content: str, title: str | None = None, reason: str = "") -> dict:
    require(p, "correct_memory")
    if not content.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Corrected content is required")
    old = _active_or_404(p, memory_id)
    db = get_db()
    now = utcnow()
    new = {**old, "_id": None}
    new.update({"content": content.strip(), "title": (title or old["title"]).strip()[:160], "version": old["version"] + 1, "supersedes": old["_id"],
                "status": repo.ACTIVE, "authority": "verified", "approved_by": p.actor, "created_by": p.actor, "created_at": now,
                "updated_at": now, "retrieval_count": 0, "last_retrieved_at": None})
    new["_id"] = new_id("memv")
    new.pop("embedding", None)
    repo.attach_embedding(new)  # embed first: a failure leaves the old version untouched
    res = db.memories.update_one({"_id": old["_id"], "tenant_id": p.org_id, "status": repo.ACTIVE},
                                 {"$set": {"status": repo.SUPERSEDED, "updated_at": now, "superseded_at": now}})
    if res.modified_count != 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "Memory changed concurrently; retry")
    try:
        db.memories.insert_one(new)
    except DuplicateKeyError:
        db.memories.update_one({"_id": old["_id"]}, {"$set": {"status": repo.ACTIVE}})
        raise HTTPException(status.HTTP_409_CONFLICT, "Another active version exists")
    audit.record("memory.corrected", p, memory_id=memory_id, details={"from_version": old["version"], "to_version": new["version"],
                                                                      "reason": reason[:300], "content_sha256": _sha(new["content"])})
    new.pop("embedding", None)
    return new


def revoke(p: Principal, memory_id: str, reason: str = "") -> dict:
    require(p, "revoke_memory")
    old = _active_or_404(p, memory_id)
    now = utcnow()
    get_db().memories.update_one({"_id": old["_id"], "tenant_id": p.org_id},
                                 {"$set": {"status": repo.INVALIDATED, "updated_at": now, "invalidated_at": now, "invalidated_by": p.actor,
                                           "invalidation_reason": reason[:300]}})
    audit.record("memory.revoked", p, memory_id=memory_id, details={"version": old["version"], "reason": reason[:300]})
    return repo.current(p.org_id, memory_id)


def purge(p: Principal, memory_id: str, reason: str = "") -> dict:
    require(p, "purge_memory")
    db = get_db()
    versions = list(db.memories.find({"memory_id": memory_id, "tenant_id": p.org_id}))
    if not versions:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Memory not found")
    now = utcnow()
    for v in versions:
        digest = _sha(v["content"]) if v.get("content") else v.get("content_sha256")
        db.memories.update_one({"_id": v["_id"], "tenant_id": p.org_id},
                               {"$set": {"status": repo.PURGED, "purged_at": now, "updated_at": now, "purged_by": p.actor, "content_sha256": digest},
                                "$unset": {"content": "", "title": "", "embedding": "", "source_refs": "", "invalidation_reason": "", "rejection_reason": ""}})
    audit.record("memory.purged", p, memory_id=memory_id, details={"versions_purged": len(versions), "reason": reason[:300]})
    return {"memory_id": memory_id, "versions_purged": len(versions)}


# ------------------------------------------------------------------ reads
def list_memories(p: Principal, *, status_filter: str | None = None, q: str | None = None, repo_id: str | None = None) -> list[dict]:
    seen: dict[str, dict] = {}
    for d in get_db().memories.find(repo.visible_filter(p), {"embedding": 0}).sort("version", 1):
        cur = seen.get(d["memory_id"])
        if cur is None or d["status"] == repo.ACTIVE or (cur["status"] != repo.ACTIVE and d["version"] > cur["version"]):
            seen[d["memory_id"]] = d
    docs = [d for d in seen.values() if d["status"] != repo.PURGED or status_filter == "purged"]
    if repo_id:
        docs = [d for d in docs if d["scope"] != "repo" or d.get("repo_id") == repo_id]
    if status_filter:
        docs = [d for d in docs if repo.effective_status(d) == status_filter]
    if q:
        ql = q.lower()
        docs = [d for d in docs if ql in (d.get("title", "") + " " + d.get("content", "")).lower()]
    docs.sort(key=lambda d: d["updated_at"], reverse=True)
    return [repo.to_api(d, p, repo_id=repo_id) for d in docs]


def detail(p: Principal, memory_id: str) -> dict:
    versions = list(get_db().memories.find({"$and": [repo.visible_filter(p), {"memory_id": memory_id}]}, {"embedding": 0}).sort("version", 1))
    if not versions:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Memory not found")
    rep = next((v for v in versions if v["status"] == repo.ACTIVE), versions[-1])
    return repo.to_api(rep, p, history=versions)
