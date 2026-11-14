"""ArchMind governed organizational memory (architecture decisions, bug resolutions, conventions,
ownership, workarounds) stored in MongoDB Atlas `arch_memories` with Atlas Vector Search.

Governance rules, enforced server-side:
- Visibility: same tenant AND (scope in {org, repo} OR team == caller's team).
- Retrieval eligibility: visible AND status == "approved" AND (no expiry OR expires_at > now).
  Applied as the `filter` INSIDE $vectorSearch, so ineligible vectors are never candidates.
- pending / rejected / revoked / superseded memories are never retrieved.
- Correction = new version (content re-embedded), previous version kept in history as superseded.
- Only approvers (Admin, Super Admin) may approve, reject, correct or revoke.
"""
from __future__ import annotations

import json
import pathlib
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status

from app import audit
from app.auth import Principal, require
from app.config import get_settings
from app.db import get_db, utcnow
from app.memory.embeddings import get_embedder

COLL = "arch_memories"
INDEX = "arch_memory_vector_index"
SEED_PATH = pathlib.Path(__file__).with_name("seed_data.json")
FAR_FUTURE = datetime(9999, 12, 31, tzinfo=timezone.utc)


def _coll():
    return get_db()[COLL]


def _when(s: str | None) -> datetime | None:
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _embed_text(m: dict) -> str:
    return f"{m['title']}. {m['content']} Components: {', '.join(m.get('components', []))}. Type: {m['type']}."


def visibility_filter(p: Principal) -> dict:
    return {"tenant": {"$eq": p.tenant_id},
            "$or": [{"scope": {"$in": ["org", "repo"]}}, {"team": {"$eq": p.team}}]}


def eligibility_filter(p: Principal, now: datetime) -> dict:
    return {"$and": [visibility_filter(p), {"status": {"$eq": "approved"}}, {"expires_at": {"$gt": now}}]}


def to_api(m: dict) -> dict:
    """Shape a stored doc into the frontend's Memory type."""
    out = {k: v for k, v in m.items() if k not in ("_id", "embedding", "expires_at", "retrieval_log")}
    out["id"] = m["_id"]
    out["expiresAt"] = m["expires_at"].isoformat().replace("+00:00", "Z") if m.get("expires_at") and m["expires_at"] < FAR_FUTURE else None
    return out


# ---------------------------------------------------------------- seed
def seed() -> dict:
    data = json.loads(SEED_PATH.read_text())
    c = _coll()
    c.delete_many({})
    emb = get_embedder()
    for m in data["memories"]:
        doc = {**m, "_id": m["id"]}
        doc.pop("id", None)
        doc.pop("expiresAt", None)
        doc["expires_at"] = _when(m.get("expiresAt")) or FAR_FUTURE
        doc["embedding"] = emb.embed(_embed_text(doc), kind="document")
        doc["created_at"] = doc["updated_at"] = utcnow()
        c.insert_one(doc)
    return {"arch_memories": c.count_documents({})}


# ---------------------------------------------------------------- reads
def list_visible(p: Principal) -> list[dict]:
    return [to_api(m) for m in _coll().find(visibility_filter(p), {"embedding": 0}).sort("_id", 1)]


def search(p: Principal, query: str, *, k: int = 5, run_id: str | None = None) -> tuple[list[dict], int]:
    """Governed vector search. Returns (eligible hits with scores, count of memories excluded by governance)."""
    s = get_settings()
    now = utcnow()
    qv = get_embedder().embed(query, kind="query")
    c = _coll()
    filt = eligibility_filter(p, now)
    if s.vector_backend == "atlas":
        pipe = [{"$vectorSearch": {"index": INDEX, "path": "embedding", "queryVector": qv,
                                   "numCandidates": 100, "limit": k, "filter": filt}},
                {"$set": {"score": {"$meta": "vectorSearchScore"}}}, {"$match": filt},
                {"$project": {"embedding": 0, "retrieval_log": 0}}]
        hits = list(c.aggregate(pipe))
    else:  # unit tests only: same filter, exact cosine
        from app.memory.retrieval import _cosine
        hits = []
        for d in c.find(filt):
            d["score"] = (1 + _cosine(qv, d.pop("embedding"))) / 2
            hits.append(d)
        hits = sorted(hits, key=lambda d: d["score"], reverse=True)[:k]
    tenant_total = c.count_documents({"tenant": p.tenant_id})
    eligible_total = c.count_documents(filt)
    excluded = tenant_total - eligible_total  # pending/revoked/expired/other-team, never shown to the model
    audit.record("arch.retrieval", tenant_id=p.tenant_id, actor=p.user_id, run_id=run_id,
                 details={"memory_ids": [h["_id"] for h in hits], "scores": [round(h["score"], 3) for h in hits],
                          "excluded_by_governance": excluded})
    return hits, excluded


# ---------------------------------------------------------------- governance actions
def _get_visible(p: Principal, mid: str) -> dict:
    m = _coll().find_one({"_id": mid, **visibility_filter(p)})
    if not m:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Memory not found")
    return m


def _event(p: Principal, kind: str, mid: str, detail: str) -> None:
    audit.record(f"memory.{kind}", tenant_id=p.tenant_id, actor=p.name, memory_id=mid, details={"detail": detail})


def approve(p: Principal, mid: str, content: str | None = None) -> dict:
    require(p, "approver")
    m = _get_visible(p, mid)
    if m["status"] != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Memory is {m['status']}, not pending")
    upd: dict[str, Any] = {"status": "approved", "approvedBy": p.name, "updated_at": utcnow()}
    hist = [dict(h) for h in m["history"]]
    if content and content.strip() != m["content"]:
        upd["content"] = content.strip()
        hist[-1]["content"] = content.strip()
    hist[-1]["status"] = "approved"
    upd["history"] = hist
    upd["embedding"] = get_embedder().embed(_embed_text({**m, **upd}), kind="document")
    _coll().update_one({"_id": mid, "tenant": p.tenant_id}, {"$set": upd})
    _event(p, "approved", mid, f"Approved v{m['version']}{' with edits' if 'content' in upd else ''}; embedded; now eligible for retrieval")
    return to_api(_coll().find_one({"_id": mid}))


def reject(p: Principal, mid: str) -> dict:
    require(p, "approver")
    m = _get_visible(p, mid)
    if m["status"] != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Memory is {m['status']}, not pending")
    hist = [dict(h) for h in m["history"]]
    hist[-1]["status"] = "rejected"
    _coll().update_one({"_id": mid, "tenant": p.tenant_id},
                       {"$set": {"status": "rejected", "history": hist, "updated_at": utcnow()}, "$unset": {"embedding": ""}})
    _event(p, "rejected", mid, "Rejected; never eligible for retrieval")
    return to_api(_coll().find_one({"_id": mid}))


def correct(p: Principal, mid: str, content: str, note: str = "") -> dict:
    require(p, "approver")
    m = _get_visible(p, mid)
    if m["status"] != "approved":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only approved memories can be corrected")
    hist = [{**h, "status": "superseded"} if h["version"] == m["version"] else dict(h) for h in m["history"]]
    v = m["version"] + 1
    hist.append({"version": v, "content": content.strip(), "status": "approved", "by": p.name,
                 "at": utcnow().strftime("%Y-%m-%d %H:%M"), "note": note or "Corrected"})
    new = {"content": content.strip(), "version": v, "history": hist, "approvedBy": p.name, "updated_at": utcnow()}
    new["embedding"] = get_embedder().embed(_embed_text({**m, **new}), kind="document")
    _coll().update_one({"_id": mid, "tenant": p.tenant_id, "version": m["version"]}, {"$set": new})
    _event(p, "corrected", mid, f"Corrected v{m['version']} → v{v}; previous version superseded; new embedding generated")
    return to_api(_coll().find_one({"_id": mid}))


def revoke(p: Principal, mid: str, reason: str = "") -> dict:
    require(p, "approver")
    m = _get_visible(p, mid)
    if m["status"] not in ("approved", "pending"):
        raise HTTPException(status.HTTP_409_CONFLICT, f"Memory is already {m['status']}")
    hist = [{**h, "status": "revoked"} if h["version"] == m["version"] else dict(h) for h in m["history"]]
    _coll().update_one({"_id": mid, "tenant": p.tenant_id},
                       {"$set": {"status": "revoked", "revokeReason": reason[:300], "history": hist, "updated_at": utcnow()}})
    _event(p, "revoked", mid, f"Revoked: {reason or 'no reason given'}; excluded from retrieval immediately")
    return to_api(_coll().find_one({"_id": mid}))


def propose(p: Principal, *, title: str, content: str, components: list[str], run_id: str) -> dict:
    """Agent-proposed memory. Always lands as `pending` (team-scoped); never retrievable until approved."""
    mid = f"m_{uuid.uuid4().hex[:8]}"
    doc = {"_id": mid, "title": title[:120], "type": "agent_experience", "status": "pending", "version": 1,
           "content": content[:2000], "tenant": p.tenant_id, "scope": "team", "team": p.team,
           "repo": "payments-platform", "authority": "agent_observed",
           "sources": [{"type": "agent_run", "id": run_id, "label": f"Agent run {run_id}"}],
           "expires_at": FAR_FUTURE, "components": components[:10], "usedInRuns": 0,
           "history": [{"version": 1, "content": content[:2000], "status": "pending", "by": "ArchMind agent",
                        "at": utcnow().strftime("%Y-%m-%d %H:%M"), "note": f"Proposed from {run_id}"}],
           "created_at": utcnow(), "updated_at": utcnow()}
    _coll().insert_one(doc)
    _event(p, "created", mid, f"Proposed from {run_id} (pending approval)")
    return to_api(doc)


def mark_used(p: Principal, ids: list[str]) -> None:
    if ids:
        _coll().update_many({"_id": {"$in": ids}, "tenant": p.tenant_id}, {"$inc": {"usedInRuns": 1}})
