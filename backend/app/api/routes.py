from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

from app import audit
from app.auth import COOKIE_NAME, DEMO_USERS, SESSION_MAX_AGE, Principal, current_principal, issue_token, require
from app.config import get_settings
from app.db import get_db, ping
from app.memory import governance, repository as repo, retrieval
from app.services import runs
from app.simulator import state as sim
from app.simulator import tools

router = APIRouter(prefix="/api")


def _me(p: Principal) -> dict:
    return {"user_id": p.user_id, "name": p.name, "tenant_id": p.tenant_id, "tenant_name": p.tenant_name,
            "roles": sorted(p.roles)}


# ------------------------------------------------------------------ health / session
@router.get("/health")
def health() -> dict:
    s = get_settings()
    out: dict[str, Any] = {"status": "ok", "demo_mode": s.demo_mode, "llm_model": s.llm_model,
                           "embedding_model": s.embedding_model, "embedding_dimensions": s.embedding_dimensions,
                           "gemini_configured": bool(s.gemini_api_key)}
    try:
        out["mongodb"] = ping()
    except Exception as e:
        out["status"] = "degraded"
        out["mongodb"] = {"ok": False, "error": str(e)[:200]}
    return out


@router.get("/session/users")
def demo_users() -> list[dict]:
    return [{"user_id": k, "name": v["name"], "tenant_name": v["tenant_name"], "roles": sorted(v["roles"])}
            for k, v in DEMO_USERS.items()]


class LoginBody(BaseModel):
    user_id: str


@router.post("/session/login")
def login(body: LoginBody, response: Response) -> dict:
    token = issue_token(body.user_id)
    response.set_cookie(COOKIE_NAME, token, max_age=SESSION_MAX_AGE, httponly=True, samesite="lax",
                        secure=not get_settings().demo_mode)
    from app.auth import principal_for
    return _me(principal_for(body.user_id))


@router.post("/session/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}


@router.get("/session/me")
def me(p: Principal = Depends(current_principal)) -> dict:
    return _me(p)


# ------------------------------------------------------------------ incidents & runs
class IncidentIn(BaseModel):
    model_config = ConfigDict(extra="ignore")  # a client-supplied tenant_id is silently dropped
    service: str
    environment: str = "staging"
    error_code: str = ""
    description: str = Field(min_length=5, max_length=4000)
    metadata: Optional[dict] = None


@router.post("/incidents")
def create_incident(body: IncidentIn, p: Principal = Depends(current_principal)) -> dict:
    return runs.create_incident(p, body.model_dump())


@router.get("/incidents")
def list_incidents(p: Principal = Depends(current_principal)) -> list[dict]:
    return list(get_db().incidents.find({"tenant_id": p.tenant_id}).sort("created_at", -1).limit(50))


class RunIn(BaseModel):
    memory_enabled: bool = True


@router.post("/incidents/{incident_id}/runs")
def start_run(incident_id: str, body: RunIn, p: Principal = Depends(current_principal)) -> dict:
    return runs.start_run(p, incident_id, memory_enabled=body.memory_enabled)


@router.get("/runs/{run_id}")
def get_run(run_id: str, p: Principal = Depends(current_principal)) -> dict:
    return runs.get_run(p, run_id)


class DecisionIn(BaseModel):
    comment: str = ""


@router.post("/runs/{run_id}/approve")
def approve(run_id: str, body: DecisionIn, p: Principal = Depends(current_principal)) -> dict:
    return runs.decide_approval(p, run_id, True, body.comment)


@router.post("/runs/{run_id}/reject")
def reject(run_id: str, body: DecisionIn, p: Principal = Depends(current_principal)) -> dict:
    return runs.decide_approval(p, run_id, False, body.comment)


@router.post("/incidents/{incident_id}/experiment")
def experiment(incident_id: str, p: Principal = Depends(current_principal)) -> dict:
    return runs.run_experiment(p, incident_id)


# ------------------------------------------------------------------ simulator
@router.get("/simulator")
def simulator_state(p: Principal = Depends(current_principal)) -> dict:
    s = sim.load(p.tenant_id)
    return {"state": s, "evaluation": {svc: sim.evaluate_secret_access(s, svc) for svc in s["services"]
                                       if s["services"][svc].get("secret_id")}}


@router.post("/simulator/reset")
def simulator_reset(p: Principal = Depends(current_principal)) -> dict:
    require(p, "responder")
    s = sim.reset(p.tenant_id)
    audit.record("simulator.reset", tenant_id=p.tenant_id, actor=p.user_id)
    return {"state": s}


@router.get("/tools")
def tool_catalog() -> list[dict]:
    return tools.catalog()


# ------------------------------------------------------------------ memories
@router.get("/memories")
def list_memories(p: Principal = Depends(current_principal)) -> list[dict]:
    return repo.list_memories(p.tenant_id)


@router.get("/memories/{memory_id}/history")
def memory_history(memory_id: str, p: Principal = Depends(current_principal)) -> list[dict]:
    h = repo.history(p.tenant_id, memory_id)
    if not h:
        raise HTTPException(404, "Memory not found")
    return h


class SearchIn(BaseModel):
    query: str = Field(min_length=3, max_length=1000)


@router.post("/memories/search")
def memory_search(body: SearchIn, p: Principal = Depends(current_principal)) -> list[dict]:
    return retrieval.search(body.query, p.tenant_id, actor=p.user_id)


class CorrectIn(BaseModel):
    content: str = Field(min_length=10, max_length=4000)
    resolution_action: Optional[str] = None
    reason: str = ""


@router.post("/memories/{memory_id}/correct")
def correct(memory_id: str, body: CorrectIn, p: Principal = Depends(current_principal)) -> dict:
    if body.resolution_action and body.resolution_action not in tools.REGISTRY:
        raise HTTPException(422, "resolution_action must be an allowlisted tool")
    return governance.correct_memory(p, memory_id, content=body.content, resolution_action=body.resolution_action,
                                     reason=body.reason)


class ReasonIn(BaseModel):
    reason: str = ""


@router.post("/memories/{memory_id}/invalidate")
def invalidate(memory_id: str, body: ReasonIn, p: Principal = Depends(current_principal)) -> dict:
    return governance.invalidate_memory(p, memory_id, body.reason)


@router.post("/memories/{memory_id}/purge")
def purge(memory_id: str, body: ReasonIn, p: Principal = Depends(current_principal)) -> dict:
    return governance.purge_memory(p, memory_id, body.reason)


# ------------------------------------------------------------------ audit
@router.get("/audit")
def audit_events(run_id: Optional[str] = None, incident_id: Optional[str] = None, memory_id: Optional[str] = None,
                 p: Principal = Depends(current_principal)) -> list[dict]:
    return audit.list_events(p.tenant_id, run_id=run_id, incident_id=incident_id, memory_id=memory_id)


@router.get("/experiments")
def list_experiments(p: Principal = Depends(current_principal)) -> list[dict]:
    return list(get_db().experiments.find({"tenant_id": p.tenant_id}).sort("created_at", -1).limit(10))
