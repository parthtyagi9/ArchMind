"""GitHub OAuth (web application flow). Used both to sign in/register and to link repository access."""
from __future__ import annotations

import secrets
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException, status

from app.config import get_settings
from app.security import sign, unsign

SCOPE = "repo read:user user:email"
STATE_SALT = "archmind-oauth"


def authorize_url(*, mode: str, user_id: str | None = None, invite_code: str | None = None) -> str:
    s = get_settings()
    if not s.github_oauth_configured:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "GitHub OAuth is not configured on this server")
    state = sign(STATE_SALT, {"mode": mode, "uid": user_id, "invite": invite_code, "n": secrets.token_hex(8)})
    q = urlencode({"client_id": s.github_client_id, "redirect_uri": s.github_callback, "scope": SCOPE, "state": state,
                   "allow_signup": "true"})
    return f"https://github.com/login/oauth/authorize?{q}"


def read_state(state: str) -> dict:
    return unsign(STATE_SALT, state, 600)


def exchange_code(code: str, client: httpx.Client | None = None) -> tuple[str, str]:
    s = get_settings()
    http = client or httpx.Client(timeout=20)
    r = http.post("https://github.com/login/oauth/access_token", headers={"Accept": "application/json"},
                  data={"client_id": s.github_client_id, "client_secret": s.github_client_secret, "code": code,
                        "redirect_uri": s.github_callback})
    body = r.json() if r.content else {}
    if r.status_code >= 400 or "access_token" not in body:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"GitHub rejected the sign-in: {body.get('error_description') or body.get('error') or r.status_code}")
    return body["access_token"], body.get("scope", "")


def fetch_profile(token: str, client: httpx.Client | None = None) -> tuple[dict, str | None]:
    http = client or httpx.Client(timeout=20)
    h = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
    u = http.get("https://api.github.com/user", headers=h)
    if u.status_code >= 400:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"GitHub profile lookup failed ({u.status_code})")
    profile = u.json()
    email = profile.get("email")
    e = http.get("https://api.github.com/user/emails", headers=h)
    if e.status_code == 200:
        verified = [x for x in e.json() if x.get("verified")]
        primary = next((x for x in verified if x.get("primary")), verified[0] if verified else None)
        if primary:
            email = primary["email"]
        elif not email:
            email = None
    return profile, email
