from __future__ import annotations

import hmac
from hashlib import sha256
from typing import Any

from .config import Settings
from .encryption import EncryptionService


def metadata_aad(table: str, field: str, record_id: str) -> str:
    return f"{table}.{field}:{record_id}"


def encrypt_metadata_text(
    encryption: EncryptionService,
    table: str,
    field: str,
    record_id: str,
    value: str | None,
) -> str | None:
    return encryption.encrypt_text(value, metadata_aad(table, field, record_id))


def decrypt_metadata_text(
    encryption: EncryptionService,
    table: str,
    field: str,
    record_id: str,
    encrypted_value: str | None,
    legacy_value: str | None,
    default: str | None = None,
) -> str | None:
    if encrypted_value is not None:
        value = encryption.decrypt_text(encrypted_value, metadata_aad(table, field, record_id))
        return value if value is not None else default
    return legacy_value if legacy_value is not None else default


def encrypt_metadata_json(
    encryption: EncryptionService,
    table: str,
    field: str,
    record_id: str,
    value: Any | None,
) -> str | None:
    return encryption.encrypt_json(value, metadata_aad(table, field, record_id))


def decrypt_metadata_json(
    encryption: EncryptionService,
    table: str,
    field: str,
    record_id: str,
    encrypted_value: str | None,
    legacy_value: Any | None,
    default: Any,
) -> Any:
    if encrypted_value is not None:
        value = encryption.decrypt_json(encrypted_value, metadata_aad(table, field, record_id))
        return value if value is not None else default
    return legacy_value if legacy_value is not None else default


def blind_index(settings: Settings, purpose: str, value: str | None) -> str | None:
    if value is None:
        return None
    canonical = str(value).strip()
    if not canonical:
        return None
    message = f"{purpose}\0{canonical}".encode("utf-8")
    secret = settings.blind_index_secret.encode("utf-8")
    return hmac.new(secret, message, sha256).hexdigest()
