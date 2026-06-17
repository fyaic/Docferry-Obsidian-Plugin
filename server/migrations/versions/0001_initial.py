"""Initial share tables.

Revision ID: 0001_initial
Revises:
Create Date: 2026-06-09
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("display_name", sa.String(length=160), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "shares",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("owner_id", sa.String(length=64), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("slug", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("source_path", sa.String(length=1024), nullable=False),
        sa.Column("source_hash", sa.String(length=128), nullable=False),
        sa.Column("markdown", sa.Text(), nullable=False),
        sa.Column("html_snapshot", sa.Text(), nullable=True),
        sa.Column("render_mode", sa.String(length=32), nullable=False),
        sa.Column("css_asset_id", sa.String(length=64), nullable=True),
        sa.Column("assets", sa.JSON(), nullable=False),
        sa.Column("client", sa.JSON(), nullable=False),
        sa.Column("password_hash", sa.String(length=512), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stopped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_published_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_shares_owner_id", "shares", ["owner_id"])
    op.create_index("ix_shares_slug", "shares", ["slug"], unique=True)
    op.create_index("ix_shares_source_hash", "shares", ["source_hash"])


def downgrade() -> None:
    op.drop_index("ix_shares_source_hash", table_name="shares")
    op.drop_index("ix_shares_slug", table_name="shares")
    op.drop_index("ix_shares_owner_id", table_name="shares")
    op.drop_table("shares")
    op.drop_table("users")
