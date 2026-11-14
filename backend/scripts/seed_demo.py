"""Reset and seed synthetic demo data for two tenants.

Run:  cd backend && python -m scripts.seed_demo        (wipes RecallOps collections in MONGODB_DATABASE)

Seeded memories are deliberately designed so that governance failures would CHANGE behavior:
- Beta's memory for the same service/error says "rotate the secret". If it leaked into Alpha,
  Alpha's agent would be steered to a fix that does not work in Alpha's environment.
- Alpha's expired and invalidated memories recommend wrong actions (restart / rotate).
"""
from __future__ import annotations

from datetime import timedelta

from app.db import get_db, utcnow
from app.memory import repository as repo
from app.simulator import state as sim

DEMO_INCIDENT = {
    "service": "payment-service", "environment": "staging", "error_code": "AccessDeniedException",
    "description": "Deploy of payment-service 2.14.0 to staging failed. Pods crash on startup while loading "
                   "database credentials; logs show AccessDeniedException from AWS. No config changes were "
                   "made to the app itself.",
}


def seed() -> dict:
    db = get_db()
    for c in ["memories", "incidents", "agent_runs", "audit_events", "approvals", "experiments", "simulator_states"]:
        db[c].delete_many({})
    now = utcnow()
    out = {}

    # ---------------- tenant_alpha
    a1 = repo.create_memory(
        tenant_id="tenant_alpha", memory_id="mem_alpha_secrets_iam", service="payment-service",
        error_code="AccessDeniedException", resolution_action="repair_secret_access",
        resolution_params={"service": "payment-service", "action": "secretsmanager:GetSecretValue"},
        outcome="success", confidence=0.95, verification_status="verified", source_incident_id="inc_hist_0412",
        content="payment-service deployment failed at startup with AccessDeniedException when reading its "
                "database credentials from Secrets Manager. Root cause: the service IAM role had "
                "DescribeSecret but not secretsmanager:GetSecretValue on the secret ARN. KMS and VPC endpoint "
                "were fine. Fix: a least-privilege IAM statement granting GetSecretValue on that one ARN "
                "(repair_secret_access). Restarting pods alone did not help.",
        now=now - timedelta(days=21))
    repo.create_memory(
        tenant_id="tenant_alpha", memory_id="mem_alpha_checkout_502", service="checkout-service",
        error_code="HTTP502", resolution_action="restart_service", outcome="success", confidence=0.7,
        verification_status="verified", source_incident_id="inc_hist_0388",
        content="checkout-service returned 502s after a node drain left a stale connection pool; a rolling "
                "restart (restart_service) cleared it.", now=now - timedelta(days=40))
    repo.create_memory(
        tenant_id="tenant_alpha", memory_id="mem_alpha_expired_restart", service="payment-service",
        error_code="AccessDeniedException", resolution_action="restart_service", outcome="success",
        confidence=0.6, verification_status="unverified", source_incident_id="inc_hist_0102",
        content="payment-service AccessDeniedException loading secrets went away after restarting the pods "
                "(restart_service). Assumed transient credential caching issue.",
        now=now - timedelta(days=200), expires_at=now - timedelta(days=110))
    inv = repo.create_memory(
        tenant_id="tenant_alpha", memory_id="mem_alpha_bad_rotate", service="payment-service",
        error_code="AccessDeniedException", resolution_action="rotate_secret", outcome="success",
        confidence=0.5, verification_status="unverified", source_incident_id="inc_hist_0233",
        content="AccessDeniedException on payment-service secrets: rotating the secret (rotate_secret) "
                "regenerated credentials and the deployment recovered.", now=now - timedelta(days=60))
    db.memories.update_one({"_id": inv["_id"]}, {"$set": {"status": repo.INVALIDATED, "invalidated_by": "alice",
                                                          "invalidation_reason": "post-mortem found rotation was coincidental"}})
    repo.create_memory(
        tenant_id="tenant_alpha", memory_id="mem_alpha_orders_s3", service="orders-service",
        error_code="AccessDeniedException", resolution_action="restart_service", outcome="success",
        confidence=0.6, verification_status="unverified", source_incident_id="inc_hist_0301",
        content="orders-service could not write invoices to S3 (AccessDenied). Restarting the service fixed it.",
        now=now - timedelta(days=15))  # inaccurate on purpose: use it for the live correction demo

    # ---------------- tenant_beta
    repo.create_memory(
        tenant_id="tenant_beta", memory_id="mem_beta_secrets_rotate", service="payment-service",
        error_code="AccessDeniedException", resolution_action="rotate_secret", outcome="success",
        confidence=0.9, verification_status="verified", source_incident_id="inc_beta_0077",
        content="Beta's payment-service failed with AccessDeniedException reading Secrets Manager because its "
                "secret's resource policy pinned an old credential version; rotating the secret "
                "(rotate_secret) fixed it. CONFIDENTIAL to Beta Logistics.", now=now - timedelta(days=10))
    repo.create_memory(
        tenant_id="tenant_beta", memory_id="mem_beta_kms", service="ledger-service",
        error_code="KMSAccessDenied", resolution_action=None, outcome="escalated", confidence=0.8,
        verification_status="verified", source_incident_id="inc_beta_0081",
        content="ledger-service KMS key was disabled during a key-rotation drill; re-enabled by security team.",
        now=now - timedelta(days=5))

    for t in ("tenant_alpha", "tenant_beta"):
        sim.reset(t)
    out["memories"] = db.memories.count_documents({})
    out["alpha_primary_memory"] = a1["memory_id"]
    return out


if __name__ == "__main__":
    print(seed())
