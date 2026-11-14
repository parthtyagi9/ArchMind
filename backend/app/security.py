"""Passwords, signed session cookies and at-rest encryption for stored integration tokens."""
from __future__ import annotations

import base64
import hashlib
import hmac
import os

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.config import get_settings

COOKIE_NAME = "archmind_session"
_SCRYPT = {"n": 2**14, "r": 8, "p": 1}


# ------------------------------------------------------------------ passwords
def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT, dklen=32)
    return "scrypt${n}${r}${p}${s}${h}".format(**_SCRYPT, s=base64.b64encode(salt).decode(), h=base64.b64encode(dk).decode())


def verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        return False
    try:
        _, n, r, p, s, h = stored.split("$")
        dk = hashlib.scrypt(password.encode(), salt=base64.b64decode(s), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(dk, base64.b64decode(h))
    except (ValueError, TypeError):
        return False


# ------------------------------------------------------------------ signed tokens
def _signer(salt: str) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(get_settings().session_secret, salt=salt)


def sign(salt: str, data: dict) -> str:
    return _signer(salt).dumps(data)


def unsign(salt: str, token: str, max_age: int) -> dict:
    try:
        return _signer(salt).loads(token, max_age=max_age)
    except (BadSignature, SignatureExpired):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired session")


def issue_session(user_id: str, org_id: str) -> str:
    return sign("archmind-session", {"uid": user_id, "oid": org_id})


def read_session(token: str) -> dict:
    return unsign("archmind-session", token, get_settings().session_max_age_days * 86400)


# ------------------------------------------------------------------ encryption of stored secrets
def _fernet() -> Fernet:
    s = get_settings()
    key = s.encryption_key.encode() if s.encryption_key else base64.urlsafe_b64encode(
        hashlib.sha256(("archmind-enc:" + s.session_secret).encode()).digest())
    return Fernet(key)


def encrypt(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt(token: str | None) -> str | None:
    if not token:
        return None
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        return None  # key rotated or data corrupted: treat as not connected rather than crash
