"""The ArchMind agent: an orchestrator that deploys GitHub / Jira / Confluence / Memory sub-agents in parallel, then a
reasoning agent that turns their evidence into a structured, validated answer.

Tools are deterministic API calls (blame, JQL, CQL, governed $vectorSearch). The LLM only synthesizes: its output is
parsed against a schema and sanitized so every cited evidence ref and every memory constraint maps to something that
was actually retrieved. Governance happens before the model: it only sees memories the caller may retrieve."""
from __future__ import annotations

import logging
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any, Callable

from fastapi import HTTPException, status
from pymongo import ReturnDocument

from app import audit
from app.agents import prompts
from app.agents.keywords import keywords
from app.agents.llm import LLMAnswer, get_llm
from app.config import get_settings
from app.db import get_db, iso, new_id, utcnow
from app.deps import Principal, require
from app.integrations.atlassian import AtlassianError, clip
from app.integrations.github import GitHubError, get_github_client
from app.memory import governance, retrieval
from app.memory import repository as mrepo
from app.memory.context import MemoryContext
from app import codesearch
from app.services import groups, provenance, repos
from app.services import integrations as integ

log = logging.getLogger("archmind.agent")
AGENT_IDS = ("github", "jira", "confluence", "memory")
LABELS = {"github": "GitHub agent", "jira": "Jira agent", "confluence": "Confluence agent", "memory": "Memory agent"}
KEYS_WAIT_SECONDS = 25


# ------------------------------------------------------------------ run documents
def _blank_agent(aid: str) -> dict:
    return {"id": aid, "label": LABELS[aid], "status": "pending", "tools": [], "findings": [], "summary": "", "error": None,
            "started_at": None, "finished_at": None}


def run_api(doc: dict) -> dict:
    return {
        "id": doc["_id"], "kind": doc["kind"], "status": doc["status"], "question": doc["question"], "selection": doc.get("selection"),
        "repo_id": doc.get("repo_id"), "repo_name": doc.get("repo_name"), "group_id": doc.get("group_id"), "group_name": doc.get("group_name"),
        "memory_enabled": doc["memory_enabled"], "user": doc["user"],
        "created_at": iso(doc["created_at"]), "finished_at": iso(doc.get("finished_at")), "orchestrator": doc["orchestrator"],
        "agents": [doc["agents"][a] for a in AGENT_IDS], "memory": doc["memory"], "reasoning": doc["reasoning"], "answer": doc.get("answer"),
        "error": doc.get("error"), "proposed_memory_id": doc.get("proposed_memory_id"),
    }


class Rec:
    """Writes live progress into the run document so the UI can poll it."""

    def __init__(self, run_id: str):
        self.id, self.db = run_id, get_db()

    def set(self, **fields: Any) -> None:
        self.db.agent_runs.update_one({"_id": self.id}, {"$set": fields})

    def agent(self, aid: str, **f: Any) -> None:
        self.set(**{f"agents.{aid}.{k}": v for k, v in f.items()})

    @contextmanager
    def tool(self, aid: str, text: str):
        doc = self.db.agent_runs.find_one_and_update(
            {"_id": self.id}, {"$push": {f"agents.{aid}.tools": {"text": text, "status": "running", "at": iso(utcnow())}}},
            return_document=ReturnDocument.AFTER, projection={f"agents.{aid}.tools": 1})
        idx = len(doc["agents"][aid]["tools"]) - 1
        try:
            yield
        except Exception:
            self.set(**{f"agents.{aid}.tools.{idx}.status": "error"})
            raise
        self.set(**{f"agents.{aid}.tools.{idx}.status": "done"})

    def note_tool(self, aid: str, text: str) -> None:
        with self.tool(aid, text):
            pass

    def findings(self, aid: str, items: list[dict]) -> None:
        if items:
            self.db.agent_runs.update_one({"_id": self.id}, {"$push": {f"agents.{aid}.findings": {"$each": items}}})


@dataclass
class Ctx:
    p: Principal
    run: dict
    rec: Rec
    repo: dict | None  # the repository the selection is in (or the single-repo workspace)
    kind: str
    question: str
    selection: dict | None
    memory_enabled: bool
    terms: list[str]
    components: list[dict] = field(default_factory=list)
    file_context: str | None = None
    ticket_keys: list[str] = field(default_factory=list)
    keys_ready: threading.Event = field(default_factory=threading.Event)
    atlassian: Any = None  # (cfg, client) | None
    memdocs: list[dict] = field(default_factory=list)
    findings_by_agent: dict[str, list[dict]] = field(default_factory=dict)
    group: dict | None = None
    search_repos: list[dict] = field(default_factory=list)  # every repository whose code the GitHub agent may search
    mctx: MemoryContext = field(default_factory=MemoryContext)


# ------------------------------------------------------------------ creation
def create_run(p: Principal, *, kind: str, question: str, repo_id: str | None, selection: dict | None, memory_enabled: bool,
               group_id: str | None = None) -> dict:
    require(p, "ask")
    if kind not in ("why", "ask"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "kind must be why or ask")
    question = (question or "").strip()
    if not question and selection:
        question = "Why does this exist?"
    if not question:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Ask a question")
    sel_repo_id = (selection or {}).get("repo_id") or repo_id
    if group_id and selection and not sel_repo_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "In a group workspace, say which repository the selection is from")
    mctx = groups.context(p, repo_id=sel_repo_id, group_id=group_id)  # validates the group and that the repo is a member
    group = groups.get_group(p, group_id) if group_id else None
    repo = repos.get_repo(p, sel_repo_id) if sel_repo_id else None
    if selection:
        selection = {"path": str(selection["path"])[:500], "start_line": int(selection["start_line"]), "end_line": int(selection["end_line"]),
                     "text": str(selection["text"])[:6000], "repo_id": repo["_id"] if repo else None}
    now = utcnow()
    doc = {
        "_id": new_id("run"), "tenant_id": p.org_id, "kind": kind, "status": "running", "question": question[:2000], "selection": selection,
        "repo_id": repo["_id"] if repo else None, "repo_name": repo["full_name"] if repo else None, "memory_enabled": memory_enabled, "user": p.actor,
        "group_id": group["_id"] if group else None, "group_name": group["name"] if group else None,
        "created_at": now, "finished_at": None, "orchestrator": {"status": "planning", "plan": [], "note": "Deciding which sources to search"},
        "agents": {a: _blank_agent(a) for a in AGENT_IDS},
        "memory": {"retrieved": [], "excluded": 0, "filter": retrieval.filter_summary(p, now, mctx)},
        "reasoning": {"status": "pending", "model": None}, "answer": None, "error": None, "proposed_memory_id": None,
    }
    get_db().agent_runs.insert_one(doc)
    return doc


def start_run(p: Principal, *, kind: str, question: str, repo_id: str | None = None, selection: dict | None = None,
              memory_enabled: bool = True, background: bool = True, group_id: str | None = None) -> str:
    doc = create_run(p, kind=kind, question=question, repo_id=repo_id, selection=selection, memory_enabled=memory_enabled, group_id=group_id)
    if background:
        threading.Thread(target=execute_run, args=(p, doc["_id"]), daemon=True, name=doc["_id"]).start()
    else:
        execute_run(p, doc["_id"])
    return doc["_id"]


# ------------------------------------------------------------------ sub-agents
def _snippet(text: str, terms: list[str], radius: int = 2) -> str:
    lines = text.splitlines()
    low = [t.lower() for t in terms]
    for i, ln in enumerate(lines):
        if any(t in ln.lower() for t in low):
            return clip("\n".join(lines[max(0, i - radius): i + radius + 1]), 420)
    return clip("\n".join(lines[:4]), 300)


def search_code(repo_ids: str | list[str], terms: list[str], limit: int = 6) -> list[dict]:
    """Keyword search over indexed source of one or more repositories. Uses the Atlas text index when present, else a scored scan."""
    ids = [repo_ids] if isinstance(repo_ids, str) else list(repo_ids)
    scope = {"repo_id": ids[0]} if len(ids) == 1 else {"repo_id": {"$in": ids}}
    docs = get_db().source_documents
    hits: list[dict] = []
    try:
        hits = list(docs.find({**scope, "$text": {"$search": " ".join(terms)}}, {"score": {"$meta": "textScore"}, "path": 1, "content": 1, "repo_id": 1})
                    .sort([("score", {"$meta": "textScore"})]).limit(limit))
    except Exception:  # no text index (tests / fresh DB): fall back to a scored scan
        hits = []
    if not hits:
        scored = []
        for d in docs.find(scope, {"path": 1, "content": 1, "repo_id": 1}):
            low = d["content"].lower()
            sc = sum(low.count(t.lower()) for t in terms) + 3 * sum(t.lower() in d["path"].lower() for t in terms)
            if sc:
                scored.append((sc, d))
        hits = [d for _, d in sorted(scored, key=lambda x: -x[0])[:limit]]
    return hits


def github_agent(ctx: Ctx) -> list[dict]:
    rec, repo, sel = ctx.rec, ctx.repo, ctx.selection
    out: list[dict] = []
    try:
        keys_from: list[str] = []
        if ctx.kind == "why" and sel and repo:
            client = get_github_client(repos.provenance_token(ctx.p, repo))
            commits: list[dict] = []
            if client.authenticated:
                try:
                    with rec.tool("github", f"git blame {sel['path']} lines {sel['start_line']}-{sel['end_line']}"):
                        commits = client.blame(repo["full_name"], repo["branch"], sel["path"], sel["start_line"], sel["end_line"])
                except GitHubError as e:
                    log.info("blame unavailable, falling back to history: %s", e)
            if not commits:
                with rec.tool("github", f"list commits that touched {sel['path']}"):
                    commits = client.file_history(repo["full_name"], repo["branch"], sel["path"], 8)
                for c in commits[:4]:
                    try:
                        with rec.tool("github", f"find pull requests for commit {c['short']}"):
                            c["pulls"] = client.commit_pulls(repo["full_name"], c["sha"])
                    except GitHubError:
                        c["pulls"] = []
            prs: dict[int, dict] = {}
            for c in commits:
                for pr in c.get("pulls", []):
                    prs.setdefault(pr["number"], pr)
            out += [provenance.pr_finding(pr) for pr in list(prs.values())[:5]]
            out += [provenance.commit_finding(c, repo["full_name"]) for c in commits[:6]]
            keys_from = [c.get("message") for c in commits] + [x for pr in prs.values() for x in (pr["title"], pr["body"], pr.get("branch"))]
        else:
            by_id = {r["_id"]: r for r in ctx.search_repos}
            multi = len(by_id) > 1
            where = f" across {len(by_id)} repositories" if multi else ""
            query = " ".join(x for x in (ctx.question, sel["text"][:600] if sel else None) if x)
            with rec.tool("github", f"search indexed code{where} for: {ctx.question[:60]}") :
                found = codesearch.search(list(by_id), query, ctx.terms[:5])
            hits = found["hits"]
            how = {"semantic+rerank": f"semantic code search ({found['model']})", "semantic": f"semantic code search ({found['model']}, no reranker)",
                   "keyword": "keyword code search (semantic search not indexed yet)"}[found["mode"]]
            rec.note_tool("github", f"{how}: {len(hits)} code passage{'s' if len(hits) != 1 else ''}")
            seen_files: list[dict] = []
            for h in hits:
                r = by_id[h["repo_id"]]
                loc = f"{h['path']}:{h['start_line']}-{h['end_line']}"
                ref = f"{r['full_name']}:{loc}" if multi else loc
                out.append({"kind": "code", "ref": ref, "title": ref, "detail": clip(h["text"], 600),
                            "url": f"https://github.com/{r['full_name']}/blob/{r['branch']}/{h['path']}#L{h['start_line']}-L{h['end_line']}"})
                if all(x["path"] != h["path"] or x["repo_id"] != h["repo_id"] for x in seen_files):
                    seen_files.append(h)
            for h in seen_files[:2]:
                r = by_id[h["repo_id"]]
                try:
                    with rec.tool("github", f"recent commits touching {r['full_name'] + ':' if multi else ''}{h['path']}"):
                        client = get_github_client(repos.provenance_token(ctx.p, r))
                        for c in client.file_history(r["full_name"], r["branch"], h["path"], 3):
                            out.append(provenance.commit_finding(c, r["full_name"]))
                            keys_from.append(c.get("message"))
                except GitHubError:
                    pass
        ctx.ticket_keys = provenance.ticket_keys(ctx.question, sel["text"] if sel else None, *keys_from)
        return out
    finally:
        ctx.keys_ready.set()  # Jira/Confluence agents wait for this to follow ticket references found in git history


def jira_agent(ctx: Ctx) -> list[dict]:
    cfg, atl = ctx.atlassian
    rec, out, seen = ctx.rec, [], set()
    own_keys = provenance.ticket_keys(ctx.question, ctx.selection["text"] if ctx.selection else None)
    terms = ctx.terms[:4]
    if terms or own_keys:
        with rec.tool("jira", "search Jira: " + (", ".join(terms) or "(keys only)") + (f" + keys {', '.join(own_keys)}" if own_keys else "")):
            for i in atl.jira_search(terms, own_keys, limit=5):
                seen.add(i["key"])
                out.append(provenance.issue_finding(i))
    ctx.keys_ready.wait(KEYS_WAIT_SECONDS)
    new = [k for k in ctx.ticket_keys if k not in seen]
    if new:
        with rec.tool("jira", f"fetch tickets referenced in git history: {', '.join(new[:8])}"):
            for i in atl.jira_search([], new[:8], limit=8):
                if i["key"] not in seen:
                    seen.add(i["key"])
                    out.append(provenance.issue_finding(i))
    return out


def confluence_agent(ctx: Ctx) -> list[dict]:
    cfg, atl = ctx.atlassian
    rec, pages, seen = ctx.rec, [], set()

    def add(found: list[dict]) -> None:
        for pg in found:
            if pg["id"] not in seen:
                seen.add(pg["id"])
                pages.append(pg)

    terms = ctx.terms[:4]
    if terms:
        with rec.tool("confluence", "search Confluence: " + ", ".join(terms)):
            add(atl.confluence_search(terms, limit=4))
    ctx.keys_ready.wait(KEYS_WAIT_SECONDS)
    if ctx.ticket_keys:
        with rec.tool("confluence", f"search pages mentioning: {', '.join(ctx.ticket_keys[:6])}"):
            add(atl.confluence_search(ctx.ticket_keys[:6], limit=3))
    out = []
    for pg in pages[:4]:
        body = None
        try:
            with rec.tool("confluence", f"read page “{clip(pg['title'], 50)}”"):
                body = atl.confluence_page_text(pg["id"])
        except AtlassianError:
            pass
        out.append(provenance.page_finding(pg, body))
    return out


def memory_agent(ctx: Ctx) -> list[dict]:
    rec, p = ctx.rec, ctx.p
    sel = ctx.selection
    query = " ".join(x for x in (ctx.question, sel["path"] if sel else None, sel["text"][:600] if sel else None) if x)
    with rec.tool("memory", "governed $vectorSearch (tenant · approved · unexpired · scope)"):
        ctx.memdocs = retrieval.search(p, query, ctx=ctx.mctx, run_id=ctx.run["_id"])
    rec.set(**{"memory.retrieved": [{"memory_id": d["memory_id"], "version": d["version"], "title": d["title"], "score": round(d["score"], 4), "used": False}
                                     for d in ctx.memdocs]})
    excluded = retrieval.excluded_count(p, ctx.mctx)
    rec.note_tool("memory", f"policy withheld {excluded} memor{'y' if excluded == 1 else 'ies'} before they reach the model")
    rec.set(**{"memory.excluded": excluded})
    return [{"kind": "memory", "ref": f"{d['memory_id']}@v{d['version']}", "title": d["title"], "detail": clip(d["content"], 400), "url": None}
            for d in ctx.memdocs]


def _run_agent(ctx: Ctx, aid: str, fn: Callable[[Ctx], list[dict]]) -> None:
    rec = ctx.rec
    rec.agent(aid, status="running", started_at=iso(utcnow()))
    try:
        found = fn(ctx)
        ctx.findings_by_agent[aid] = found
        rec.findings(aid, found)
        kinds: dict[str, int] = {}
        for f in found:
            kinds[f["kind"]] = kinds.get(f["kind"], 0) + 1
        plural = {"memory": "memories"}
        summary = ", ".join(f"{n} {plural.get(k, k.replace('_', ' ') + 's') if n != 1 else k.replace('_', ' ')}" for k, n in kinds.items()) or "nothing relevant found"
        rec.agent(aid, status="done", summary=summary, finished_at=iso(utcnow()))
    except (GitHubError, AtlassianError) as e:
        log.warning("%s failed: %s", aid, e)
        rec.agent(aid, status="error", error=str(e), summary=f"Failed: {clip(str(e), 120)}", finished_at=iso(utcnow()))
    except Exception as e:
        log.exception("%s crashed", aid)
        rec.agent(aid, status="error", error=f"{type(e).__name__}: {e}", summary="Failed unexpectedly", finished_at=iso(utcnow()))
    finally:
        if aid == "github":
            ctx.keys_ready.set()


# ------------------------------------------------------------------ orchestration
def gather(p: Principal, run_id: str) -> Ctx:
    """Plan and run the sub-agents. Returns once all have finished (reasoning is separate)."""
    run = get_db().agent_runs.find_one({"_id": run_id})
    rec = Rec(run_id)
    repo = repos.get_repo(p, run["repo_id"]) if run.get("repo_id") else None
    group = groups.get_group(p, run["group_id"]) if run.get("group_id") else None
    sel = run.get("selection")
    terms = keywords(sel["text"] if sel else None, sel["path"].rsplit("/", 1)[-1].rsplit(".", 1)[0] if sel else None, run["question"], limit=6)
    ctx = Ctx(p=p, run=run, rec=rec, repo=repo, kind=run["kind"], question=run["question"], selection=sel, memory_enabled=run["memory_enabled"], terms=terms,
              group=group, mctx=groups.context(p, repo_id=None if group else (repo or {}).get("_id"), group_id=(group or {}).get("_id")))
    if group:
        ctx.search_repos = groups.member_repos(group)
        ctx.components = [{"id": n["id"], "path": f"{n['repo_name']}/{n['path']}".rstrip("/")} for n in groups.build_graph(group)["nodes"]]
    elif repo:
        ctx.search_repos = [repo]
        ctx.components = [{"id": n["id"], "path": n["path"]} for n in repos.graph(repo["_id"])["nodes"]]
    if repo:
        if sel:
            d = get_db().source_documents.find_one({"repo_id": repo["_id"], "path": sel["path"]}, {"content": 1})
            if d:
                lines = d["content"].splitlines()
                a, b = max(0, sel["start_line"] - 26), min(len(lines), sel["end_line"] + 25)
                ctx.file_context = "\n".join(f"{i + 1}: {ln}" for i, ln in enumerate(lines[a:b], start=a))
    ctx.atlassian = integ.atlassian_client(p.org_id)
    cfg = ctx.atlassian[0] if ctx.atlassian else None

    plan: dict[str, Callable[[Ctx], list[dict]]] = {}
    skipped: dict[str, str] = {}
    if ctx.search_repos and (repo or not (ctx.kind == "why" and sel)):
        plan["github"] = github_agent
    else:
        skipped["github"] = "No repository is connected for this workspace, so there is no git history to search."
        ctx.keys_ready.set()
    for aid, fn, flag in (("jira", jira_agent, "jira_ok"), ("confluence", confluence_agent, "confluence_ok")):
        if cfg and cfg.get(flag, True):
            plan[aid] = fn
        else:
            skipped[aid] = f"{aid.capitalize()} is not connected. Add Atlassian credentials in Settings → Integrations."
    if run["memory_enabled"]:
        plan["memory"] = memory_agent
    else:
        skipped["memory"] = "Governed memory is switched off for this run."
    for aid, why in skipped.items():
        rec.agent(aid, status="skipped", summary=why)
    rec.set(orchestrator={"status": "done", "plan": [a for a in AGENT_IDS if a in plan],
                          "note": f"Deploying {len(plan)} sub-agent{'s' if len(plan) != 1 else ''} in parallel" if plan else "No sources are available for this question"})
    if plan:
        with ThreadPoolExecutor(max_workers=len(plan)) as pool:
            for aid, fn in plan.items():
                pool.submit(_run_agent, ctx, aid, fn)
    return ctx


def _unique_evidence(ctx: Ctx) -> list[dict]:
    out, seen = [], set()
    for aid in ("github", "jira", "confluence"):
        for f in ctx.findings_by_agent.get(aid, []):
            ref = f["ref"]
            if ref in seen:
                ref = f"{ref} ({aid})"
            seen.add(ref)
            out.append({**f, "ref": ref})
    return out


def _memory_view(d: dict) -> dict:
    exp = d["expires_at"]
    return {"memory_ref": f"{d['memory_id']}@v{d['version']}", "title": d["title"], "content": d["content"], "type": d["memory_type"],
            "authority": d["authority"], "scope": d["scope"] + (f":{d['team']}" if d["scope"] == "team" else ""),
            "approved_by": (d.get("approved_by") or {}).get("name"), "expires": None if exp.year >= 9999 else iso(exp)}


def reason(ctx: Ctx, memory_enabled: bool) -> tuple[dict, str]:
    """One reasoning pass over the shared evidence. Returns (Answer, model name)."""
    evidence = _unique_evidence(ctx)
    memories = [_memory_view(d) for d in ctx.memdocs] if memory_enabled else []
    prompt = prompts.reasoning_prompt(kind=ctx.kind, question=ctx.question, selection=ctx.selection, file_context=ctx.file_context,
                                      components=ctx.components, evidence=evidence, memories=memories, memory_enabled=memory_enabled)
    llm = get_llm()
    raw = llm.structured(prompts.SYSTEM, prompt, LLMAnswer)
    return sanitize(raw, evidence={e["ref"] for e in evidence}, memory_refs={m["memory_ref"] for m in memories},
                    component_ids={c["id"] for c in ctx.components}), llm.model_name


def sanitize(raw: LLMAnswer, *, evidence: set[str], memory_refs: set[str], component_ids: set[str]) -> dict:
    """Nothing the model cites survives unless it was actually retrieved."""
    constraints = []
    seen: set[tuple] = set()
    for c in raw.constraints:
        ref = c.memory_ref.strip()
        if ref in memory_refs and (c.text, ref) not in seen and c.text.strip():
            seen.add((c.text, ref))
            constraints.append({"text": c.text.strip(), "memory_ref": ref})
    explanation = [x.strip() for x in raw.explanation if x.strip()] or [raw.headline]
    return {
        "headline": raw.headline.strip(), "explanation": explanation,
        "guidance": {"verdict": raw.verdict, "recommendation": raw.recommendation.strip(), "constraints": constraints,
                     "risks": [r.strip() for r in raw.risks if r.strip()]},
        "evidence_refs": [r for r in dict.fromkeys(x.strip() for x in raw.evidence_refs) if r in evidence],
        "affected_components": [c for c in dict.fromkeys(raw.affected_components) if c in component_ids],
        "confidence": raw.confidence,
    }


def finish(ctx: Ctx, answer: dict, model: str) -> None:
    cited = {c["memory_ref"] for c in answer["guidance"]["constraints"]}
    retrieved = [{"memory_id": d["memory_id"], "version": d["version"], "title": d["title"], "score": round(d["score"], 4),
                  "used": f"{d['memory_id']}@v{d['version']}" in cited} for d in ctx.memdocs] if ctx.memory_enabled else []
    ctx.rec.set(status="completed", answer=answer, finished_at=utcnow(), reasoning={"status": "done", "model": model},
                **{"memory.retrieved": retrieved})
    audit.record("agent.run", ctx.p, run_id=ctx.run["_id"], details={
        "kind": ctx.kind, "repo": ctx.run.get("repo_name"), "group": ctx.run.get("group_name"), "memory_enabled": ctx.memory_enabled, "verdict": answer["guidance"]["verdict"],
        "memory_used": sorted(cited), "model": model})


def fail(rec: Rec, msg: str, *, reasoning_error: bool = False) -> None:
    fields: dict[str, Any] = {"status": "failed", "error": msg, "finished_at": utcnow()}
    if reasoning_error:
        fields["reasoning.status"] = "error"
    rec.set(**fields)


def execute_run(p: Principal, run_id: str) -> None:
    rec = Rec(run_id)
    try:
        ctx = gather(p, run_id)
        rec.set(**{"reasoning.status": "running"})
        try:
            answer, model = reason(ctx, ctx.memory_enabled)
        except Exception as e:
            log.exception("reasoning failed")
            fail(rec, f"The reasoning model failed: {clip(str(e), 300)}", reasoning_error=True)
            return
        finish(ctx, answer, model)
    except Exception as e:
        log.exception("run crashed")
        fail(rec, f"Run failed: {clip(str(e), 300)}")


# ------------------------------------------------------------------ memory impact comparison
def start_compare(p: Principal, *, question: str, repo_id: str | None, selection: dict | None, background: bool = True,
                  group_id: str | None = None) -> str:
    kind = "why" if selection else "ask"
    run = create_run(p, kind=kind, question=question, repo_id=repo_id, selection=selection, memory_enabled=True, group_id=group_id)
    cid = new_id("cmp")
    get_db().compares.insert_one({"_id": cid, "tenant_id": p.org_id, "status": "running", "question": run["question"], "error": None,
                                  "evidence_run_id": run["_id"], "without_memory": None, "with_memory": None, "memories_used": [],
                                  "changed": None, "diff": [], "created_at": utcnow()})
    if background:
        threading.Thread(target=execute_compare, args=(p, cid, run["_id"]), daemon=True, name=cid).start()
    else:
        execute_compare(p, cid, run["_id"])
    return cid


def diff_answers(without: dict, with_: dict) -> tuple[bool, list[dict]]:
    rows = []
    if without["guidance"]["verdict"] != with_["guidance"]["verdict"]:
        rows.append({"field": "verdict", "without": without["guidance"]["verdict"], "with": with_["guidance"]["verdict"]})
    a = sorted({c["memory_ref"] for c in without["guidance"]["constraints"]})
    b = sorted({c["memory_ref"] for c in with_["guidance"]["constraints"]})
    if a != b:
        rows.append({"field": "constraints", "without": ", ".join(a) or "none", "with": ", ".join(b) or "none"})
    if rows:  # recommendation text always varies a little; show it only as context when the decision itself changed
        rows.append({"field": "recommendation", "without": without["guidance"]["recommendation"], "with": with_["guidance"]["recommendation"]})
    return bool(rows), rows


def execute_compare(p: Principal, compare_id: str, run_id: str) -> None:
    db, rec = get_db(), Rec(run_id)
    try:
        ctx = gather(p, run_id)
        rec.set(**{"reasoning.status": "running"})
        with ThreadPoolExecutor(max_workers=2) as pool:
            f_without = pool.submit(reason, ctx, False)
            f_with = pool.submit(reason, ctx, True)
            (without, _), (with_, model) = f_without.result(), f_with.result()
        finish(ctx, with_, model)
        changed, rows = diff_answers(without, with_)
        cited = {c["memory_ref"] for c in with_["guidance"]["constraints"]}
        used = [{"memory_id": d["memory_id"], "version": d["version"], "title": d["title"]} for d in ctx.memdocs if f"{d['memory_id']}@v{d['version']}" in cited]
        db.compares.update_one({"_id": compare_id}, {"$set": {"status": "completed", "without_memory": without, "with_memory": with_,
                                                              "memories_used": used, "changed": changed, "diff": [r for r in rows if r["field"] != "recommendation" or changed]}})
        audit.record("agent.compare", p, run_id=run_id, details={"compare_id": compare_id, "changed": changed,
                                                                 "verdict_without": without["guidance"]["verdict"], "verdict_with": with_["guidance"]["verdict"]})
    except Exception as e:
        log.exception("compare failed")
        fail(rec, f"Comparison failed: {clip(str(e), 300)}")
        db.compares.update_one({"_id": compare_id}, {"$set": {"status": "failed", "error": clip(str(e), 300)}})


def compare_api(doc: dict) -> dict:
    return {"id": doc["_id"], "status": doc["status"], "question": doc["question"], "error": doc.get("error"), "evidence_run_id": doc.get("evidence_run_id"),
            "without_memory": doc.get("without_memory"), "with_memory": doc.get("with_memory"), "memories_used": doc.get("memories_used", []),
            "changed": doc.get("changed"), "diff": doc.get("diff", [])}


# ------------------------------------------------------------------ proposing memory from an answer
def propose_memory(p: Principal, run_id: str) -> dict:
    require(p, "propose_memory")
    run = get_db().agent_runs.find_one({"_id": run_id, "tenant_id": p.org_id})
    if not run:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    ans = run.get("answer")
    if not ans:
        raise HTTPException(status.HTTP_409_CONFLICT, "This run has no answer to propose")
    refs = [{"type": "agent_run", "id": run_id, "label": f"ArchMind run on “{clip(run['question'], 60)}”", "url": None}]
    urls = {f["ref"]: f for a in run["agents"].values() for f in a["findings"] if f.get("url")}
    for r in ans["evidence_refs"][:4]:
        f = urls.get(r)
        if f:
            typ = {"issue": "jira", "page": "confluence"}.get(f["kind"], "github")
            refs.append({"type": typ, "id": r, "label": clip(f["title"], 100), "url": f["url"]})
    content = f"{ans['headline']}. {ans['guidance']['recommendation']}"
    scope = "group" if run.get("group_id") else "repo" if run.get("repo_id") else "org"
    doc = governance.propose(p, title=ans["headline"], content=content, memory_type="agent_experience", scope=scope,
                             repo_id=run.get("repo_id"), components=ans["affected_components"], source_refs=refs, authority="agent_observed",
                             force_pending=True, group_id=run.get("group_id"))
    get_db().agent_runs.update_one({"_id": run_id}, {"$set": {"proposed_memory_id": doc["memory_id"]}})
    return doc
