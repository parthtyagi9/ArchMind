"""GitHub client: repository metadata, archive download (for indexing), line-level blame (GraphQL),
file history and pull requests (REST). Works unauthenticated for public repositories (60 req/h), which is
why indexing downloads one tarball instead of one API call per file."""
from __future__ import annotations

import io
import tarfile
from urllib.parse import quote
from dataclasses import dataclass
from typing import Iterator

import httpx

API = "https://api.github.com"

BLAME_QUERY = """
query($owner:String!,$name:String!,$ref:String!,$path:String!){
  repository(owner:$owner,name:$name){
    object(expression:$ref){
      ... on Commit{
        blame(path:$path){
          ranges{
            startingLine endingLine
            commit{
              oid abbreviatedOid messageHeadline message committedDate url
              author{ name user{ login } }
              associatedPullRequests(first:3){ nodes{ number title url bodyText mergedAt headRefName } }
            }
          }
        }
      }
    }
  }
}"""


class GitHubError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


@dataclass
class ArchiveFile:
    path: str
    data: bytes


class GitHubClient:
    def __init__(self, token: str | None = None, transport: httpx.BaseTransport | None = None):
        headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ArchMind"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        self.authenticated = bool(token)
        self._http = httpx.Client(base_url=API, headers=headers, timeout=40, follow_redirects=True, transport=transport)
        self._raw_http = httpx.Client(timeout=30, follow_redirects=True, transport=transport)

    # -------------------------------------------------------------- plumbing
    def _request(self, method: str, path: str, **kw) -> httpx.Response:
        try:
            r = self._http.request(method, path, **kw)
        except httpx.HTTPError as e:
            raise GitHubError(f"Could not reach GitHub: {e}") from e
        if r.status_code in (401,):
            raise GitHubError("GitHub rejected the access token. Link GitHub again in Settings.", 401)
        if r.status_code == 403 and r.headers.get("x-ratelimit-remaining") == "0":
            raise GitHubError("GitHub API rate limit reached" + ("" if self.authenticated else ". Link GitHub for a higher limit."), 429)
        if r.status_code == 404:
            raise GitHubError("Not found on GitHub (it may be private: link GitHub with repo access)", 404)
        if r.status_code >= 400:
            raise GitHubError(f"GitHub returned {r.status_code}: {r.text[:160]}", r.status_code)
        return r

    # -------------------------------------------------------------- repositories
    def repo(self, full_name: str) -> dict:
        d = self._request("GET", f"/repos/{full_name}").json()
        return {"full_name": d["full_name"], "private": d["private"], "default_branch": d["default_branch"],
                "description": d.get("description"), "updated_at": d.get("pushed_at") or d.get("updated_at")}

    def user_repos(self, q: str | None = None, limit: int = 100) -> list[dict]:
        out: list[dict] = []
        for page in (1, 2, 3):
            r = self._request("GET", "/user/repos", params={"per_page": 100, "page": page, "sort": "pushed",
                                                            "affiliation": "owner,collaborator,organization_member"})
            items = r.json()
            out += [{"full_name": d["full_name"], "private": d["private"], "default_branch": d["default_branch"],
                     "description": d.get("description"), "updated_at": d.get("pushed_at")} for d in items]
            if len(items) < 100:
                break
        if q:
            ql = q.lower()
            out = [d for d in out if ql in d["full_name"].lower() or ql in (d["description"] or "").lower()]
        return out[:limit]

    def tree(self, full_name: str, ref: str) -> tuple[list[dict], bool]:
        """Every blob in the repo at `ref` with its size: one API call. Returns (entries, truncated)."""
        d = self._request("GET", f"/repos/{full_name}/git/trees/{ref}", params={"recursive": "1"}).json()
        return [{"path": e["path"], "size": e.get("size", 0), "sha": e["sha"]} for e in d.get("tree", []) if e["type"] == "blob"], bool(d.get("truncated"))

    def raw(self, full_name: str, ref: str, path: str) -> bytes:
        """File bytes from raw.githubusercontent.com (not subject to the REST API rate limit; token works for private repos)."""
        headers = {"User-Agent": "ArchMind"}
        auth = self._http.headers.get("Authorization")
        if auth:
            headers["Authorization"] = auth
        try:
            r = self._raw_http.get(f"https://raw.githubusercontent.com/{full_name}/{ref}/{quote(path)}", headers=headers)
        except httpx.HTTPError as e:
            raise GitHubError(f"Could not download {path}: {e}") from e
        if r.status_code >= 400:
            raise GitHubError(f"GitHub returned {r.status_code} for {path}", r.status_code)
        return r.content

    def archive(self, full_name: str, ref: str, max_bytes: int) -> Iterator[ArchiveFile]:
        """Stream the repo tarball and yield regular files (top-level directory stripped)."""
        # Anonymous: codeload serves public repos without touching the 60 req/h API limit. Authenticated: the API
        # tarball endpoint, which also works for private repositories.
        url = f"/repos/{full_name}/tarball/{ref}" if self.authenticated else f"https://codeload.github.com/{full_name}/tar.gz/{ref}"
        try:
            with self._http.stream("GET", url) as r:
                if r.status_code == 404:
                    raise GitHubError("Repository or branch not found (private repositories need a linked GitHub account)", 404)
                if r.status_code >= 400:
                    raise GitHubError(f"GitHub returned {r.status_code} while downloading the repository", r.status_code)
                buf = io.BytesIO()
                for chunk in r.iter_bytes():
                    buf.write(chunk)
                    if buf.tell() > max_bytes:
                        raise GitHubError(f"Repository archive is larger than {max_bytes // 1_000_000} MB", 413)
        except httpx.HTTPError as e:
            raise GitHubError(f"Could not download the repository: {e}") from e
        buf.seek(0)
        with tarfile.open(fileobj=buf, mode="r:gz") as tf:
            for m in tf:
                if not m.isfile():
                    continue
                parts = m.name.split("/", 1)
                if len(parts) < 2:
                    continue
                f = tf.extractfile(m)
                if f is not None:
                    yield ArchiveFile(parts[1], f.read(m.size) if m.size <= 2_000_000 else b"")

    # -------------------------------------------------------------- provenance
    def blame(self, full_name: str, ref: str, path: str, start: int, end: int) -> list[dict]:
        """Commits (with their pull requests) that last touched lines start..end. Requires a token (GraphQL)."""
        owner, name = full_name.split("/", 1)
        r = self._request("POST", "/graphql", json={"query": BLAME_QUERY, "variables": {"owner": owner, "name": name, "ref": ref, "path": path}})
        body = r.json()
        if body.get("errors"):
            raise GitHubError("GitHub blame failed: " + body["errors"][0].get("message", "unknown error"))
        obj = ((body.get("data") or {}).get("repository") or {}).get("object") or {}
        ranges = (obj.get("blame") or {}).get("ranges") or []
        seen: dict[str, dict] = {}
        for rg in ranges:
            if rg["endingLine"] < start or rg["startingLine"] > end:
                continue
            c = rg["commit"]
            if c["oid"] in seen:
                continue
            seen[c["oid"]] = {
                "sha": c["oid"], "short": c["abbreviatedOid"], "headline": c["messageHeadline"], "message": c["message"],
                "date": c["committedDate"], "url": c["url"], "author": (c.get("author") or {}).get("name"),
                "login": ((c.get("author") or {}).get("user") or {}).get("login"),
                "lines": f"{rg['startingLine']}-{rg['endingLine']}",
                "pulls": [{"number": n["number"], "title": n["title"], "url": n["url"], "body": n.get("bodyText") or "",
                           "merged_at": n.get("mergedAt"), "branch": n.get("headRefName")}
                          for n in (c.get("associatedPullRequests") or {}).get("nodes") or []],
            }
        return list(seen.values())

    def file_history(self, full_name: str, ref: str, path: str, limit: int = 8) -> list[dict]:
        """Commits that touched `path`, newest first (REST; works without a token for public repos)."""
        r = self._request("GET", f"/repos/{full_name}/commits", params={"sha": ref, "path": path, "per_page": limit})
        return [{"sha": c["sha"], "short": c["sha"][:7], "headline": c["commit"]["message"].splitlines()[0],
                 "message": c["commit"]["message"], "date": c["commit"]["author"]["date"], "url": c["html_url"],
                 "author": c["commit"]["author"]["name"], "login": (c.get("author") or {}).get("login"), "lines": None, "pulls": []}
                for c in r.json()]

    def commit_pulls(self, full_name: str, sha: str) -> list[dict]:
        r = self._request("GET", f"/repos/{full_name}/commits/{sha}/pulls", params={"per_page": 3})
        return [{"number": n["number"], "title": n["title"], "url": n["html_url"], "body": n.get("body") or "",
                 "merged_at": n.get("merged_at"), "branch": (n.get("head") or {}).get("ref")} for n in r.json()]


def get_github_client(token: str | None = None) -> GitHubClient:
    """Indirection so tests can swap in a fake."""
    return GitHubClient(token)
