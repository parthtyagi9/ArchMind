"""Repo groups ("systems"): several repositories of one organization treated as one architecture, e.g. a notes app made
of a web repo and an API repo. A group's map merges every member repo's components and adds cross-repo edges:

- calls_api:          an HTTP call in one repo matched to a route served by another (method + path, prefix tolerant)
- depends_on_package: one repo imports a package another repo publishes (package.json / pyproject.toml / go.mod)

The map is computed on read from each repo's stored graph and interfaces, so it is always current after a reindex or a
membership change. Every cross-repo edge carries its evidence (file and line on both sides)."""
from __future__ import annotations

import re
from collections import defaultdict

from fastapi import HTTPException, status
from pymongo.errors import DuplicateKeyError

from app import audit, code, interfaces
from app.db import get_db, iso, new_id, utcnow
from app.deps import Principal, require
from app.memory.context import MemoryContext
from app.services import repos

MAX_REPOS = 20
SEP = ":"  # group node id = <repo_id>:<component id>; repo ids and component slugs never contain ':'


def node_id(repo_id: str, comp_id: str) -> str:
    return f"{repo_id}{SEP}{comp_id}"


def split_node_id(nid: str) -> tuple[str, str]:
    repo_id, _, comp = nid.partition(SEP)
    return repo_id, comp


# ------------------------------------------------------------------ CRUD
def _clean_name(name: str | None) -> str:
    name = re.sub(r"\s+", " ", (name or "").strip())
    if not name or len(name) > 80:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Group name must be 1-80 characters")
    return name


def _check_repos(p: Principal, repo_ids: list[str]) -> list[str]:
    ids = list(dict.fromkeys(r for r in repo_ids or [] if r))
    if len(ids) > MAX_REPOS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"A group can hold at most {MAX_REPOS} repositories")
    found = {r["_id"] for r in get_db().repos.find({"_id": {"$in": ids}, "org_id": p.org_id}, {"_id": 1})}
    missing = [r for r in ids if r not in found]
    if missing:  # same answer for other orgs' ids and ids that do not exist
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Every repository must be connected in this organization")
    return ids


def get_group(p: Principal, group_id: str) -> dict:
    g = get_db().repo_groups.find_one({"_id": group_id, "org_id": p.org_id})
    if not g:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    return g


def create(p: Principal, *, name: str, description: str = "", repo_ids: list[str] | None = None) -> dict:
    require(p, "connect_repo")
    now = utcnow()
    g = {"_id": new_id("grp"), "org_id": p.org_id, "name": _clean_name(name), "description": (description or "").strip()[:500],
         "repo_ids": _check_repos(p, repo_ids or []), "created_by": p.user_id, "created_at": now, "updated_at": now}
    db = get_db()
    if db.repo_groups.find_one({"org_id": p.org_id, "name": g["name"]}):
        raise HTTPException(status.HTTP_409_CONFLICT, "A group with this name already exists")
    try:
        db.repo_groups.insert_one(g)
    except DuplicateKeyError:
        raise HTTPException(status.HTTP_409_CONFLICT, "A group with this name already exists")
    audit.record("group.created", p, details={"group_id": g["_id"], "name": g["name"], "repos": len(g["repo_ids"])})
    return g


def update(p: Principal, group_id: str, *, name: str | None = None, description: str | None = None, repo_ids: list[str] | None = None) -> dict:
    require(p, "connect_repo")
    g = get_group(p, group_id)
    changes: dict = {"updated_at": utcnow()}
    if name is not None:
        changes["name"] = _clean_name(name)
        clash = get_db().repo_groups.find_one({"org_id": p.org_id, "name": changes["name"], "_id": {"$ne": group_id}})
        if clash:
            raise HTTPException(status.HTTP_409_CONFLICT, "A group with this name already exists")
    if description is not None:
        changes["description"] = description.strip()[:500]
    if repo_ids is not None:
        changes["repo_ids"] = _check_repos(p, repo_ids)
    db = get_db()
    db.repo_groups.update_one({"_id": group_id, "org_id": p.org_id}, {"$set": changes})
    if "name" in changes and changes["name"] != g["name"]:  # keep the label on group-scoped memories readable
        db.memories.update_many({"tenant_id": p.org_id, "group_id": group_id}, {"$set": {"group_name": changes["name"]}})
    added = sorted(set(changes.get("repo_ids", g["repo_ids"])) - set(g["repo_ids"]))
    removed = sorted(set(g["repo_ids"]) - set(changes.get("repo_ids", g["repo_ids"])))
    audit.record("group.updated", p, details={"group_id": group_id, "fields": sorted(k for k in changes if k != "updated_at"),
                                              "repos_added": added, "repos_removed": removed})
    return get_group(p, group_id)


def delete(p: Principal, group_id: str) -> None:
    """Group-scoped memories are kept (for audit) but can no longer be retrieved: no workspace matches their group."""
    require(p, "connect_repo")
    g = get_group(p, group_id)
    get_db().repo_groups.delete_one({"_id": group_id, "org_id": p.org_id})
    audit.record("group.deleted", p, details={"group_id": group_id, "name": g["name"]})


def list_groups(p: Principal) -> list[dict]:
    return list(get_db().repo_groups.find({"org_id": p.org_id}).sort("name", 1))


def member_repos(g: dict) -> list[dict]:
    by_id = {r["_id"]: r for r in get_db().repos.find({"_id": {"$in": g["repo_ids"]}, "org_id": g["org_id"]})}
    return [by_id[r] for r in g["repo_ids"] if r in by_id]


def group_api(g: dict, *, memory_count: int | None = None) -> dict:
    members = member_repos(g)
    out = {"id": g["_id"], "name": g["name"], "description": g.get("description", ""), "repo_ids": [r["_id"] for r in members],
           "repos": [repos.repo_api(r) for r in members], "created_at": iso(g["created_at"]), "updated_at": iso(g.get("updated_at"))}
    if memory_count is not None:
        out["memory_count"] = memory_count
    return out


# ------------------------------------------------------------------ workspace context
def context(p: Principal, *, repo_id: str | None = None, group_id: str | None = None) -> MemoryContext:
    """Validated memory context for a request. A group wins over a single repo; a repo given with a group must be a member."""
    if group_id:
        g = get_group(p, group_id)
        members = member_repos(g)
        if repo_id and repo_id not in {r["_id"] for r in members}:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That repository is not part of this group")
        return MemoryContext(repo_ids=tuple(r["_id"] for r in members), group_id=g["_id"],
                             repo_names={r["_id"]: r["full_name"] for r in members}, group_name=g["name"])
    if repo_id:
        r = repos.get_repo(p, repo_id)
        return MemoryContext(repo_ids=(r["_id"],), repo_names={r["_id"]: r["full_name"]})
    return MemoryContext()


# ------------------------------------------------------------------ the group map
def build_graph(g: dict) -> dict:
    members = member_repos(g)
    db = get_db()
    stored = {d["_id"]: d for d in db.repo_graphs.find({"_id": {"$in": [r["_id"] for r in members]}})}
    nodes, edges = [], []
    all_routes, all_calls, all_provides, all_requires = [], [], [], []
    repos_out = []
    for r in members:
        rg = stored.get(r["_id"]) or {"nodes": [], "edges": []}
        ifc = rg.get("interfaces")
        repos_out.append({"id": r["_id"], "full_name": r["full_name"], "branch": r["branch"], "status": r["status"],
                          "file_count": r.get("file_count", 0), "interfaces_indexed": ifc is not None,
                          "routes": len((ifc or {}).get("routes", [])), "calls": len((ifc or {}).get("calls", []))})
        for n in rg["nodes"]:
            nodes.append({**n, "id": node_id(r["_id"], n["id"]), "component_id": n["id"], "repo_id": r["_id"], "repo_name": r["full_name"]})
        for e in rg["edges"]:
            edges.append({**e, "from": node_id(r["_id"], e["from"]), "to": node_id(r["_id"], e["to"]), "cross_repo": False})
        for key, bucket in (("routes", all_routes), ("calls", all_calls), ("provides", all_provides), ("requires", all_requires)):
            for item in (ifc or {}).get(key, []):
                bucket.append({**item, "repo_id": r["_id"], "repo_name": r["full_name"]})

    comp = lambda item: node_id(item["repo_id"], code.slug(item["component"]))  # noqa: E731
    # calls inside one repo are already edges of that repo's own graph; here only calls answered by ANOTHER repo count
    links, _ = interfaces.link_calls(all_calls, all_routes)
    cross = [(c, r, s) for c, r, s in links if c["repo_id"] != r["repo_id"]]
    linked_calls = {id(c) for c, _, _ in links}
    edges += [{**e, "cross_repo": True} for e in code.api_edges(cross, comp, comp)]

    pkg: dict[tuple[str, str], list[tuple[dict, dict]]] = defaultdict(list)
    for rq, pv in interfaces.link_packages(all_requires, all_provides):
        if rq["repo_id"] != pv["repo_id"]:
            pkg[(comp(rq), comp(pv))].append((rq, pv))
    for (a, b), items in sorted(pkg.items()):
        edges.append({"from": a, "to": b, "kind": "depends_on_package", "weight": sum(rq["count"] for rq, _ in items), "cross_repo": True,
                      "packages": sorted({pv["name"] for _, pv in items}),
                      "evidence": [{"import_file": rq["file"], "import_repo": rq["repo_name"], "package": pv["name"],
                                    "manifest_file": pv["file"], "manifest_repo": pv["repo_name"]} for rq, pv in items[:20]]})

    unmatched = [{"repo_name": c["repo_name"], "method": c["method"], "path": c["path"], "raw": c["raw"], "host": c.get("host"),
                  "file": c["file"], "line": c["line"]}
                 for c in all_calls if id(c) not in linked_calls][:100]
    return {"group": {"id": g["_id"], "name": g["name"]}, "repos": repos_out, "nodes": nodes, "edges": edges,
            "unmatched_calls": unmatched, "stats": {"routes": len(all_routes), "calls": len(all_calls),
                                                    "cross_repo_edges": sum(1 for e in edges if e["cross_repo"])}}


def component(g: dict, nid: str, graph: dict) -> dict:
    node = next((n for n in graph["nodes"] if n["id"] == nid), None)
    if not node:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Component not found")
    labels = {n["id"]: (n["label"], n["repo_name"]) for n in graph["nodes"]}

    def ref(other: str, e: dict) -> dict:
        label, repo_name = labels.get(other, (other, None))
        return {"id": other, "label": label, "repo_name": repo_name, "weight": e["weight"], "kind": e.get("kind", "imports"),
                "cross_repo": e.get("cross_repo", False), "endpoints": e.get("endpoints", []), "packages": e.get("packages", []),
                "evidence": e.get("evidence", [])}

    ifc = repos.interfaces_of(node["repo_id"])
    mine = lambda items: [i for i in items if code.slug(i["component"]) == node["component_id"]][:100]  # noqa: E731
    return {"node": node,
            "depends_on": [ref(e["to"], e) for e in graph["edges"] if e["from"] == nid],
            "used_by": [ref(e["from"], e) for e in graph["edges"] if e["to"] == nid],
            "serves": mine(ifc["routes"]), "calls": mine(ifc["calls"])}


def tree(g: dict) -> list[dict]:
    out = []
    for r in member_repos(g):
        out += [{**f, "repo_id": r["_id"], "repo_name": r["full_name"]} for f in repos.tree(r["_id"])]
    return out
