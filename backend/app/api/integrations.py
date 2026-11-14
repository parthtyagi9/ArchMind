from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app import audit
from app.db import get_db
from app.deps import Principal, current_principal, require
from app.integrations import atlassian as atl
from app.integrations import public_atlassian as public_atl
from app.security import encrypt
from app.services import integrations as svc

router = APIRouter(prefix="/integrations", tags=["integrations"])


class AtlassianIn(BaseModel):
    base_url: str
    email: str
    api_token: str
    jira_projects: list[str] = []
    confluence_spaces: list[str] = []


def _status(p: Principal) -> dict:
    return {"github": svc.github_status(p.user_id), "atlassian": svc.atlassian_status(p.org_id),
            "public_sources": [svc.public_source_api(s) for s in svc.public_sources(p.org_id)]}


@router.get("")
def get_integrations(p: Principal = Depends(current_principal)) -> dict:
    return _status(p)


class PublicSourceIn(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    repo_id: str | None = None


@router.post("/sources")
def connect_public_source(body: PublicSourceIn, p: Principal = Depends(current_principal)) -> dict:
    require(p, "manage_integrations")
    if body.repo_id:
        from app.services.repos import get_repo

        get_repo(p, body.repo_id)
    try:
        parsed = public_atl.resolve_source(body.url)
        existing = svc.public_sources(p.org_id)
        if len(existing) >= 20 and not any(s["url"] == parsed["url"] and s.get("repo_id") == body.repo_id for s in existing):
            raise HTTPException(status.HTTP_409_CONFLICT, "Disconnect an unused source before adding another (limit 20).")
        source = public_atl.get_public_atlassian(parsed).probe()
    except atl.AtlassianError as e:
        # Upstream authorization is not an expired ArchMind session (401).
        code = 422 if e.status == 422 else 409 if e.status in (401, 403) else 502
        raise HTTPException(code, str(e))
    saved = svc.save_public_source(p.org_id, p.user_id, source, body.repo_id)
    audit.record("integration.public_connected", p, details={"source_id": saved["_id"], "kind": source["kind"], "repo_id": body.repo_id})
    return svc.public_source_api(saved)


@router.delete("/sources/{source_id}")
def disconnect_public_source(source_id: str, p: Principal = Depends(current_principal)) -> dict:
    require(p, "manage_integrations")
    result = get_db().integrations.delete_one({"_id": source_id, "org_id": p.org_id, "type": "public_atlassian"})
    if not result.deleted_count:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source not found")
    audit.record("integration.public_disconnected", p, details={"source_id": source_id})
    return {"ok": True}


@router.put("/atlassian")
def put_atlassian(body: AtlassianIn, p: Principal = Depends(current_principal)) -> dict:
    require(p, "manage_integrations")
    base = body.base_url.strip().rstrip("/")
    if not re.fullmatch(r"https://[A-Za-z0-9.-]+\.atlassian\.net", base):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Site URL must look like https://your-team.atlassian.net")
    if not body.api_token.strip() or "@" not in body.email:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Email and API token are required")
    try:
        products = atl.Atlassian(base, body.email.strip(), body.api_token.strip()).validate()
    except atl.AtlassianError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))
    svc.save_atlassian(p.org_id, p.user_id, base_url=base, email=body.email.strip(), token_enc=encrypt(body.api_token.strip()),
                       jira_projects=[x.strip().upper() for x in body.jira_projects if x.strip()],
                       confluence_spaces=[x.strip() for x in body.confluence_spaces if x.strip()], products=products)
    audit.record("integration.atlassian_connected", p, details={"base_url": base, "jira": products["jira"], "confluence": products["confluence"]})
    return svc.atlassian_status(p.org_id)


@router.delete("/atlassian")
def delete_atlassian(p: Principal = Depends(current_principal)) -> dict:
    require(p, "manage_integrations")
    get_db().integrations.delete_one({"_id": f"{p.org_id}:atlassian"})
    audit.record("integration.atlassian_disconnected", p)
    return {"ok": True}


@router.delete("/github")
def delete_github(p: Principal = Depends(current_principal)) -> dict:
    get_db().users.update_one({"_id": p.user_id}, {"$set": {"github": None}})
    audit.record("integration.github_unlinked", p)
    return {"ok": True}
