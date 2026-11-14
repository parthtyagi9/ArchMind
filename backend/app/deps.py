"""Identity for every request. The org (tenant) comes from the signed session cookie and is re-validated
against the memberships collection on each request. No request body or query parameter can choose it."""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import Cookie, HTTPException, status

from app.db import get_db
from app.security import COOKIE_NAME, read_session

ROLES = ("member", "admin", "owner")
PERMISSIONS: dict[str, set[str]] = {
    "member": {"ask", "propose_memory"},
    "admin": {"ask", "propose_memory", "approve_memory", "correct_memory", "revoke_memory", "connect_repo", "manage_integrations"},
    "owner": {"ask", "propose_memory", "approve_memory", "correct_memory", "revoke_memory", "connect_repo", "manage_integrations",
              "purge_memory", "manage_members"},
}


@dataclass(frozen=True)
class Principal:
    user_id: str
    name: str
    email: str
    org_id: str
    org_name: str
    role: str
    team: str | None

    @property
    def permissions(self) -> set[str]:
        return PERMISSIONS[self.role]

    def can(self, perm: str) -> bool:
        return perm in self.permissions

    @property
    def actor(self) -> dict:
        return {"id": self.user_id, "name": self.name}


def principal_from_session(token: str) -> Principal:
    data = read_session(token)
    db = get_db()
    user = db.users.find_one({"_id": data.get("uid")})
    mem = db.memberships.find_one({"user_id": data.get("uid"), "org_id": data.get("oid")})
    org = db.orgs.find_one({"_id": data.get("oid")})
    if not user or not mem or not org:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session is no longer valid")
    return Principal(user["_id"], user["name"], user["email"], org["_id"], org["name"], mem["role"], mem.get("team"))


def current_principal(archmind_session: str | None = Cookie(default=None)) -> Principal:
    if not archmind_session:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    return principal_from_session(archmind_session)


def require(p: Principal, perm: str) -> None:
    """Deny and leave a trace: authorization failures are audit events."""
    if not p.can(perm):
        from app import audit

        audit.record("authz.denied", p, details={"permission": perm, "role": p.role})
        need = next((r for r in ROLES if perm in PERMISSIONS[r]), "owner")
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Requires {need} role (you are {p.role})")


assert COOKIE_NAME == "archmind_session"  # the Cookie() parameter name above must match
