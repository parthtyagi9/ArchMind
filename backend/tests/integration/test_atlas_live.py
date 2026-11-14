"""Live suite against MongoDB Atlas + Gemini. Uses a separate database so demo data is untouched.

    cd backend && RUN_LIVE=1 python -m pytest tests/integration -m integration -s
Requires backend/.env with MONGODB_URI and GEMINI_API_KEY, and the vector index on <db>_it.memories
(the fixture creates it and waits)."""
import os
import time

import pytest

pytestmark = [pytest.mark.integration,
              pytest.mark.skipif(not os.getenv("RUN_LIVE"), reason="set RUN_LIVE=1 for live Atlas tests")]


@pytest.fixture(scope="module", autouse=True)
def live_db():
    from app.config import get_settings
    from app.db import set_db, get_db
    from app.memory.embeddings import set_embedder
    from app.agents.llm import set_llm

    s = get_settings()
    s.vector_backend = "atlas"
    s.mongodb_database = s.mongodb_database + "_it"
    set_db(None), set_embedder(None), set_llm(None)
    from scripts import create_indexes, seed_demo
    create_indexes.main()
    seed_demo.seed()
    time.sleep(3)  # let Atlas Search sync newly inserted vectors
    yield get_db()


@pytest.fixture(autouse=True)
def env():  # override the unit-test mongomock fixture
    yield


def _ids(r):
    return {m["memory_id"] for m in r}


def test_vector_search_tenant_isolation_live():
    from app.memory import retrieval
    q = "payment-service can't fetch its DB password from Secrets Manager, AccessDenied"
    a = retrieval.search(q, "org_alpha", k=10)
    b = retrieval.search(q, "org_beta", k=10)
    assert "mem_alpha_secrets_iam" in _ids(a) and "mem_beta_secrets_rotate" not in _ids(a)
    assert "mem_beta_secrets_rotate" in _ids(b) and "mem_alpha_secrets_iam" not in _ids(b)
    assert "mem_alpha_expired_restart" not in _ids(a) and "mem_alpha_bad_rotate" not in _ids(a)


def test_semantic_paraphrase_retrieval_live():
    from app.memory import retrieval
    q = "checkout API throwing bad gateway errors after nodes were drained"  # no shared key tokens like 'HTTP502'
    res = retrieval.search(q, "org_alpha", k=3)
    assert res and res[0]["memory_id"] == "mem_alpha_checkout_502", [(r["memory_id"], r["score"]) for r in res]


def test_full_agent_run_live():
    from app.auth import principal_for
    from app.services import runs
    from scripts.seed_demo import DEMO_INCIDENT
    alice = principal_for("alice")
    inc = runs.create_incident(alice, DEMO_INCIDENT)
    run = runs.start_run(alice, inc["_id"])
    assert run["status"] == "awaiting_approval", run.get("status_reason")
    run = runs.decide_approval(alice, run["_id"], True)
    print("\nsteps:", [(s["kind"], s.get("tool")) for s in run["steps"]])
    assert run["status"] in ("resolved", "awaiting_approval")
