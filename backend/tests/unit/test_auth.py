from fastapi.testclient import TestClient

from conftest import register


def test_register_creates_org_with_owner_role(client):
    me = register(client, "a@x.io", "Ada", org_name="Acme")
    assert me["org"]["name"] == "Acme" and me["org"]["role"] == "owner"
    assert "purge_memory" in me["org"]["permissions"] and "manage_members" in me["org"]["permissions"]
    assert client.get("/api/auth/me").json()["user"]["email"] == "a@x.io"


def test_duplicate_email_and_weak_password_rejected(client):
    register(client, "a@x.io")
    r = client.post("/api/auth/register", json={"email": "A@x.io", "password": "longenough", "name": "B", "org_name": "O"})
    assert r.status_code == 409
    r = client.post("/api/auth/register", json={"email": "b@x.io", "password": "short", "name": "B", "org_name": "O"})
    assert r.status_code == 422


def test_login_logout_and_bad_credentials(client):
    register(client, "a@x.io")
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json={"email": "a@x.io", "password": "wrong"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "nobody@x.io", "password": "correct horse"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "a@x.io", "password": "correct horse"}).status_code == 200
    assert client.get("/api/auth/me").status_code == 200


def test_password_is_hashed_not_stored(client, env):
    register(client, "a@x.io")
    u = env["db"].users.find_one({"email": "a@x.io"})
    assert "correct horse" not in u["password_hash"] and u["password_hash"].startswith("scrypt$")


def test_forged_or_tampered_cookie_is_rejected(client):
    register(client, "a@x.io")
    c2 = TestClient(client.app)
    c2.cookies.set("archmind_session", client.cookies.get("archmind_session") + "x")
    assert c2.get("/api/auth/me").status_code == 401


def test_invite_joins_org_with_role_and_team(client, make_client):
    register(client, "owner@x.io", "Olive", org_name="Acme")
    inv = client.post("/api/org/invites", json={"role": "member", "team": "platform"}).json()
    c2 = make_client()
    me = register(c2, "dev@x.io", "Dev", invite_code=inv["code"])
    assert me["org"]["name"] == "Acme" and me["org"]["role"] == "member" and me["org"]["team"] == "platform"
    assert len(client.get("/api/org/members").json()) == 2


def test_invalid_invite_rejected(client):
    r = client.post("/api/auth/register", json={"email": "a@x.io", "password": "correct horse", "name": "A", "invite_code": "nope"})
    assert r.status_code == 400


def test_member_cannot_manage_and_denial_is_audited(client, make_client, env):
    register(client, "owner@x.io", org_name="Acme")
    inv = client.post("/api/org/invites", json={"role": "member"}).json()
    c2 = make_client()
    register(c2, "dev@x.io", invite_code=inv["code"])
    assert c2.post("/api/org/invites", json={"role": "member"}).status_code == 403
    assert c2.patch("/api/org/members/anyone", json={"role": "owner"}).status_code == 403
    assert env["db"].audit_events.count_documents({"type": "authz.denied"}) == 2


def test_cannot_switch_into_foreign_org(client, make_client):
    me_a = register(client, "a@x.io", org_name="A")
    c2 = make_client()
    register(c2, "b@x.io", org_name="B")
    r = c2.post("/api/auth/switch-org", json={"org_id": me_a["org"]["id"]})
    assert r.status_code == 403


def test_last_owner_cannot_be_demoted(client):
    me = register(client, "a@x.io")
    r = client.patch(f"/api/org/members/{me['user']['id']}", json={"role": "member"})
    assert r.status_code == 409


def test_github_oauth_not_configured_reports_false(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "github_client_id", "")
    monkeypatch.setattr(get_settings(), "github_client_secret", "")
    assert client.get("/api/auth/config").json() == {"github_oauth": False}
    assert client.get("/api/auth/github/login").status_code == 503
