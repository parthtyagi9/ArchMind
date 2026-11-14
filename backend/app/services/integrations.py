"""Stored integration credentials. Secrets are encrypted at rest and never returned by the API."""
from __future__ import annotations

from app.db import get_db, iso, utcnow
from app.integrations import atlassian as atl
from app.integrations.atlassian import Atlassian
from app.security import decrypt


def github_token(user_id: str | None) -> str | None:
    if not user_id:
        return None
    u = get_db().users.find_one({"_id": user_id}, {"github": 1}) or {}
    return decrypt((u.get("github") or {}).get("token_enc"))


def github_status(user_id: str) -> dict:
    from app.config import get_settings

    gh = (get_db().users.find_one({"_id": user_id}) or {}).get("github") or {}
    return {"connected": bool(decrypt(gh.get("token_enc"))), "login": gh.get("login"), "oauth_configured": get_settings().github_oauth_configured}


def atlassian_config(org_id: str) -> dict | None:
    return get_db().integrations.find_one({"_id": f"{org_id}:atlassian"})


def atlassian_status(org_id: str) -> dict:
    c = atlassian_config(org_id)
    if not c:
        return {"connected": False, "base_url": None, "email": None, "jira_projects": [], "confluence_spaces": [], "status": None, "error": None,
                "jira_available": False, "confluence_available": False}
    return {"connected": True, "base_url": c["base_url"], "email": c["email"], "jira_projects": c.get("jira_projects", []),
            "confluence_spaces": c.get("confluence_spaces", []), "status": c.get("status"), "error": c.get("error"),
            "jira_available": c.get("jira_ok", True), "confluence_available": c.get("confluence_ok", True)}


def atlassian_client(org_id: str) -> tuple[dict, Atlassian] | None:
    c = atlassian_config(org_id)
    token = decrypt(c.get("token_enc")) if c else None
    if not c or not token:
        return None
    return c, atl.get_atlassian(c, token)


def save_atlassian(org_id: str, user_id: str, *, base_url: str, email: str, token_enc: str, jira_projects: list[str],
                   confluence_spaces: list[str], products: dict) -> None:
    get_db().integrations.update_one(
        {"_id": f"{org_id}:atlassian"},
        {"$set": {"org_id": org_id, "type": "atlassian", "base_url": base_url, "email": email, "token_enc": token_enc,
                  "jira_projects": jira_projects, "confluence_spaces": confluence_spaces, "status": "ok", "error": None,
                  "jira_ok": products["jira"], "confluence_ok": products["confluence"], "updated_by": user_id, "updated_at": utcnow()}},
        upsert=True)


def public_sources(org_id: str, repo_id: str | None = None, *, for_run: bool = False) -> list[dict]:
    q: dict = {"org_id": org_id, "type": "public_atlassian"}
    if for_run:
        q["repo_id"] = {"$in": [None, repo_id]} if repo_id else None
    return list(get_db().integrations.find(q).sort("created_at", 1))


def public_source_api(source: dict) -> dict:
    fields = ("kind", "url", "base_url", "title", "repo_id", "project", "space", "search_available", "access")
    return {"id": source["_id"], **{key: source.get(key) for key in fields}, "created_at": iso(source["created_at"])}


def save_public_source(org_id: str, user_id: str, source: dict, repo_id: str | None) -> dict:
    db = get_db()
    # Canonical URL + attachment identifies a connection. Updating it re-checks access.
    import hashlib

    sid = "src_" + hashlib.sha256(f"{org_id}|{repo_id}|{source['url']}".encode()).hexdigest()[:24]
    now = utcnow()
    db.integrations.update_one({"_id": sid, "org_id": org_id}, {
        "$set": {**source, "type": "public_atlassian", "org_id": org_id, "repo_id": repo_id, "updated_by": user_id, "updated_at": now},
        "$setOnInsert": {"created_at": now},
    }, upsert=True)
    return db.integrations.find_one({"_id": sid, "org_id": org_id})
