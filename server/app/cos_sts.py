from __future__ import annotations

import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib import request
from urllib.parse import urlparse

from .config import Settings


@dataclass(frozen=True)
class CosCredentials:
    tmp_secret_id: str
    tmp_secret_key: str
    session_token: str
    start_time: int
    expired_time: int


@dataclass(frozen=True)
class CosUploadTarget:
    bucket: str
    region: str
    key: str
    slice_size: int
    credentials: CosCredentials


class CosStsError(RuntimeError):
    pass


def cos_direct_upload_configured(settings: Settings) -> bool:
    return bool(
        settings.cos_direct_upload_enabled
        and settings.cos_secret_id
        and settings.cos_secret_key
        and settings.cos_bucket
        and settings.cos_region
        and cos_app_id(settings)
    )


def cos_object_key(settings: Settings, storage_key: str) -> str:
    prefix = settings.cos_object_key_prefix.strip("/")
    if not prefix:
        return storage_key
    return f"{prefix}/{storage_key}"


def cos_app_id(settings: Settings) -> str:
    if settings.cos_app_id:
        return settings.cos_app_id
    suffix = settings.cos_bucket.rsplit("-", 1)[-1]
    return suffix if suffix.isdigit() else ""


def cos_short_bucket(settings: Settings) -> str:
    app_id = cos_app_id(settings)
    suffix = f"-{app_id}"
    if app_id and settings.cos_bucket.endswith(suffix):
        return settings.cos_bucket[: -len(suffix)]
    return settings.cos_bucket


def cos_resource_for_key(settings: Settings, object_key: str) -> str:
    app_id = cos_app_id(settings)
    short_bucket = cos_short_bucket(settings)
    return f"qcs::cos:{settings.cos_region}:uid/{app_id}:prefix//{app_id}/{short_bucket}/{object_key}"


def create_cos_upload_target(settings: Settings, storage_key: str) -> CosUploadTarget:
    object_key = cos_object_key(settings, storage_key)
    credentials = issue_cos_temporary_credentials(settings, object_key)
    return CosUploadTarget(
        bucket=settings.cos_bucket,
        region=settings.cos_region,
        key=object_key,
        slice_size=settings.cos_upload_slice_size_bytes,
        credentials=credentials,
    )


def issue_cos_temporary_credentials(settings: Settings, object_key: str) -> CosCredentials:
    policy = {
        "version": "2.0",
        "statement": [
            {
                "effect": "allow",
                "action": [
                    "name/cos:PutObject",
                    "name/cos:PostObject",
                    "name/cos:InitiateMultipartUpload",
                    "name/cos:UploadPart",
                    "name/cos:ListParts",
                    "name/cos:CompleteMultipartUpload",
                    "name/cos:AbortMultipartUpload",
                ],
                "resource": [cos_resource_for_key(settings, object_key)],
            }
        ],
    }
    payload = {
        "Name": f"docferry-{hashlib.sha1(object_key.encode('utf-8')).hexdigest()[:16]}",
        "Policy": json.dumps(policy, separators=(",", ":")),
        "DurationSeconds": max(900, min(settings.cos_credential_duration_seconds, 7200)),
    }
    response_body = call_tencent_sts(settings, payload)
    response = response_body.get("Response", {})
    if "Error" in response:
        error = response["Error"]
        raise CosStsError(f"{error.get('Code', 'cos_sts_error')}: {error.get('Message', '')}")

    credentials = response.get("Credentials") or {}
    start_time = int(time.time())
    expired_time = int(response.get("ExpiredTime") or response.get("ExpiredTimeStamp") or 0)
    if not expired_time:
        expiration = response.get("Expiration")
        if isinstance(expiration, str):
            expired_time = int(datetime.fromisoformat(expiration.replace("Z", "+00:00")).timestamp())
    if not expired_time:
        expired_time = start_time + settings.cos_credential_duration_seconds

    result = CosCredentials(
        tmp_secret_id=credentials.get("TmpSecretId") or credentials.get("tmpSecretId") or "",
        tmp_secret_key=credentials.get("TmpSecretKey") or credentials.get("tmpSecretKey") or "",
        session_token=credentials.get("Token") or credentials.get("SessionToken") or credentials.get("sessionToken") or "",
        start_time=start_time,
        expired_time=expired_time,
    )
    if not result.tmp_secret_id or not result.tmp_secret_key or not result.session_token:
        raise CosStsError("Tencent STS response did not include complete temporary credentials.")
    return result


def call_tencent_sts(settings: Settings, payload: dict[str, object]) -> dict[str, object]:
    host = urlparse(settings.cos_sts_endpoint).netloc or settings.cos_sts_endpoint.removeprefix("https://")
    endpoint = settings.cos_sts_endpoint if settings.cos_sts_endpoint.startswith("http") else f"https://{host}"
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    timestamp = int(time.time())
    authorization = tc3_authorization(
        secret_id=settings.cos_secret_id,
        secret_key=settings.cos_secret_key,
        service="sts",
        host=host,
        payload=body,
        timestamp=timestamp,
    )
    headers = {
        "Authorization": authorization,
        "Content-Type": "application/json; charset=utf-8",
        "Host": host,
        "X-TC-Action": "GetFederationToken",
        "X-TC-Version": "2018-08-13",
        "X-TC-Timestamp": str(timestamp),
        "X-TC-Region": settings.cos_region,
    }
    req = request.Request(endpoint, data=body, headers=headers, method="POST")
    try:
        with request.urlopen(req, timeout=8) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # pragma: no cover - network failures are integration concerns.
        raise CosStsError(str(exc)) from exc


def tc3_authorization(
    *,
    secret_id: str,
    secret_key: str,
    service: str,
    host: str,
    payload: bytes,
    timestamp: int,
) -> str:
    algorithm = "TC3-HMAC-SHA256"
    content_type = "application/json; charset=utf-8"
    date = datetime.fromtimestamp(timestamp, timezone.utc).strftime("%Y-%m-%d")
    canonical_headers = f"content-type:{content_type}\nhost:{host}\n"
    signed_headers = "content-type;host"
    canonical_request = "\n".join(
        [
            "POST",
            "/",
            "",
            canonical_headers,
            signed_headers,
            hashlib.sha256(payload).hexdigest(),
        ]
    )
    credential_scope = f"{date}/{service}/tc3_request"
    string_to_sign = "\n".join(
        [
            algorithm,
            str(timestamp),
            credential_scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )
    secret_date = hmac_sha256(("TC3" + secret_key).encode("utf-8"), date)
    secret_service = hmac_sha256(secret_date, service)
    secret_signing = hmac_sha256(secret_service, "tc3_request")
    signature = hmac.new(secret_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    return (
        f"{algorithm} Credential={secret_id}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )


def hmac_sha256(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()
