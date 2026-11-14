"""Prepare a separate Atlas database for authentic UI recording.

Run from backend/: .venv/bin/python ../demo-video/scripts/setup-demo.py
Only public Kafka source files are copied from the existing index. No real users,
tokens, memories or agent answers are copied. All demo accounts/policies are new.
"""
from __future__ import annotations

import json
import logging
import secrets
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.config import get_settings
from app import code
from app.db import get_db, set_db, utcnow
from app.deps import Principal
from app.memory import governance
from app.security import issue_session
from app.services import accounts, integrations
from app.integrations.public_atlassian import PublicAtlassian, parse_source
from scripts.create_indexes import main as create_indexes

logging.basicConfig(level=logging.WARNING)
VIDEO = ROOT / "demo-video"
STATE = VIDEO / "recording-state.json"
POLICY = (
    "DEMO TEAM POLICY — Kafka producer reliability. For this demonstration workspace, "
    "all producer configurations, including local development, must keep retries enabled "
    "and enable.idempotence=true. Do not set retries=0 or disable idempotence to fail fast. "
    "Use delivery.timeout.ms and request.timeout.ms to bound waiting instead. "
    "Any exception needs platform architecture review before proceeding."
)
QUESTION = "For a local development Kafka producer, can I set retries=0 and enable.idempotence=false to fail fast?"
FILE = "clients/src/main/java/org/apache/kafka/clients/producer/ProducerConfig.java"


def principal(user, org, role, team=None):
    return Principal(user["_id"], user["name"], user["email"], org["_id"], org["name"], role, team)


if __name__ == "__main__":
    if STATE.exists():
        print("Recording environment already exists; reuse recording-state.json.", flush=True)
        raise SystemExit(0)
    source_db = get_db()
    print("Reading public Kafka index metadata…", flush=True)
    repo = source_db.repos.find_one({"full_name": "apache/kafka", "status": "ready"}, max_time_ms=15000)
    if not repo:
        raise SystemExit("Index apache/kafka in ArchMind first.")
    print("Copying a focused public-source snapshot for recording…", flush=True)
    files = list(source_db.source_documents.find({"repo_id": repo["_id"], "path": {"$in": [FILE,
        "clients/src/main/java/org/apache/kafka/clients/producer/internals/Sender.java",
        "clients/src/main/java/org/apache/kafka/clients/producer/KafkaProducer.java", "README.md"]}}).max_time_ms(15000))
    graph = {"_id":repo["_id"], **code.build_graph({d["path"]:d["content"] for d in files}), "built_at":utcnow()}
    assert any(d["path"] == FILE for d in files)
    name = "archmind_video_demo_" + uuid.uuid4().hex[:8]
    demo = source_db.client[name]
    set_db(demo)
    get_settings().session_secret = "archmind-isolated-video-session"
    print("Creating isolated Atlas recording database:", name, flush=True)
    create_indexes()
    owner, org = accounts.register("alex@archmind-demo.example", secrets.token_urlsafe(24), "Alex Chen", "ArchMind · Demo Team", None)
    invite = accounts.create_invite(principal(owner, org, "owner"), "member", "platform", 7)
    member, _ = accounts.register("sam@archmind-demo.example", secrets.token_urlsafe(24), "Sam Rivera", None, invite["code"])
    cloned = {**repo, "org_id": org["_id"], "connected_by": owner["_id"], "file_count":len(files),
              "progress":{"done":len(files),"total":len(files)}, "created_at": utcnow(), "indexed_at": utcnow()}
    demo.repos.insert_one(cloned)
    for d in files:
        d.pop("_id", None)
        d["org_id"] = org["_id"]
    demo.source_documents.insert_many(files)
    if graph:
        graph["org_id"] = org["_id"]
        demo.repo_graphs.insert_one(graph)
    policy = governance.propose(principal(member, org, "member", "platform"), title="Demo policy: preserve producer reliability",
        content=POLICY, memory_type="repository_convention", scope="repo", repo_id=repo["_id"], expires_in_days=30,
        source_refs=[{"type": "human", "id": "demo-team-policy", "label": "Illustrative policy for this demonstration", "url": None}])
    for url in ("https://issues.apache.org/jira/projects/KAFKA", "https://cwiki.apache.org/confluence/display/KAFKA/Index"):
        s = PublicAtlassian(parse_source(url)).probe()
        integrations.save_public_source(org["_id"], owner["_id"], s, repo["_id"])
        print("Connected public", s["kind"], flush=True)
    state = {"database": name, "repo_id": repo["_id"], "owner_id": owner["_id"], "org_id": org["_id"],
             "cookie": issue_session(owner["_id"], org["_id"]), "policy_id": policy["memory_id"], "question": QUESTION, "path": FILE,
             "selection": {"path": FILE, "start_line": 311, "end_line": 323,
                           "text": "\n".join(next(d["content"] for d in files if d["path"] == FILE).splitlines()[310:323])}}
    STATE.write_text(json.dumps(state, indent=2))
    print("Recording environment ready. No existing workspace data was changed.", flush=True)
