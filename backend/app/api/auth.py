from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from app import audit
from app.config import get_settings
from app.db import get_db
from app.deps import Principal, current_principal, principal_from_session
from app.security import COOKIE_NAME, encrypt, issue_session
from app.services import accounts, github_oauth

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_cookie(resp: Response, user_id: str, org_id: str) -> None:
    s = get_settings()
    resp.set_cookie(COOKIE_NAME, issue_session(user_id, org_id), max_age=s.session_max_age_days * 86400, httponly=True,
                    samesite="lax", secure=s.cookie_secure, path="/")


class RegisterIn(BaseModel):
    email: str
    password: str
    name: str
    org_name: str | None = None
    invite_code: str | None = None


class LoginIn(BaseModel):
    email: str
    password: str


class SwitchIn(BaseModel):
    org_id: str


@router.get("/config")
def config() -> dict:
    return {"github_oauth": get_settings().github_oauth_configured}


@router.post("/register")
def register(body: RegisterIn, response: Response) -> dict:
    user, org = accounts.register(body.email, body.password, body.name, body.org_name, body.invite_code)
    _set_cookie(response, user["_id"], org["_id"])
    return accounts.me_payload(user, org["_id"])


@router.post("/login")
def login(body: LoginIn, response: Response) -> dict:
    user, org = accounts.authenticate(body.email, body.password)
    _set_cookie(response, user["_id"], org["_id"])
    return accounts.me_payload(user, org["_id"])


@router.post("/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me")
def me(p: Principal = Depends(current_principal)) -> dict:
    return accounts.me_payload(get_db().users.find_one({"_id": p.user_id}), p.org_id)


@router.post("/switch-org")
def switch_org(body: SwitchIn, response: Response, p: Principal = Depends(current_principal)) -> dict:
    org = accounts.switch_org(p.user_id, body.org_id)
    _set_cookie(response, p.user_id, org["_id"])
    return accounts.me_payload(get_db().users.find_one({"_id": p.user_id}), org["_id"])


# ------------------------------------------------------------------ GitHub OAuth (browser navigations)
@router.get("/github/login")
def github_login(invite_code: str | None = None):
    return RedirectResponse(github_oauth.authorize_url(mode="login", invite_code=invite_code or None))


@router.get("/github/connect")
def github_connect(archmind_session: str | None = Cookie(default=None)):
    if not archmind_session:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in first, then link GitHub")
    p = principal_from_session(archmind_session)
    return RedirectResponse(github_oauth.authorize_url(mode="connect", user_id=p.user_id))


def _back(path: str) -> RedirectResponse:
    return RedirectResponse(get_settings().frontend_origin.rstrip("/") + path)


@router.get("/github/callback")
def github_callback(request: Request, code: str | None = None, state: str | None = None, error: str | None = None,
                    error_description: str | None = None):
    if error or not code or not state:
        return _back("/?auth_error=" + quote(error_description or error or "GitHub sign-in was cancelled"))
    try:
        st = github_oauth.read_state(state)
        token, scopes = github_oauth.exchange_code(code)
        profile, email = github_oauth.fetch_profile(token)
        db = get_db()
        if st["mode"] == "connect":
            other = db.users.find_one({"github.id": profile["id"], "_id": {"$ne": st["uid"]}})
            if other:
                raise HTTPException(status.HTTP_409_CONFLICT, "That GitHub account is already linked to another ArchMind user")
            db.users.update_one({"_id": st["uid"]}, {"$set": {"github": {
                "id": profile["id"], "login": profile["login"], "avatar_url": profile.get("avatar_url"),
                "token_enc": encrypt(token), "scopes": scopes}}})
            user = db.users.find_one({"_id": st["uid"]})
            org = accounts.active_org_for(user)
            audit.record("integration.github_linked", {"id": user["_id"], "name": user["name"]}, tenant_id=org["_id"],
                         details={"login": profile["login"]})
            resp = _back("/?connected=github")
        else:
            user, org = accounts.github_user_sign_in(profile, email, encrypt(token), scopes, st.get("invite"))
            audit.record("auth.login", {"id": user["_id"], "name": user["name"]}, tenant_id=org["_id"], details={"via": "github"})
            resp = _back("/")
        _set_cookie(resp, user["_id"], org["_id"])
        return resp
    except HTTPException as e:
        return _back("/?auth_error=" + quote(str(e.detail)))
