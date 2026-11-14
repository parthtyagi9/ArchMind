from datetime import timedelta

import pytest
from fastapi import HTTPException

from app.auth import principal_for
from app.config import get_settings
from app.db import utcnow
from app.memory import governance, repository as repo, retrieval
from scripts.seed_demo import seed

QUERY = "payment-service AccessDeniedException secretsmanager GetSecretValue secret access denied"


def ids(results):
    return {r["memory_id"] for r in results}


def test_memory_creation_stores_embedding_and_provenance(env):
    m = repo.create_memory(tenant_id="org_alpha", content="x fixed by y", service="s", error_code="E",
                           resolution_action="repair_secret_access", outcome="success", source_incident_id="inc_1")
    doc = env["db"].memories.find_one({"_id": m["_id"]})
    assert len(doc["embedding"]) == get_settings().embedding_dimensions
    for f in ("tenant_id", "version", "status", "created_at", "updated_at", "expires_at", "source_incident_id"):
        assert doc[f] is not None
    assert doc["status"] == "active" and doc["version"] == 1


def test_tenant_isolation_both_directions(env):
    seed()
    alpha = retrieval.search(QUERY, "org_alpha", k=10)
    beta = retrieval.search(QUERY, "org_beta", k=10)
    assert alpha and beta
    assert all(r["tenant_id"] == "org_alpha" for r in alpha)
    assert all(r["tenant_id"] == "org_beta" for r in beta)
    assert "mem_beta_secrets_rotate" not in ids(alpha)
    assert "mem_alpha_secrets_iam" not in ids(beta)


def test_governance_filter_is_inside_vector_search_stage():
    pipe = retrieval.build_vector_pipeline([0.0] * 1024, "org_alpha", utcnow(), 4)
    vs = pipe[0]["$vectorSearch"]
    assert vs["filter"]["tenant_id"] == {"$eq": "org_alpha"}
    assert vs["filter"]["status"] == {"$eq": "active"}
    assert "$gt" in vs["filter"]["expires_at"]
    with pytest.raises(ValueError):
        retrieval.governance_filter("", utcnow())


def test_expired_and_invalidated_memories_excluded(env):
    seed()
    got = ids(retrieval.search(QUERY, "org_alpha", k=10))
    assert "mem_alpha_secrets_iam" in got
    assert "mem_alpha_expired_restart" not in got
    assert "mem_alpha_bad_rotate" not in got


def test_invalidate_takes_effect_immediately(env):
    seed()
    alice = principal_for("alice")
    governance.invalidate_memory(alice, "mem_alpha_secrets_iam", "test")
    assert "mem_alpha_secrets_iam" not in ids(retrieval.search(QUERY, "org_alpha", k=10))
    assert env["db"].audit_events.find_one({"event_type": "memory.invalidated"})


def test_correction_supersedes_and_reembeds(env):
    seed()
    alice = principal_for("alice")
    old = repo.get_active("org_alpha", "mem_alpha_orders_s3")
    new = governance.correct_memory(alice, "mem_alpha_orders_s3",
                                    content="orders-service S3 AccessDenied was a bucket policy missing s3:PutObject; "
                                            "restart did not fix it.", resolution_action=None, reason="post-mortem")
    hist = repo.history("org_alpha", "mem_alpha_orders_s3")
    assert [h["status"] for h in hist] == ["superseded", "active"]
    assert new["version"] == 2 and new["supersedes"] == old["_id"]
    new_doc = env["db"].memories.find_one({"_id": new["_id"]})
    assert new_doc["embedding"] != old["embedding"]
    res = retrieval.search("orders-service S3 bucket policy PutObject", "org_alpha", k=10)
    versions = [r["_id"] for r in res if r["memory_id"] == "mem_alpha_orders_s3"]
    assert versions == [new["_id"]]
    assert env["db"].audit_events.find_one({"event_type": "memory.corrected", "memory_id": "mem_alpha_orders_s3"})


def test_governance_requires_role_and_same_tenant(env):
    seed()
    with pytest.raises(HTTPException) as e:
        governance.invalidate_memory(principal_for("dev"), "mem_alpha_secrets_iam")
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        governance.invalidate_memory(principal_for("bob"), "mem_alpha_secrets_iam")  # beta admin, alpha memory
    assert e.value.status_code == 404
    assert repo.get_active("org_alpha", "mem_alpha_secrets_iam")


def test_purge_removes_content_and_embedding(env):
    seed()
    governance.purge_memory(principal_for("alice"), "mem_alpha_checkout_502")
    for v in env["db"].memories.find({"memory_id": "mem_alpha_checkout_502"}):
        assert "content" not in v and "embedding" not in v and v["status"] == "purged" and v["content_sha256"]


def test_semantic_retrieval_with_different_wording_is_integration_only():
    """Paraphrase relevance needs real Gemini embeddings: see tests/integration/test_atlas_live.py."""


def test_expiry_boundary(env):
    now = utcnow()
    repo.create_memory(tenant_id="t", content="payment secret fix", service="s", error_code="E",
                       resolution_action="a", outcome="success", expires_at=now + timedelta(seconds=1), now=now)
    assert retrieval.search("payment secret fix", "t", now=now)
    assert not retrieval.search("payment secret fix", "t", now=now + timedelta(seconds=2))
