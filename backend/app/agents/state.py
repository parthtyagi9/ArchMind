from __future__ import annotations

from typing import Any, Literal, Optional, TypedDict

RunStatus = Literal["running", "awaiting_approval", "resolved", "failed", "escalated", "rejected"]


class Step(TypedDict, total=False):
    n: int
    kind: Literal["classify", "retrieve", "plan", "policy", "tool", "verify", "memory", "approval"]
    tool: Optional[str]
    args: dict[str, Any]
    state_changing: bool
    rationale: str
    hypothesis: str
    memory_ids_used: list[str]
    result: Any
    note: str
    at: str


class AgentState(TypedDict, total=False):
    run_id: str
    tenant_id: str
    actor: str                       # user who started the run
    approver: Optional[str]          # set only for pre-approved experiment runs
    incident: dict[str, Any]
    memory_enabled: bool
    write_memory: bool
    approval_mode: Literal["interactive", "pre_approved"]
    resume: Optional[Literal["execute", "plan"]]
    classification: dict[str, Any]
    memories: list[dict[str, Any]]
    retrieved_memory_ids: list[str]
    steps: list[Step]
    pending_action: Optional[dict[str, Any]]
    approval_id: Optional[str]
    repair_attempts: int
    verification: Optional[dict[str, Any]]
    memory_result: Optional[dict[str, Any]]
    status: RunStatus
    status_reason: str
    metrics: dict[str, Any]
    experiment_id: Optional[str]
    experiment_arm: Optional[str]
