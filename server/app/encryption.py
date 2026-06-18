from __future__ import annotations

import base64
import json
import secrets
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import Settings

DB_ENVELOPE_VERSION = 1
OBJECT_PREFIX = b"DFENC1\n"
ALGORITHM = "AES-256-GCM"


class EncryptionService:
    def __init__(self, settings: Settings) -> None:
        self.key_id = settings.encryption_key_id
        self._key = decode_master_key(settings.master_key_b64)
        if settings.encryption_required and self._key is None:
            raise RuntimeError("DOCFERRY_MASTER_KEY_B64 is required when encryption is required.")

    @property
    def enabled(self) -> bool:
        return self._key is not None

    def encrypt_text(self, value: str | None, aad: str) -> str | None:
        if value is None or not self.enabled:
            return value
        envelope = self._encrypt(value.encode("utf-8"), aad)
        return json.dumps(envelope, separators=(",", ":"), sort_keys=True)

    def decrypt_text(self, value: str | None, aad: str) -> str | None:
        if value is None:
            return None
        envelope = parse_db_envelope(value)
        if envelope is None:
            return value
        return self._decrypt(envelope, aad).decode("utf-8")

    def encrypt_json(self, value: Any | None, aad: str) -> str | None:
        if value is None:
            return None
        payload = json.dumps(value, separators=(",", ":"), sort_keys=True)
        return self.encrypt_text(payload, aad)

    def decrypt_json(self, value: str | None, aad: str) -> Any | None:
        payload = self.decrypt_text(value, aad)
        if payload is None:
            return None
        return json.loads(payload)

    def encrypt_bytes(self, value: bytes, aad: str) -> bytes:
        if not self.enabled:
            return value
        envelope = self._encrypt(value, aad)
        return OBJECT_PREFIX + json.dumps(envelope, separators=(",", ":"), sort_keys=True).encode("utf-8") + b"\n"

    def decrypt_bytes(self, value: bytes, aad: str) -> bytes:
        if not value.startswith(OBJECT_PREFIX):
            return value
        envelope_bytes = value[len(OBJECT_PREFIX) :].strip()
        try:
            envelope = json.loads(envelope_bytes.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("Invalid encrypted object envelope.") from exc
        return self._decrypt(envelope, aad)

    def _encrypt(self, value: bytes, aad: str) -> dict[str, Any]:
        aesgcm = AESGCM(self._require_key())
        nonce = secrets.token_bytes(12)
        ciphertext = aesgcm.encrypt(nonce, value, aad.encode("utf-8"))
        return {
            "df_enc": DB_ENVELOPE_VERSION,
            "alg": ALGORITHM,
            "key_id": self.key_id,
            "nonce_b64": base64.b64encode(nonce).decode("ascii"),
            "aad": aad,
            "ciphertext_b64": base64.b64encode(ciphertext).decode("ascii"),
        }

    def _decrypt(self, envelope: dict[str, Any], aad: str) -> bytes:
        if envelope.get("df_enc") != DB_ENVELOPE_VERSION or envelope.get("alg") != ALGORITHM:
            raise ValueError("Unsupported encrypted envelope.")
        try:
            nonce = base64.b64decode(str(envelope["nonce_b64"]), validate=True)
            ciphertext = base64.b64decode(str(envelope["ciphertext_b64"]), validate=True)
            return AESGCM(self._require_key()).decrypt(nonce, ciphertext, aad.encode("utf-8"))
        except (KeyError, InvalidTag, ValueError) as exc:
            raise ValueError("Unable to decrypt encrypted envelope.") from exc

    def _require_key(self) -> bytes:
        if self._key is None:
            raise RuntimeError("Encryption key is not configured.")
        return self._key


def decode_master_key(value: str) -> bytes | None:
    if not value:
        return None
    try:
        key = base64.b64decode(value, validate=True)
    except ValueError as exc:
        raise RuntimeError("DOCFERRY_MASTER_KEY_B64 must be valid base64.") from exc
    if len(key) != 32:
        raise RuntimeError("DOCFERRY_MASTER_KEY_B64 must decode to 32 bytes.")
    return key


def parse_db_envelope(value: str) -> dict[str, Any] | None:
    stripped = value.strip()
    if not stripped.startswith("{"):
        return None
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        return None
    if isinstance(parsed, dict) and parsed.get("df_enc") == DB_ENVELOPE_VERSION:
        return parsed
    return None


def share_markdown_aad(share_id: str) -> str:
    return f"share.markdown:{share_id}"


def share_html_aad(share_id: str) -> str:
    return f"share.html:{share_id}"


def asset_bytes_aad(asset_id: str) -> str:
    return f"asset.bytes:{asset_id}"
