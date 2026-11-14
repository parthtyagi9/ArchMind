"""Repository connection, indexing (tarball -> MongoDB source_documents + dependency graph) and queries."""
from __future__ import annotations

import hashlib
import logging
import re
import threading
from concurrent.futures import ThreadPoolExecutor

from fastapi import HTTPException, status

from app import audit, code
from app.config import get_settings
from app.db import get_db, iso, new_id, utcnow
from app.deps import Principal
from app.integrations.github import GitHubError, get_github_client
from app.services import integrations as integ

log = logging.getLogger("archmind.repos")
FULL_NAME = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
BATCH = 200


def repo_api(r: dict) -> dict:
    u = get_db().users.find_one({"_id": r.get("connected_by")}, {"name": 1}) or {}
    return {"id": r["_id"], "full_name": r["full_name"], "branch": r["branch"], "private": r.get("private", False), "status": r["status"],
            "progress": r.get("progress", {"done": 0, "total": 0}), "error": r.get("error"), "file_count": r.get("file_count", 0),
            "indexed_at": iso(r.get("indexed_at")), "connected_by": u.get("name", "unknown")}


def get_repo(p: Principal, repo_id: str) -> dict:
    r = get_db().repos.find_one({"_id": repo_id, "org_id": p.org_id})
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Repository not found")  # same answer for other orgs' ids
    return r


def provenance_token(p: Principal, repo: dict) -> str | None:
    """Caller's GitHub token, else the token of whoever connected the repo (org members already read its indexed
    contents), else None (public repositories only)."""
    return integ.github_token(p.user_id) or integ.github_token(repo.get("connected_by"))


def connect(p: Principal, full_name: str, branch: str | None) -> dict:
    full_name = (full_name or "").strip().removeprefix("https://github.com/").strip("/")
    if not FULL_NAME.match(full_name):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Use the form owner/name")
    token = integ.github_token(p.user_id)
    try:
        meta = get_github_client(token).repo(full_name)
    except GitHubError as e:
        if e.status == 429 and not token:
            # Anonymous API budget is spent. Public repos can still be indexed through codeload (no API limit);
            # visibility and default branch are unknown, so index HEAD and let the archive download decide.
            meta = {"full_name": full_name, "private": False, "default_branch": "HEAD"}
        else:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY if e.status != 404 else status.HTTP_404_NOT_FOUND, str(e))
    db = get_db()
    existing = db.repos.find_one({"org_id": p.org_id, "full_name": meta["full_name"]})
    repo = existing or {"_id": new_id("repo"), "org_id": p.org_id, "full_name": meta["full_name"], "created_at": utcnow()}
    repo.update({"branch": branch or meta["default_branch"], "private": meta["private"], "connected_by": p.user_id,
                 "status": "indexing", "error": None, "progress": {"done": 0, "total": 0}})
    db.repos.replace_one({"_id": repo["_id"]}, repo, upsert=True)
    audit.record("repo.connected", p, details={"repo": repo["full_name"], "private": repo["private"]})
    start_index(repo["_id"], token)
    return repo


def start_index(repo_id: str, token: str | None, *, background: bool = True) -> None:
    if background:
        threading.Thread(target=index_repo, args=(repo_id, token), daemon=True, name=f"index-{repo_id}").start()
    else:
        index_repo(repo_id, token)


def _progress(repo_id: str, done: int, total: int) -> None:
    get_db().repos.update_one({"_id": repo_id}, {"$set": {"progress": {"done": done, "total": total}}})


def _decode(data: bytes) -> str | None:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return None
    return None if "\x00" in text else text


def _collect_files(client, repo: dict, s) -> tuple[dict[str, str], dict[str, int]]:
    """Fast path: list the tree (1 API call), drop vendor/binary/oversized files BEFORE downloading anything, then fetch only
    the code files in parallel with live progress. Falls back to streaming the whole tarball when the tree is unavailable
    (rate limit) or truncated (huge repos)."""
    files: dict[str, str] = {}
    sizes: dict[str, int] = {}
    try:
        entries, truncated = client.tree(repo["full_name"], repo["branch"])
        if truncated:
            raise GitHubError("tree truncated", 413)
    except GitHubError as e:
        log.info("tree listing unavailable for %s (%s); using the archive instead", repo["full_name"], e)
        for f in client.archive(repo["full_name"], repo["branch"], s.index_max_archive_mb * 1_000_000):
            if len(files) >= s.index_max_files:
                break
            if code.should_index(f.path, len(f.data), s.index_max_file_bytes) and (text := _decode(f.data)) is not None:
                files[f.path], sizes[f.path] = text, len(f.data)
        return files, sizes
    wanted = [e for e in entries if code.should_index(e["path"], e["size"], s.index_max_file_bytes)][: s.index_max_files]
    total = len(wanted)
    _progress(repo["_id"], 0, total)
    done = 0
    lock = threading.Lock()

    def fetch(e: dict) -> tuple[str, bytes | None]:
        for attempt in (1, 2):
            try:
                return e["path"], client.raw(repo["full_name"], repo["branch"], e["path"])
            except GitHubError as ex:
                if attempt == 2 or ex.status == 404:
                    log.info("skipping %s: %s", e["path"], ex)
        return e["path"], None

    with ThreadPoolExecutor(max_workers=12) as pool:
        for path, data in pool.map(fetch, wanted):
            with lock:
                done += 1
                if done % 10 == 0 or done == total:
                    _progress(repo["_id"], done, total)
            if data is not None and (text := _decode(data)) is not None:
                files[path], sizes[path] = text, len(data)
    return files, sizes


def index_repo(repo_id: str, token: str | None) -> None:
    db = get_db()
    s = get_settings()
    repo = db.repos.find_one({"_id": repo_id})
    if not repo:
        return
    try:
        client = get_github_client(token)
        files, sizes = _collect_files(client, repo, s)
        total = len(files)
        _progress(repo_id, 0, total)
        db.source_documents.delete_many({"repo_id": repo_id})
        batch = []
        for i, (path, text) in enumerate(sorted(files.items()), 1):
            blob = hashlib.sha1(b"blob %d\0" % sizes[path] + text.encode()).hexdigest()
            batch.append({"repo_id": repo_id, "org_id": repo["org_id"], "path": path, "sha": blob, "size": sizes[path],
                          "language": code.language_of(path), "loc": text.count("\n") + 1, "content": text})
            if len(batch) >= BATCH or i == total:
                db.source_documents.insert_many(batch)
                batch = []
                _progress(repo_id, i, total)
        graph = code.build_graph(files)
        db.repo_graphs.replace_one({"_id": repo_id}, {"_id": repo_id, "org_id": repo["org_id"], "nodes": graph["nodes"],
                                                      "edges": graph["edges"], "built_at": utcnow()}, upsert=True)
        db.repos.update_one({"_id": repo_id}, {"$set": {"status": "ready", "file_count": total, "indexed_at": utcnow(), "error": None}})
        audit.record("repo.indexed", None, tenant_id=repo["org_id"], details={"repo": repo["full_name"], "files": total,
                                                                               "components": len(graph["nodes"])})
    except GitHubError as e:
        log.warning("index failed for %s: %s", repo.get("full_name"), e)
        db.repos.update_one({"_id": repo_id}, {"$set": {"status": "failed", "error": str(e)}})
    except Exception as e:  # never leave a repo stuck in "indexing"
        log.exception("index crashed for %s", repo.get("full_name"))
        db.repos.update_one({"_id": repo_id}, {"$set": {"status": "failed", "error": f"Indexing failed: {e}"}})


def delete_repo(p: Principal, repo_id: str) -> None:
    repo = get_repo(p, repo_id)
    db = get_db()
    db.source_documents.delete_many({"repo_id": repo_id})
    db.repo_graphs.delete_one({"_id": repo_id})
    db.repos.delete_one({"_id": repo_id})
    audit.record("repo.removed", p, details={"repo": repo["full_name"]})


# ------------------------------------------------------------------ reads
def tree(repo_id: str) -> list[dict]:
    return [{"path": d["path"], "size": d["size"], "language": d["language"]}
            for d in get_db().source_documents.find({"repo_id": repo_id}, {"path": 1, "size": 1, "language": 1}).sort("path", 1)]


def file_doc(repo_id: str, path: str) -> dict:
    d = get_db().source_documents.find_one({"repo_id": repo_id, "path": path})
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found in the indexed repository")
    return {"path": d["path"], "content": d["content"], "language": d["language"], "size": d["size"], "sha": d["sha"]}


def graph(repo_id: str) -> dict:
    g = get_db().repo_graphs.find_one({"_id": repo_id})
    return {"nodes": g["nodes"], "edges": g["edges"]} if g else {"nodes": [], "edges": []}
