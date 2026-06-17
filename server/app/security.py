from __future__ import annotations

import hmac
import secrets
from dataclasses import dataclass
from hashlib import sha256

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError
from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import Settings
from .errors import ApiError
from .models import UserToken, utc_now

password_hasher = PasswordHasher()


@dataclass(frozen=True)
class AuthContext:
    user_id: str
    token_id: str | None
    active_share_limit: int
    mode: str
    token_label: str | None = None


def hash_cloud_token(token: str, settings: Settings) -> str:
    return hmac.new(settings.token_hash_secret.encode("utf-8"), token.encode("utf-8"), sha256).hexdigest()


def make_cloud_token() -> str:
    return f"dfc_{secrets.token_urlsafe(32)}"


def require_bearer_token(request: Request, settings: Settings, db: Session) -> AuthContext:
    expected = settings.api_token
    auth = request.headers.get("authorization", "")
    prefix = "Bearer "
    if not auth.startswith(prefix):
        raise ApiError(401, "missing_auth_token", "Missing bearer token.")
    token = auth[len(prefix) :]
    if hmac.compare_digest(token, expected):
        return AuthContext(
            user_id="usr_local",
            token_id=None,
            active_share_limit=0,
            mode="self_host",
            token_label="Self-hosted token",
        )
    if token.startswith("dfc_"):
        token_hash = hash_cloud_token(token, settings)
        user_token = db.execute(select(UserToken).where(UserToken.token_hash == token_hash)).scalar_one_or_none()
        if user_token:
            if user_token.revoked_at is not None:
                raise ApiError(401, "revoked_auth_token", "Token has been revoked.")
            user_token.last_used_at = utc_now()
            return AuthContext(
                user_id=user_token.user_id,
                token_id=user_token.id,
                active_share_limit=user_token.active_share_limit,
                mode="cloud",
                token_label=user_token.label,
            )
    raise ApiError(401, "invalid_auth_token", "Invalid bearer token.")


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError):
        return False


def generate_prefixed_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(12).replace('-', '').replace('_', '')[:16]}"


def generate_slug() -> str:
    return secrets.token_urlsafe(8).replace("-", "").replace("_", "")[:10]


def access_cookie_name(slug: str) -> str:
    return f"docferry_access_{slug}"


def sign_share_access(settings: Settings, share_id: str) -> str:
    signature = hmac.new(settings.cookie_secret.encode(), share_id.encode(), sha256).hexdigest()
    return f"{share_id}.{signature}"


def verify_share_access(settings: Settings, share_id: str, value: str | None) -> bool:
    if not value:
        return False
    expected = sign_share_access(settings, share_id)
    return hmac.compare_digest(value, expected)
