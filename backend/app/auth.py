"""Demo-only identity. NOT production auth.

The browser holds an HMAC-signed, httpOnly cookie that contains only a user_id. The tenant and
roles are looked up server-side from DEMO_USERS, so a client cannot choose its tenant by putting
a tenant_id in a request body, query string, or forged cookie (the signature would fail).
"""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import Cookie, HTTPException, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.config import get_settings

COOKIE_NAME = "recallops_session"
SESSION_MAX_AGE = 60 * 60 * 12


@dataclass(frozen=True)
class Principal:
    user_id: str
    name: str
    tenant_id: str
    tenant_name: str
    roles: frozenset[str]  # permissions derived from `role`
    role: str = "User"

    def has(self, role: str) -> bool:
        return role in self.roles


# Role levels -> permissions. Permissions are what the code checks:
#   responder    = file incidents, run the agent
#   approver     = approve/reject state-changing actions, run the A/B experiment
#   memory_admin = correct / invalidate / purge memories
ROLE_PERMISSIONS: dict[str, set[str]] = {
    "Super Admin": {"responder", "approver", "memory_admin"},
    "Admin": {"responder", "approver"},
    "User": {"responder"},
}

# Synthetic demo directory (no real people, no passwords).
DEMO_USERS: dict[str, dict] = {
    "alice": {"name": "Alice Chen", "title": "SRE lead", "role": "Super Admin",
              "tenant_id": "tenant_alpha", "tenant_name": "Alpha Payments"},
    "maya": {"name": "Maya Singh", "title": "Platform engineer", "role": "Admin",
             "tenant_id": "tenant_alpha", "tenant_name": "Alpha Payments"},
    "dev": {"name": "Dev Patel", "title": "On-call engineer", "role": "User",
            "tenant_id": "tenant_alpha", "tenant_name": "Alpha Payments"},
    "bob": {"name": "Bob Okafor", "title": "Platform lead", "role": "Super Admin",
            "tenant_id": "tenant_beta", "tenant_name": "Beta Logistics"},
}
for _u in DEMO_USERS.values():
    _u["roles"] = ROLE_PERMISSIONS[_u["role"]]


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(get_settings().session_secret, salt="recallops-session")


def issue_token(user_id: str) -> str:
    if user_id not in DEMO_USERS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown demo user")
    return _serializer().dumps({"uid": user_id})


def principal_for(user_id: str) -> Principal:
    u = DEMO_USERS[user_id]
    return Principal(user_id, u["name"], u["tenant_id"], u["tenant_name"], frozenset(u["roles"]), u["role"])


def decode_token(token: str) -> Principal:
    try:
        data = _serializer().loads(token, max_age=SESSION_MAX_AGE)
    except (BadSignature, SignatureExpired):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired session")
    uid = data.get("uid")
    if uid not in DEMO_USERS:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unknown session user")
    return principal_for(uid)


def current_principal(recallops_session: str | None = Cookie(default=None)) -> Principal:
    if not recallops_session:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    return decode_token(recallops_session)


def require(principal: Principal, role: str) -> None:
    if not principal.has(role):
        need = next((r for r in ("User", "Admin", "Super Admin") if role in ROLE_PERMISSIONS[r]), role)
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Requires {need} (you are {principal.role})")
