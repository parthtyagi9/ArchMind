"""Semantic code search (Voyage voyage-code-3 + rerank) and memory reranking, fully offline: a fake Voyage HTTP client,
the lexical HashEmbedder and fake rerankers stand in for the network."""
import pytest

from conftest import principal_for, register
from app import codesearch
from app.agents import pipeline
from app.db import get_db
from app.integrations.github import ArchiveFile, GitHubError
from app.memory import embeddings as E
from app.memory import retrieval
from app.services import repos

ORIGINAL_INDEX = repos.index_repo

PAYMENTS = "\n".join([
    "import { db } from './db';",
    "",
    "export function chargeCard(order) {",
    *[f"  const step{i} = order.total * {i};" for i in range(30)],
    "  return db.save(order);",
    "}",
    "",
    "export function retryFailedPayment(order, attempts) {",
    "  // exponential backoff before charging the card again",
    *[f"  const wait{i} = Math.pow(2, attempts) * {i};" for i in range(30)],
    "  return chargeCard(order);",
    "}",
])
REPO_FILES = {"src/payments.ts": PAYMENTS, "src/db.ts": "export const db = { save(x) { return x; } };\n", "README.md": "# Shop\nCheckout service.\n"}


class FakeGitHub:
    authenticated = True
    files = REPO_FILES

    def __init__(self, token=None):
        pass

    def repo(self, full_name):
        return {"full_name": full_name, "private": False, "default_branch": "main", "description": "", "updated_at": None}

    def tree(self, full_name, ref):
        raise GitHubError("use the archive path", 429)

    def archive(self, full_name, ref, max_bytes):
        for path, text in FakeGitHub.files.items():
            yield ArchiveFile(path, text.encode())

    def blame(self, *a, **k):
        return []

    def file_history(self, *a, **k):
        return []

    def commit_pulls(self, *a, **k):
        return []


class CountingEmbedder(E.HashEmbedder):
    def __init__(self, dims):
        super().__init__(dims)
        self.documents = 0

    def embed_many(self, texts, *, kind="document", progress=None):
        if kind == "document":
            self.documents += len(texts)
        return super().embed_many(texts, kind=kind, progress=progress)


class ReverseReranker:
    """Puts the candidates in reverse order, so tests can see the reranker decided the final order."""
    model = "fake-rerank"

    def __init__(self):
        self.seen: list[list[str]] = []

    def rerank(self, query, documents, top_k):
        self.seen.append(documents)
        return [(i, 1.0 - n * 0.1) for n, i in enumerate(reversed(range(len(documents))))][:top_k]


@pytest.fixture
def world(client, monkeypatch, env):
    for target in ("app.agents.pipeline.get_github_client", "app.services.repos.get_github_client"):
        monkeypatch.setattr(target, FakeGitHub)
    monkeypatch.setattr(repos, "start_index", lambda rid, token, background=True: ORIGINAL_INDEX(rid, token))
    FakeGitHub.files = dict(REPO_FILES)
    register(client, "owner@x.io", "Olive", org_name="Acme")
    return {"owner": client, "p": principal_for(client)}


def connect(w):
    r = w["owner"].post("/api/repos", json={"full_name": "acme/shop"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


# ------------------------------------------------------------------ chunking
def test_chunks_cover_every_line_once_and_prefer_declaration_boundaries():
    chunks = codesearch.chunk_file("src/payments.ts", PAYMENTS)
    lines = PAYMENTS.splitlines()
    covered = [n for a, b, _ in chunks for n in range(a, b + 1)]
    assert covered == list(range(1, len(lines) + 1))
    assert any(lines[a - 1].startswith("export function retryFailedPayment") for a, _, _ in chunks)
    big = "\n".join(f"x = {i}  # " + "y" * 80 for i in range(400))
    assert all(b - a + 1 <= codesearch.MAX_LINES and len(t) <= codesearch.MAX_CHARS + 200 for a, b, t in codesearch.chunk_file("big.py", big))


# ------------------------------------------------------------------ Voyage client behaviour (no network)
class FakeVoyageHTTP:
    def __init__(self, script):
        self.script, self.bodies, self.slept = list(script), [], []

    def post(self, path, body):
        self.bodies.append((path, body))
        status = self.script.pop(0) if self.script else 200
        if status != 200:
            return status, "rate limited"
        if path == "/v1/rerank":
            return 200, {"data": [{"index": i, "relevance_score": 1 - i / 10} for i in reversed(range(len(body["documents"])))][: body["top_k"]]}
        return 200, {"data": [{"index": i, "embedding": [1.0] + [0.0] * 7} for i in range(len(body["input"]))]}

    def sleep(self, s):
        self.slept.append(s)


def test_voyage_batches_shrink_on_429_and_keep_order(monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "voyage_batch_tokens", 1000)
    http = FakeVoyageHTTP([429])
    emb = E.VoyageEmbedder(model="voyage-code-3", dimensions=8, client=http)
    progress = []
    vecs = emb.embed_many(["a" * 900] * 6, progress=progress.append)  # ~300 tokens each -> 3 per batch at first
    assert len(vecs) == 6 and http.slept == [21]
    assert emb.batch_tokens < 1000                            # halved after the 429
    sizes = [len(b["input"]) for p, b in http.bodies]
    assert sizes[0] == 3 and max(sizes[1:]) < 3                # the retried batches are smaller
    assert progress[-1] == 6
    assert all(b["model"] == "voyage-code-3" and b["output_dimension"] == 8 for _, b in http.bodies)


def test_voyage_rerank_returns_indexes_best_first():
    rr = E.VoyageReranker(client=FakeVoyageHTTP([]))
    assert [i for i, _ in rr.rerank("q", ["a", "b", "c"], top_k=2)] == [2, 1]


# ------------------------------------------------------------------ indexing
def test_indexing_embeds_chunks_and_a_reindex_only_pays_for_changed_code(world):
    counting = CountingEmbedder(1024)
    E.set_code_embedder(counting)
    repo_id = connect(world)
    repo = world["owner"].get(f"/api/repos/{repo_id}").json()
    assert repo["status"] == "ready" and repo["search"]["status"] == "ready" and repo["search"]["model"] == "hash"
    stored = list(get_db().code_chunks.find({"repo_id": repo_id}))
    assert stored and {c["path"] for c in stored} == {"src/payments.ts", "src/db.ts", "README.md"}
    first = counting.documents
    assert first == len(stored)

    FakeGitHub.files = {**REPO_FILES, "src/db.ts": "export const db = { save(x) { return { ...x, saved: true }; } };\n"}
    world["owner"].post(f"/api/repos/{repo_id}/reindex")
    assert counting.documents - first == 1                    # only the changed chunk was embedded again
    assert get_db().code_chunks.count_documents({"repo_id": repo_id}) == len(stored)

    world["owner"].delete(f"/api/repos/{repo_id}")
    assert get_db().code_chunks.count_documents({"repo_id": repo_id}) == 0


def test_without_an_embedder_search_stays_keyword_only(world):
    E.set_code_embedder(None)
    repo_id = connect(world)
    assert world["owner"].get(f"/api/repos/{repo_id}").json()["search"]["status"] == "disabled"
    found = codesearch.search([repo_id], "retry failed payment", ["retryFailedPayment"])
    assert found["mode"] == "keyword" and found["hits"][0]["path"] == "src/payments.ts"


def test_a_failed_embedding_run_keeps_the_previous_chunks(world):
    repo_id = connect(world)
    before = get_db().code_chunks.count_documents({"repo_id": repo_id})

    class Broken(E.HashEmbedder):
        model = "hash"

        def embed_many(self, texts, *, kind="document", progress=None):
            raise RuntimeError("Voyage API 401: bad key")

    E.set_code_embedder(Broken(1024))
    FakeGitHub.files = {**REPO_FILES, "src/new.ts": "export function refund(o) { return o; }\n"}
    world["owner"].post(f"/api/repos/{repo_id}/reindex")
    s = world["owner"].get(f"/api/repos/{repo_id}").json()["search"]
    assert s["status"] == "failed" and "401" in s["error"]
    assert get_db().code_chunks.count_documents({"repo_id": repo_id}) == before


# ------------------------------------------------------------------ search
def test_semantic_search_returns_line_ranges_and_the_reranker_decides_the_order(world):
    repo_id = connect(world)
    plain = codesearch.search([repo_id], "exponential backoff before charging the card again", ["backoff"])
    assert plain["mode"] == "semantic"
    top = plain["hits"][0]
    assert top["path"] == "src/payments.ts" and top["start_line"] >= 1 and top["end_line"] > top["start_line"]
    assert "backoff" in top["text"]

    rr = ReverseReranker()
    E.set_reranker(rr)
    ranked = codesearch.search([repo_id], "exponential backoff before charging the card again", ["backoff"], limit=3)
    assert ranked["mode"] == "semantic+rerank" and len(ranked["hits"]) <= 3 and rr.seen
    assert ranked["hits"][0]["text"] in rr.seen[0][-1]        # the reranker's first pick (the last candidate) leads


def test_search_never_crosses_into_repositories_outside_the_workspace(world):
    a = connect(world)
    FakeGitHub.files = {"other.ts": "export function retryFailedPayment() { /* exponential backoff */ }\n"}
    b = world["owner"].post("/api/repos", json={"full_name": "acme/other"}).json()["id"]
    hits = codesearch.search([a], "exponential backoff", ["backoff"])["hits"]
    assert hits and all(h["repo_id"] == a for h in hits)
    assert all(h["repo_id"] == b for h in codesearch.search([b], "exponential backoff", ["backoff"])["hits"])


def test_agent_cites_code_with_line_ranges_and_says_which_search_ran(world):
    repo_id = connect(world)
    rid = pipeline.start_run(world["p"], kind="ask", question="How do we retry a failed payment with backoff?", repo_id=repo_id, background=False)
    run = pipeline.run_api(get_db().agent_runs.find_one({"_id": rid}))
    gh = next(a for a in run["agents"] if a["id"] == "github")
    assert any("semantic code search" in t["text"] for t in gh["tools"])
    code_refs = [f for f in gh["findings"] if f["kind"] == "code"]
    assert code_refs and all(":" in f["ref"] and "-" in f["ref"].split(":")[-1] for f in code_refs)
    assert all("#L" in f["url"] for f in code_refs)


# ------------------------------------------------------------------ memory rerank respects governance
def test_memory_rerank_only_sees_memories_governance_allows(world, make_client):
    o = world["owner"]
    for title, scope, team in (("Payments retry policy", "org", None), ("Payments retry policy for the payments team", "team", "payments"),
                               ("Retry payments with backoff", "org", None)):
        body = {"title": title, "content": f"{title}: retry failed payments with exponential backoff.", "memory_type": "architecture_decision", "scope": scope}
        if team:
            body["team"] = team
        assert o.post("/api/memories", json=body).status_code == 200
    rr = ReverseReranker()
    E.set_reranker(rr)
    results = retrieval.search(world["p"], "retry failed payments with backoff", k=2)   # owner has no team
    assert len(results) == 2 and rr.seen
    assert not any("payments team" in d for d in rr.seen[0])  # the team-scoped memory never reached the reranker
    ev = next(e for e in o.get("/api/audit").json() if e["type"] == "memory.retrieved")
    assert ev["details"]["reranked"] is True
