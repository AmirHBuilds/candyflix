"""
Password hashing and session cookie configuration.

- Password hashing: pwdlib with Argon2 (the modern, recommended choice —
  no Passlib).
- Sessions: server-side, keyed by an opaque random token stored in Redis.
  The browser only ever holds that opaque token, in a secure, HttpOnly
  cookie — never a JWT, never anything decodable client-side, and never
  localStorage.
"""
import secrets

from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher

from app.core.config import get_settings

settings = get_settings()

_password_hash = PasswordHash((Argon2Hasher(),))


def hash_password(plain_password: str) -> str:
    return _password_hash.hash(plain_password)


def verify_password(plain_password: str, password_hash: str) -> bool:
    return _password_hash.verify(plain_password, password_hash)


def generate_session_token() -> str:
    """A cryptographically random, unguessable session identifier."""
    return secrets.token_urlsafe(32)


# --- Cookie configuration -------------------------------------------------

SESSION_COOKIE_NAME = "candyflix_session"
SESSION_TTL_SECONDS = 60 * 60 * 24 * 30  # 30 days — this is a private app
# for a handful of trusted people, not a bank; long-lived sessions are fine.


def session_cookie_kwargs() -> dict:
    """
    Cookie attributes shared by set/delete calls.

    `secure` is on in any non-development environment (i.e. real
    deployments should be served over HTTPS). `samesite="lax"` is
    enough here since the frontend and backend are same-site
    (same registrable domain, different ports) even across Docker.
    """
    return {
        "httponly": True,
        "secure": settings.environment != "development",
        "samesite": "lax",
        "path": "/",
    }
