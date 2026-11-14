import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.archmind import agent, memory as mem
from app.auth import principal_for
from app.main import app

ALICE, DEV, CAROL, BOB, MAYA = (principal_for(u) for u in ("alice", "dev", "carol", "bob", "maya"))
Q = "Should we introduce Redis caching into the payment service?"


@pytest.fixture(autouse=True)
def seeded(env):
    mem.seed()


def ids(rows):
    return {r["id"] if "id" in r else r["_id"] for r in rows}


def test_visibility_tenant_and_team_scope():
    alice, carol, bob = ids(mem.list_visible(ALICE)), ids(mem.list_visible(CAROL)), ids(mem.list_visible(BOB))
    assert "m_redis" in alice and "m_redis" not in carol  # team:payments memory hidden from mobile team
    assert "m_audience" in carol                           # org-scoped memory visible
    assert bob == {"b_idem", "b_redis"} and not (alice & bob)


def test_retrieval_only_approved_unexpired_in_scope():
    hits, excluded = mem.search(ALICE, "redis caching payments jwt memcached session gateway", k=20)
    got = ids(hits)
    assert not got & {"m_memcached", "m_p1", "m_p2", "m_pin", "b_redis", "b_idem"}  # revoked, pending, expired, other tenant
    assert "m_redis" in got and excluded == 4  # m_memcached, m_p1, m_p2, m_pin
    assert "m_redis" not in ids(mem.search(CAROL, "redis caching payments", k=20)[0])


def test_approval_flow_and_roles():
    with pytest.raises(HTTPException) as e:
        mem.approve(DEV, "m_p1")
    assert e.value.status_code == 403
    assert "m_p1" not in ids(mem.search(ALICE, "gateway jwt termination audience", k=20)[0])
    out = mem.approve(MAYA, "m_p1")  # Admin can approve
    assert out["status"] == "approved"
    assert "m_p1" in ids(mem.search(ALICE, "gateway jwt termination audience", k=20)[0])
    assert mem.reject(ALICE, "m_p2")["status"] == "rejected"


def test_correction_versions_and_reembeds(env):
    before = env["db"].arch_memories.find_one({"_id": "m_pg"})["embedding"]
    out = mem.correct(ALICE, "m_pg", "Transactional data uses PostgreSQL 16 with logical replication.", "upgrade")
    assert out["version"] == 2 and [h["status"] for h in out["history"]] == ["superseded", "approved"]
    assert env["db"].arch_memories.find_one({"_id": "m_pg"})["embedding"] != before


def test_revoke_takes_effect_immediately():
    mem.revoke(ALICE, "m_redis", "superseded by platform decision")
    assert "m_redis" not in ids(mem.search(ALICE, "redis caching payments", k=20)[0])


def test_cross_tenant_actions_are_404():
    with pytest.raises(HTTPException) as e:
        mem.revoke(BOB, "m_redis")
    assert e.value.status_code == 404


def test_ask_memory_changes_decision_and_drops_hallucinated_citations():
    off = agent.ask(ALICE, Q, memory_on=False, evidence=[])
    on = agent.ask(ALICE, Q, memory_on=True, evidence=[])
    assert off["retrieved"] == [] and off["answer"]["decision"] == "adopt_redis_cache"
    assert on["answer"]["decision"] == "restrict_redis_to_non_critical" and on["memoryInfluenced"]
    used = {r["id"] for r in on["retrieved"] if r["used"]}
    assert "m_redis" in used and "m_hallucinated" not in used
    assert on["answer"]["requiresApproval"] is True  # cites an approved architecture decision


def test_carol_gets_no_payments_team_memory_in_answer():
    run = agent.ask(CAROL, Q, memory_on=True, evidence=[])
    assert "m_redis" not in {r["id"] for r in run["retrieved"]}


def test_proposed_memory_is_pending_and_not_retrievable():
    m = mem.propose(ALICE, title="Balance cache must be write-through", content="Any balance cache must be write-through.",
                    components=["payments-service"], run_id="run_x")
    assert m["status"] == "pending"
    assert m["id"] not in ids(mem.search(ALICE, "balance cache write-through", k=20)[0])


def test_api_endpoints():
    c = TestClient(app)
    c.post("/api/session/login", json={"user_id": "bob"})
    assert ids(c.get("/api/arch/memories").json()) == {"b_idem", "b_redis"}
    assert c.post("/api/arch/memories/m_redis/revoke", json={"reason": "x"}).status_code == 404
    r = c.post("/api/arch/compare", json={"question": Q, "evidence": [{"kind": "jira", "ref": "PAY-171", "title": "latency"}]}).json()
    assert r["off"]["memoryOn"] is False and r["on"]["memoryOn"] is True
    assert c.get("/api/arch/runs").json() and c.get("/api/arch/events").json()
