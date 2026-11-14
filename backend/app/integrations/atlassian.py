"""Jira + Confluence (Atlassian Cloud) over REST with Basic auth (account email + API token)."""
from __future__ import annotations

import re
from html.parser import HTMLParser

import httpx


class AtlassianError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


# ------------------------------------------------------------------ text helpers
def adf_to_text(node) -> str:
    """Atlassian Document Format (Jira Cloud descriptions/comments) -> plain text."""
    if node is None:
        return ""
    if isinstance(node, str):
        return node
    if isinstance(node, list):
        return "".join(adf_to_text(n) for n in node)
    t = node.get("type")
    if t == "text":
        return node.get("text", "")
    if t == "hardBreak":
        return "\n"
    inner = adf_to_text(node.get("content"))
    if t in ("paragraph", "heading", "codeBlock", "blockquote", "listItem", "tableRow"):
        return inner.strip() + "\n"
    return inner


class _Strip(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data):
        self.parts.append(data)

    def handle_starttag(self, tag, attrs):
        if tag in ("p", "br", "li", "h1", "h2", "h3", "h4", "tr"):
            self.parts.append("\n")


def html_to_text(html: str) -> str:
    p = _Strip()
    p.feed(html or "")
    return re.sub(r"\n\s*\n+", "\n\n", re.sub(r"[ \t]+", " ", "".join(p.parts))).strip()


def _q(term: str) -> str:
    return term.replace("\\", "\\\\").replace('"', '\\"')


def clip(s: str, n: int) -> str:
    s = (s or "").strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


# ------------------------------------------------------------------ client
class Atlassian:
    def __init__(self, base_url: str, email: str, token: str, *, jira_projects: list[str] | None = None,
                 confluence_spaces: list[str] | None = None, transport: httpx.BaseTransport | None = None):
        self.base = base_url.rstrip("/")
        self.jira_projects = [p for p in (jira_projects or []) if p]
        self.confluence_spaces = [s for s in (confluence_spaces or []) if s]
        self._http = httpx.Client(base_url=self.base, auth=(email, token), timeout=30, follow_redirects=True, transport=transport,
                                  headers={"Accept": "application/json", "User-Agent": "ArchMind"})

    def _get(self, path: str, **kw) -> dict:
        return self._send("GET", path, **kw)

    def _send(self, method: str, path: str, **kw) -> dict:
        try:
            r = self._http.request(method, path, **kw)
        except httpx.HTTPError as e:
            raise AtlassianError(f"Could not reach {self.base}: {e}") from e
        if r.status_code == 401:
            raise AtlassianError("Atlassian rejected the email/API token", 401)
        if r.status_code == 403:
            raise AtlassianError("The Atlassian account lacks permission for that resource", 403)
        if r.status_code >= 400:
            raise AtlassianError(f"Atlassian returned {r.status_code}: {clip(r.text, 160)}", r.status_code)
        return r.json() if r.content else {}

    # -------------------------------------------------------------- validation
    def validate(self) -> dict:
        """Returns {"jira": bool, "confluence": bool}. Raises only when neither product is reachable."""
        res = {"jira": False, "confluence": False}
        errors: list[str] = []
        try:
            self._get("/rest/api/3/myself")
            res["jira"] = True
        except AtlassianError as e:
            errors.append(f"Jira: {e}")
        try:
            self._get("/wiki/rest/api/space", params={"limit": 1})
            res["confluence"] = True
        except AtlassianError as e:
            errors.append(f"Confluence: {e}")
        if not any(res.values()):
            raise AtlassianError("; ".join(errors))
        return res

    # -------------------------------------------------------------- Jira
    @staticmethod
    def _issue(d: dict, base: str) -> dict:
        f = d.get("fields", {})
        comments = [{"author": (c.get("author") or {}).get("displayName"), "text": clip(adf_to_text(c.get("body")), 400)}
                    for c in ((f.get("comment") or {}).get("comments") or [])[-3:]]
        return {"key": d["key"], "summary": f.get("summary", ""), "status": (f.get("status") or {}).get("name"),
                "type": (f.get("issuetype") or {}).get("name"), "description": clip(adf_to_text(f.get("description")), 900),
                "comments": comments, "updated": f.get("updated"), "url": f"{base}/browse/{d['key']}"}

    JIRA_FIELDS = ["summary", "status", "issuetype", "description", "comment", "updated"]

    def jira_search(self, terms: list[str], keys: list[str] | None = None, limit: int = 5) -> list[dict]:
        clauses = [f'text ~ "{_q(t)}"' for t in terms if t]
        if keys:
            clauses.append("key in (" + ",".join(k for k in keys if re.fullmatch(r"[A-Z][A-Z0-9_]+-\d+", k)) + ")")
        clauses = [c for c in clauses if not c.endswith("()")]
        if not clauses:
            return []
        jql = "(" + " OR ".join(clauses) + ")"
        if self.jira_projects:
            jql = f"project in ({','.join(self.jira_projects)}) AND {jql}"
        jql += " ORDER BY updated DESC"
        body = {"jql": jql, "maxResults": limit, "fields": self.JIRA_FIELDS}
        try:
            data = self._send("POST", "/rest/api/3/search/jql", json=body)
        except AtlassianError as e:
            if e.status not in (404, 410):
                raise
            data = self._send("POST", "/rest/api/3/search", json=body)  # older sites
        return [self._issue(i, self.base) for i in data.get("issues", [])]

    # -------------------------------------------------------------- Confluence
    def confluence_search(self, terms: list[str], limit: int = 4) -> list[dict]:
        clauses = " OR ".join(f'text ~ "{_q(t)}"' for t in terms if t)
        if not clauses:
            return []
        cql = f"type = page AND ({clauses})"
        if self.confluence_spaces:
            cql += " AND space in (" + ",".join(f'"{_q(s)}"' for s in self.confluence_spaces) + ")"
        data = self._get("/wiki/rest/api/search", params={"cql": cql, "limit": limit, "excerpt": "highlight"})
        out = []
        for r in data.get("results", []):
            c = r.get("content") or {}
            if not c.get("id"):
                continue
            webui = (c.get("_links") or {}).get("webui") or r.get("url", "")
            out.append({"id": c["id"], "title": r.get("title") or c.get("title", ""), "excerpt": clip(html_to_text(r.get("excerpt", "")), 400),
                        "space": (r.get("resultGlobalContainer") or {}).get("title"), "url": f"{self.base}/wiki{webui}" if webui.startswith("/") else webui,
                        "updated": r.get("lastModified")})
        return out

    def confluence_page_text(self, page_id: str, max_chars: int = 1500) -> str:
        d = self._get(f"/wiki/rest/api/content/{page_id}", params={"expand": "body.storage"})
        return clip(html_to_text(((d.get("body") or {}).get("storage") or {}).get("value", "")), max_chars)


def get_atlassian(cfg: dict, token: str) -> Atlassian:
    """Indirection so tests can swap in a fake."""
    return Atlassian(cfg["base_url"], cfg["email"], token, jira_projects=cfg.get("jira_projects"), confluence_spaces=cfg.get("confluence_spaces"))
