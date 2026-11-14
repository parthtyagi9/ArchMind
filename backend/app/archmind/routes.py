from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.archmind import agent, memory as mem
from app.auth import Principal, current_principal

router = APIRouter(prefix="/api/arch")


@router.get("/memories")
def memories(p: Principal = Depends(current_principal)) -> list[dict]:
    return mem.list_visible(p)


class SearchIn(BaseModel):
    query: str = Field(min_length=2, max_length=1000)


@router.post("/memories/search")
def search(body: SearchIn, p: Principal = Depends(current_principal)) -> dict:
    hits, excluded = mem.search(p, body.query)
    return {"hits": [{**mem.to_api(h), "score": round(h["score"], 3)} for h in hits], "excluded": excluded}


class ContentIn(BaseModel):
    content: Optional[str] = None


class CorrectIn(BaseModel):
    content: str = Field(min_length=5, max_length=2000)
    note: str = ""


class ReasonIn(BaseModel):
    reason: str = ""


class ProposeIn(BaseModel):
    title: str = Field(min_length=3, max_length=120)
    content: str = Field(min_length=5, max_length=2000)
    components: list[str] = []
    run_id: str


@router.post("/memories/{mid}/approve")
def approve(mid: str, body: ContentIn, p: Principal = Depends(current_principal)) -> dict:
    return mem.approve(p, mid, body.content)


@router.post("/memories/{mid}/reject")
def reject(mid: str, p: Principal = Depends(current_principal)) -> dict:
    return mem.reject(p, mid)


@router.post("/memories/{mid}/correct")
def correct(mid: str, body: CorrectIn, p: Principal = Depends(current_principal)) -> dict:
    return mem.correct(p, mid, body.content, body.note)


@router.post("/memories/{mid}/revoke")
def revoke(mid: str, body: ReasonIn, p: Principal = Depends(current_principal)) -> dict:
    return mem.revoke(p, mid, body.reason)


@router.post("/memories")
def propose(body: ProposeIn, p: Principal = Depends(current_principal)) -> dict:
    return mem.propose(p, title=body.title, content=body.content, components=body.components, run_id=body.run_id)


class AskIn(BaseModel):
    question: str = Field(min_length=3, max_length=2000)
    memory_on: bool = True
    selection: Optional[dict] = None
    evidence: list[agent.EvidenceItem] = []


@router.post("/ask")
def ask(body: AskIn, p: Principal = Depends(current_principal)) -> dict:
    return agent.ask(p, body.question, memory_on=body.memory_on, evidence=body.evidence, selection=body.selection)


@router.post("/compare")
def compare(body: AskIn, p: Principal = Depends(current_principal)) -> dict:
    return agent.compare(p, body.question, body.evidence, body.selection)


@router.get("/runs")
def runs(p: Principal = Depends(current_principal)) -> list[dict]:
    return agent.list_runs(p)


@router.get("/events")
def events(p: Principal = Depends(current_principal)) -> list[dict]:
    return agent.list_events(p)
