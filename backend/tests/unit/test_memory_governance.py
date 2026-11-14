"""The governance claims of the hackathon track, as executable tests."""
import json

from conftest import principal_for, register
from app.memory import retrieval
from app.db import utcnow


def mem(title="Redis restrictions", content="Redis must not be the source of truth for payment balances.", **kw):
    return {"title": title, "content": content, "memory_type": "architecture_decision", "scope": "org", **kw}


def setup_org(client, make_client):
    register(client, "owner@x.io", "Olive", org_name="Acme")
    inv_m = client.post("/api/org/invites", json={"role": "member", "team": "payments"}).json()
    inv_a = client.post("/api/org/invites", json={"role": "admin", "team": "platform"}).json()
    member, admin = make_client(), make_client()
    register(member, "m@x.io", "Mia", invite_code=inv_m["code"])
    register(admin, "a@x.io", "Abe", invite_code=inv_a["code"])
    return member, admin


def search(c, q="redis caching for payment balances", repo_id=None):
    r = c.post("/api/memories/search", json={"query": q, "repo_id": repo_id})
    assert r.status_code == 200, r.text
    return r.json()


def test_member_proposal_is_pending_and_never_retrievable(client, make_client):
    member, admin = setup_org(client, make_client)
    m = member.post("/api/memories", json=mem()).json()
    assert m["status"] == "pending" and m["eligible"] is False and m["exclusion_reason"] == "pending approval"
    assert search(member)["results"] == [] and search(admin)["results"] == []


def test_admin_creates_active_directly_and_it_is_retrievable(client, make_client):
    member, admin = setup_org(client, make_client)
    m = admin.post("/api/memories", json=mem()).json()
    assert m["status"] == "active" and m["approved_by"]["name"] == "Abe"
    res = search(member)["results"]
    assert [r["memory"]["memory_id"] for r in res] == [m["memory_id"]]


def test_approve_embeds_and_makes_it_retrievable_member_cannot_approve(client, make_client, env):
    member, admin = setup_org(client, make_client)
    m = member.post("/api/memories", json=mem()).json()
    assert member.post(f"/api/memories/{m['memory_id']}/approve", json={}).status_code == 403
    assert "embedding" not in env["db"].memories.find_one({"memory_id": m["memory_id"]})  # nothing vectorized before approval
    ok = admin.post(f"/api/memories/{m['memory_id']}/approve", json={"reason": "verified in PAY-142"})
    assert ok.status_code == 200 and ok.json()["status"] == "active" and ok.json()["authority"] == "verified"
    assert env["db"].memories.find_one({"memory_id": m["memory_id"]})["embedding"]
    assert len(search(member)["results"]) == 1


def test_edit_on_approval_is_recorded_and_embeds_the_edited_text(client, make_client, env):
    member, admin = setup_org(client, make_client)
    m = member.post("/api/memories", json=mem()).json()
    r = admin.post(f"/api/memories/{m['memory_id']}/approve", json={"content": "Redis may cache read-only reference data only."}).json()
    assert r["content"].startswith("Redis may cache")
    ev = [e for e in env["db"].audit_events.find({"type": "memory.approved"})]
    assert ev and ev[0]["details"]["edited"] is True


def test_reject_keeps_it_out_forever(client, make_client):
    member, admin = setup_org(client, make_client)
    m = member.post("/api/memories", json=mem()).json()
    assert admin.post(f"/api/memories/{m['memory_id']}/reject", json={"reason": "wrong"}).json()["status"] == "rejected"
    assert admin.post(f"/api/memories/{m['memory_id']}/approve", json={}).status_code == 404
    assert search(admin)["results"] == []


def test_tenant_isolation_in_retrieval_listing_and_detail(client, make_client):
    member, admin = setup_org(client, make_client)
    m = admin.post("/api/memories", json=mem()).json()
    other = make_client()
    register(other, "evil@y.io", "Eve", org_name="Other Co")
    assert search(other)["results"] == []                       # vector retrieval
    assert other.get("/api/memories").json() == []               # listing
    assert other.get(f"/api/memories/{m['memory_id']}").status_code == 404   # detail: same answer as "does not exist"
    # Eve owns her own org, but a foreign id answers exactly like a missing one: no existence oracle.
    for action, body in (("revoke", {}), ("correct", {"content": "pwned"}), ("purge", {})):
        assert other.post(f"/api/memories/{m['memory_id']}/{action}", json=body).status_code == 404
    assert admin.get(f"/api/memories/{m['memory_id']}").json()["content"].startswith("Redis must not")  # untouched


def test_team_scope_is_enforced_inside_retrieval(client, make_client):
    member, admin = setup_org(client, make_client)           # member: team payments, admin: team platform
    m = admin.post("/api/memories", json=mem(scope="team", team="payments")).json()
    assert len(search(member)["results"]) == 1               # same team: retrievable
    assert search(admin)["results"] == []                    # admin of ANOTHER team: the agent acting for them cannot retrieve it
    assert search(client)["results"] == []                   # owner without a team: not retrievable by their agent either
    listing = {x["memory_id"]: x for x in admin.get("/api/memories").json()}   # but admins can manage it
    assert listing[m["memory_id"]]["eligible"] is False and "scoped to team payments" in listing[m["memory_id"]]["exclusion_reason"]


def test_repo_scope_only_applies_to_that_repo(client, make_client, env):
    member, admin = setup_org(client, make_client)
    org_id = principal_for(admin).org_id
    for rid in ("repo_a", "repo_b"):
        env["db"].repos.insert_one({"_id": rid, "org_id": org_id, "full_name": f"acme/{rid}", "branch": "main", "status": "ready", "created_at": utcnow()})
    admin.post("/api/memories", json=mem(scope="repo", repo_id="repo_a"))
    assert len(search(member, repo_id="repo_a")["results"]) == 1
    assert search(member, repo_id="repo_b")["results"] == []
    assert search(member, repo_id=None)["results"] == []     # no repo context: repo-scoped memories are not used


def test_repo_scope_rejects_foreign_repo(client, make_client, env):
    member, admin = setup_org(client, make_client)
    env["db"].repos.insert_one({"_id": "repo_x", "org_id": "org_other", "full_name": "x/y", "branch": "main", "status": "ready", "created_at": utcnow()})
    assert admin.post("/api/memories", json=mem(scope="repo", repo_id="repo_x")).status_code == 422


def test_expired_memory_is_excluded_at_query_time_even_before_cleanup(client, make_client):
    member, admin = setup_org(client, make_client)
    m = admin.post("/api/memories", json=mem(expires_in_days=1)).json()
    assert len(search(member)["results"]) == 1
    from datetime import timedelta
    # Same query, two days later: nothing changed in the database, eligibility is evaluated at retrieval time.
    p = principal_for(member)
    later = retrieval.search(p, "redis caching for payment balances", now=utcnow() + timedelta(days=2))
    assert later == []
    assert m["expires_at"] is not None


def test_status_expired_is_computed_for_past_expiry(client, make_client, env):
    member, admin = setup_org(client, make_client)
    m = admin.post("/api/memories", json=mem()).json()
    from datetime import timedelta
    env["db"].memories.update_one({"memory_id": m["memory_id"]}, {"$set": {"expires_at": utcnow() - timedelta(hours=1)}})
    got = admin.get(f"/api/memories/{m['memory_id']}").json()
    assert got["status"] == "expired" and got["eligible"] is False
    assert search(member)["results"] == []


def test_revoke_takes_effect_immediately_and_keeps_history(client, make_client):
    member, admin = setup_org(client, make_client)
    m = admin.post("/api/memories", json=mem()).json()
    assert len(search(member)["results"]) == 1
    r = admin.post(f"/api/memories/{m['memory_id']}/revoke", json={"reason": "stack changed"})
    assert r.json()["status"] == "invalidated"
    assert search(member)["results"] == []
    assert member.post(f"/api/memories/{m['memory_id']}/revoke", json={}).status_code == 403


def test_correction_creates_new_version_old_is_superseded_only_current_is_retrieved(client, make_client):
    member, admin = setup_org(client, make_client)
    m = admin.post("/api/memories", json=mem(content="Do not introduce Redis to the payments service.")).json()
    new = admin.post(f"/api/memories/{m['memory_id']}/correct",
                     json={"content": "Redis may be used for non-transactional read caching, never for balances.", "reason": "ban too broad"}).json()
    assert new["version"] == 2 and new["status"] == "active"
    d = admin.get(f"/api/memories/{m['memory_id']}").json()
    assert [(h["version"], h["status"]) for h in d["history"]] == [(1, "superseded"), (2, "active")]
    res = search(member, "do we cache with redis?")["results"]
    assert len(res) == 1 and res[0]["memory"]["version"] == 2 and "non-transactional" in res[0]["memory"]["content"]


def test_purge_physically_removes_content_and_embeddings_but_keeps_tombstone(client, make_client, env):
    member, admin = setup_org(client, make_client)
    m = admin.post("/api/memories", json=mem()).json()
    admin.post(f"/api/memories/{m['memory_id']}/correct", json={"content": "second version text"})
    assert admin.post(f"/api/memories/{m['memory_id']}/purge", json={}).status_code == 403      # admins cannot purge
    r = client.post(f"/api/memories/{m['memory_id']}/purge", json={"reason": "legal request"})   # owner can
    assert r.json()["versions_purged"] == 2
    for doc in env["db"].memories.find({"memory_id": m["memory_id"]}):
        assert doc["status"] == "purged" and "content" not in doc and "embedding" not in doc and "title" not in doc and doc["content_sha256"]
    blob = json.dumps(list(env["db"].audit_events.find({}, {"_id": 0})), default=str)
    assert "Redis must not" not in blob and "second version text" not in blob      # audit never held content
    assert search(member)["results"] == []


def test_audit_trail_records_lifecycle(client, make_client):
    member, admin = setup_org(client, make_client)
    m = member.post("/api/memories", json=mem()).json()
    admin.post(f"/api/memories/{m['memory_id']}/approve", json={})
    admin.post(f"/api/memories/{m['memory_id']}/revoke", json={"reason": "r"})
    types = [e["type"] for e in admin.get(f"/api/audit?memory_id={m['memory_id']}").json()]
    assert types == ["memory.revoked", "memory.approved", "memory.created"]


def test_members_only_see_what_they_may(client, make_client):
    member, admin = setup_org(client, make_client)
    admin.post("/api/memories", json=mem(title="platform only", scope="team", team="platform"))
    pend = admin.post("/api/memories", json=mem(title="visible org")).json()
    other_member_pending = client.post("/api/memories", json=mem(title="owner active")).json()
    titles = {x["title"] for x in member.get("/api/memories").json()}
    assert "platform only" not in titles and {"visible org", "owner active"} <= titles
    assert pend["status"] == "active" and other_member_pending["status"] == "active"
