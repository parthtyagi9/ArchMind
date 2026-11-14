"""Memory persistence. Memories are immutable versions grouped by a lineage `memory_id`.
Exactly one version per lineage may be `active` (enforced by a partial unique index on Atlas).

Lifecycle: pending -> active | rejected ; active -> superseded (by a correction) | invalidated (revoked) ;
any -> purged (tombstone). Only `active`, unexpired, in-scope versions are ever retrievable."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from app.config import get_settings
from app.db import NEVER, get_db, iso, new_id, utcnow
from app.deps import Principal
from app.memory.context import NONE, MemoryContext
from app.memory.embeddings import get_embedder

PENDING, ACTIVE, SUPERSEDED, INVALIDATED, REJECTED, PURGED = "pending", "active", "superseded", "invalidated", "rejected", "purged"
SCOPES = ("org", "repo", "team", "group")
TYPES = ("architecture_decision", "bug_resolution", "repository_convention", "code_ownership", "engineering_preference",
         "workaround", "agent_experience")
AUTHORITIES = ("agent_observed", "human", "verified")


def embedding_text(doc: dict) -> str:
    return f"{doc['title']}. {doc['content']} | type {doc['memory_type'].replace('_', ' ')} | components {', '.join(doc.get('components') or [])}"


def expiry_from_days(days: int | None) -> datetime:
    return NEVER if not days else utcnow() + timedelta(days=days)


def create_version(*, tenant_id: str, title: str, content: str, memory_type: str, scope: str, team: str | None, repo_id: str | None,
                   repo_name: str | None, components: list[str], source_refs: list[dict], authority: str, status: str,
                   created_by: dict, approved_by: dict | None = None, expires_at: datetime | None = None,
                   memory_id: str | None = None, version: int = 1, supersedes: str | None = None,
                   group_id: str | None = None, group_name: str | None = None) -> dict:
    now = utcnow()
    doc: dict[str, Any] = {
        "_id": new_id("memv"), "memory_id": memory_id or new_id("mem"), "version": version, "supersedes": supersedes,
        "tenant_id": tenant_id, "title": title.strip()[:160], "content": content.strip(), "memory_type": memory_type, "scope": scope,
        "team": team if scope == "team" else None, "repo_id": repo_id if scope == "repo" else None, "repo_name": repo_name if scope == "repo" else None,
        "group_id": group_id if scope == "group" else None, "group_name": group_name if scope == "group" else None,
        "components": components, "source_refs": source_refs, "authority": authority, "status": status,
        "created_by": created_by, "approved_by": approved_by, "created_at": now, "updated_at": now,
        "expires_at": expires_at or expiry_from_days(get_settings().default_memory_ttl_days),
        "retrieval_count": 0, "last_retrieved_at": None,
    }
    if status == ACTIVE:
        attach_embedding(doc)
    get_db().memories.insert_one(doc)
    return doc


def attach_embedding(doc: dict) -> None:
    emb = get_embedder()
    doc["embedding"] = emb.embed(embedding_text(doc), kind="document")
    doc["embedding_model"] = getattr(emb, "model", "unknown")


# ------------------------------------------------------------------ reads
def lineage(tenant_id: str, memory_id: str) -> list[dict]:
    return list(get_db().memories.find({"memory_id": memory_id, "tenant_id": tenant_id}, {"embedding": 0}).sort("version", 1))


def current(tenant_id: str, memory_id: str, status: str | None = None) -> dict | None:
    q: dict[str, Any] = {"memory_id": memory_id, "tenant_id": tenant_id}
    if status:
        q["status"] = status
    docs = list(get_db().memories.find(q).sort("version", -1).limit(1))
    return docs[0] if docs else None


def representatives(tenant_id: str) -> list[dict]:
    """One document per lineage: the active version if there is one, otherwise the newest."""
    best: dict[str, dict] = {}
    for d in get_db().memories.find({"tenant_id": tenant_id}, {"embedding": 0}).sort("version", 1):
        cur = best.get(d["memory_id"])
        if cur is None or d["status"] == ACTIVE or (cur["status"] != ACTIVE and d["version"] > cur["version"]):
            best[d["memory_id"]] = d
    return list(best.values())


def is_expired(doc: dict, now: datetime | None = None) -> bool:
    exp = doc["expires_at"]
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=(now or utcnow()).tzinfo)
    return exp <= (now or utcnow())


def effective_status(doc: dict) -> str:
    return "expired" if doc["status"] == ACTIVE and is_expired(doc) else doc["status"]


def exclusion_reason(doc: dict, p: Principal, ctx: MemoryContext = NONE) -> str | None:
    """Why an agent acting for `p` in `ctx` would NOT retrieve this memory (None = eligible). Mirrors governance_filter.
    Without a workspace context, repo- and group-scoped memories are reported as eligible (they depend on where you ask)."""
    s = effective_status(doc)
    if s != ACTIVE:
        return {"pending": "pending approval", "superseded": "superseded by a newer version", "invalidated": "revoked",
                "rejected": "rejected", "purged": "purged", "expired": "expired"}[s]
    if doc["scope"] == "team" and doc.get("team") != p.team:
        return f"scoped to team {doc.get('team')}"
    if doc["scope"] == "repo" and ctx.scoped and doc.get("repo_id") not in ctx.repo_ids:
        return f"scoped to repository {doc.get('repo_name')}"
    if doc["scope"] == "group" and ctx.scoped and doc.get("group_id") != ctx.group_id:
        return f"scoped to group {doc.get('group_name')}"
    return None


def visible_filter(p: Principal) -> dict:
    """Which memories `p` may see in the management UI (distinct from what an agent may retrieve)."""
    base: dict[str, Any] = {"tenant_id": p.org_id}
    if p.role in ("admin", "owner"):
        return base
    return {"$and": [base, {"$or": [{"scope": {"$in": ["org", "repo", "group"]}}, {"scope": "team", "team": p.team}, {"created_by.id": p.user_id}]},
                     {"$or": [{"status": {"$ne": PENDING}}, {"created_by.id": p.user_id}]}]}


def to_api(doc: dict, p: Principal, *, history: list[dict] | None = None, ctx: MemoryContext = NONE) -> dict:
    exp = doc["expires_at"]
    out = {
        "memory_id": doc["memory_id"], "version": doc["version"], "version_id": doc["_id"], "title": doc.get("title", ""),
        "content": doc.get("content", ""), "memory_type": doc["memory_type"], "status": effective_status(doc), "scope": doc["scope"],
        "team": doc.get("team"), "repo_id": doc.get("repo_id"), "repo_name": doc.get("repo_name"),
        "group_id": doc.get("group_id"), "group_name": doc.get("group_name"), "authority": doc["authority"],
        "components": doc.get("components", []), "source_refs": doc.get("source_refs", []),
        "created_by": doc["created_by"], "approved_by": doc.get("approved_by"), "created_at": iso(doc["created_at"]),
        "updated_at": iso(doc["updated_at"]), "expires_at": None if exp.year >= 9999 else iso(exp),
        "retrieval_count": doc.get("retrieval_count", 0),
    }
    reason = exclusion_reason(doc, p, ctx)
    out["eligible"] = reason is None
    out["exclusion_reason"] = reason
    if history is not None:
        out["history"] = [to_api(h, p) for h in history]
    return out
