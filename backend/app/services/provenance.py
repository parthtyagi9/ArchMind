"""Turn GitHub/Jira/Confluence payloads into the Finding shape the UI and the reasoning agent share."""
from __future__ import annotations

import re

from app.integrations.atlassian import clip

TICKET_KEY = re.compile(r"\b([A-Z][A-Z0-9]{1,9}-\d{1,6})\b")


def commit_finding(c: dict, full_name: str) -> dict:
    who = c.get("author") or c.get("login") or "unknown"
    detail = f"{c['headline']}\n{who}, {(c.get('date') or '')[:10]}" + (f", lines {c['lines']}" if c.get("lines") else "")
    body = [ln for ln in (c.get("message") or "").splitlines()[1:] if ln.strip()]
    if body:
        detail += "\n" + clip(" ".join(body), 300)
    return {"kind": "commit", "ref": c["short"], "title": c["headline"], "detail": detail, "url": c.get("url") or f"https://github.com/{full_name}/commit/{c['sha']}"}


def pr_finding(pr: dict) -> dict:
    detail = clip(pr.get("body") or "", 500) or None
    merged = (pr.get("merged_at") or "")[:10]
    head = f"merged {merged}" if merged else "not merged"
    return {"kind": "pull_request", "ref": f"PR #{pr['number']}", "title": pr["title"], "detail": f"{head}\n{detail}" if detail else head, "url": pr["url"]}


def issue_finding(i: dict) -> dict:
    parts = [f"{i.get('type') or 'Issue'} · {i.get('status') or 'unknown status'}"]
    if i.get("description"):
        parts.append(i["description"])
    for c in i.get("comments", []):
        if c.get("text"):
            parts.append(f"{c.get('author') or 'someone'}: {c['text']}")
    return {"kind": "issue", "ref": i["key"], "title": i["summary"], "detail": "\n".join(parts), "url": i["url"]}


def page_finding(pg: dict, body: str | None) -> dict:
    parts = [pg.get("space") or ""]
    text = body or pg.get("excerpt") or ""
    if text:
        parts.append(text)
    return {"kind": "page", "ref": pg["title"], "title": pg["title"], "detail": "\n".join(x for x in parts if x) or None, "url": pg["url"]}


def ticket_keys(*texts: str | None) -> list[str]:
    seen: dict[str, None] = {}
    for t in texts:
        for m in TICKET_KEY.findall(t or ""):
            seen.setdefault(m)
    return list(seen)
