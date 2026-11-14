from fastapi.testclient import TestClient

from app.main import app
from scripts.seed_demo import seed


def client_as(user):
    c = TestClient(app)
    assert c.post("/api/session/login", json={"user_id": user}).status_code == 200
    return c


def test_requires_session(env):
    assert TestClient(app).get("/api/memories").status_code == 401


def test_forged_cookie_rejected(env):
    c = TestClient(app)
    c.cookies.set("recallops_session", "eyJ1aWQiOiJib2IifQ.forged.sig")
    assert c.get("/api/session/me").status_code == 401


def test_tenant_in_body_or_query_is_ignored(env):
    seed()
    c = client_as("bob")
    r = c.get("/api/memories", params={"tenant_id": "org_alpha"})
    assert r.status_code == 200 and {m["tenant_id"] for m in r.json()} == {"org_beta"}
    r = c.post("/api/incidents", json={"tenant_id": "org_alpha", "service": "payment-service",
                                       "description": "secret access failure"})
    assert r.json()["tenant_id"] == "org_beta"
    assert c.get("/api/memories/mem_alpha_secrets_iam/history").status_code == 404


def test_memory_list_never_returns_embeddings(env):
    seed()
    r = client_as("alice").get("/api/memories")
    assert r.json() and all("embedding" not in m for m in r.json())


def test_role_levels(env):
    from fastapi import HTTPException
    import pytest
    from app.auth import principal_for
    from app.memory import governance
    from app.services import runs
    from scripts.seed_demo import DEMO_INCIDENT
    seed()
    maya = principal_for("maya")  # Admin: can approve, cannot govern memory
    assert maya.role == "Admin" and maya.has("approver") and not maya.has("memory_admin")
    with pytest.raises(HTTPException) as e:
        governance.invalidate_memory(maya, "mem_alpha_secrets_iam")
    assert e.value.status_code == 403 and "Super Admin" in e.value.detail
    inc = runs.create_incident(maya, DEMO_INCIDENT)
    run = runs.start_run(maya, inc["_id"])
    assert runs.decide_approval(maya, run["_id"], True)["status"] == "resolved"
    assert principal_for("dev").role == "User" and principal_for("alice").role == "Super Admin"
