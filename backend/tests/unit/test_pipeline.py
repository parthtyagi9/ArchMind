"""The agent end to end with fake GitHub/Atlassian and the scripted LLM: sub-agents, governance before the model,
sanitized structured output, and proof that memory changes the decision (and that revoking it changes it back)."""
import httpx
import pytest

from conftest import principal_for, register
from app.agents import pipeline
from app.db import utcnow
from app.integrations import atlassian as atl_mod
from app.integrations.github import ArchiveFile, GitHubError
from app.security import encrypt
from app.services import integrations as integ
from app.services import repos


ORIGINAL_INDEX = repos.index_repo


class FakeGitHub:
    authenticated = True

    def __init__(self, token=None):
        self.token = token

    def repo(self, full_name):
        return {"full_name": full_name, "private": False, "default_branch": "main", "description": "", "updated_at": None}

    def tree(self, full_name, ref):
        raise GitHubError("tree unavailable in this fake: use the archive path", 429)

    def archive(self, full_name, ref, max_bytes):
        yield ArchiveFile("services/auth/src/validate.ts", b'import jwt from "jsonwebtoken";\nexport function validate(t) {\n  return jwt.verify(t, key, { audience: AUD });\n}\n')
        yield ArchiveFile("services/auth/src/index.ts", b'import { validate } from "./validate";\n')
        yield ArchiveFile("node_modules/x/index.js", b"ignored")
        yield ArchiveFile("logo.png", b"\x89PNG\x00")

    def blame(self, full_name, ref, path, start, end):
        return [{"sha": "a41c9e2" + "0" * 33, "short": "a41c9e2", "headline": "fix(auth): AUTH-311 reject tokens for other services", "message": "fix(auth): AUTH-311 reject tokens for other services\n\nAdds audience.",
                 "date": "2026-07-19T00:00:00Z", "url": "https://github.com/acme/pay/commit/a41c9e2", "author": "Ana", "login": "ana", "lines": "3-3",
                 "pulls": [{"number": 7, "title": "Add audience validation", "url": "https://github.com/acme/pay/pull/7", "body": "Closes AUTH-311", "merged_at": "2026-07-19T00:00:00Z", "branch": "ana/AUTH-311"}]}]

    def file_history(self, *a, **k):
        return []

    def commit_pulls(self, *a, **k):
        return []


class FakeAtlassian:
    def __init__(self, *a, **k):
        self.calls = []

    def jira_search(self, terms, keys=None, limit=5):
        self.calls.append(("jira", terms, keys))
        if keys and "AUTH-311" in keys:
            return [{"key": "AUTH-311", "summary": "Tokens accepted without audience check", "status": "Done", "type": "Bug", "description": "Cross-service replay.",
                     "comments": [], "updated": "", "url": "https://x.atlassian.net/browse/AUTH-311"}]
        return []

    def confluence_search(self, terms, limit=4):
        self.calls.append(("confluence", terms))
        return [{"id": "9", "title": "Authentication architecture", "excerpt": "verify aud", "space": "ENG", "url": "https://x.atlassian.net/wiki/9", "updated": None}]

    def confluence_page_text(self, pid, max_chars=1500):
        return "Every service must verify aud."


@pytest.fixture
def world(client, make_client, monkeypatch, env):
    monkeypatch.setattr("app.agents.pipeline.get_github_client", FakeGitHub)
    monkeypatch.setattr("app.services.repos.get_github_client", FakeGitHub)
    monkeypatch.setattr(atl_mod, "get_atlassian", lambda cfg, token: FakeAtlassian())
    register(client, "owner@x.io", "Olive", org_name="Acme")
    inv = client.post("/api/org/invites", json={"role": "member", "team": "payments"}).json()
    member = make_client()
    register(member, "m@x.io", "Mia", invite_code=inv["code"])
    # Index synchronously (the real code path, minus the background thread) so tests are deterministic.
    monkeypatch.setattr(repos, "start_index", lambda rid, token, background=True: ORIGINAL_INDEX(rid, token))
    return {"owner": client, "member": member, "owner_p": principal_for(client), "member_p": principal_for(member)}


def connect_repo(w, monkeypatch):
    r = w["owner"].post("/api/repos", json={"full_name": "acme/pay"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def connect_atlassian(w):
    integ.save_atlassian(w["owner_p"].org_id, w["owner_p"].user_id, base_url="https://x.atlassian.net", email="o@x.io", token_enc=encrypt("tok"),
                         jira_projects=[], confluence_spaces=[], products={"jira": True, "confluence": True})


SEL = {"path": "services/auth/src/validate.ts", "start_line": 3, "end_line": 3, "text": "return jwt.verify(t, key, { audience: AUD });"}


def run_sync(p, repo_id, memory_enabled=True, selection=SEL):
    rid = pipeline.start_run(p, kind="why", question="Why does this exist?", repo_id=repo_id, selection=selection, memory_enabled=memory_enabled, background=False)
    from app.db import get_db
    return pipeline.run_api(get_db().agent_runs.find_one({"_id": rid}))


def decision_memory(w, **kw):
    body = {"title": "Audience validation must be preserved", "content": "Token audience validation must stay in the owning service; never remove or bypass it (AUTH-311).",
            "memory_type": "architecture_decision", "scope": "org", **kw}
    r = w["owner"].post("/api/memories", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_indexing_skips_junk_stores_files_and_builds_graph(world, monkeypatch):
    repo_id = connect_repo(world, monkeypatch)
    repo = world["owner"].get(f"/api/repos/{repo_id}").json()
    assert repo["status"] == "ready" and repo["file_count"] == 2
    tree = world["member"].get(f"/api/repos/{repo_id}/tree").json()["files"]
    assert [f["path"] for f in tree] == ["services/auth/src/index.ts", "services/auth/src/validate.ts"]
    f = world["member"].get(f"/api/repos/{repo_id}/file", params={"path": "services/auth/src/validate.ts"}).json()
    assert "jwt.verify" in f["content"] and len(f["sha"]) == 40
    assert world["member"].get(f"/api/repos/{repo_id}/graph").json()["nodes"]


def test_foreign_org_cannot_see_repo(world, monkeypatch, make_client):
    repo_id = connect_repo(world, monkeypatch)
    other = make_client()
    register(other, "e@y.io", "Eve", org_name="Evil")
    assert other.get(f"/api/repos/{repo_id}").status_code == 404
    assert other.get(f"/api/repos/{repo_id}/tree").status_code == 404
    assert other.get("/api/repos").json() == []
    assert other.get(f"/api/repos/{repo_id}/file", params={"path": "services/auth/src/validate.ts"}).status_code == 404


def test_subagents_gather_real_evidence_and_follow_ticket_keys_from_git_history(world, monkeypatch):
    repo_id = connect_repo(world, monkeypatch)
    connect_atlassian(world)
    run = run_sync(world["member_p"], repo_id)
    assert run["status"] == "completed" and run["reasoning"]["model"] == "scripted"
    by = {a["id"]: a for a in run["agents"]}
    assert [a["id"] for a in run["agents"]] == ["github", "jira", "confluence", "memory"]
    refs = {f["ref"] for f in by["github"]["findings"]}
    assert {"PR #7", "a41c9e2"} <= refs
    assert any(t["text"].startswith("git blame") for t in by["github"]["tools"])
    assert [f["ref"] for f in by["jira"]["findings"]] == ["AUTH-311"]          # found via the key in the PR body / commit message
    assert any("referenced in git history" in t["text"] for t in by["jira"]["tools"])
    assert by["confluence"]["findings"][0]["title"] == "Authentication architecture" and "must verify aud" in by["confluence"]["findings"][0]["detail"]
    assert all(t["status"] == "done" for a in run["agents"] for t in a["tools"])
    assert run["orchestrator"]["plan"] == ["github", "jira", "confluence", "memory"]


def test_access_questions_receive_live_source_provenance_and_missing_connection_status(world, monkeypatch, env):
    import json

    repo_id = connect_repo(world, monkeypatch)
    connect_atlassian(world)
    env["db"].integrations.update_one({"_id": f"{world['owner_p'].org_id}:atlassian"}, {"$set": {"confluence_ok": False}})
    pipeline.start_run(world["member_p"], kind="ask", question="can you see jira issues and confluence docs AUTH-311",
                       repo_id=repo_id, memory_enabled=False, background=False)
    prompt = env["llm"].prompts[-1]
    runtime = json.loads(prompt.split("<runtime_context>\n")[1].split("\n</runtime_context>")[0])
    sources = {s["source"]: s for s in runtime["sources"]}
    assert runtime["assistant"] == "ArchMind" and runtime["repository_under_analysis"] == "acme/pay"
    assert sources["jira"]["status"] == "done" and sources["jira"]["findings_retrieved"] == 1
    assert sources["jira"]["completed_tool_calls"] > 0
    assert sources["confluence"]["status"] == "skipped" and sources["confluence"]["findings_retrieved"] == 0
    assert "not connected" in sources["confluence"]["skip_reason"]
    evidence = json.loads(prompt.split("<untrusted_evidence>\n")[1].split("\n</untrusted_evidence>")[0])
    issue = next(e for e in evidence if e["ref"] == "AUTH-311")
    assert issue["source_agent"] == "jira" and issue["url"] == "https://x.atlassian.net/browse/AUTH-311"
    assert "token" not in json.dumps(runtime).lower()


def test_reasoning_distinguishes_failed_source_from_absent_connection(world, monkeypatch, env):
    import json

    repo_id = connect_repo(world, monkeypatch)
    connect_atlassian(world)

    class FailedJira(FakeAtlassian):
        def jira_search(self, *a, **k):
            raise atl_mod.AtlassianError("Authentication expired", 401)

    monkeypatch.setattr(atl_mod, "get_atlassian", lambda cfg, token: FailedJira())
    run_sync(world["member_p"], repo_id)
    runtime = json.loads(env["llm"].prompts[-1].split("<runtime_context>\n")[1].split("\n</runtime_context>")[0])
    jira = next(s for s in runtime["sources"] if s["source"] == "jira")
    assert jira["status"] == "error" and jira["failed_tool_calls"] > 0 and jira["skip_reason"] is None


def test_unconnected_sources_are_skipped_honestly(world, monkeypatch):
    repo_id = connect_repo(world, monkeypatch)
    run = run_sync(world["member_p"], repo_id)               # no Atlassian connected
    by = {a["id"]: a for a in run["agents"]}
    assert by["jira"]["status"] == "skipped" and "not connected" in by["jira"]["summary"] and by["confluence"]["status"] == "skipped"
    assert by["github"]["status"] == "done"
    local = run_sync(world["member_p"], None)                # local workspace: no repo
    assert {a["id"]: a for a in local["agents"]}["github"]["status"] == "skipped"


def test_a_failing_source_does_not_fail_the_run(world, monkeypatch):
    repo_id = connect_repo(world, monkeypatch)
    connect_atlassian(world)

    class Boom(FakeAtlassian):
        def jira_search(self, *a, **k):
            raise atl_mod.AtlassianError("Atlassian rejected the email/API token", 401)

    monkeypatch.setattr(atl_mod, "get_atlassian", lambda cfg, token: Boom())
    run = run_sync(world["member_p"], repo_id)
    by = {a["id"]: a for a in run["agents"]}
    assert run["status"] == "completed" and by["jira"]["status"] == "error" and "rejected" in by["jira"]["error"]
    assert by["confluence"]["status"] == "done"


def test_memory_changes_the_decision_and_sanitization_drops_invented_citations(world, monkeypatch):
    repo_id = connect_repo(world, monkeypatch)
    connect_atlassian(world)
    mem = decision_memory(world)
    without = run_sync(world["member_p"], repo_id, memory_enabled=False)
    with_mem = run_sync(world["member_p"], repo_id, memory_enabled=True)
    assert without["answer"]["guidance"]["verdict"] == "proceed" and without["answer"]["guidance"]["constraints"] == []
    g = with_mem["answer"]["guidance"]
    assert g["verdict"] == "needs_architecture_review"
    assert [c["memory_ref"] for c in g["constraints"]] == [f"{mem['memory_id']}@v1"]          # real memory; "mem_doesnotexist@v9" was dropped
    assert with_mem["answer"]["evidence_refs"] == ["PR #7"]                                    # "PR #999" was dropped
    assert with_mem["answer"]["affected_components"] == ["svc~auth"] or with_mem["answer"]["affected_components"] == []  # unknown "nope" dropped
    assert with_mem["memory"]["retrieved"][0]["used"] is True and with_mem["memory"]["excluded"] == 0
    assert without["memory"]["retrieved"] == [] and {a["id"]: a for a in without["agents"]}["memory"]["status"] == "skipped"


def test_prompt_never_contains_memories_the_caller_may_not_retrieve(world, monkeypatch, env):
    repo_id = connect_repo(world, monkeypatch)
    decision_memory(world, scope="team", team="platform", content="SECRET platform-team rule about audience validation")
    decision_memory(world, title="pending one", content="PENDING rule about audience validation")  # owner => active; make a pending via member below
    pending = world["member"].post("/api/memories", json={"title": "pending", "content": "PENDING-ONLY audience rule", "memory_type": "workaround", "scope": "org"}).json()
    other = world["owner"].post("/api/memories", json={"title": "x", "content": "x", "memory_type": "workaround", "scope": "org"})
    run_sync(world["member_p"], repo_id)                      # member is on team payments
    prompt = env["llm"].prompts[-1]
    assert "SECRET platform-team rule" not in prompt and "PENDING-ONLY" not in prompt
    assert pending["status"] == "pending" and other.status_code == 200


def test_revoking_the_memory_flips_the_decision_back(world, monkeypatch):
    repo_id = connect_repo(world, monkeypatch)
    mem = decision_memory(world)
    assert run_sync(world["member_p"], repo_id)["answer"]["guidance"]["verdict"] == "needs_architecture_review"
    assert world["owner"].post(f"/api/memories/{mem['memory_id']}/revoke", json={"reason": "obsolete"}).status_code == 200
    again = run_sync(world["member_p"], repo_id)
    assert again["answer"]["guidance"]["verdict"] == "proceed" and again["memory"]["retrieved"] == []


def test_compare_proves_or_honestly_denies_behavior_change(world, monkeypatch):
    repo_id = connect_repo(world, monkeypatch)
    mem = decision_memory(world)
    cid = pipeline.start_compare(world["member_p"], question="Why does this exist?", repo_id=repo_id, selection=SEL, background=False)
    from app.db import get_db
    c = pipeline.compare_api(get_db().compares.find_one({"_id": cid}))
    assert c["status"] == "completed" and c["changed"] is True
    assert c["without_memory"]["guidance"]["verdict"] == "proceed" and c["with_memory"]["guidance"]["verdict"] == "needs_architecture_review"
    assert {r["field"] for r in c["diff"]} == {"verdict", "constraints", "recommendation"}
    assert c["memories_used"][0]["memory_id"] == mem["memory_id"]
    # Same question once the memory no longer applies: both arms agree, and the system says so.
    world["owner"].post(f"/api/memories/{mem['memory_id']}/revoke", json={})
    cid2 = pipeline.start_compare(world["member_p"], question="Why does this exist?", repo_id=repo_id, selection=SEL, background=False)
    c2 = pipeline.compare_api(get_db().compares.find_one({"_id": cid2}))
    assert c2["changed"] is False and c2["diff"] == [] and c2["memories_used"] == []


def test_propose_memory_from_run_is_pending_even_for_owner(world, monkeypatch):
    repo_id = connect_repo(world, monkeypatch)
    rid = world["owner"].post("/api/agent/runs", json={"kind": "why", "question": "q", "repo_id": repo_id, "selection": SEL, "memory_enabled": False}).json()["run_id"]
    import time
    for _ in range(100):
        run = world["owner"].get(f"/api/agent/runs/{rid}").json()
        if run["status"] != "running":
            break
        time.sleep(0.05)
    assert run["status"] == "completed"
    m = world["owner"].post(f"/api/agent/runs/{rid}/propose-memory").json()
    assert m["status"] == "pending" and m["authority"] == "agent_observed" and m["source_refs"][0]["type"] == "agent_run"
    assert world["owner"].get(f"/api/agent/runs/{rid}").json()["proposed_memory_id"] == m["memory_id"]


def test_members_cannot_read_other_members_runs_but_admins_can(world, monkeypatch, make_client):
    repo_id = connect_repo(world, monkeypatch)
    rid = pipeline.start_run(world["member_p"], kind="why", question="q", repo_id=repo_id, selection=SEL, background=False)
    assert world["member"].get(f"/api/agent/runs/{rid}").status_code == 200
    assert world["owner"].get(f"/api/agent/runs/{rid}").status_code == 200
    inv = world["owner"].post("/api/org/invites", json={"role": "member"}).json()
    third = make_client()
    register(third, "t@x.io", "Tom", invite_code=inv["code"])
    assert third.get(f"/api/agent/runs/{rid}").status_code == 404 and third.get("/api/agent/runs").json() == []


def test_reasoning_failure_marks_run_failed_but_keeps_evidence(world, monkeypatch, env):
    repo_id = connect_repo(world, monkeypatch)
    env["llm"].structured = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("quota exceeded"))
    run = run_sync(world["member_p"], repo_id)
    assert run["status"] == "failed" and "quota exceeded" in run["error"] and run["reasoning"]["status"] == "error"
    assert {a["id"]: a for a in run["agents"]}["github"]["findings"]


def test_index_failure_is_reported_not_stuck(world, monkeypatch):
    class Broken(FakeGitHub):
        def archive(self, *a, **k):
            raise GitHubError("Repository or branch not found (private repositories need a linked GitHub account)", 404)
            yield

    monkeypatch.setattr("app.services.repos.get_github_client", Broken)
    r = world["owner"].post("/api/repos", json={"full_name": "acme/pay"})
    repo = world["owner"].get(f"/api/repos/{r.json()['id']}").json()
    assert repo["status"] == "failed" and "not found" in repo["error"]


def test_public_repo_still_connects_when_anonymous_api_budget_is_spent(world, monkeypatch):
    class RateLimited(FakeGitHub):
        authenticated = False

        def repo(self, full_name):
            raise GitHubError("GitHub API rate limit reached. Link GitHub for a higher limit.", 429)

    monkeypatch.setattr("app.services.repos.get_github_client", RateLimited)
    r = world["owner"].post("/api/repos", json={"full_name": "acme/pay"})
    assert r.status_code == 200
    repo = world["owner"].get(f"/api/repos/{r.json()['id']}").json()
    assert repo["status"] == "ready" and repo["branch"] == "HEAD" and repo["file_count"] == 2


class FakeTreeGitHub(FakeGitHub):
    """Fast path: list the tree, filter BEFORE downloading, fetch only wanted files."""
    fetched: list[str] = []

    def tree(self, full_name, ref):
        return [{"path": "services/auth/src/validate.ts", "size": 120, "sha": "a" * 40},
                {"path": "node_modules/x/index.js", "size": 10, "sha": "b" * 40},
                {"path": "data/huge.csv", "size": 90_000_000, "sha": "c" * 40},
                {"path": "logo.png", "size": 500, "sha": "d" * 40},
                {"path": "README.md", "size": 20, "sha": "e" * 40}], False

    def raw(self, full_name, ref, path):
        FakeTreeGitHub.fetched.append(path)
        return {"services/auth/src/validate.ts": b"export const a = 1;\n", "README.md": b"# hi\n"}[path]


def test_tree_fast_path_downloads_only_indexable_files_with_progress(world, monkeypatch):
    FakeTreeGitHub.fetched = []
    monkeypatch.setattr("app.services.repos.get_github_client", FakeTreeGitHub)
    r = world["owner"].post("/api/repos", json={"full_name": "acme/pay"})
    repo = world["owner"].get(f"/api/repos/{r.json()['id']}").json()
    assert repo["status"] == "ready" and repo["file_count"] == 2
    assert sorted(FakeTreeGitHub.fetched) == ["README.md", "services/auth/src/validate.ts"]   # vendor, binary and 90 MB data never downloaded
    assert repo["progress"] == {"done": 2, "total": 2}


def test_startup_recovery_marks_interrupted_work_failed(world, env):
    from app.main import recover_interrupted_work
    env["db"].repos.insert_one({"_id": "repo_stuck", "org_id": "o", "full_name": "a/b", "branch": "main", "status": "indexing", "created_at": utcnow()})
    env["db"].agent_runs.insert_one({"_id": "run_stuck", "tenant_id": "o", "status": "running"})
    recover_interrupted_work()
    assert env["db"].repos.find_one({"_id": "repo_stuck"})["status"] == "failed"
    assert "restart" in env["db"].repos.find_one({"_id": "repo_stuck"})["error"]
    assert env["db"].agent_runs.find_one({"_id": "run_stuck"})["status"] == "failed"


def test_public_sources_feed_agents_without_credentials_and_only_for_attached_repo(world, monkeypatch, env):
    repo_id = connect_repo(world, monkeypatch)
    from app.integrations.public_atlassian import parse_source

    jira = integ.save_public_source(world["owner_p"].org_id, world["owner_p"].user_id,
        {**parse_source("https://issues.example.org/jira/projects/AUTH"), "title": "Auth", "search_available": True, "access": "public"}, repo_id)
    conf = integ.save_public_source(world["owner_p"].org_id, world["owner_p"].user_id,
        {**parse_source("https://wiki.example.org/confluence/spaces/ENG"), "title": "Engineering", "search_available": True, "access": "public"}, repo_id)
    calls = []

    class PublicFake(FakeAtlassian):
        def __init__(self, source):
            super().__init__()
            self.source, self.base = source, source["base_url"]

        def jira_search(self, terms, keys=None, limit=5):
            calls.append((self.source["kind"], keys))
            return super().jira_search(terms, keys, limit)

        def confluence_search(self, terms, limit=4, links=None):
            calls.append((self.source["kind"], links))
            return super().confluence_search(terms, limit)

    monkeypatch.setattr(pipeline, "get_public_atlassian", PublicFake)
    run = run_sync(world["member_p"], repo_id)
    by = {a["id"]: a for a in run["agents"]}
    assert run["status"] == "completed"
    assert by["jira"]["findings"][0]["ref"] == "AUTH-311"
    assert "must verify aud" in by["confluence"]["findings"][0]["detail"]
    assert "Authentication architecture" in env["llm"].prompts[-1]
    assert any("public Jira" in t["text"] for t in by["jira"]["tools"])
    assert any("public Confluence" in t["text"] for t in by["confluence"]["tools"])
    exact_link = "https://wiki.example.org/confluence/spaces/ENG/pages/42/Design"
    pipeline.start_run(world["member_p"], kind="ask", question=f"Explain {exact_link}", repo_id=repo_id, memory_enabled=False, background=False)
    assert any(aid == "confluence" and exact_link in links for aid, links in calls if isinstance(links, list))
    calls.clear()
    local = run_sync(world["member_p"], None)
    assert {a["id"]: a for a in local["agents"]}["jira"]["status"] == "skipped"
    assert calls == []
    world["owner"].delete(f"/api/integrations/sources/{jira['_id']}")
    world["owner"].delete(f"/api/integrations/sources/{conf['_id']}")
    after = run_sync(world["member_p"], repo_id)
    assert {a["id"]: a for a in after["agents"]}["confluence"]["status"] == "skipped"


def test_broken_private_connection_does_not_hide_working_public_evidence(world, monkeypatch):
    repo_id = connect_repo(world, monkeypatch)
    connect_atlassian(world)
    from app.integrations.public_atlassian import parse_source

    integ.save_public_source(world["owner_p"].org_id, world["owner_p"].user_id,
        {**parse_source("https://issues.example.org/jira/projects/AUTH"), "title": "Auth", "search_available": True, "access": "public"}, repo_id)

    class PrivateBroken(FakeAtlassian):
        def jira_search(self, *a, **k):
            raise atl_mod.AtlassianError("Private token expired", 401)

    class PublicWorking(FakeAtlassian):
        def __init__(self, source):
            super().__init__()
            self.source, self.base = source, source["base_url"]

    monkeypatch.setattr(atl_mod, "get_atlassian", lambda cfg, token: PrivateBroken())
    monkeypatch.setattr(pipeline, "get_public_atlassian", PublicWorking)
    run = run_sync(world["member_p"], repo_id)
    jira = {a["id"]: a for a in run["agents"]}["jira"]
    assert jira["status"] == "done" and jira["findings"][0]["ref"] == "AUTH-311"
    assert any(t["status"] == "error" for t in jira["tools"])
