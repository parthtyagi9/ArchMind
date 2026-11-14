"""Unit-test fixtures: mongomock DB, deterministic hash embedder, scripted LLM, fake integrations. No network."""
from __future__ import annotations

import mongomock
import pytest
from fastapi.testclient import TestClient
from pymongo import ASCENDING, IndexModel

from app.agents.llm import LLMAnswer, LLMConstraint, set_llm
from app.config import get_settings
from app.db import set_db
from app.memory.embeddings import HashEmbedder, reset_providers, set_code_embedder, set_embedder, set_reranker


class ScriptedLLM:
    """Deterministic stand-in for Gemini. It reads the prompt the real agent built, so it reacts to exactly the
    memories passed in (and to nothing else), the same way the real model has to."""
    model_name = "scripted"

    def __init__(self) -> None:
        self.prompts: list[str] = []

    def structured(self, system, prompt, schema):
        self.prompts.append(prompt)
        mems_block = prompt.split("<memories>")[1].split("</memories>")[0]
        refs = []
        if '"memory_ref"' in mems_block:
            import re

            refs = re.findall(r'"memory_ref": "([^"]+)"', mems_block)
        bogus = LLMConstraint(text="Invented rule", memory_ref="mem_doesnotexist@v9")
        if refs:
            return LLMAnswer(headline="Constrained", explanation=["Because of an approved decision."], verdict="needs_architecture_review",
                             recommendation="Do not change without review.", constraints=[LLMConstraint(text="Follow the decision", memory_ref=refs[0]), bogus],
                             risks=["regression"], evidence_refs=["PR #7", "PR #999"], affected_components=["svc~auth", "nope"], confidence="high")
        return LLMAnswer(headline="Free to change", explanation=["No constraints known."], verdict="proceed", recommendation="Go ahead.",
                         constraints=[bogus], risks=[], evidence_refs=["PR #7"], affected_components=["svc~auth"], confidence="medium")


@pytest.fixture(autouse=True)
def env():
    db = mongomock.MongoClient(tz_aware=True).db
    db.users.create_indexes([IndexModel([("email", ASCENDING)], unique=True)])
    db.memberships.create_indexes([IndexModel([("user_id", ASCENDING), ("org_id", ASCENDING)], unique=True)])
    db.memories.create_indexes([IndexModel([("tenant_id", ASCENDING), ("memory_id", ASCENDING), ("version", ASCENDING)], unique=True)])
    # The partial unique "one active version per lineage" index lives in scripts/create_indexes.py (mongomock ignores partial filters).
    set_db(db)
    s = get_settings()
    saved = (s.vector_backend, s.memory_min_score, s.session_secret)
    s.vector_backend, s.memory_min_score, s.session_secret = "local", 0.5, "test-secret"
    set_embedder(HashEmbedder(s.embedding_dimensions))
    set_code_embedder(HashEmbedder(s.code_embedding_dimensions))  # offline; tests never reach Voyage
    set_reranker(None)
    llm = ScriptedLLM()
    set_llm(llm)
    yield {"db": db, "llm": llm}
    s.vector_backend, s.memory_min_score, s.session_secret = saved
    set_db(None)
    reset_providers()
    set_llm(None)


@pytest.fixture
def client():
    from app.main import app

    return TestClient(app)


def register(client: TestClient, email: str, name: str = "Test User", org_name: str | None = None, invite_code: str | None = None):
    body = {"email": email, "password": "correct horse", "name": name}
    if invite_code:
        body["invite_code"] = invite_code
    else:
        body["org_name"] = org_name or f"{name} Org"
    r = client.post("/api/auth/register", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def principal_for(client: TestClient):
    """Principal of whoever the client is signed in as."""
    from app.deps import principal_from_session
    from app.security import COOKIE_NAME

    return principal_from_session(client.cookies.get(COOKIE_NAME))


@pytest.fixture
def make_client():
    from app.main import app

    clients = []

    def _make():
        c = TestClient(app)
        clients.append(c)
        return c

    return _make
