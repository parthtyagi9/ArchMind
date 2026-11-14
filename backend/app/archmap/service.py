"""Architecture maps for repositories and repo groups: build/store, merge across a group's repositories, and the
cached Gemini naming pass (keyed by the map's fingerprint, so a reindex that changes the structure re-labels it)."""
from __future__ import annotations

import hashlib
import logging

from app.archmap import build as builder
from app.archmap import labels as namer
from app import interfaces
from app.db import get_db, utcnow

log = logging.getLogger("archmind.archmap")


def compute_for_repo(repo_id: str) -> dict:
    files = {d["path"]: d["content"] for d in get_db().source_documents.find({"repo_id": repo_id}, {"path": 1, "content": 1})}
    return builder.build(files)


def store(repo_id: str, org_id: str, archmap: dict) -> None:
    get_db().repo_graphs.update_one({"_id": repo_id}, {"$set": {"archmap": archmap, "org_id": org_id}}, upsert=True)


def repo_map(repo: dict) -> dict:
    """The stored map, or one computed now for repositories indexed before maps existed (then stored)."""
    g = get_db().repo_graphs.find_one({"_id": repo["_id"]}, {"archmap": 1}) or {}
    m = g.get("archmap")
    if not m or m.get("version") != builder.VERSION:
        m = compute_for_repo(repo["_id"])
        store(repo["_id"], repo["org_id"], m)
    return m


# ------------------------------------------------------------------ groups
def _prefixed(repo: dict, m: dict) -> tuple[list[dict], list[dict], list[dict], dict]:
    rid, name = repo["_id"], repo["full_name"]
    p = lambda i: i if i.startswith(("ext:", "actor:")) else f"{rid}::{i}"  # noqa: E731 - externals and the user are shared
    nodes = [{**n, "id": p(n["id"]), "repo_id": rid, "repo_name": name, "feature": n["feature"] if n["feature"] in ("external", "actor") else f"{rid}::{n['feature']}"}
             for n in m["nodes"]]
    edges = [{**e, "from": p(e["from"]), "to": p(e["to"]), "id": f"{rid[-6:]}{e['id']}"} for e in m["edges"]]
    feats = [{**f, "id": f"{rid}::{f['id']}" if f["id"] != "external" else "external", "node_ids": [p(i) for i in f["node_ids"]], "repo_name": name}
             for f in m["features"]]
    http = {"calls": [{**c, "node": p(c["node"]), "repo_id": rid} for c in m.get("http", {}).get("calls", [])],
            "routes": [{**r, "node": p(r["node"]), "repo_id": rid} for r in m.get("http", {}).get("routes", [])]}
    return nodes, edges, feats, http


def group_map(group: dict, members: list[dict]) -> dict:
    nodes: dict[str, dict] = {}
    edges: list[dict] = []
    feats: dict[str, dict] = {}
    calls, routes = [], []
    for repo in members:
        if repo.get("status") != "ready":
            continue
        n, e, f, h = _prefixed(repo, repo_map(repo))
        for x in n:
            nodes.setdefault(x["id"], x)
        edges += e
        for x in f:
            if x["id"] in feats:  # shared "External systems"
                feats[x["id"]]["node_ids"] = list(dict.fromkeys(feats[x["id"]]["node_ids"] + x["node_ids"]))
            else:
                feats[x["id"]] = x
        calls += h["calls"]
        routes += h["routes"]
    # the user reaches the group through its frontends when there are any
    fronts = [x for x in nodes.values() if x.get("tier") == "frontend"]
    if fronts:
        edges = [e for e in edges if not (e["kind"] == "actor" and nodes.get(e["to"], {}).get("tier") == "backend")]
    # HTTP calls answered by another repository of the group
    links, _ = interfaces.link_calls(calls, routes)
    cross: dict[tuple[str, str], dict] = {}
    for c, r, score in links:
        if c["repo_id"] == r["repo_id"] or c["node"] not in nodes or r["node"] not in nodes:
            continue
        e = cross.setdefault((c["node"], r["node"]), {"from": c["node"], "to": r["node"], "kind": "http", "methods": [], "endpoints": [], "tags": [],
                                                     "evidence": [], "cross_repo": True})
        ep = f"{r['method']} {r['path']}"
        if ep not in e["endpoints"]:
            e["endpoints"].append(ep)
        if len(e["evidence"]) < 20:
            e["evidence"].append({"call": f"{c['method']} {c['raw']}", "call_file": c["file"], "call_line": c["line"], "call_repo": nodes[c["node"]]["repo_name"],
                                  "route": ep, "route_file": r["file"], "route_line": r["line"], "route_repo": nodes[r["node"]]["repo_name"], "score": score})
    for e in cross.values():
        e["label"] = builder.http_label([tuple(x.split(" ", 1)) for x in e["endpoints"]])
        e["id"] = hashlib.sha1(f"{e['from']}>{e['to']}>http".encode()).hexdigest()[:12]
        edges.append(e)
    node_list = list(nodes.values())
    order = {"frontend": 0, "backend": 1, "external": 3}
    feat_list = sorted(feats.values(), key=lambda f: (order.get(f["tier"], 2), f.get("repo_name", ""), f["id"].endswith("::data"), f["name"]))
    return {"version": builder.VERSION, "nodes": node_list, "edges": edges, "features": feat_list,
            "hidden": {}, "unmatched_calls": [], "fingerprint": builder.fingerprint(node_list, edges),
            "repos": [{"id": r["_id"], "full_name": r["full_name"], "status": r.get("status")} for r in members]}


# ------------------------------------------------------------------ labels (cached)
def labels_available() -> bool:
    from app.agents import llm as llm_mod
    from app.config import get_settings

    return llm_mod._llm is not None or bool(get_settings().gemini_api_key)


def respond(owner: str, owner_id: str, archmap: dict) -> dict:
    lab = cached_labels(owner, owner_id, archmap["fingerprint"])
    out = namer.apply(archmap, lab)
    out["labels_status"] = "ready" if lab else ("missing" if labels_available() else "unavailable")
    out.pop("http", None)
    return out


def cached_labels(owner: str, owner_id: str, fingerprint: str) -> dict | None:
    coll = get_db().repo_graphs if owner == "repo" else get_db().repo_groups
    doc = coll.find_one({"_id": owner_id}, {"archmap_labels": 1}) or {}
    lab = doc.get("archmap_labels")
    return lab if lab and lab.get("fingerprint") == fingerprint else None


def make_labels(owner: str, owner_id: str, archmap: dict, repo_names: list[str]) -> dict:
    lab = namer.generate(archmap, repo_names)
    lab.update({"fingerprint": archmap["fingerprint"], "created_at": utcnow()})
    coll = get_db().repo_graphs if owner == "repo" else get_db().repo_groups
    coll.update_one({"_id": owner_id}, {"$set": {"archmap_labels": lab}}, upsert=owner == "repo")
    return lab
