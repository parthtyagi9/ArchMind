from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field

from app.api.auth import _set_cookie
from app.db import get_db
from app.deps import Principal, current_principal, require
from app.services import accounts

router = APIRouter(prefix="/org", tags=["org"])


class OrgIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class MemberPatch(BaseModel):
    role: str | None = None
    team: str | None = None


class InviteIn(BaseModel):
    role: str = "member"
    team: str | None = None
    expires_days: int = 7


@router.post("")
def create_org(body: OrgIn, response: Response, p: Principal = Depends(current_principal)) -> dict:
    org = accounts.create_org(p.user_id, body.name)
    accounts.switch_org(p.user_id, org["_id"])
    _set_cookie(response, p.user_id, org["_id"])
    return accounts.me_payload(get_db().users.find_one({"_id": p.user_id}), org["_id"])


@router.get("/members")
def members(p: Principal = Depends(current_principal)) -> list[dict]:
    return accounts.list_members(p.org_id)


@router.patch("/members/{user_id}")
def patch_member(user_id: str, body: MemberPatch, p: Principal = Depends(current_principal)) -> dict:
    require(p, "manage_members")
    return accounts.update_member(p, user_id, body.role, body.team, "team" in body.model_fields_set)


@router.delete("/members/{user_id}")
def delete_member(user_id: str, p: Principal = Depends(current_principal)) -> dict:
    require(p, "manage_members")
    accounts.remove_member(p, user_id)
    return {"ok": True}


@router.get("/invites")
def invites(p: Principal = Depends(current_principal)) -> list[dict]:
    require(p, "manage_integrations")
    return accounts.list_invites(p.org_id)


@router.post("/invites")
def create_invite(body: InviteIn, p: Principal = Depends(current_principal)) -> dict:
    require(p, "manage_integrations")
    return accounts.create_invite(p, body.role, body.team, body.expires_days)


@router.delete("/invites/{code}")
def delete_invite(code: str, p: Principal = Depends(current_principal)) -> dict:
    require(p, "manage_integrations")
    get_db().invites.delete_one({"_id": code, "org_id": p.org_id})
    return {"ok": True}
