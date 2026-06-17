"""Add asset storage tables.

Revision ID: 0003_assets
Revises: 0002_share_access_events
Create Date: 2026-06-11
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0003_assets"
down_revision = "0002_share_access_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assets",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("owner_id", sa.String(length=64), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("hash", sa.String(length=128), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=120), nullable=False),
        sa.Column("byte_length", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(length=512), nullable=False),
        sa.Column("public_url", sa.String(length=2048), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("owner_id", "hash", name="uq_assets_owner_hash"),
    )
    op.create_index("ix_assets_owner_id", "assets", ["owner_id"])
    op.create_index("ix_assets_storage_key", "assets", ["storage_key"], unique=True)

    op.create_table(
        "share_assets",
        sa.Column("share_id", sa.String(length=64), sa.ForeignKey("shares.id"), primary_key=True),
        sa.Column("asset_id", sa.String(length=64), sa.ForeignKey("assets.id"), primary_key=True),
        sa.Column("role", sa.String(length=40), nullable=False),
        sa.Column("original_path", sa.String(length=1024), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_share_assets_asset_id", "share_assets", ["asset_id"])


def downgrade() -> None:
    op.drop_index("ix_share_assets_asset_id", table_name="share_assets")
    op.drop_table("share_assets")
    op.drop_index("ix_assets_storage_key", table_name="assets")
    op.drop_index("ix_assets_owner_id", table_name="assets")
    op.drop_table("assets")
