"""Gemini naming pass. The structure (boxes, arrows, groups) is fixed by code analysis; Gemini only gives features and
boxes friendly names and one-line descriptions a new engineer can follow ("Draft lifecycle", "Fetches and scores RSS
articles"). Output is schema-validated and filtered to ids that exist, so it cannot add or remove anything."""
from __future__ import annotations

import json
import logging

from pydantic import BaseModel, Field

log = logging.getLogger("archmind.archmap.labels")
MAX_NODES_IN_PROMPT = 160

SYSTEM = """You label an architecture diagram that was extracted from source code, for a new engineer or a college student.
- Use plain, concrete words. Prefer what a part DOES for the product ("Draft lifecycle", "News intake", "Publishes posts to WordPress").
- Feature names: 1-3 words. Box labels: 2-4 words, no file extensions, no class-name jargon like "Impl".
- Descriptions: one short sentence, max 14 words, present tense, no marketing.
- Only use the ids you are given. Never invent components, never merge or split them.
- The actor is the human who uses the product (e.g. "Editor", "Shopper", "Developer"); use "User" if unclear."""


class FeatureLabel(BaseModel):
    id: str
    name: str = Field(description="1-3 words")
    description: str = Field(description="one short sentence")


class NodeLabel(BaseModel):
    id: str
    label: str = Field(description="2-4 plain words")
    description: str = Field(description="one short sentence")


class MapLabels(BaseModel):
    actor: str = Field(description="who uses this product")
    summary: str = Field(description="one sentence: what this codebase does")
    features: list[FeatureLabel]
    nodes: list[NodeLabel]


def prompt_for(archmap: dict, repo_names: list[str]) -> tuple[str, dict[str, str]]:
    """Compact JSON of the map with short ids (n1, n2 ...) to keep the prompt small."""
    nodes = [n for n in archmap["nodes"] if n["role"] not in ("actor",)]
    degree: dict[str, int] = {}
    for e in archmap["edges"]:
        degree[e["from"]] = degree.get(e["from"], 0) + 1
        degree[e["to"]] = degree.get(e["to"], 0) + 1
    if len(nodes) > MAX_NODES_IN_PROMPT:
        nodes = sorted(nodes, key=lambda n: -degree.get(n["id"], 0))[:MAX_NODES_IN_PROMPT]
    short = {n["id"]: f"n{i}" for i, n in enumerate(nodes, 1)}
    out_edges: dict[str, list[str]] = {}
    for e in archmap["edges"]:
        if e["from"] in short and e["to"] in short:
            out_edges.setdefault(e["from"], []).append(f"{e['label']} -> {short[e['to']]}")
    feats = []
    for f in archmap["features"]:
        feats.append({"id": f["id"], "current_name": f["name"], "boxes": [
            {"id": short[i], "name": n["name"], "role": n["role"], **({"file": n["file"]} if n.get("file") else {}),
             **({"routes": n["routes"][:6]} if n.get("routes") else {}), **({"ui_route": n["ui_route"]} if n.get("ui_route") else {}),
             **({"uses_types": n["tags"][:4]} if n.get("tags") else {}), **({"arrows": out_edges[i][:6]} if out_edges.get(i) else {})}
            for i in f["node_ids"] if i in short for n in [next(x for x in archmap["nodes"] if x["id"] == i)]]})
    body = {"repositories": repo_names, "features": feats}
    return ("Label this architecture map. Return a label and description for every box id and every feature id.\n<map>\n"
            + json.dumps(body, separators=(",", ":"))[:120_000] + "\n</map>"), {v: k for k, v in short.items()}


def generate(archmap: dict, repo_names: list[str]) -> dict:
    from app.agents.llm import get_llm

    prompt, back = prompt_for(archmap, repo_names)
    llm = get_llm()
    raw: MapLabels = llm.structured(SYSTEM, prompt, MapLabels)
    feature_ids = {f["id"] for f in archmap["features"]}
    clip = lambda s, n: " ".join(str(s).split())[:n]  # noqa: E731
    return {
        "model": llm.model_name,
        "actor": clip(raw.actor, 30) or "User",
        "summary": clip(raw.summary, 200),
        "features": {f.id: {"name": clip(f.name, 40), "description": clip(f.description, 160)} for f in raw.features if f.id in feature_ids and f.name.strip()},
        "nodes": {back[n.id]: {"label": clip(n.label, 40), "description": clip(n.description, 160)} for n in raw.nodes if n.id in back and n.label.strip()},
    }


def apply(archmap: dict, labels: dict | None) -> dict:
    if not labels:
        return {**archmap, "labels": None}
    nodes = []
    for n in archmap["nodes"]:
        lab = labels["nodes"].get(n["id"])
        if n["role"] == "actor":
            n = {**n, "label": labels.get("actor") or n["label"]}
        elif lab:
            n = {**n, "label": lab["label"], "description": lab["description"]}
        nodes.append(n)
    feats = [{**f, **({"name": labels["features"][f["id"]]["name"], "description": labels["features"][f["id"]]["description"]}
                      if f["id"] in labels["features"] else {})} for f in archmap["features"]]
    return {**archmap, "nodes": nodes, "features": feats, "labels": {"model": labels.get("model"), "summary": labels.get("summary")}}
