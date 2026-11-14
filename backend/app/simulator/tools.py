"""Fixed, allowlisted tool registry. The LLM can only NAME a tool and supply arguments; arguments are
validated with Pydantic, state-changing tools require a server-side approval, and nothing here
executes shell commands or LLM-generated code."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.simulator import state as sim

ServiceName = Literal["payment-service", "checkout-service"]


class ServiceArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    service: ServiceName


class RepairArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    service: ServiceName
    action: Literal["secretsmanager:GetSecretValue"] = Field(
        "secretsmanager:GetSecretValue", description="Single IAM action to grant, scoped to the service's secret ARN")


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    args_model: type[BaseModel]
    state_changing: bool
    fn: Callable[[dict, BaseModel], tuple[dict, dict | None]]  # (result, change or None)


def _svc(state: dict, service: str) -> dict:
    return state["services"][service]


def inspect_service_logs(state: dict, a: ServiceArgs):
    return {"service": a.service, "recent_logs": state["logs"].get(a.service, []),
            "deployment_status": _svc(state, a.service)["deployment_status"]}, None


def inspect_service_permissions(state: dict, a: ServiceArgs):
    role = _svc(state, a.service)["iam_role"]
    return {"service": a.service, "iam_role": role, "policies": state["iam_roles"][role]["policies"]}, None


def inspect_secret_access(state: dict, a: ServiceArgs):
    secret_id = _svc(state, a.service).get("secret_id")
    if not secret_id:
        return {"service": a.service, "secret": None}, None
    s = state["secrets"][secret_id]
    return {"service": a.service, "secret_id": secret_id, "arn": s["arn"], "kms_key_alias": s["kms_key_alias"],
            "rotation_enabled": s["rotation_enabled"], "last_rotated_days_ago": s["last_rotated_days_ago"],
            "resource_policy": s["resource_policy"]}, None


def inspect_kms_key(state: dict, a: ServiceArgs):
    secret_id = _svc(state, a.service).get("secret_id")
    alias = state["secrets"][secret_id]["kms_key_alias"] if secret_id else None
    return {"service": a.service, "kms_key_alias": alias, **(state["kms_keys"].get(alias, {}) if alias else {})}, None


def inspect_network_path(state: dict, a: ServiceArgs):
    return {"service": a.service, **state["network"]}, None


def restart_service(state: dict, a: ServiceArgs):
    svc = _svc(state, a.service)
    svc["restarts"] += 1
    ok = sim.evaluate_secret_access(state, a.service)["allowed"] if svc.get("secret_id") else True
    svc["deployment_status"] = "healthy" if ok else "failed"
    return {"service": a.service, "restarted": True, "deployment_status": svc["deployment_status"]}, \
        {"tool": "restart_service", "service": a.service}


def rotate_secret(state: dict, a: ServiceArgs):
    secret_id = _svc(state, a.service).get("secret_id")
    s = state["secrets"][secret_id]
    s["value_version"] += 1
    s["last_rotated_days_ago"] = 0
    return {"service": a.service, "secret_id": secret_id, "new_value_version": s["value_version"]}, \
        {"tool": "rotate_secret", "service": a.service}


def repair_secret_access(state: dict, a: RepairArgs):
    svc = _svc(state, a.service)
    role = svc["iam_role"]
    arn = state["secrets"][svc["secret_id"]]["arn"]
    stmt = {"sid": "RecallOpsScopedSecretRead", "effect": "Allow", "actions": [a.action], "resources": [arn]}
    pols = state["iam_roles"][role]["policies"]
    if not any(p.get("sid") == stmt["sid"] for p in pols):
        pols.append(stmt)  # idempotent
    if sim.evaluate_secret_access(state, a.service)["allowed"]:
        svc["deployment_status"] = "healthy"
    return {"service": a.service, "iam_role": role, "statement_added": stmt,
            "note": "acknowledgement only; success is decided by independent verification"}, \
        {"tool": "repair_secret_access", "service": a.service, "statement": stmt}


REGISTRY: dict[str, Tool] = {t.name: t for t in [
    Tool("inspect_service_logs", "Read recent logs and deployment status for a service.", ServiceArgs, False, inspect_service_logs),
    Tool("inspect_service_permissions", "List the IAM policies attached to the service's role.", ServiceArgs, False, inspect_service_permissions),
    Tool("inspect_secret_access", "Show the Secrets Manager secret the service uses (ARN, KMS key, rotation, resource policy).", ServiceArgs, False, inspect_secret_access),
    Tool("inspect_kms_key", "Show state and decrypt principals of the KMS key protecting the service's secret.", ServiceArgs, False, inspect_kms_key),
    Tool("inspect_network_path", "Check VPC endpoint and security-group egress to Secrets Manager.", ServiceArgs, False, inspect_network_path),
    Tool("restart_service", "Restart the service's deployment. STATE-CHANGING.", ServiceArgs, True, restart_service),
    Tool("rotate_secret", "Rotate the service's secret value. STATE-CHANGING.", ServiceArgs, True, rotate_secret),
    Tool("repair_secret_access", "Attach a least-privilege IAM statement granting one Secrets Manager action on the service's secret ARN. STATE-CHANGING.", RepairArgs, True, repair_secret_access),
]}


def catalog() -> list[dict]:
    return [{"name": t.name, "description": t.description, "state_changing": t.state_changing,
             "args_schema": t.args_model.model_json_schema()} for t in REGISTRY.values()]


def validate(tool_name: str, args: dict[str, Any]) -> tuple[Tool, BaseModel]:
    if tool_name not in REGISTRY:
        raise ValueError(f"Tool '{tool_name}' is not in the allowlist")
    t = REGISTRY[tool_name]
    return t, t.args_model.model_validate(args or {})


def execute(tenant_id: str, tool_name: str, args: dict[str, Any], env: str = "staging") -> dict:
    t, parsed = validate(tool_name, args)
    state = sim.load(tenant_id, env)
    result, change = t.fn(state, parsed)
    if change:
        sim.save(state, change)
    return result


def verify_secret_access(tenant_id: str, service: str, env: str = "staging") -> dict:
    """Re-reads persisted state from MongoDB (not the tool's return value) and recomputes access."""
    return sim.evaluate_secret_access(sim.load(tenant_id, env), service)
