"""Governed retrieval. The governance filter (tenant, status, expiry, scope) is applied INSIDE $vectorSearch as
a pre-filter on indexed filter fields, so other tenants', expired, inactive and out-of-scope vectors are never
candidates. A second identical $match after the search is defence in depth, not the primary control."""
from __future__ import annotations

import math
from datetime import datetime

from app import audit
from app.config import get_settings
from app.db import get_db, iso, utcnow
from app.deps import Principal
from app.memory import repository as repo
from app.memory.embeddings import get_embedder

PROJECTION = {"embedding": 0, "retrieval_log": 0}


def governance_filter(p: Principal, now: datetime, repo_id: str | None) -> dict:
    """Tenant comes from the Principal (server-side session). `repo_id` scopes repo-level memories."""
    if not p.org_id:
        raise ValueError("tenant is required for memory retrieval")
    scopes: list[dict] = [{"scope": {"$eq": "org"}}]
    if repo_id:
        scopes.append({"$and": [{"scope": {"$eq": "repo"}}, {"repo_id": {"$eq": repo_id}}]})
    if p.team:
        scopes.append({"$and": [{"scope": {"$eq": "team"}}, {"team": {"$eq": p.team}}]})
    return {"$and": [{"tenant_id": {"$eq": p.org_id}}, {"status": {"$eq": repo.ACTIVE}}, {"expires_at": {"$gt": now}}, {"$or": scopes}]}


def filter_summary(p: Principal, now: datetime, repo_id: str | None, repo_name: str | None) -> dict:
    scopes = ["org"] + ([f"repo:{repo_name or repo_id}"] if repo_id else []) + ([f"team:{p.team}"] if p.team else [])
    return {"tenant_id": p.org_id, "status": repo.ACTIVE, "scopes": scopes, "expires_after": iso(now)}


def build_vector_pipeline(query_vector: list[float], flt: dict, k: int) -> list[dict]:
    s = get_settings()
    return [
        {"$vectorSearch": {"index": s.vector_index_name, "path": "embedding", "queryVector": query_vector,
                           "numCandidates": max(50, k * 20), "limit": k, "filter": flt}},
        {"$set": {"score": {"$meta": "vectorSearchScore"}}},
        {"$match": flt},
        {"$project": PROJECTION},
    ]


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)


def search(p: Principal, query_text: str, *, repo_id: str | None = None, k: int | None = None, run_id: str | None = None,
           now: datetime | None = None) -> list[dict]:
    s = get_settings()
    k = k or s.memory_top_k
    now = now or utcnow()
    flt = governance_filter(p, now, repo_id)
    qv = get_embedder().embed(query_text, kind="query")
    coll = get_db().memories
    if s.vector_backend == "atlas":
        results = list(coll.aggregate(build_vector_pipeline(qv, flt, k)))  # Atlas cosine score is (1 + cos) / 2 in [0, 1]
    else:  # test-only exact scan with the SAME governance filter
        docs = list(coll.find(flt))
        for d in docs:
            d["score"] = (1 + _cosine(qv, d["embedding"])) / 2
            d.pop("embedding", None)
        results = sorted(docs, key=lambda d: d["score"], reverse=True)[:k]
    results = [r for r in results if r.get("score", 0) >= s.memory_min_score]
    ids = [r["_id"] for r in results]
    if ids:
        coll.update_many({"_id": {"$in": ids}, "tenant_id": p.org_id}, {"$inc": {"retrieval_count": 1}, "$set": {"last_retrieved_at": utcnow()}})
    audit.record("memory.retrieved", p, run_id=run_id, details={"memory_version_ids": ids, "scores": [round(r["score"], 4) for r in results],
                                                                "backend": s.vector_backend, "k": k, "repo_id": repo_id})
    return results


def excluded_count(p: Principal, repo_id: str | None) -> int:
    """Memory lineages in the caller's org that governance withholds from this caller's agent right now."""
    return sum(1 for d in repo.representatives(p.org_id) if d["status"] != repo.PURGED and repo.exclusion_reason(d, p, repo_id))
