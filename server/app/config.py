from __future__ import annotations

import os
from dataclasses import dataclass


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    service_name: str = "docferry-share"
    version: str = "0.0.6"
    environment: str = "development"
    api_token: str = "dev-token"
    token_hash_secret: str = "dev-token-hash-secret"
    install_hash_secret: str = "dev-install-hash-secret"
    blind_index_secret: str = "dev-blind-index-secret"
    default_active_share_limit: int = 5
    cloud_claim_enabled: bool = True
    cloud_claim_ip_hour_limit: int = 60
    cloud_claim_install_hour_limit: int = 10
    master_key_b64: str = ""
    encryption_key_id: str = "v1"
    encryption_required: bool = False
    public_base_url: str = "http://127.0.0.1:8787"
    trusted_proxy_hosts: str = ""
    database_url: str = "sqlite:///./.local/docferry.db"
    cookie_secret: str = "dev-cookie-secret"
    sso_login_url: str = "https://auth.example.com/oauth/start"
    sso_callback_protocol: str = "docferry"
    password_failed_limit: int = 8
    password_failed_window_seconds: int = 600
    object_storage_root: str = "./.local/object-storage"
    asset_max_bytes: int = 10 * 1024 * 1024
    asset_max_per_share: int = 50
    asset_owner_quota_bytes: int = 1024 * 1024 * 1024
    snapshot_max_db_bytes: int = 256 * 1024
    cos_direct_upload_enabled: bool = False
    cos_secret_id: str = ""
    cos_secret_key: str = ""
    cos_bucket: str = ""
    cos_region: str = ""
    cos_app_id: str = ""
    cos_object_key_prefix: str = ""
    cos_sts_endpoint: str = "https://sts.tencentcloudapi.com"
    cos_credential_duration_seconds: int = 1800
    cos_upload_slice_size_bytes: int = 5 * 1024 * 1024
    cos_direct_upload_verify_bytes: bool = True
    log_level: str = "INFO"
    log_format: str = "json"

    @classmethod
    def from_env(cls) -> "Settings":
        environment = os.getenv("DOCFERRY_ENV", cls.environment).strip().lower()
        return cls(
            service_name=os.getenv("DOCFERRY_SERVICE_NAME", cls.service_name),
            version=os.getenv("DOCFERRY_VERSION", cls.version),
            environment=environment,
            api_token=os.getenv("DOCFERRY_API_TOKEN", cls.api_token),
            token_hash_secret=os.getenv("DOCFERRY_TOKEN_HASH_SECRET", cls.token_hash_secret),
            install_hash_secret=os.getenv("DOCFERRY_INSTALL_HASH_SECRET", cls.install_hash_secret),
            blind_index_secret=os.getenv("DOCFERRY_BLIND_INDEX_SECRET", cls.blind_index_secret),
            default_active_share_limit=int(
                os.getenv("DOCFERRY_DEFAULT_ACTIVE_SHARE_LIMIT", cls.default_active_share_limit)
            ),
            cloud_claim_enabled=env_bool("DOCFERRY_CLOUD_CLAIM_ENABLED", cls.cloud_claim_enabled),
            cloud_claim_ip_hour_limit=int(
                os.getenv("DOCFERRY_CLOUD_CLAIM_IP_HOUR_LIMIT", cls.cloud_claim_ip_hour_limit)
            ),
            cloud_claim_install_hour_limit=int(
                os.getenv("DOCFERRY_CLOUD_CLAIM_INSTALL_HOUR_LIMIT", cls.cloud_claim_install_hour_limit)
            ),
            master_key_b64=os.getenv("DOCFERRY_MASTER_KEY_B64", cls.master_key_b64),
            encryption_key_id=os.getenv("DOCFERRY_ENCRYPTION_KEY_ID", cls.encryption_key_id),
            encryption_required=env_bool("DOCFERRY_ENCRYPTION_REQUIRED", environment == "production"),
            public_base_url=os.getenv("DOCFERRY_PUBLIC_BASE_URL", cls.public_base_url).rstrip("/"),
            trusted_proxy_hosts=os.getenv("DOCFERRY_TRUSTED_PROXY_HOSTS", cls.trusted_proxy_hosts),
            database_url=os.getenv("DOCFERRY_DATABASE_URL", cls.database_url),
            cookie_secret=os.getenv("DOCFERRY_COOKIE_SECRET", cls.cookie_secret),
            sso_login_url=os.getenv("DOCFERRY_SSO_LOGIN_URL", cls.sso_login_url),
            sso_callback_protocol=os.getenv("DOCFERRY_SSO_CALLBACK_PROTOCOL", cls.sso_callback_protocol),
            password_failed_limit=int(os.getenv("DOCFERRY_PASSWORD_FAILED_LIMIT", cls.password_failed_limit)),
            password_failed_window_seconds=int(
                os.getenv("DOCFERRY_PASSWORD_FAILED_WINDOW_SECONDS", cls.password_failed_window_seconds)
            ),
            object_storage_root=os.getenv("DOCFERRY_OBJECT_STORAGE_ROOT", cls.object_storage_root),
            asset_max_bytes=int(os.getenv("DOCFERRY_ASSET_MAX_BYTES", cls.asset_max_bytes)),
            asset_max_per_share=int(os.getenv("DOCFERRY_ASSET_MAX_PER_SHARE", cls.asset_max_per_share)),
            asset_owner_quota_bytes=int(
                os.getenv("DOCFERRY_ASSET_OWNER_QUOTA_BYTES", cls.asset_owner_quota_bytes)
            ),
            snapshot_max_db_bytes=int(os.getenv("DOCFERRY_SNAPSHOT_MAX_DB_BYTES", cls.snapshot_max_db_bytes)),
            cos_direct_upload_enabled=env_bool(
                "DOCFERRY_COS_DIRECT_UPLOAD_ENABLED", cls.cos_direct_upload_enabled
            ),
            cos_secret_id=os.getenv("DOCFERRY_COS_SECRET_ID", cls.cos_secret_id),
            cos_secret_key=os.getenv("DOCFERRY_COS_SECRET_KEY", cls.cos_secret_key),
            cos_bucket=os.getenv("DOCFERRY_COS_BUCKET", cls.cos_bucket),
            cos_region=os.getenv("DOCFERRY_COS_REGION", cls.cos_region),
            cos_app_id=os.getenv("DOCFERRY_COS_APP_ID", cls.cos_app_id),
            cos_object_key_prefix=os.getenv("DOCFERRY_COS_OBJECT_KEY_PREFIX", cls.cos_object_key_prefix),
            cos_sts_endpoint=os.getenv("DOCFERRY_COS_STS_ENDPOINT", cls.cos_sts_endpoint),
            cos_credential_duration_seconds=int(
                os.getenv(
                    "DOCFERRY_COS_CREDENTIAL_DURATION_SECONDS",
                    cls.cos_credential_duration_seconds,
                )
            ),
            cos_upload_slice_size_bytes=int(
                os.getenv("DOCFERRY_COS_UPLOAD_SLICE_SIZE_BYTES", cls.cos_upload_slice_size_bytes)
            ),
            cos_direct_upload_verify_bytes=env_bool(
                "DOCFERRY_COS_DIRECT_UPLOAD_VERIFY_BYTES", cls.cos_direct_upload_verify_bytes
            ),
            log_level=os.getenv("DOCFERRY_LOG_LEVEL", cls.log_level),
            log_format=os.getenv("DOCFERRY_LOG_FORMAT", cls.log_format),
        )


def validate_runtime_settings(settings: Settings) -> None:
    if settings.encryption_required and not settings.master_key_b64:
        raise RuntimeError("DOCFERRY_MASTER_KEY_B64 is required when encryption is required.")
    if settings.environment == "production":
        if not settings.master_key_b64:
            raise RuntimeError("DOCFERRY_MASTER_KEY_B64 is required in production.")
        if not settings.token_hash_secret or settings.token_hash_secret == Settings.token_hash_secret:
            raise RuntimeError("DOCFERRY_TOKEN_HASH_SECRET must be set to a production secret.")
        if not settings.install_hash_secret or settings.install_hash_secret == Settings.install_hash_secret:
            raise RuntimeError("DOCFERRY_INSTALL_HASH_SECRET must be set to a production secret.")
        if not settings.blind_index_secret or settings.blind_index_secret == Settings.blind_index_secret:
            raise RuntimeError("DOCFERRY_BLIND_INDEX_SECRET must be set to a production secret.")
