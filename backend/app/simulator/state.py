"""Deterministic AWS-like simulator persisted in `simulator_states` (one document per tenant+env).

Scenario: payment-service's IAM role can DescribeSecret but lacks secretsmanager:GetSecretValue on
its DB secret, so startup fails with AccessDeniedException. Red herrings (KMS, VPC endpoint,
rotation, restarts) are real, inspectable parts of the state so a memory-less agent has to rule
them out. Access is COMPUTED from state by `evaluate_secret_access`, never stored as a flag."""
from __future__ import annotations

import copy
import fnmatch
from typing import Any

from app.db import get_db, utcnow

SECRET_ARN = "arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/payment/db-credentials-a1B2c3"


def initial_state(tenant_id: str, env: str = "staging") -> dict:
    return {
        "_id": f"sim_{tenant_id}_{env}",
        "tenant_id": tenant_id,
        "environment": env,
        "version": 0,
        "services": {
            "payment-service": {"iam_role": "payment-service-role", "deployment_status": "failed",
                                "secret_id": "prod/payment/db-credentials", "restarts": 0, "image": "payment:2.14.0"},
            "checkout-service": {"iam_role": "checkout-service-role", "deployment_status": "healthy",
                                 "secret_id": None, "restarts": 0, "image": "checkout:5.2.1"},
        },
        "iam_roles": {
            "payment-service-role": {"policies": [
                {"sid": "AllowDescribe", "effect": "Allow", "actions": ["secretsmanager:DescribeSecret"],
                 "resources": [SECRET_ARN]},
                {"sid": "AllowLogs", "effect": "Allow", "actions": ["logs:CreateLogStream", "logs:PutLogEvents"],
                 "resources": ["*"]},
            ]},
            "checkout-service-role": {"policies": []},
        },
        "secrets": {
            "prod/payment/db-credentials": {"arn": SECRET_ARN, "kms_key_alias": "alias/payment-secrets",
                                            "rotation_enabled": True, "last_rotated_days_ago": 12,
                                            "resource_policy": None, "value_version": 7},
        },
        "kms_keys": {"alias/payment-secrets": {"key_state": "Enabled",
                                               "decrypt_principals": ["payment-service-role"]}},
        "network": {"vpc_endpoint_secretsmanager": "available", "security_group_egress_443": True},
        "logs": {"payment-service": [
            "2026-11-14T09:58:02Z INFO  starting payment-service 2.14.0",
            "2026-11-14T09:58:03Z INFO  loading database credentials from AWS Secrets Manager",
            "2026-11-14T09:58:03Z ERROR credential bootstrap failed: AccessDeniedException (403) while loading secret",
            "2026-11-14T09:58:03Z ERROR startup aborted; container exiting with code 1",
        ]},
        "change_log": [],
        "updated_at": utcnow(),
    }


def reset(tenant_id: str, env: str = "staging") -> dict:
    s = initial_state(tenant_id, env)
    get_db().simulator_states.replace_one({"_id": s["_id"], "tenant_id": tenant_id}, s, upsert=True)
    return s


def load(tenant_id: str, env: str = "staging") -> dict:
    doc = get_db().simulator_states.find_one({"_id": f"sim_{tenant_id}_{env}", "tenant_id": tenant_id})
    return doc if doc else reset(tenant_id, env)


def save(state: dict, change: dict[str, Any]) -> dict:
    """Optimistic concurrency on `version` so concurrent tool calls cannot clobber each other."""
    prev = state["version"]
    new = copy.deepcopy(state)
    new["version"] = prev + 1
    new["updated_at"] = utcnow()
    new["change_log"] = (state.get("change_log", []) + [{**change, "at": new["updated_at"], "version": prev + 1}])[-50:]
    res = get_db().simulator_states.replace_one({"_id": state["_id"], "tenant_id": state["tenant_id"],
                                                 "version": prev}, new)
    if res.matched_count != 1:
        raise RuntimeError("Simulator state changed concurrently")
    return new


def _allows(policies: list[dict], action: str, resource: str) -> bool:
    allowed = False
    for p in policies:
        if any(fnmatch.fnmatch(action, a) for a in p["actions"]) and any(fnmatch.fnmatch(resource, r) for r in p["resources"]):
            if p["effect"] == "Deny":
                return False
            allowed = True
    return allowed


def evaluate_secret_access(state: dict, service: str) -> dict:
    """Independent evaluator: recomputes effective access from raw IAM/KMS/network state."""
    svc = state["services"].get(service)
    if not svc or not svc.get("secret_id"):
        return {"allowed": False, "checks": {"service_known": False}, "reason": "unknown service or no secret"}
    role = svc["iam_role"]
    secret = state["secrets"][svc["secret_id"]]
    policies = state["iam_roles"].get(role, {}).get("policies", [])
    key = state["kms_keys"].get(secret["kms_key_alias"], {})
    checks = {
        "iam_get_secret_value": _allows(policies, "secretsmanager:GetSecretValue", secret["arn"]),
        "kms_decrypt": key.get("key_state") == "Enabled" and role in key.get("decrypt_principals", []),
        "network_path": state["network"]["vpc_endpoint_secretsmanager"] == "available"
                        and state["network"]["security_group_egress_443"],
    }
    failing = [k for k, v in checks.items() if not v]
    return {"allowed": not failing, "checks": checks, "failing_checks": failing, "role": role,
            "secret_arn": secret["arn"]}
