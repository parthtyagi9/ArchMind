"""Create the judge-demo data through the running API (synthetic data only).

    cd backend && uv run python -m scripts.demo_setup [--base http://127.0.0.1:8000]

Creates: Alice (owner, Alpha Streaming), Dev (member, team payments, via invite), Bob (owner, Beta Logistics);
connects apache/kafka in both orgs; creates memories M1-M6 as Alice and one spare pending proposal from Dev.
Passwords are generated on first run and written to ../demo-accounts.txt (keep it out of git). Safe to re-run.
"""
from __future__ import annotations

import argparse
import os
import pathlib
import secrets
import sys
import time

import httpx

CREDS = pathlib.Path(__file__).resolve().parents[2] / "demo-accounts.txt"
REPO = "apache/kafka"


def load_creds() -> dict:
    out = {}
    if CREDS.exists():
        for line in CREDS.read_text().splitlines():
            if line.count(" | ") == 2:
                name, email, pw = [x.strip() for x in line.split(" | ")]
                out[email] = pw
    return out


def account(base: str, creds: dict, name: str, email: str, org_name: str | None = None, invite: str | None = None) -> httpx.Client:
    c = httpx.Client(base_url=base, timeout=60)
    pw = creds.get(email) or f"demo-{secrets.token_urlsafe(9)}"
    r = c.post("/api/auth/login", json={"email": email, "password": pw})
    if r.status_code != 200:
        r = c.post("/api/auth/register", json={"email": email, "password": pw, "name": name, "org_name": org_name, "invite_code": invite})
        if r.status_code != 200:
            sys.exit(f"could not create {email}: {r.status_code} {r.text[:300]}")
        print(f"created account {name} <{email}>")
    else:
        print(f"signed in as existing {name} <{email}>")
    creds[email] = pw
    with CREDS.open("w") as f:
        f.write("# Demo accounts for the local ArchMind app (synthetic). Name | Email | Password\n")
        for e, p in creds.items():
            f.write(f"{e.split('@')[0].title()} | {e} | {p}\n")
    return c


def ok(r: httpx.Response, what: str) -> dict:
    if r.status_code >= 400:
        sys.exit(f"{what} failed: {r.status_code} {r.text[:400]}")
    return r.json()


def connect_repo(c: httpx.Client, who: str) -> str:
    repos = ok(c.get("/api/repos"), "list repos")
    repos = repos.get("repos", repos) if isinstance(repos, dict) else repos
    existing = next((r for r in repos if r.get("full_name") == REPO), None)
    repo = existing or ok(c.post("/api/repos", json={"full_name": REPO}), f"connect {REPO}")
    repo = repo.get("repo", repo)
    rid = repo["id"]
    print(f"{who}: {REPO} {'already connected' if existing else 'connecting'} ({rid})")
    for _ in range(120):
        st = ok(c.get(f"/api/repos/{rid}"), "repo status")
        st = st.get("repo", st)
        if st.get("status") in ("ready", "indexed"):
            print(f"{who}: {REPO} ready")
            return rid
        if st.get("status") == "failed":
            sys.exit(f"{who}: indexing failed: {st.get('error')}")
        time.sleep(5)
    sys.exit(f"{who}: indexing still running after 10 minutes")


def memories(c: httpx.Client, kafka_id: str) -> None:
    have = ok(c.get("/api/memories"), "list memories")
    have = have.get("memories", have) if isinstance(have, dict) else have
    titles = {m.get("title") for m in have}
    src = lambda t, i, l: [{"type": t, "id": i, "label": l}]
    rows = [
        dict(title="Consumers use the cooperative-sticky assignor", memory_type="architecture_decision", scope="repo", repo_id=kafka_id,
             components=["consumer"], source_refs=src("jira", "KAFKA-OPS-41", "Rebalance storm postmortem"),
             content="All consumer groups must use partition.assignment.strategy=CooperativeStickyAssignor. Eager rebalancing (Range or "
                     "RoundRobin) caused stop-the-world pauses of 40+ seconds on the payments consumer group in production. Do not switch "
                     "back without an architecture review."),
        dict(title="Producer idempotence stays enabled", memory_type="bug_resolution", scope="org", components=["producer"],
             source_refs=src("github", "PR #812", "Duplicate payment events fix"),
             content="Duplicate payment events (INC-2207) were caused by producer retries with enable.idempotence=false. Fixed with "
                     "enable.idempotence=true and acks=all. Never disable idempotence on topics that carry money movements, even to reduce latency."),
        dict(title="Platform team owns the KRaft controller quorum", memory_type="code_ownership", scope="team", team="platform",
             components=["metadata", "controller"], source_refs=src("human", "CODEOWNERS", "Ownership file"),
             content="Changes to KRaft controller quorum settings (controller.quorum.voters, metadata.log.*) require review by the Platform team."),
        dict(title="Temporary: pin zstd-jni to 1.5.5-6", memory_type="workaround", scope="org", components=["compression"], expires_in_days=30,
             source_refs=src("jira", "KAFKA-OPS-77", "ARM native crash"),
             content="Pin zstd-jni to 1.5.5-6 until the native crash on ARM hosts is fixed upstream. Remove the pin once the fix ships."),
        dict(title="Audit topics keep infinite retention", memory_type="engineering_preference", scope="org", components=["log", "retention"],
             source_refs=src("confluence", "Data retention policy", "Retention policy page"),
             content="Topics prefixed audit.* keep retention.ms=-1. Never lower retention on audit topics."),
        dict(title="Use MirrorMaker 1 for cross-region replication", memory_type="architecture_decision", scope="org", components=["replication"],
             source_refs=src("confluence", "DR runbook", "Disaster recovery runbook"),
             content="Cross-region replication uses MirrorMaker 1 with one mirror per region pair."),
    ]
    for i, m in enumerate(rows, 1):
        if m["title"] in titles:
            print(f"M{i} already exists: {m['title']}")
            continue
        out = ok(c.post("/api/memories", json=m), f"create M{i}")
        out = out.get("memory", out)
        print(f"M{i} created ({out.get('status')}): {m['title']}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    base = ap.parse_args().base
    ok(httpx.get(f"{base}/api/health", timeout=10), "backend health (is start-app running?)")
    creds = load_creds()

    owner_email, owner_pw = os.environ.get("OWNER_EMAIL"), os.environ.get("OWNER_PASSWORD")
    if owner_email and owner_pw:  # use an existing owner account (its current organization) instead of creating Alice
        alice = httpx.Client(base_url=base, timeout=60)
        ok(alice.post("/api/auth/login", json={"email": owner_email, "password": owner_pw}), f"sign in as {owner_email}")
        print(f"signed in as existing owner <{owner_email}>")
        member_name, member_email = "Priya Shah", "priya@archmind.demo"
    else:
        alice = account(base, creds, "Alice Chen", "alice@archmind.demo", org_name="Alpha Streaming")
        member_name, member_email = "Dev Patel", "dev@archmind.demo"
    kafka_alpha = connect_repo(alice, "Alpha")
    memories(alice, kafka_alpha)

    invites = ok(alice.get("/api/org/invites"), "list invites")
    invites = invites.get("invites", invites) if isinstance(invites, dict) else invites
    inv = next((i for i in invites if i.get("role") == "member" and i.get("team") == "payments"), None) \
        or ok(alice.post("/api/org/invites", json={"role": "member", "team": "payments", "expires_days": 7}), "create invite")
    inv = inv.get("invite", inv)
    dev = account(base, creds, member_name, member_email, invite=inv["code"])

    have = ok(dev.get("/api/memories?status=pending"), "list pending")
    have = have.get("memories", have) if isinstance(have, dict) else have
    spare = "Payments consumer keeps max.poll.records at 500"
    if not any(m.get("title") == spare for m in have) and dev.get("/api/auth/me").json().get("org", {}).get("role") == "member":
        out = ok(dev.post("/api/memories", json={
            "title": spare, "memory_type": "repository_convention", "scope": "org", "components": ["consumer"],
            "content": "The payments consumer keeps max.poll.records=500; higher values exceeded max.poll.interval.ms during settlement "
                       "batches and triggered rebalances."}), "spare proposal")
        out = out.get("memory", out)
        print(f"spare proposal from Dev: {out.get('status')}")

    if creds.get("bob@beta.demo") and owner_email:
        print("Beta Logistics (Bob) already set up; skipping")
        print(f"\nDONE. Sign-in details are in {CREDS}")
        return
    bob = account(base, creds, "Bob Okafor", "bob@beta.demo", org_name="Beta Logistics")
    connect_repo(bob, "Beta")
    print(f"\nDONE. Sign-in details are in {CREDS}")


if __name__ == "__main__":
    main()
