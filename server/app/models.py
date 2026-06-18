from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class CloudInstall(Base):
    __tablename__ = "cloud_installs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    install_id_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.id"), nullable=False, index=True)
    first_claimed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    last_claimed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    replacement_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class CloudClaimEvent(Base):
    __tablename__ = "cloud_claim_events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    install_id_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    result: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    plugin_version: Mapped[str | None] = mapped_column(String(40), nullable=True)
    obsidian_version: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False, index=True)


class UserToken(Base):
    __tablename__ = "user_tokens"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.id"), nullable=False, index=True)
    install_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("cloud_installs.id"), nullable=True, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    label: Mapped[str | None] = mapped_column(String(160), nullable=True)
    active_share_limit: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class Share(Base):
    __tablename__ = "shares"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.id"), nullable=False, index=True)
    slug: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    title_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    vault_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    vault_id_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    vault_id_index: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    source_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    source_path_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_path_normalized: Mapped[str | None] = mapped_column(String(1024), nullable=True, index=True)
    source_path_normalized_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_path_full_index: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    source_path_extless_index: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    source_path_basename_index: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    source_path_basename_extless_index: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    doc_identity: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    doc_identity_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    doc_identity_index: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    source_hash: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    source_hash_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_hash_index: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    markdown: Mapped[str | None] = mapped_column(Text, nullable=True)
    markdown_asset_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    html_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    html_snapshot_asset_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    render_mode: Mapped[str] = mapped_column(String(32), default="markdown_fallback", nullable=False)
    css_asset_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    assets: Mapped[list[dict[str, str]]] = mapped_column(JSON, default=list, nullable=False)
    assets_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    client: Mapped[dict[str, str]] = mapped_column(JSON, default=dict, nullable=False)
    client_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(512), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)
    last_published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class ShareAccessEvent(Base):
    __tablename__ = "share_access_events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    share_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("shares.id"), nullable=True, index=True)
    slug: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    request_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status_code: Mapped[int] = mapped_column(Integer, nullable=False)
    ip_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    details: Mapped[dict[str, str]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class Asset(Base):
    __tablename__ = "assets"
    __table_args__ = (
        UniqueConstraint("owner_id", "hash", name="uq_assets_owner_hash"),
        UniqueConstraint("owner_id", "hash_index", name="uq_assets_owner_hash_index"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.id"), nullable=False, index=True)
    hash: Mapped[str] = mapped_column(String(128), nullable=False)
    hash_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    hash_index: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    filename_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    byte_length: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    public_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ShareAsset(Base):
    __tablename__ = "share_assets"

    share_id: Mapped[str] = mapped_column(String(64), ForeignKey("shares.id"), primary_key=True)
    asset_id: Mapped[str] = mapped_column(String(64), ForeignKey("assets.id"), primary_key=True, index=True)
    role: Mapped[str] = mapped_column(String(40), nullable=False)
    original_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    original_path_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class ShareLink(Base):
    __tablename__ = "share_links"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    source_share_id: Mapped[str] = mapped_column(String(64), ForeignKey("shares.id"), nullable=False, index=True)
    owner_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.id"), nullable=False, index=True)
    vault_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    vault_id_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    vault_id_index: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    raw_target: Mapped[str] = mapped_column(String(1024), nullable=False)
    raw_target_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_target_index: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    target_path: Mapped[str | None] = mapped_column(String(1024), nullable=True, index=True)
    target_path_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_path_full_index: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    target_path_extless_index: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    target_path_basename_index: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    target_path_basename_extless_index: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    target_doc_identity: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    target_doc_identity_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_doc_identity_index: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    target_subpath: Mapped[str | None] = mapped_column(String(512), nullable=True)
    target_subpath_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    label: Mapped[str | None] = mapped_column(String(512), nullable=True)
    label_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    link_kind: Mapped[str] = mapped_column(String(40), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class SystemEvent(Base):
    __tablename__ = "system_events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    dedupe_key: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    payload: Mapped[dict[str, object]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
