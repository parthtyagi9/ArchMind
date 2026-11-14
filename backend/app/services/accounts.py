"""Users, organizations, memberships and invites."""
from __future__ import annotations

import re
import secrets
from datetime import timedelta

from fastapi import HTTPException, status
from pymongo.errors import DuplicateKeyError

from app import audit
from app.db import get_db, iso, new_id, utcnow
from app.deps import PERMISSIONS, Principal
from app.security import hash_password, verify_password

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _norm_email(email: str) -> str:
    e = (email or "").strip().lower()
    if not EMAIL_RE.match(e):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Enter a valid email address")
    return e


def create_org(user_id: str, name: str, *, role: str = "owner") -> dict:
    db = get_db()
    org = {"_id": new_id("org"), "name": name.strip()[:80] or "Workspace", "created_by": user_id, "created_at": utcnow()}
    db.orgs.insert_one(org)
    db.memberships.insert_one({"_id": new_id("mem"), "user_id": user_id, "org_id": org["_id"], "role": role, "team": None,
                               "created_at": utcnow()})
    return org


def add_member(user_id: str, org_id: str, role: str, team: str | None) -> None:
    try:
        get_db().memberships.insert_one({"_id": new_id("mem"), "user_id": user_id, "org_id": org_id, "role": role,
                                         "team": (team or None), "created_at": utcnow()})
    except DuplicateKeyError:
        pass  # already a member: keep the existing role


def redeem_invite(code: str) -> dict:
    inv = get_db().invites.find_one({"_id": code})
    if not inv or inv["expires_at"] < utcnow():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invite code is invalid or expired")
    return inv


def register(email: str, password: str, name: str, org_name: str | None, invite_code: str | None) -> tuple[dict, dict]:
    email = _norm_email(email)
    if len(password or "") < 8:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Password must be at least 8 characters")
    name = (name or "").strip()
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Name is required")
    inv = redeem_invite(invite_code.strip()) if invite_code else None
    user = {"_id": new_id("usr"), "email": email, "name": name[:80], "password_hash": hash_password(password), "github": None,
            "created_at": utcnow(), "last_org_id": None}
    try:
        get_db().users.insert_one(user)
    except DuplicateKeyError:
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    org = _join_or_create(user, inv, org_name)
    audit.record("auth.register", {"id": user["_id"], "name": user["name"]}, tenant_id=org["_id"], details={"via": "invite" if inv else "new_org"})
    return user, org


def _join_or_create(user: dict, inv: dict | None, org_name: str | None) -> dict:
    db = get_db()
    if inv:
        org = db.orgs.find_one({"_id": inv["org_id"]})
        add_member(user["_id"], org["_id"], inv["role"], inv.get("team"))
        db.invites.update_one({"_id": inv["_id"]}, {"$inc": {"uses": 1}})
    else:
        org = create_org(user["_id"], org_name or f"{user['name']}'s workspace")
    db.users.update_one({"_id": user["_id"]}, {"$set": {"last_org_id": org["_id"]}})
    return org


def authenticate(email: str, password: str) -> tuple[dict, dict]:
    db = get_db()
    user = db.users.find_one({"email": (email or "").strip().lower()})
    if not user or not verify_password(password, user.get("password_hash")):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong email or password")
    audit_user = {"id": user["_id"], "name": user["name"]}
    org = active_org_for(user)
    audit.record("auth.login", audit_user, tenant_id=org["_id"])
    return user, org


def active_org_for(user: dict) -> dict:
    db = get_db()
    mems = list(db.memberships.find({"user_id": user["_id"]}))
    if not mems:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account does not belong to any organization")
    preferred = next((m for m in mems if m["org_id"] == user.get("last_org_id")), mems[0])
    return db.orgs.find_one({"_id": preferred["org_id"]})


def github_user_sign_in(gh: dict, email: str | None, token_enc: str, scopes: str, invite_code: str | None) -> tuple[dict, dict]:
    """Find or create the account for a GitHub identity. Links by GitHub id first, then by verified email."""
    db = get_db()
    link = {"id": gh["id"], "login": gh["login"], "avatar_url": gh.get("avatar_url"), "token_enc": token_enc, "scopes": scopes}
    user = db.users.find_one({"github.id": gh["id"]})
    if not user and email:
        user = db.users.find_one({"email": email.lower()})
    if user:
        db.users.update_one({"_id": user["_id"]}, {"$set": {"github": link}})
        return user, active_org_for(user)
    inv = redeem_invite(invite_code) if invite_code else None
    user = {"_id": new_id("usr"), "email": (email or f"{gh['login']}@users.noreply.github.com").lower(), "name": gh.get("name") or gh["login"],
            "password_hash": None, "github": link, "created_at": utcnow(), "last_org_id": None}
    db.users.insert_one(user)
    org = _join_or_create(user, inv, f"{gh['login']}'s workspace")
    audit.record("auth.register", {"id": user["_id"], "name": user["name"]}, tenant_id=org["_id"], details={"via": "github"})
    return user, org


def switch_org(user_id: str, org_id: str) -> dict:
    db = get_db()
    if not db.memberships.find_one({"user_id": user_id, "org_id": org_id}):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not a member of that organization")
    db.users.update_one({"_id": user_id}, {"$set": {"last_org_id": org_id}})
    return db.orgs.find_one({"_id": org_id})


def me_payload(user: dict, org_id: str) -> dict:
    db = get_db()
    mems = {m["org_id"]: m for m in db.memberships.find({"user_id": user["_id"]})}
    orgs = {o["_id"]: o for o in db.orgs.find({"_id": {"$in": list(mems)}})}
    cur = mems[org_id]
    gh = user.get("github") or {}
    return {
        "user": {"id": user["_id"], "email": user["email"], "name": user["name"], "github_login": gh.get("login"),
                 "avatar_url": gh.get("avatar_url")},
        "org": {"id": org_id, "name": orgs[org_id]["name"], "role": cur["role"], "team": cur.get("team"),
                "permissions": sorted(PERMISSIONS[cur["role"]])},
        "orgs": [{"id": o, "name": orgs[o]["name"], "role": mems[o]["role"]} for o in mems],
    }


# ------------------------------------------------------------------ org admin
def list_members(org_id: str) -> list[dict]:
    db = get_db()
    ms = list(db.memberships.find({"org_id": org_id}))
    users = {u["_id"]: u for u in db.users.find({"_id": {"$in": [m["user_id"] for m in ms]}})}
    return [{"user_id": m["user_id"], "name": users[m["user_id"]]["name"], "email": users[m["user_id"]]["email"], "role": m["role"],
             "team": m.get("team")} for m in ms if m["user_id"] in users]


def update_member(p: Principal, user_id: str, role: str | None, team: str | None, team_given: bool) -> dict:
    db = get_db()
    m = db.memberships.find_one({"org_id": p.org_id, "user_id": user_id})
    if not m:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    upd: dict = {}
    if role is not None:
        if role not in PERMISSIONS:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown role")
        if m["role"] == "owner" and role != "owner" and db.memberships.count_documents({"org_id": p.org_id, "role": "owner"}) <= 1:
            raise HTTPException(status.HTTP_409_CONFLICT, "An organization needs at least one owner")
        upd["role"] = role
    if team_given:
        upd["team"] = (team or "").strip() or None
    if upd:
        db.memberships.update_one({"_id": m["_id"]}, {"$set": upd})
        audit.record("org.member_updated", p, details={"user_id": user_id, **upd})
    return next(x for x in list_members(p.org_id) if x["user_id"] == user_id)


def remove_member(p: Principal, user_id: str) -> None:
    db = get_db()
    m = db.memberships.find_one({"org_id": p.org_id, "user_id": user_id})
    if not m:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    if m["role"] == "owner" and db.memberships.count_documents({"org_id": p.org_id, "role": "owner"}) <= 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "An organization needs at least one owner")
    db.memberships.delete_one({"_id": m["_id"]})
    audit.record("org.member_removed", p, details={"user_id": user_id})


def create_invite(p: Principal, role: str, team: str | None, expires_days: int) -> dict:
    if role not in ("admin", "member"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invites can grant admin or member")
    inv = {"_id": secrets.token_urlsafe(9), "org_id": p.org_id, "role": role, "team": (team or "").strip() or None,
           "expires_at": utcnow() + timedelta(days=max(1, min(expires_days, 60))), "uses": 0, "created_by": p.user_id,
           "created_at": utcnow()}
    get_db().invites.insert_one(inv)
    audit.record("org.invite_created", p, details={"role": role, "team": inv["team"]})
    return invite_api(inv, p.name)


def invite_api(inv: dict, creator_name: str) -> dict:
    return {"code": inv["_id"], "role": inv["role"], "team": inv.get("team"), "expires_at": iso(inv["expires_at"]),
            "uses": inv.get("uses", 0), "created_by": creator_name}


def list_invites(org_id: str) -> list[dict]:
    db = get_db()
    invs = list(db.invites.find({"org_id": org_id, "expires_at": {"$gt": utcnow()}}).sort("created_at", -1))
    names = {u["_id"]: u["name"] for u in db.users.find({"_id": {"$in": [i["created_by"] for i in invs]}})}
    return [invite_api(i, names.get(i["created_by"], "unknown")) for i in invs]
