"""LangGraph workflow:

  START -> (router) -> classify -> retrieve -> plan -> policy -+-> execute -+-> plan (read-only result)
                                                ^              |            +-> verify -+-> record_memory -> finalize -> END
                                                |              |                        +-> plan (retry, bounded)
                                                |              |                        +-> finalize (failed)
                                                +--------------+-> await_approval -> END (persisted; resumed via API)
                                                               +-> finalize (escalated / budget exhausted)

Control decisions that matter for safety (allowlist, argument validation, approval, verification,
memory write) are deterministic code. The LLM only proposes the next tool and explains why."""
from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

from langgraph.graph import END, START, StateGraph
from pydantic import ValidationError

from app import audit
from app.agents import prompts
from app.agents.llm import Classification, PlanDecision, get_llm
from app.agents.state import AgentState
from app.auth import DEMO_USERS
from app.config import get_settings
from app.db import get_db, utcnow
from app.memory import repository as repo
from app.memory import retrieval
from app.simulator import tools


def args_hash(tool: str, args: dict) -> str:
    return hashlib.sha256(json.dumps({"tool": tool, "args": args}, sort_keys=True).encode()).hexdigest()


def _step(state: AgentState, kind: str, **kw) -> list:
    steps = list(state.get("steps", []))
    steps.append({"n": len(steps) + 1, "kind": kind, "at": utcnow().isoformat(), **kw})
    return steps


def persist(state: AgentState) -> None:
    doc = {k: v for k, v in state.items() if k != "memories"}
    doc["memories"] = [{k: m.get(k) for k in ("_id", "memory_id", "version", "content", "resolution_action",
                                               "verification_status", "score", "service", "error_code")}
                       for m in state.get("memories", [])]
    doc["updated_at"] = utcnow()
    get_db().agent_runs.update_one({"_id": state["run_id"], "tenant_id": state["tenant_id"]},
                                   {"$set": doc}, upsert=True)


def _persisting(fn):
    def wrapper(state: AgentState) -> dict:
        update = fn(state)
        persist({**state, **update})
        return update
    wrapper.__name__ = fn.__name__
    return wrapper


# ---------------------------------------------------------------- nodes
@_persisting
def classify(state: AgentState) -> dict:
    c = get_llm().structured(prompts.SYSTEM, prompts.classify_prompt(state["incident"]), Classification)
    cd = c.model_dump()
    # The incident record (server-side) is authoritative for the service; the model cannot retarget it.
    cd["affected_service"] = state["incident"]["service"]
    return {"classification": cd, "steps": _step(state, "classify", result=cd)}


@_persisting
def retrieve(state: AgentState) -> dict:
    if not state.get("memory_enabled"):
        return {"memories": [], "retrieved_memory_ids": [],
                "steps": _step(state, "retrieve", note="memory retrieval disabled for this run")}
    inc, c = state["incident"], state["classification"]
    query = f"{c['search_query']} | service {inc['service']} | error {inc.get('error_code', '')} | {inc.get('description', '')}"
    mems = retrieval.search(query, state["tenant_id"], run_id=state["run_id"], actor="agent",
                            memory_type="incident_resolution")
    ids = [m["memory_id"] for m in mems]
    return {"memories": mems, "retrieved_memory_ids": ids,
            "steps": _step(state, "retrieve", result=[{"memory_id": m["memory_id"], "version": m["version"],
                                                       "score": round(m["score"], 3),
                                                       "resolution_action": m.get("resolution_action")} for m in mems])}


def _tool_steps(state: AgentState) -> int:
    return sum(1 for s in state.get("steps", []) if s["kind"] == "tool")


@_persisting
def plan(state: AgentState) -> dict:
    s = get_settings()
    remaining = s.max_agent_steps - _tool_steps(state)
    if remaining <= 0:
        return {"status": "failed", "status_reason": "step budget exhausted", "pending_action": None,
                "steps": _step(state, "plan", note="step budget exhausted")}
    d: PlanDecision = get_llm().structured(
        prompts.SYSTEM, prompts.plan_prompt(state["incident"], state["classification"], state.get("memories", []),
                                            state.get("steps", []), tools.catalog(), remaining), PlanDecision)
    known = set(state.get("retrieved_memory_ids", []))
    cited = [m for m in d.memory_ids_used if m in known]  # drop hallucinated citations
    common = {"rationale": d.rationale, "hypothesis": d.hypothesis, "memory_ids_used": cited}
    if d.decision == "escalate":
        return {"status": "escalated", "status_reason": d.rationale, "pending_action": None,
                "steps": _step(state, "plan", note="agent escalated to a human", **common)}
    action = {"tool": d.tool_name, "args": {"service": d.service or state["incident"]["service"]}}
    return {"pending_action": {**action, **common}, "status": "running",
            "steps": _step(state, "plan", tool=d.tool_name, args=action["args"], **common)}


@_persisting
def policy(state: AgentState) -> dict:
    a = state["pending_action"]
    try:
        t, parsed = tools.validate(a["tool"], a["args"])
    except (ValueError, ValidationError) as e:
        audit.record("policy.rejected", tenant_id=state["tenant_id"], actor="policy", run_id=state["run_id"],
                     details={"tool": a.get("tool"), "error": str(e)[:300]})
        return {"pending_action": None,
                "steps": _step(state, "tool", tool=a.get("tool"), args=a.get("args"), state_changing=False,
                               note=f"REJECTED by policy: {str(e)[:200]}")}
    args = parsed.model_dump()
    if args.get("service") != state["incident"]["service"]:
        # Blast-radius rule: a run may only change the service named in its incident.
        if t.state_changing:
            audit.record("policy.rejected", tenant_id=state["tenant_id"], actor="policy", run_id=state["run_id"],
                         details={"tool": t.name, "error": "target service outside incident scope"})
            return {"pending_action": None, "steps": _step(state, "tool", tool=t.name, args=args, state_changing=True,
                                                           note="REJECTED by policy: target outside incident scope")}
    a = {**a, "args": args, "state_changing": t.state_changing}
    if not t.state_changing:
        return {"pending_action": a, "approval_id": None}
    h = args_hash(t.name, args)
    db = get_db()
    appr = {"_id": f"appr_{uuid.uuid4().hex[:12]}", "tenant_id": state["tenant_id"], "run_id": state["run_id"],
            "incident_id": state["incident"]["_id"], "tool": t.name, "args": args, "args_hash": h,
            "rationale": a.get("rationale"), "requested_at": utcnow(), "consumed": False}
    if state.get("approval_mode") == "pre_approved" and state.get("approver"):
        appr.update(status="approved", decided_by=state["approver"], decided_at=utcnow(), mode="pre_approved_experiment")
        db.approvals.insert_one(appr)
        audit.record("action.approved", tenant_id=state["tenant_id"], actor=state["approver"], run_id=state["run_id"],
                     details={"approval_id": appr["_id"], "tool": t.name, "args": args, "mode": "pre_approved_experiment"})
        return {"pending_action": a, "approval_id": appr["_id"]}
    appr.update(status="pending", mode="interactive")
    db.approvals.insert_one(appr)
    audit.record("action.approval_requested", tenant_id=state["tenant_id"], actor="agent", run_id=state["run_id"],
                 details={"approval_id": appr["_id"], "tool": t.name, "args": args})
    return {"pending_action": a, "approval_id": appr["_id"], "status": "awaiting_approval",
            "status_reason": f"approval required for {t.name}",
            "steps": _step(state, "approval", tool=t.name, args=args, note="waiting for human approval")}


def _consume_approval(state: AgentState, a: dict) -> tuple[bool, str]:
    """Re-validate authorization at execution time, independent of anything the model produced."""
    appr_id = state.get("approval_id")
    if not appr_id:
        return False, "no approval on record"
    appr = get_db().approvals.find_one_and_update(
        {"_id": appr_id, "tenant_id": state["tenant_id"], "run_id": state["run_id"], "status": "approved",
         "consumed": False, "args_hash": args_hash(a["tool"], a["args"])},
        {"$set": {"consumed": True, "consumed_at": utcnow()}})
    if not appr:
        return False, "approval missing, not approved, already used, or does not match this action"
    approver = DEMO_USERS.get(appr["decided_by"])
    if not approver or approver["tenant_id"] != state["tenant_id"] or "approver" not in approver["roles"]:
        return False, "approver lacks the approver role for this tenant"
    return True, appr["decided_by"]


@_persisting
def execute(state: AgentState) -> dict:
    a = state["pending_action"]
    if a.get("state_changing"):
        ok, who = _consume_approval(state, a)
        if not ok:
            audit.record("action.blocked", tenant_id=state["tenant_id"], actor="policy", run_id=state["run_id"],
                         details={"tool": a["tool"], "reason": who})
            return {"status": "failed", "status_reason": f"execution blocked: {who}", "pending_action": None,
                    "steps": _step(state, "tool", tool=a["tool"], args=a["args"], state_changing=True,
                                   note=f"BLOCKED: {who}")}
    try:
        result = tools.execute(state["tenant_id"], a["tool"], a["args"], state["incident"].get("environment", "staging"))
    except Exception as e:  # tool failure is an observation, not a crash
        result = {"error": str(e)[:300]}
    audit.record("tool.executed", tenant_id=state["tenant_id"], actor="agent", run_id=state["run_id"],
                 details={"tool": a["tool"], "args": a["args"], "state_changing": a.get("state_changing", False)})
    return {"pending_action": a if a.get("state_changing") else None, "resume": None, "status": "running",
            "steps": _step(state, "tool", tool=a["tool"], args=a["args"], state_changing=a.get("state_changing", False),
                           rationale=a.get("rationale", ""), memory_ids_used=a.get("memory_ids_used", []), result=result)}


@_persisting
def verify(state: AgentState) -> dict:
    inc = state["incident"]
    v = tools.verify_secret_access(state["tenant_id"], inc["service"], inc.get("environment", "staging"))
    audit.record("verification.completed", tenant_id=state["tenant_id"], actor="verifier", run_id=state["run_id"],
                 details={"allowed": v["allowed"], "failing_checks": v.get("failing_checks")})
    upd: dict[str, Any] = {"verification": v, "pending_action": None,
                           "steps": _step(state, "verify", tool="verify_secret_access", args={"service": inc["service"]},
                                          result=v)}
    if v["allowed"]:
        upd.update(status="resolved", status_reason="independent verification passed")
    else:
        n = state.get("repair_attempts", 0) + 1
        upd["repair_attempts"] = n
        if n >= get_settings().max_repair_attempts:
            upd.update(status="failed", status_reason=f"verification failed after {n} state-changing attempts")
    return upd


@_persisting
def record_memory(state: AgentState) -> dict:
    inc, steps = state["incident"], state["steps"]
    changes = [s for s in steps if s["kind"] == "tool" and s.get("state_changing") and "result" in s]
    winning = changes[-1]
    failed = [c["tool"] for c in changes[:-1]]
    if not state.get("write_memory", True):
        return {"memory_result": {"written": False, "reason": "experiment run: memory writes disabled for isolation"},
                "steps": _step(state, "memory", note="memory write skipped (experiment isolation)")}
    existing = repo.find_equivalent_active(state["tenant_id"], inc["service"], inc.get("error_code", ""), winning["tool"])
    if existing:
        get_db().memories.update_one({"_id": existing["_id"], "tenant_id": state["tenant_id"]},
                                     {"$inc": {"verification_count": 1},
                                      "$set": {"last_verified_at": utcnow(), "updated_at": utcnow(),
                                               "confidence": min(0.99, existing.get("confidence", 0.8) + 0.02)}})
        audit.record("memory.reconfirmed", tenant_id=state["tenant_id"], actor="agent", run_id=state["run_id"],
                     memory_id=existing["memory_id"], incident_id=inc["_id"])
        res = {"written": False, "reconfirmed": existing["memory_id"]}
    else:
        diag = [s["tool"] for s in steps if s["kind"] == "tool" and not s.get("state_changing")]
        content = (f"{inc['service']} ({inc.get('environment')}) failed with {inc.get('error_code')}: "
                   f"{state['classification'].get('summary', '')} Resolved by {winning['tool']} "
                   f"({json.dumps(winning['args'])}); independent verification confirmed secret access "
                   f"(IAM, KMS and network checks passed). "
                   + (f"Attempts that did NOT resolve it: {', '.join(failed)}. " if failed else "")
                   + (f"Diagnostics used: {', '.join(diag)}." if diag else "No diagnostics were needed."))
        m = repo.create_memory(tenant_id=state["tenant_id"], content=content, service=inc["service"],
                               error_code=inc.get("error_code", ""), resolution_action=winning["tool"],
                               resolution_params=winning["args"], outcome="success", confidence=0.9,
                               verification_status="verified", source_incident_id=inc["_id"],
                               source_run_id=state["run_id"], created_by="agent")
        audit.record("memory.created", tenant_id=state["tenant_id"], actor="agent", run_id=state["run_id"],
                     memory_id=m["memory_id"], incident_id=inc["_id"],
                     details={"version_id": m["_id"], "verification_status": "verified"})
        res = {"written": True, "memory_id": m["memory_id"], "version_id": m["_id"]}
    return {"memory_result": res, "steps": _step(state, "memory", result=res)}


@_persisting
def await_approval(state: AgentState) -> dict:
    return {}


@_persisting
def finalize(state: AgentState) -> dict:
    status = state.get("status", "failed")
    if status == "running":
        status = "failed"
    get_db().incidents.update_one({"_id": state["incident"]["_id"], "tenant_id": state["tenant_id"]},
                                  {"$set": {"status": status, "last_run_id": state["run_id"], "updated_at": utcnow()}})
    audit.record(f"run.{status}", tenant_id=state["tenant_id"], actor="agent", run_id=state["run_id"],
                 incident_id=state["incident"]["_id"], details={"reason": state.get("status_reason", "")})
    return {"status": status, "metrics": metrics(state)}


def metrics(state: AgentState) -> dict:
    steps = state.get("steps", [])
    tool_steps = [s for s in steps if s["kind"] == "tool"]
    return {"tool_calls": len(tool_steps),
            "diagnostic_calls": sum(1 for s in tool_steps if not s.get("state_changing")),
            "state_changing_calls": sum(1 for s in tool_steps if s.get("state_changing") and "result" in s),
            "tool_sequence": [s["tool"] for s in tool_steps],
            "resolved": state.get("status") == "resolved",
            "llm_decisions": sum(1 for s in steps if s["kind"] == "plan")}


# ---------------------------------------------------------------- routing
def route_start(state: AgentState) -> str:
    return {"execute": "execute", "plan": "plan"}.get(state.get("resume") or "", "classify")


def route_after_plan(state: AgentState) -> str:
    return "policy" if state.get("pending_action") else "finalize"


def route_after_policy(state: AgentState) -> str:
    if state.get("status") == "awaiting_approval":
        return "await_approval"
    return "execute" if state.get("pending_action") else "plan"


def route_after_execute(state: AgentState) -> str:
    if state.get("status") == "failed":
        return "finalize"
    return "verify" if state.get("pending_action") else "plan"


def route_after_verify(state: AgentState) -> str:
    s = state.get("status")
    return "record_memory" if s == "resolved" else ("finalize" if s == "failed" else "plan")


def build_graph():
    g = StateGraph(AgentState)
    for name, fn in [("classify", classify), ("retrieve", retrieve), ("plan", plan), ("policy", policy),
                     ("execute", execute), ("verify", verify), ("record_memory", record_memory),
                     ("await_approval", await_approval), ("finalize", finalize)]:
        g.add_node(name, fn)
    g.add_conditional_edges(START, route_start, ["classify", "execute", "plan"])
    g.add_edge("classify", "retrieve")
    g.add_edge("retrieve", "plan")
    g.add_conditional_edges("plan", route_after_plan, ["policy", "finalize"])
    g.add_conditional_edges("policy", route_after_policy, ["await_approval", "execute", "plan"])
    g.add_conditional_edges("execute", route_after_execute, ["verify", "plan", "finalize"])
    g.add_conditional_edges("verify", route_after_verify, ["record_memory", "plan", "finalize"])
    g.add_edge("record_memory", "finalize")
    g.add_edge("await_approval", END)
    g.add_edge("finalize", END)
    return g.compile()


GRAPH = build_graph()
