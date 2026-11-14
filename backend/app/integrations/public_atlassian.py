"""Discover public Jira projects/issues and Confluence spaces/pages from a link.

Public sources use anonymous REST APIs (including Server/Data Center paths).
Exact pages also support a public HTML fallback when REST is unavailable.
"""
from __future__ import annotations

import re
from html.parser import HTMLParser
from urllib.parse import parse_qs, quote, unquote, urlencode, urlsplit

import httpx

from app.integrations.atlassian import Atlassian, AtlassianError, _q, clip, html_to_text
from app.integrations.public_http import get_public, public_url

KEY = r"[A-Z][A-Z0-9_]*"


def parse_source(url: str) -> dict:
    url = public_url(url.strip())
    p = urlsplit(url)
    path = p.path.rstrip("/")
    origin = f"https://{p.netloc}"
    issue = re.fullmatch(rf"(.*)/browse/({KEY}-\d+)", path, re.I)
    project = re.fullmatch(rf"(.*)/(?:projects|plugins/servlet/project-config)/({KEY})(?:/.*)?", path, re.I)
    if issue or project:
        m = issue or project
        key = m[2].upper()
        # Jira Cloud's modern project UI adds routing segments, not an API context path.
        prefix = "" if m[1] in ("/jira/software/c", "/jira/software", "/jira/core") else m[1]
        base = origin + prefix
        return {"kind": "jira", "url": base + (f"/browse/{key}" if issue else f"/projects/{key}"), "base_url": base,
                "project": key.rsplit("-", 1)[0] if issue else key, "issue_key": key if issue else None,
                "space": None, "page_id": None, "page_title": None}
    display = re.fullmatch(r"(.*)/display/([^/]+)(?:/(.+))?", path)
    spaces = re.fullmatch(r"(.*)/spaces/([^/]+)(?:/(?:pages/(\d+)(?:/.*)?|overview))?", path)
    legacy_page = re.fullmatch(r"(.*)/pages/viewpage.action", path)
    if display or spaces or legacy_page:
        m = display or spaces or legacy_page
        page_id = spaces[3] if spaces else (parse_qs(p.query).get("pageId") or [None])[0] if legacy_page else None
        if legacy_page and (not page_id or not page_id.isdigit()):
            raise AtlassianError("That Confluence link needs a numeric pageId.", 422)
        space = unquote((display or spaces)[2]) if display or spaces else None
        if space and not re.fullmatch(r"[A-Za-z0-9_~-]+", space):
            raise AtlassianError("The Confluence space key is invalid.", 422)
        canonical = origin + path + (f"?pageId={page_id}" if legacy_page else "")
        return {"kind": "confluence", "url": canonical, "base_url": origin + m[1], "project": None, "issue_key": None,
                "space": space, "page_id": page_id, "page_title": unquote(display[3].replace("+", " ")) if display and display[3] else None}
    raise AtlassianError("Paste a Jira project/issue or Confluence space/page link, for example https://issues.apache.org/jira/projects/KAFKA.", 422)


def resolve_source(url: str) -> dict:
    """Confluence share links redirect to a normal page URL on public sites."""
    url = public_url(url.strip())
    if re.fullmatch(r".*/x/[A-Za-z0-9_-]+/?", urlsplit(url).path):
        response = get_public(url)
        url = str(response.url)
    return parse_source(url)


class PageContent(HTMLParser):
    """Extract product content, excluding navigation, scripts and login screens."""
    def __init__(self):
        super().__init__()
        self.depth = 0
        self.parts: list[str] = []
        self.title: list[str] = []
        self.in_title = False
        self.skip = 0
        self.login_form = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "input" and attrs.get("type", "").lower() == "password":
            self.login_form = True
        if tag in ("script", "style"):
            self.skip += 1
        if tag == "title":
            self.in_title = True
        if tag in ("br", "hr", "img", "input", "meta", "link"):
            return
        if self.depth:
            self.depth += 1
        elif attrs.get("id") in ("main-content", "description-val", "descriptionmodule"):
            self.depth = 1
        if self.depth and tag in ("p", "div", "li", "h1", "h2", "tr"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self.skip:
            self.skip -= 1
        if tag == "title":
            self.in_title = False
        if self.depth and tag not in ("br", "hr", "img", "input", "meta", "link"):
            self.depth -= 1

    def handle_data(self, data):
        if self.in_title:
            self.title.append(data)
        if self.depth and not self.skip:
            self.parts.append(data)


class PublicAtlassian:
    def __init__(self, source: dict, transport: httpx.BaseTransport | None = None):
        self.source = source
        self.base = source["base_url"]
        self.transport = transport

    def _get(self, path: str, params: dict | None = None) -> dict:
        url = self.base + path + (("?" + urlencode(params)) if params else "")
        r = get_public(url, transport=self.transport)
        if r.status_code in (401, 403):
            raise AtlassianError("This source requires sign-in or blocks anonymous access. For a private Atlassian Cloud site, use the private connection below.", r.status_code)
        if r.status_code >= 400:
            raise AtlassianError(f"The public source returned HTTP {r.status_code}.", r.status_code)
        try:
            data = r.json()
            if not isinstance(data, dict):
                raise ValueError
            return data
        except ValueError:
            raise AtlassianError("The source did not return public API data; it may require sign-in.", 502)

    def _html(self, url: str) -> tuple[str, str]:
        r = get_public(url, transport=self.transport)
        if r.status_code >= 400:
            raise AtlassianError(f"Cannot read this public page (HTTP {r.status_code}). It may require sign-in.", r.status_code)
        page = PageContent()
        page.feed(r.text)
        text = re.sub(r"\n\s*\n+", "\n\n", "".join(page.parts)).strip()
        if len(text) < 30 or page.login_form:
            raise AtlassianError("No readable public content was found. Check the link, or connect a private Atlassian Cloud account below.", 422)
        return "".join(page.title).strip(), text

    def _issue(self, key: str) -> dict:
        data = self._get(f"/rest/api/2/issue/{quote(key, safe='')}", {"fields": ",".join(Atlassian.JIRA_FIELDS)})
        if data.get("key", "").upper().rsplit("-", 1)[0] != self.source["project"]:
            raise AtlassianError("The issue is outside the connected project.", 422)
        return Atlassian._issue(data, self.base)

    def _page(self, page_id: str) -> dict:
        data = self._get(f"/rest/api/content/{quote(page_id, safe='')}", {"expand": "body.storage,space"})
        if not data.get("id") or not data.get("title") or "storage" not in data.get("body", {}):
            raise AtlassianError("The page has no readable public content.", 422)
        space = data.get("space", {}).get("key")
        if self.source.get("space") and space != self.source["space"]:
            raise AtlassianError("The page is outside the connected space.", 422)
        return data

    def _finding_page(self, data: dict) -> dict:
        link = data.get("_links", {}).get("webui", "")
        return {"id": str(data["id"]), "title": data["title"], "excerpt": clip(html_to_text(data.get("body", {}).get("storage", {}).get("value", "")), 1500),
                "space": data.get("space", {}).get("key") or self.source.get("space"),
                "url": self.base + link if link.startswith("/") else self.base + f"/pages/viewpage.action?pageId={data['id']}"}

    def probe(self) -> dict:
        """Validate access before persisting; keep only metadata, never page bodies."""
        s = dict(self.source)
        s.update({"access": "public", "search_available": True, "title": s.get("project") or s.get("space") or "Confluence page"})
        try:
            if s["kind"] == "jira":
                if s.get("issue_key"):
                    s["title"] = f"{s['issue_key']}: {self._issue(s['issue_key'])['summary']}"
                else:
                    data = self._get(f"/rest/api/2/project/{quote(s['project'], safe='')}")
                    if data.get("key", "").upper() != s["project"]:
                        raise AtlassianError("Jira did not return the requested public project.", 422)
                    s["title"] = data.get("name") or s["project"]
                # A readable item does not necessarily grant search access.
                results = self._get("/rest/api/2/search", {"jql": f'project = "{_q(s["project"])}"', "maxResults": 1, "fields": "summary"})
                if not isinstance(results.get("issues"), list):
                    raise AtlassianError("Public Jira search is unavailable on this site.", 502)
            else:
                if s.get("page_title") and not s.get("page_id"):
                    data = self._get("/rest/api/content", {"spaceKey": s["space"], "title": s["page_title"], "expand": "body.storage,space", "limit": 1})
                    pages = data.get("results", [])
                    if not pages:
                        raise AtlassianError("Confluence page not found in that space.", 404)
                    s["page_id"] = str(pages[0]["id"])
                if s.get("page_id"):
                    data = self._page(s["page_id"])
                    s["space"] = data.get("space", {}).get("key") or s.get("space")
                    s["title"] = data["title"]
                else:
                    data = self._get(f"/rest/api/space/{quote(s['space'], safe='')}")
                    if data.get("key") != s["space"]:
                        raise AtlassianError("Confluence did not return the requested public space.", 422)
                    s["title"] = data.get("name") or s["space"]
                results = self._get("/rest/api/search", {"cql": f'type = page AND space = "{_q(s["space"])}"', "limit": 1})
                if not isinstance(results.get("results"), list):
                    raise AtlassianError("Public Confluence search is unavailable on this site.", 502)
        except AtlassianError:
            # Exact issue/page links can remain useful when a site blocks REST/search.
            # Never advertise a project/space as searchable unless search succeeded.
            if not (s.get("issue_key") or s.get("page_id") or s.get("page_title")):
                raise
            title, _ = self._html(s["url"])
            s.update({"title": title or s["title"], "search_available": False})
        return s

    def jira_search(self, terms: list[str], keys: list[str] | None = None, limit: int = 5) -> list[dict]:
        s = self.source
        if not s.get("search_available", True):
            title, text = self._html(s["url"])
            return [{"key": s["issue_key"], "summary": title, "description": clip(text, 1400), "status": None, "type": "Issue", "comments": [], "url": s["url"]}]
        matching = [k for k in keys or [] if re.fullmatch(rf'{re.escape(s["project"])}-\d+', k)]
        if s.get("issue_key"):
            matching.insert(0, s["issue_key"])
        out = []
        for key in dict.fromkeys(matching[:limit]):
            try:
                out.append(self._issue(key))
            except AtlassianError as e:
                if e.status != 404:
                    raise
        if terms and len(out) < limit:
            jql = f'project = "{_q(s["project"])}" AND (' + " OR ".join(f'text ~ "{_q(t)}"' for t in terms[:4]) + ") ORDER BY updated DESC"
            data = self._get("/rest/api/2/search", {"jql": jql, "maxResults": limit, "fields": ",".join(Atlassian.JIRA_FIELDS)})
            seen = {i["key"] for i in out}
            out += [Atlassian._issue(i, self.base) for i in data.get("issues", []) if i.get("key") not in seen and i.get("key", "").rsplit("-", 1)[0] == s["project"]]
        return out[:limit]

    def confluence_search(self, terms: list[str], limit: int = 4, links: list[str] | None = None) -> list[dict]:
        s = self.source
        if not s.get("search_available", True):
            title, text = self._html(s["url"])
            return [{"id": s.get("page_id") or s["url"], "title": title, "excerpt": clip(text, 1500), "space": s.get("space"), "url": s["url"]}]
        out = [self._finding_page(self._page(s["page_id"]))] if s.get("page_id") else []
        for url in (links or [])[:4]:
            try:
                target = parse_source(url)
            except AtlassianError:
                continue
            if target["kind"] != "confluence" or target["base_url"] != self.base or (target.get("space") and target["space"] != s["space"]):
                continue
            try:
                if target.get("page_id"):
                    out.append(self._finding_page(self._page(target["page_id"])))
                elif target.get("page_title"):
                    data = self._get("/rest/api/content", {"spaceKey": s["space"], "title": target["page_title"], "expand": "body.storage,space", "limit": 1})
                    out += [self._finding_page(d) for d in data.get("results", [])]
            except AtlassianError as e:
                # A stale link or another space must not suppress valid scoped search.
                if e.status not in (404, 422):
                    raise
        if terms:
            cql = f'type = page AND space = "{_q(s["space"])}" AND (' + " OR ".join(f'text ~ "{_q(t)}"' for t in terms[:6]) + ")"
            data = self._get("/rest/api/search", {"cql": cql, "limit": limit})
            for row in data.get("results", []):
                d = row.get("content", {})
                if d.get("id"):
                    out.append(self._finding_page(d))
        return list({p["id"]: p for p in reversed(out)}.values())[::-1][:limit]

    def confluence_page_text(self, page_id: str, max_chars: int = 1500) -> str:
        if not self.source.get("search_available", True):
            return clip(self._html(self.source["url"])[1], max_chars)
        return clip(html_to_text(self._page(page_id)["body"]["storage"]["value"]), max_chars)


def get_public_atlassian(source: dict) -> PublicAtlassian:
    return PublicAtlassian(source)
