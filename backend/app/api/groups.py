from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.deps import Principal, current_principal
from app.integrations.github import GitHubError, get_github_client
from app.memory import governance
from app.services import groups, provenance, repos

log = logging.getLogger("archmind.api.groups")
router = APIRouter(tags=["groups"])


class GroupIn(BaseModel):
    name: str
    description: str = ""
    repo_ids: list[str] = Field(default_factory=list)


class GroupPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    repo_ids: list[str] | None = None


def _memory_counts(p: Principal, g: dict, graph: dict) -> dict[str, int]:
    """Active memories per group node: repo-scoped ones of that node's repo (by plain component id) and group/org/team ones
    that name the node (by namespaced id, or by plain id when the memory is scoped to that repo)."""
    ctx = groups.context(p, group_id=g["_id"])
    mems = governance.list_memories(p, status_filter="active", ctx=ctx)
    counts: dict[str, int] = {}
    for n in graph["nodes"]:
        c = 0
        for m in mems:
            comps = m["components"]
            if n["id"] in comps or (n["component_id"] in comps and (m["scope"] != "repo" or m["repo_id"] == n["repo_id"])):
                c += 1
        counts[n["id"]] = c
    return counts


@router.get("/groups")
def list_groups(p: Principal = Depends(current_principal)) -> list[dict]:
    return [groups.group_api(g) for g in groups.list_groups(p)]


@router.post("/groups")
def create_group(body: GroupIn, p: Principal = Depends(current_principal)) -> dict:
    return groups.group_api(groups.create(p, name=body.name, description=body.description, repo_ids=body.repo_ids))


@router.get("/groups/{group_id}")
def get_group(group_id: str, p: Principal = Depends(current_principal)) -> dict:
    return groups.group_api(groups.get_group(p, group_id))


@router.patch("/groups/{group_id}")
def update_group(group_id: str, body: GroupPatch, p: Principal = Depends(current_principal)) -> dict:
    return groups.group_api(groups.update(p, group_id, name=body.name, description=body.description, repo_ids=body.repo_ids))


@router.delete("/groups/{group_id}")
def delete_group(group_id: str, p: Principal = Depends(current_principal)) -> dict:
    groups.delete(p, group_id)
    return {"ok": True}


@router.get("/groups/{group_id}/tree")
def group_tree(group_id: str, p: Principal = Depends(current_principal)) -> dict:
    return {"files": groups.tree(groups.get_group(p, group_id))}


@router.get("/groups/{group_id}/graph")
def group_graph(group_id: str, p: Principal = Depends(current_principal)) -> dict:
    g = groups.get_group(p, group_id)
    graph = groups.build_graph(g)
    counts = _memory_counts(p, g, graph)
    graph["nodes"] = [{**n, "memory_count": counts.get(n["id"], 0)} for n in graph["nodes"]]
    return graph


@router.get("/groups/{group_id}/components/{node_id}")
def group_component(group_id: str, node_id: str, p: Principal = Depends(current_principal)) -> dict:
    g = groups.get_group(p, group_id)
    graph = groups.build_graph(g)
    out = groups.component(g, node_id, graph)
    node = out["node"]
    ctx = groups.context(p, group_id=group_id)
    mems = [m for m in governance.list_memories(p, status_filter="active", ctx=ctx)
            if node_id in m["components"] or (node["component_id"] in m["components"] and (m["scope"] != "repo" or m["repo_id"] == node["repo_id"]))]
    commits: list[dict] = []
    repo = repos.get_repo(p, node["repo_id"])
    if node["path"]:
        try:
            client = get_github_client(repos.provenance_token(p, repo))
            commits = [provenance.commit_finding(c, repo["full_name"]) for c in client.file_history(repo["full_name"], repo["branch"], node["path"], 5)]
        except GitHubError as e:
            log.info("component history unavailable for %s: %s", node["path"], e)
    return {**out, "node": {**node, "memory_count": len(mems)}, "recent_commits": commits, "memories": mems}
