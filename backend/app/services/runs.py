"""Incident + agent-run orchestration and the controlled memory A/B experiment."""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import HTTPException, status

from app import audit
from app.agents.graph import GRAPH, metrics
from app.auth import Principal, require
from app.db import get_db, utcnow
from app.simulator import state as sim

RECURSION_LIMIT = 100


def create_incident(p: Principal, data: dict[str, Any]) -> dict:
    require(p, "responder")
    inc = {"_id": f"inc_{uuid.uuid4().hex[:10]}", "tenant_id": p.tenant_id,  # from the session, never the body
           "service": data["service"], "environment": data.get("environment", "staging"),
           "error_code": data.get("error_code", ""), "description": data["description"][:4000],
           "metadata": data.get("metadata") or {}, "status": "open", "created_by": p.user_id,
           "created_at": utcnow(), "updated_at": utcnow()}
    get_db().incidents.insert_one(inc)
    audit.record("incident.created", tenant_id=p.tenant_id, actor=p.user_id, incident_id=inc["_id"],
                 details={"service": inc["service"], "error_code": inc["error_code"]})
    return inc


def get_incident(p: Principal, incident_id: str) -> dict:
    inc = get_db().incidents.find_one({"_id": incident_id, "tenant_id": p.tenant_id})
    if not inc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Incident not found")
    return inc


def get_run(p: Principal, run_id: str) -> dict:
    run = get_db().agent_runs.find_one({"_id": run_id, "tenant_id": p.tenant_id})
    if not run:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    return run


def _invoke(state: dict) -> dict:
    try:
        return GRAPH.invoke(state, {"recursion_limit": RECURSION_LIMIT})
    except Exception as e:
        get_db().agent_runs.update_one({"_id": state["run_id"], "tenant_id": state["tenant_id"]},
                                       {"$set": {"status": "failed", "status_reason": f"agent error: {str(e)[:300]}",
                                                 "updated_at": utcnow()}})
        audit.record("run.error", tenant_id=state["tenant_id"], actor="agent", run_id=state["run_id"],
                     details={"error": str(e)[:300]})
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Agent run failed: {str(e)[:200]}")


def start_run(p: Principal, incident_id: str, *, memory_enabled: bool = True, approval_mode: str = "interactive",
              write_memory: bool = True, experiment_id: str | None = None, experiment_arm: str | None = None) -> dict:
    require(p, "responder")
    if approval_mode == "pre_approved":
        require(p, "approver")
    inc = get_incident(p, incident_id)
    run_id = f"run_{uuid.uuid4().hex[:10]}"
    state = {"run_id": run_id, "tenant_id": p.tenant_id, "actor": p.user_id,
             "approver": p.user_id if approval_mode == "pre_approved" else None,
             "incident": inc, "memory_enabled": memory_enabled, "write_memory": write_memory,
             "approval_mode": approval_mode, "resume": None, "steps": [], "repair_attempts": 0,
             "status": "running", "status_reason": "", "experiment_id": experiment_id,
             "experiment_arm": experiment_arm}
    get_db().agent_runs.insert_one({"_id": run_id, "tenant_id": p.tenant_id, "incident_id": incident_id,
                                    "created_at": utcnow(), **{k: v for k, v in state.items() if k not in ("run_id",)}})
    audit.record("run.started", tenant_id=p.tenant_id, actor=p.user_id, run_id=run_id, incident_id=incident_id,
                 details={"memory_enabled": memory_enabled, "approval_mode": approval_mode,
                          "experiment_id": experiment_id, "arm": experiment_arm})
    _invoke(state)
    return get_run(p, run_id)


def decide_approval(p: Principal, run_id: str, approve: bool, comment: str = "") -> dict:
    require(p, "approver")
    run = get_run(p, run_id)
    if run.get("status") != "awaiting_approval" or not run.get("approval_id"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Run is not awaiting approval")
    db = get_db()
    appr = db.approvals.find_one_and_update(
        {"_id": run["approval_id"], "tenant_id": p.tenant_id, "run_id": run_id, "status": "pending"},
        {"$set": {"status": "approved" if approve else "rejected", "decided_by": p.user_id,
                  "decided_at": utcnow(), "comment": comment[:300]}})
    if not appr:
        raise HTTPException(status.HTTP_409_CONFLICT, "Approval already decided")
    audit.record("action.approved" if approve else "action.rejected", tenant_id=p.tenant_id, actor=p.user_id,
                 run_id=run_id, details={"approval_id": appr["_id"], "tool": appr["tool"], "args": appr["args"]})
    state = {k: v for k, v in run.items() if k not in ("_id", "created_at", "updated_at", "incident_id")}
    state["run_id"] = run_id
    state["incident"] = get_incident(p, run["incident_id"])
    if approve:
        state.update(resume="execute", status="running")
    else:
        steps = list(state.get("steps", []))
        steps.append({"n": len(steps) + 1, "kind": "approval", "tool": appr["tool"], "args": appr["args"],
                      "at": utcnow().isoformat(),
                      "note": f"REJECTED by {p.user_id}: {comment[:200] or 'no reason given'}. Choose a different action."})
        state.update(resume="plan", status="running", pending_action=None, approval_id=None, steps=steps)
    # memories are re-attached from the run doc summary so the planner keeps the same evidence
    _invoke(state)
    return get_run(p, run_id)


def run_experiment(p: Principal, incident_id: str) -> dict:
    """Same incident, same tools, same model settings, same approval policy, same reset initial simulator
    state. Only `memory_enabled` differs. Neither arm writes memory, so arm A cannot contaminate arm B."""
    require(p, "approver")
    inc = get_incident(p, incident_id)
    exp_id = f"exp_{uuid.uuid4().hex[:10]}"
    audit.record("experiment.started", tenant_id=p.tenant_id, actor=p.user_id, incident_id=incident_id,
                 details={"experiment_id": exp_id, "approval_policy": "pre_approved by operator for both arms"})
    arms = {}
    for arm, mem in (("without_memory", False), ("with_memory", True)):
        sim.reset(p.tenant_id, inc.get("environment", "staging"))
        r = start_run(p, incident_id, memory_enabled=mem, approval_mode="pre_approved", write_memory=False,
                      experiment_id=exp_id, experiment_arm=arm)
        arms[arm] = {"run_id": r["_id"], "status": r.get("status"), "status_reason": r.get("status_reason"),
                     "metrics": r.get("metrics") or metrics(r), "retrieved_memory_ids": r.get("retrieved_memory_ids", []),
                     "steps": r.get("steps", []), "verification": r.get("verification")}
    sim.reset(p.tenant_id, inc.get("environment", "staging"))
    a, b = arms["without_memory"]["metrics"], arms["with_memory"]["metrics"]
    summary = {"same_tool_sequence": a["tool_sequence"] == b["tool_sequence"],
               "tool_calls_delta": b["tool_calls"] - a["tool_calls"],
               "diagnostic_calls_delta": b["diagnostic_calls"] - a["diagnostic_calls"],
               "both_resolved": a["resolved"] and b["resolved"]}
    doc = {"_id": exp_id, "tenant_id": p.tenant_id, "incident_id": incident_id, "created_by": p.user_id,
           "created_at": utcnow(), "arms": arms, "summary": summary,
           "controls": {"approval_mode": "pre_approved", "write_memory": False, "simulator_reset_before_each_arm": True}}
    get_db().experiments.insert_one(doc)
    audit.record("experiment.completed", tenant_id=p.tenant_id, actor=p.user_id, incident_id=incident_id,
                 details={"experiment_id": exp_id, **summary})
    return doc
