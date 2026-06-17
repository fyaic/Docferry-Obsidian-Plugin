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


class UserToken(Base):
    __tablename__ = "user_tokens"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.id"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    label: Mapped[str | None] = mapped_column(String(160), nullable=True)
    active_share_limit: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
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
    vault_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    source_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    source_path_normalized: Mapped[str | None] = mapped_column(String(1024), nullable=True, index=True)
    doc_identity: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    source_hash: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    markdown: Mapped[str | None] = mapped_column(Text, nullable=True)
    markdown_asset_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    html_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    html_snapshot_asset_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    render_mode: Mapped[str] = mapped_column(String(32), default="markdown_fallback", nullable=False)
    css_asset_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    assets: Mapped[list[dict[str, str]]] = mapped_column(JSON, default=list, nullable=False)
    client: Mapped[dict[str, str]] = mapped_column(JSON, default=dict, nullable=False)
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
    __table_args__ = (UniqueConstraint("owner_id", "hash", name="uq_assets_owner_hash"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.id"), nullable=False, index=True)
    hash: Mapped[str] = mapped_column(String(128), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class ShareLink(Base):
    __tablename__ = "share_links"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    source_share_id: Mapped[str] = mapped_column(String(64), ForeignKey("shares.id"), nullable=False, index=True)
    owner_id: Mapped[str] = mapped_column(String(64), ForeignKey("users.id"), nullable=False, index=True)
    vault_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    raw_target: Mapped[str] = mapped_column(String(1024), nullable=False)
    target_path: Mapped[str | None] = mapped_column(String(1024), nullable=True, index=True)
    target_doc_identity: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    target_subpath: Mapped[str | None] = mapped_column(String(512), nullable=True)
    label: Mapped[str | None] = mapped_column(String(512), nullable=True)
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
