"""Governed retrieval. The governance filter is applied INSIDE $vectorSearch (pre-filter on indexed
filter fields), so other tenants' / expired / inactive vectors are never candidates. A second
identical $match after the search is defence in depth, not the primary control."""
from __future__ import annotations

import math
from datetime import datetime

from app import audit
from app.config import get_settings
from app.db import get_db, utcnow
from app.memory import repository as repo
from app.memory.embeddings import get_embedder

PROJECTION = {"embedding": 0, "retrieval_log": 0}


def governance_filter(tenant_id: str, now: datetime, memory_type: str | None = None) -> dict:
    if not tenant_id:
        raise ValueError("tenant_id is required for memory retrieval")
    f: dict = {"tenant_id": {"$eq": tenant_id}, "status": {"$eq": repo.ACTIVE}, "expires_at": {"$gt": now}}
    if memory_type:
        f["memory_type"] = {"$eq": memory_type}
    return f


def build_vector_pipeline(query_vector: list[float], tenant_id: str, now: datetime, k: int,
                          memory_type: str | None = None) -> list[dict]:
    s = get_settings()
    filt = governance_filter(tenant_id, now, memory_type)
    return [
        {"$vectorSearch": {"index": s.vector_index_name, "path": "embedding", "queryVector": query_vector,
                           "numCandidates": max(50, k * 20), "limit": k, "filter": filt}},
        {"$set": {"score": {"$meta": "vectorSearchScore"}}},
        {"$match": filt},
        {"$project": PROJECTION},
    ]


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)


def search(query_text: str, tenant_id: str, *, k: int | None = None, run_id: str | None = None,
           actor: str = "agent", memory_type: str | None = None, now: datetime | None = None) -> list[dict]:
    s = get_settings()
    k = k or s.memory_top_k
    now = now or utcnow()
    qv = get_embedder().embed(query_text, kind="query")
    coll = get_db().memories
    if s.vector_backend == "atlas":
        results = list(coll.aggregate(build_vector_pipeline(qv, tenant_id, now, k, memory_type)))
        # Atlas cosine score is (1 + cos) / 2 in [0, 1].
    else:  # test-only exact scan with the SAME governance filter
        docs = list(coll.find(governance_filter(tenant_id, now, memory_type)))
        for d in docs:
            d["score"] = (1 + _cosine(qv, d["embedding"])) / 2
            d.pop("embedding", None)
            d.pop("retrieval_log", None)
        results = sorted(docs, key=lambda d: d["score"], reverse=True)[:k]
    results = [r for r in results if r.get("score", 0) >= s.memory_min_score]
    ids = [r["_id"] for r in results]
    repo.mark_retrieved(ids, tenant_id, run_id)
    audit.record("memory.retrieved", tenant_id=tenant_id, actor=actor, run_id=run_id,
                 details={"memory_version_ids": ids, "scores": [round(r["score"], 4) for r in results],
                          "backend": s.vector_backend, "k": k})
    return results
