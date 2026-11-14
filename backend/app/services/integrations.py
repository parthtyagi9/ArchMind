"""Stored integration credentials. Secrets are encrypted at rest and never returned by the API."""
from __future__ import annotations

from app.db import get_db, utcnow
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
        return {"connected": False, "base_url": None, "email": None, "jira_projects": [], "confluence_spaces": [], "status": None, "error": None}
    return {"connected": True, "base_url": c["base_url"], "email": c["email"], "jira_projects": c.get("jira_projects", []),
            "confluence_spaces": c.get("confluence_spaces", []), "status": c.get("status"), "error": c.get("error")}


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
