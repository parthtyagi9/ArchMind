"""Unit-test fixtures: mongomock DB, deterministic hash embedder, scripted LLM. No network."""
from __future__ import annotations

import json
import re

import mongomock
import pytest
from pymongo import ASCENDING, IndexModel

from app.agents.llm import Classification, PlanDecision, set_llm
from app.config import get_settings
from app.db import set_db
from app.memory.embeddings import HashEmbedder, set_embedder


class ScriptedLLM:
    """Deterministic stand-in for Gemini. Reads the prompt the real agent built, so it reacts to the
    memories actually passed in, exactly like the real model would have to."""
    model_name = "scripted"

    def __init__(self, diagnostics=("inspect_service_logs", "inspect_service_permissions", "inspect_secret_access",
                                    "inspect_kms_key", "inspect_network_path"), fix="repair_secret_access",
                 forced: list[str] | None = None):
        self.diagnostics = list(diagnostics)
        self.fix = fix
        self.forced = list(forced) if forced else None
        self.prompts: list[str] = []

    def structured(self, system, prompt, schema):
        self.prompts.append(prompt)
        if schema.__name__ == "ArchAnswer":
            block = prompt.split("<untrusted_memories>")[1].split("</untrusted_memories>")[0].strip()
            mems = json.loads(block) if block.startswith("[") else []
            ids = [m["memory_id"] for m in mems] + ["m_hallucinated"]
            redis = [m for m in mems if "redis" in m["title"].lower()]
            return schema(headline="Answer", decision="restrict_redis_to_non_critical" if redis else "adopt_redis_cache",
                          summary="s", current_architecture="c", recommendation="r", constraints=[m["content"] for m in redis],
                          affected_components=["payments-service"], memory_ids_used=ids if mems else ["m_hallucinated"])
        if schema is Classification:
            return Classification(failure_category="secret_access_denied", affected_service="payment-service",
                                  summary="Service cannot read its secret.", search_query="secret access denied")
        done = re.findall(r'"tool": "([a-z_]+)"', prompt.split("<untrusted_tool_history>")[-1])
        mem_block = prompt.split("<untrusted_memories>")[1].split("</untrusted_memories>")[0]
        if self.forced is not None:
            tool = self.forced.pop(0) if self.forced else None
            if tool is None:
                return PlanDecision(decision="escalate", hypothesis="?", rationale="script exhausted")
            return PlanDecision(decision="call_tool", tool_name=tool, service="payment-service", hypothesis="h",
                                rationale="scripted")
        mems = json.loads(mem_block) if mem_block.strip().startswith("[") else []
        verified = [m for m in mems if m.get("resolution_action") == self.fix and m.get("outcome") == "success"]
        if verified and self.fix not in done:
            return PlanDecision(decision="call_tool", tool_name=self.fix, service="payment-service",
                                hypothesis="same root cause as verified memory", rationale="memory",
                                memory_ids_used=[verified[0]["memory_id"]])
        for d in self.diagnostics:
            if d not in done:
                return PlanDecision(decision="call_tool", tool_name=d, service="payment-service",
                                    hypothesis="investigating", rationale="diagnose")
        return PlanDecision(decision="call_tool", tool_name=self.fix, service="payment-service",
                            hypothesis="missing GetSecretValue", rationale="diagnostics point to IAM")


@pytest.fixture(autouse=True)
def env():
    db = mongomock.MongoClient(tz_aware=True).db
    db.memories.create_indexes([
        IndexModel([("tenant_id", ASCENDING), ("memory_id", ASCENDING), ("version", ASCENDING)], unique=True),
        # The partial unique "one active version" index is created on Atlas by scripts/create_indexes.py.
        # mongomock ignores partialFilterExpression (it would enforce full uniqueness), so it is omitted here.
    ])
    set_db(db)
    set_embedder(HashEmbedder(get_settings().embedding_dimensions))
    s = get_settings()
    s.vector_backend = "local"
    s.memory_min_score = 0.55
    llm = ScriptedLLM()
    set_llm(llm)
    yield {"db": db, "llm": llm}
    set_db(None)
    set_embedder(None)
    set_llm(None)
