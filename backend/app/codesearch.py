"""Semantic code search over indexed repositories.

Indexing (runs after a repository's files are stored; the repository is already usable while this runs):
  1. split every code/doc file into chunks of roughly one function or class (cut at blank lines / top-level
     declarations, ~60 lines, hard cap 120 lines or 4000 chars)
  2. embed "<path> (lines a-b)\\n<code>" with the code embedder (Voyage voyage-code-3) in batches
  3. store chunks with their vectors in `code_chunks`. Chunks whose text did not change since the last index keep their
     vector, so a reindex only pays for changed code.
  Progress is written to repos.search: {status: embedding|ready|failed|disabled, done, total, model, error}.

Search (the agent's GitHub sub-agent and nothing else):
  vector candidates ($vectorSearch, pre-filtered to the workspace's repositories) + keyword candidates (the existing
  $text search, so exact identifiers still win) -> Voyage rerank picks the best. With no code embeddings the search is
  keyword-only, exactly as before."""
from __future__ import annotations

import hashlib
import logging
import math
import re

from app import code
from app.config import get_settings
from app.db import get_db, utcnow
from app.memory.embeddings import get_code_embedder, get_reranker

log = logging.getLogger("archmind.codesearch")
TARGET_LINES = 60
MIN_LINES = 15
MAX_LINES = 120
MAX_CHARS = 4000
SEARCHABLE = code.CODE_LANGS | {"markdown"}
# A line that starts a declaration: functions/classes/types up to one indentation level (methods), but variables only at
# top level (an indented `const x =` is inside a function body, not a new unit).
_BOUNDARY = re.compile(r"^\s{0,4}(export\s+|public\s+|private\s+|protected\s+|internal\s+|static\s+|abstract\s+|async\s+|override\s+|default\s+)*"
                       r"(def|class|function|func|fun|interface|enum|record|struct|impl|type)\b|^\s{0,4}@\w+|^#+\s"
                       r"|^(export\s+)?(const|let|var)\s+\w+\s*=")


# ------------------------------------------------------------------ chunking
def chunk_file(path: str, text: str) -> list[tuple[int, int, str]]:
    """[(start_line, end_line, text)], 1-based inclusive. Cuts prefer a declaration start or a blank line."""
    lines = text.splitlines()
    if not lines:
        return []
    chunks: list[tuple[int, int, str]] = []
    n_lines = len(lines)
    start = 0
    while start < n_lines:
        hard_end = min(n_lines, start + MAX_LINES)
        cut, good, size = None, None, 0
        for i in range(start, hard_end):
            size += len(lines[i]) + 1
            count = i - start + 1
            if size >= MAX_CHARS and count >= 2:  # too big: end at the last good place, else right here
                cut = good or i + 1
                break
            nxt = lines[i + 1] if i + 1 < n_lines else None
            if count >= MIN_LINES and nxt is not None and (_BOUNDARY.match(nxt) or not nxt.strip()):
                good = i + 1  # the next line starts a declaration or follows a blank line
                if count >= TARGET_LINES:
                    cut = good
                    break
        if cut is None:
            # the rest fits in one chunk; still split a long remainder at its best declaration boundary
            cut = good if (good and n_lines - start > TARGET_LINES) else hard_end if hard_end == n_lines else (good or hard_end)
        body = "\n".join(lines[start:cut])
        if body.strip():
            chunks.append((start + 1, cut, body))
        start = cut
    return chunks


def embed_input(path: str, start: int, end: int, body: str) -> str:
    return f"{path} (lines {start}-{end})\n{body}"


def chunk_hash(model: str, text: str) -> str:
    return hashlib.sha1(f"{model}\0{text}".encode()).hexdigest()


# ------------------------------------------------------------------ indexing
def _status(repo_id: str, **fields) -> None:
    get_db().repos.update_one({"_id": repo_id}, {"$set": {f"search.{k}": v for k, v in fields.items()}})


def index_repo(repo_id: str, files: dict[str, str]) -> None:
    db = get_db()
    s = get_settings()
    repo = db.repos.find_one({"_id": repo_id}, {"org_id": 1, "full_name": 1})
    if not repo:
        return
    emb = get_code_embedder()
    if emb is None:
        db.repos.update_one({"_id": repo_id}, {"$set": {"search": {"status": "disabled", "done": 0, "total": 0, "model": None, "error": None}}})
        return
    pending: list[dict] = []
    for path in sorted(files):
        if code.language_of(path) not in SEARCHABLE:
            continue
        for a, b, body in chunk_file(path, files[path]):
            pending.append({"path": path, "start_line": a, "end_line": b, "text": body})
            if len(pending) >= s.code_max_chunks:
                break
        if len(pending) >= s.code_max_chunks:
            break
    for c in pending:
        c["hash"] = chunk_hash(emb.model, embed_input(c["path"], c["start_line"], c["end_line"], c["text"]))
    reuse = {d["hash"]: d["embedding"] for d in db.code_chunks.find({"repo_id": repo_id, "hash": {"$in": [c["hash"] for c in pending]}},
                                                                  {"hash": 1, "embedding": 1})}
    todo = [c for c in pending if c["hash"] not in reuse]
    total = len(pending)
    done_before = total - len(todo)
    db.repos.update_one({"_id": repo_id}, {"$set": {"search": {"status": "embedding", "done": done_before, "total": total, "model": emb.model,
                                                              "error": None, "reused": done_before}}})
    try:
        vecs = emb.embed_many([embed_input(c["path"], c["start_line"], c["end_line"], c["text"]) for c in todo], kind="document",
                              progress=lambda n: _status(repo_id, done=done_before + n))
    except Exception as e:  # keep the previous chunks searchable; say what went wrong
        log.warning("code embedding failed for %s: %s", repo.get("full_name"), e)
        _status(repo_id, status="failed", error=str(e)[:300])
        return
    for c, v in zip(todo, vecs):
        reuse[c["hash"]] = v
    now = utcnow()
    docs = [{"repo_id": repo_id, "org_id": repo["org_id"], "path": c["path"], "start_line": c["start_line"], "end_line": c["end_line"],
             "language": code.language_of(c["path"]), "text": c["text"], "hash": c["hash"], "embedding": reuse[c["hash"]],
             "embedding_model": emb.model, "indexed_at": now} for c in pending]
    db.code_chunks.delete_many({"repo_id": repo_id})
    for i in range(0, len(docs), 500):
        db.code_chunks.insert_many(docs[i:i + 500])
    _status(repo_id, status="ready", done=total, total=total, error=None, indexed_at=now)


def delete_repo(repo_id: str) -> None:
    get_db().code_chunks.delete_many({"repo_id": repo_id})


# ------------------------------------------------------------------ search
def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)


def _vector_candidates(repo_ids: list[str], qv: list[float], limit: int) -> list[dict]:
    s = get_settings()
    coll = get_db().code_chunks
    flt = {"repo_id": {"$in": repo_ids}}
    if s.vector_backend == "atlas":
        return list(coll.aggregate([
            {"$vectorSearch": {"index": s.code_vector_index_name, "path": "embedding", "queryVector": qv, "numCandidates": max(100, limit * 8),
                               "limit": limit, "filter": flt}},
            {"$set": {"score": {"$meta": "vectorSearchScore"}}},
            {"$project": {"embedding": 0}},
        ]))
    docs = list(coll.find(flt))  # unit tests: exact scan with the same filter
    for d in docs:
        d["score"] = (1 + _cosine(qv, d.pop("embedding"))) / 2
    return sorted(docs, key=lambda d: d["score"], reverse=True)[:limit]


def _keyword_candidates(repo_ids: list[str], terms: list[str], limit: int) -> list[dict]:
    """Files from the existing keyword search, narrowed to the chunk of each file that mentions the terms most."""
    from app.agents.pipeline import search_code  # keyword search lives with the agent

    out = []
    low = [t.lower() for t in terms if t]
    for f in search_code(repo_ids, terms, limit=limit):
        best = None
        for a, b, body in chunk_file(f["path"], f["content"]):
            sc = sum(body.lower().count(t) for t in low)
            if best is None or sc > best[0]:
                best = (sc, a, b, body)
        if best:
            out.append({"repo_id": f["repo_id"], "path": f["path"], "start_line": best[1], "end_line": best[2], "text": best[3], "score": None})
    return out


def ready_repos(repo_ids: list[str]) -> list[str]:
    return [r["_id"] for r in get_db().repos.find({"_id": {"$in": repo_ids}, "search.status": {"$in": ["ready", "embedding", "failed"]}}, {"_id": 1})
            if get_db().code_chunks.find_one({"repo_id": r["_id"]}, {"_id": 1})]


def search(repo_ids: list[str], query: str, terms: list[str], limit: int = 6) -> dict:
    """Returns {"hits": [...], "mode": "semantic+rerank" | "semantic" | "keyword", "model": ...}. Each hit has repo_id, path,
    start_line, end_line, text, via ("semantic" | "keyword" | "both") and score."""
    emb = get_code_embedder()
    semantic_repos = ready_repos(repo_ids) if emb is not None else []
    keyword = _keyword_candidates(repo_ids, terms or [query[:40]], limit=8)
    if not semantic_repos:
        return {"hits": [{**h, "via": "keyword"} for h in keyword[:limit]], "mode": "keyword", "model": None}

    qv = emb.embed(query, kind="query")
    vector = _vector_candidates(semantic_repos, qv, limit=20)
    merged: dict[tuple, dict] = {}
    for h in vector:
        merged[(h["repo_id"], h["path"], h["start_line"])] = {**h, "via": "semantic"}
    for h in keyword:
        key = (h["repo_id"], h["path"], h["start_line"])
        merged[key] = {**merged[key], "via": "both"} if key in merged else {**h, "via": "keyword"}
    cands = list(merged.values())
    rr = get_reranker()
    if rr is not None and len(cands) > 1:
        try:
            order = rr.rerank(query, [embed_input(c["path"], c["start_line"], c["end_line"], c["text"]) for c in cands], top_k=limit)
            hits = [{**cands[i], "score": round(sc, 4)} for i, sc in order]
            return {"hits": hits, "mode": "semantic+rerank", "model": f"{emb.model} + {rr.model}"}
        except Exception as e:
            log.warning("rerank failed, keeping vector order: %s", e)
    # no reranker: vector order first, then keyword-only hits
    cands.sort(key=lambda c: (c["via"] == "keyword", -(c.get("score") or 0)))
    return {"hits": cands[:limit], "mode": "semantic", "model": emb.model}
