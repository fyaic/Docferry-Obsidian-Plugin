from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ClientInfo(BaseModel):
    plugin_id: str = Field(min_length=1, max_length=80)
    plugin_version: str = Field(min_length=1, max_length=40)
    obsidian_version: str = Field(min_length=1, max_length=40)


class ShareAssetRef(BaseModel):
    asset_id: str = Field(min_length=1, max_length=80)
    role: str = Field(min_length=1, max_length=40)
    original_path: str | None = Field(default=None, max_length=1024)


class OutboundLinkPayload(BaseModel):
    raw_target: str = Field(min_length=1, max_length=1024)
    target_path: str | None = Field(default=None, max_length=1024)
    target_doc_identity: str | None = Field(default=None, max_length=128)
    target_subpath: str | None = Field(default=None, max_length=512)
    label: str | None = Field(default=None, max_length=512)
    link_kind: str = Field(min_length=1, max_length=40)


class SharePayload(BaseModel):
    vault_id: str | None = Field(default=None, max_length=128)
    source_path: str = Field(min_length=1, max_length=1024)
    source_path_normalized: str | None = Field(default=None, max_length=1024)
    doc_identity: str | None = Field(default=None, max_length=128)
    source_hash: str = Field(min_length=1, max_length=128)
    title: str = Field(min_length=1, max_length=240)
    markdown: str = Field(min_length=1)
    html_snapshot: str | None = None
    css_asset_id: str | None = Field(default=None, max_length=80)
    assets: list[ShareAssetRef] = Field(default_factory=list)
    outbound_links: list[OutboundLinkPayload] = Field(default_factory=list)
    password: str | None = Field(default=None, max_length=512)
    password_mode: Literal["keep", "set", "clear"] | None = None
    expires_at: datetime | None = None
    client: ClientInfo


ShareStatus = Literal["published", "password_protected", "expired", "stopped"]


class ShareResponse(BaseModel):
    share_id: str
    slug: str
    url: str
    status: ShareStatus
    password_enabled: bool
    expires_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime


class ShareStatusResponse(BaseModel):
    share_id: str
    slug: str
    url: str
    source_path: str
    source_hash: str
    title: str
    status: ShareStatus
    password_enabled: bool
    expires_at: datetime | None = None
    stopped_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    last_published_at: datetime


class ShareAccessEventResponse(BaseModel):
    event_id: str
    event_type: str
    status_code: int
    slug: str | None = None
    ip_hash: str | None = None
    user_agent: str | None = None
    details: dict[str, str]
    created_at: datetime


class ShareAccessEventsResponse(BaseModel):
    share_id: str
    slug: str
    events: list[ShareAccessEventResponse]


class ShareLinkStatusResponse(BaseModel):
    link_id: str
    raw_target: str
    target_path: str | None = None
    target_subpath: str | None = None
    label: str | None = None
    link_kind: str
    status: Literal["resolved", "unpublished", "ambiguous", "unsupported"]
    target_share_id: str | None = None
    target_url: str | None = None


class ShareLinksResponse(BaseModel):
    share_id: str
    slug: str
    links: list[ShareLinkStatusResponse]


class DeleteShareResponse(BaseModel):
    share_id: str
    stopped_at: datetime


class AssetResponse(BaseModel):
    asset_id: str
    hash: str
    content_type: str
    byte_length: int
    url: str | None = None


class AssetUploadIntentPayload(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=120)
    byte_length: int = Field(gt=0)
    hash: str = Field(min_length=1, max_length=128)


class AssetUploadCredentials(BaseModel):
    tmp_secret_id: str
    tmp_secret_key: str
    session_token: str
    start_time: int
    expired_time: int


class AssetUploadTarget(BaseModel):
    provider: Literal["tencent_cos"]
    bucket: str
    region: str
    key: str
    slice_size: int
    credentials: AssetUploadCredentials
    headers: dict[str, str] = Field(default_factory=dict)


class AssetUploadIntentResponse(BaseModel):
    mode: Literal["already_uploaded", "api_proxy", "tencent_cos"]
    asset_id: str | None = None
    asset: AssetResponse | None = None
    storage_key: str | None = None
    upload: AssetUploadTarget | None = None
    fallback_url: str | None = None
    expires_at: datetime | None = None


class AssetUploadCompletePayload(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=120)
    byte_length: int = Field(gt=0)
    hash: str = Field(min_length=1, max_length=128)
    storage_key: str = Field(min_length=1, max_length=512)


class HealthResponse(BaseModel):
    ok: bool
    service: str
    version: str


class AccountInfo(BaseModel):
    owner_id: str
    mode: Literal["cloud", "self_host"]
    token_label: str | None = None
    active_shares: int
    active_share_limit: int
    remaining_active_shares: int | None = None


class AccountResponse(BaseModel):
    account: AccountInfo


class AuthConfigResponse(BaseModel):
    provider: str
    login_url: str
    callback_protocol: str


class AuthExchangePayload(BaseModel):
    code: str = Field(min_length=1, max_length=2048)
    redirect_uri: str = Field(min_length=1, max_length=2048)


class PasswordPayload(BaseModel):
    password: str = Field(min_length=1, max_length=512)


class ShareImportPayloadResponse(BaseModel):
    class AssetManifestItem(BaseModel):
        asset_id: str
        role: str
        original_path: str | None = None
        filename: str
        content_type: str
        byte_length: int
        url: str

    slug: str
    title: str
    markdown: str
    source_hash: str
    assets: list[AssetManifestItem] = Field(default_factory=list)
    updated_at: datetime
