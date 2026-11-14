from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app import audit
from app.deps import Principal, current_principal
from app.memory import governance, retrieval
from app.memory import repository as mrepo

router = APIRouter(tags=["memory"])


class SourceRefIn(BaseModel):
    type: str
    id: str
    label: str | None = None
    url: str | None = None


class MemoryIn(BaseModel):
    title: str
    content: str
    memory_type: str
    scope: str = "org"
    team: str | None = None
    repo_id: str | None = None
    components: list[str] = []
    source_refs: list[SourceRefIn] = []
    expires_in_days: int | None = None


class ApproveIn(BaseModel):
    content: str | None = None
    title: str | None = None
    reason: str = ""


class ReasonIn(BaseModel):
    reason: str = ""


class CorrectIn(BaseModel):
    content: str
    title: str | None = None
    reason: str = ""


class SearchIn(BaseModel):
    query: str = Field(min_length=1)
    repo_id: str | None = None


def _api(p: Principal, doc: dict) -> dict:
    return mrepo.to_api(doc, p)


@router.get("/memories")
def list_memories(status: str | None = None, q: str | None = None, repo_id: str | None = None, p: Principal = Depends(current_principal)) -> list[dict]:
    return governance.list_memories(p, status_filter=status, q=q, repo_id=repo_id)


@router.post("/memories")
def create_memory(body: MemoryIn, p: Principal = Depends(current_principal)) -> dict:
    doc = governance.propose(p, title=body.title, content=body.content, memory_type=body.memory_type, scope=body.scope, team=body.team,
                             repo_id=body.repo_id, components=body.components, source_refs=[s.model_dump() for s in body.source_refs],
                             expires_in_days=body.expires_in_days)
    return _api(p, doc)


@router.post("/memories/search")
def search_memories(body: SearchIn, p: Principal = Depends(current_principal)) -> dict:
    results = retrieval.search(p, body.query, repo_id=body.repo_id)
    return {"results": [{"memory": mrepo.to_api(r, p, repo_id=body.repo_id), "score": round(r["score"], 4)} for r in results],
            "excluded": retrieval.excluded_count(p, body.repo_id)}


@router.get("/memories/{memory_id}")
def memory_detail(memory_id: str, p: Principal = Depends(current_principal)) -> dict:
    return governance.detail(p, memory_id)


@router.post("/memories/{memory_id}/approve")
def approve(memory_id: str, body: ApproveIn, p: Principal = Depends(current_principal)) -> dict:
    return _api(p, governance.approve(p, memory_id, content=body.content, title=body.title, reason=body.reason))


@router.post("/memories/{memory_id}/reject")
def reject(memory_id: str, body: ReasonIn, p: Principal = Depends(current_principal)) -> dict:
    return _api(p, governance.reject(p, memory_id, body.reason))


@router.post("/memories/{memory_id}/correct")
def correct(memory_id: str, body: CorrectIn, p: Principal = Depends(current_principal)) -> dict:
    return _api(p, governance.correct(p, memory_id, content=body.content, title=body.title, reason=body.reason))


@router.post("/memories/{memory_id}/revoke")
def revoke(memory_id: str, body: ReasonIn, p: Principal = Depends(current_principal)) -> dict:
    return _api(p, governance.revoke(p, memory_id, body.reason))


@router.post("/memories/{memory_id}/purge")
def purge(memory_id: str, body: ReasonIn, p: Principal = Depends(current_principal)) -> dict:
    return governance.purge(p, memory_id, body.reason)


@router.get("/audit")
def audit_events(memory_id: str | None = None, run_id: str | None = None, type: str | None = None, limit: int = Query(200, le=500),
                 p: Principal = Depends(current_principal)) -> list[dict]:
    return audit.list_events(p.org_id, memory_id=memory_id, run_id=run_id, type_=type, limit=limit)
