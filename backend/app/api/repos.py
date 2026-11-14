from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app import code
from app.db import get_db
from app.deps import Principal, current_principal, require
from app.integrations.github import GitHubError, get_github_client
from app.memory import governance
from app.memory import repository as mrepo
from app.services import integrations as integ
from app.services import groups, provenance, repos

log = logging.getLogger("archmind.api.repos")
router = APIRouter(tags=["repos"])


class ConnectIn(BaseModel):
    full_name: str
    branch: str | None = None


@router.get("/github/repos")
def github_repos(q: str | None = None, p: Principal = Depends(current_principal)) -> dict:
    token = integ.github_token(p.user_id)
    if not token:
        return {"connected": False, "repos": []}
    try:
        return {"connected": True, "repos": get_github_client(token).user_repos(q)}
    except GitHubError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))


@router.post("/repos")
def connect_repo(body: ConnectIn, p: Principal = Depends(current_principal)) -> dict:
    require(p, "connect_repo")
    return repos.repo_api(repos.connect(p, body.full_name, body.branch))


@router.get("/repos")
def list_repos(p: Principal = Depends(current_principal)) -> list[dict]:
    return [repos.repo_api(r) for r in get_db().repos.find({"org_id": p.org_id}).sort("created_at", -1)]


@router.get("/repos/{repo_id}")
def get_repo(repo_id: str, p: Principal = Depends(current_principal)) -> dict:
    return repos.repo_api(repos.get_repo(p, repo_id))


@router.post("/repos/{repo_id}/reindex")
def reindex(repo_id: str, p: Principal = Depends(current_principal)) -> dict:
    require(p, "connect_repo")
    r = repos.get_repo(p, repo_id)
    get_db().repos.update_one({"_id": repo_id}, {"$set": {"status": "indexing", "error": None, "progress": {"done": 0, "total": 0}, "connected_by": p.user_id}})
    repos.start_index(repo_id, repos.provenance_token(p, r))
    return repos.repo_api(get_db().repos.find_one({"_id": repo_id}))


@router.delete("/repos/{repo_id}")
def remove_repo(repo_id: str, p: Principal = Depends(current_principal)) -> dict:
    require(p, "connect_repo")
    repos.delete_repo(p, repo_id)
    return {"ok": True}


@router.get("/repos/{repo_id}/tree")
def repo_tree(repo_id: str, p: Principal = Depends(current_principal)) -> dict:
    repos.get_repo(p, repo_id)
    return {"files": repos.tree(repo_id)}


@router.get("/repos/{repo_id}/file")
def repo_file(repo_id: str, path: str = Query(...), p: Principal = Depends(current_principal)) -> dict:
    repos.get_repo(p, repo_id)
    return repos.file_doc(repo_id, path)


def _memory_counts(p: Principal, repo_id: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for m in governance.list_memories(p, status_filter="active", ctx=groups.context(p, repo_id=repo_id)):
        for c in m["components"]:
            counts[c] = counts.get(c, 0) + 1
    return counts


@router.get("/repos/{repo_id}/graph")
def repo_graph(repo_id: str, p: Principal = Depends(current_principal)) -> dict:
    repos.get_repo(p, repo_id)
    g = repos.graph(repo_id)
    counts = _memory_counts(p, repo_id)
    return {"nodes": [{**n, "memory_count": counts.get(n["id"], 0)} for n in g["nodes"]], "edges": g["edges"]}


def _ref(other: str, e: dict, labels: dict[str, str]) -> dict:
    return {"id": other, "label": labels.get(other, other), "weight": e["weight"], "kind": e.get("kind", "imports"), "cross_repo": False,
            "endpoints": e.get("endpoints", []), "packages": [], "evidence": e.get("evidence", [])}


@router.get("/repos/{repo_id}/components/{node_id}")
def component(repo_id: str, node_id: str, p: Principal = Depends(current_principal)) -> dict:
    repo = repos.get_repo(p, repo_id)
    g = repos.graph(repo_id)
    labels = {n["id"]: n["label"] for n in g["nodes"]}
    ifc = repos.interfaces_of(repo_id)
    node = next((n for n in g["nodes"] if n["id"] == node_id), None)
    if not node:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Component not found")
    mems = [m for m in governance.list_memories(p, status_filter="active", ctx=groups.context(p, repo_id=repo_id)) if node_id in m["components"]]
    commits: list[dict] = []
    if node["path"]:
        try:
            client = get_github_client(repos.provenance_token(p, repo))
            commits = [provenance.commit_finding(c, repo["full_name"]) for c in client.file_history(repo["full_name"], repo["branch"], node["path"], 5)]
        except GitHubError as e:
            log.info("component history unavailable for %s: %s", node["path"], e)
    return {
        "node": {**node, "memory_count": len(mems)},
        "depends_on": [_ref(e["to"], e, labels) for e in g["edges"] if e["from"] == node_id],
        "used_by": [_ref(e["from"], e, labels) for e in g["edges"] if e["to"] == node_id],
        "serves": [r for r in ifc["routes"] if code.slug(r["component"]) == node_id][:100],
        "calls": [c for c in ifc["calls"] if code.slug(c["component"]) == node_id][:100],
        "recent_commits": commits, "memories": mems,
    }
