from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.agents import pipeline
from app.db import get_db
from app.deps import Principal, current_principal, require
from app.memory import repository as mrepo

router = APIRouter(prefix="/agent", tags=["agent"])


class SelectionIn(BaseModel):
    path: str
    start_line: int
    end_line: int
    text: str


class RunIn(BaseModel):
    kind: str = "why"
    question: str = ""
    repo_id: str | None = None
    selection: SelectionIn | None = None
    memory_enabled: bool = True


class CompareIn(BaseModel):
    question: str = ""
    repo_id: str | None = None
    selection: SelectionIn | None = None


def _visible(p: Principal) -> dict:
    q: dict = {"tenant_id": p.org_id}
    if p.role == "member":
        q["user.id"] = p.user_id  # members see their own runs; admins and owners see the organization's
    return q


@router.post("/runs")
def create_run(body: RunIn, p: Principal = Depends(current_principal)) -> dict:
    run_id = pipeline.start_run(p, kind=body.kind, question=body.question, repo_id=body.repo_id,
                                selection=body.selection.model_dump() if body.selection else None, memory_enabled=body.memory_enabled)
    return {"run_id": run_id}


@router.get("/runs/{run_id}")
def get_run(run_id: str, p: Principal = Depends(current_principal)) -> dict:
    doc = get_db().agent_runs.find_one({"_id": run_id, **_visible(p)})
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    return pipeline.run_api(doc)


@router.get("/runs")
def list_runs(repo_id: str | None = None, limit: int = 30, p: Principal = Depends(current_principal)) -> list[dict]:
    q = _visible(p)
    if repo_id:
        q["repo_id"] = repo_id
    return [pipeline.run_api(d) for d in get_db().agent_runs.find(q).sort("created_at", -1).limit(max(1, min(limit, 100)))]


@router.post("/runs/{run_id}/propose-memory")
def propose_memory(run_id: str, p: Principal = Depends(current_principal)) -> dict:
    return mrepo.to_api(pipeline.propose_memory(p, run_id), p)


@router.post("/compare")
def create_compare(body: CompareIn, p: Principal = Depends(current_principal)) -> dict:
    require(p, "ask")
    cid = pipeline.start_compare(p, question=body.question, repo_id=body.repo_id, selection=body.selection.model_dump() if body.selection else None)
    return {"compare_id": cid}


@router.get("/compare/{compare_id}")
def get_compare(compare_id: str, p: Principal = Depends(current_principal)) -> dict:
    doc = get_db().compares.find_one({"_id": compare_id, "tenant_id": p.org_id})
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Comparison not found")
    return pipeline.compare_api(doc)
