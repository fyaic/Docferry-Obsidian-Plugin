"""Add objectized document snapshot asset references.

Revision ID: 0005_snapshot_assets
Revises: 0004_share_links
Create Date: 2026-06-12
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0005_snapshot_assets"
down_revision = "0004_share_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("shares", sa.Column("markdown_asset_id", sa.String(length=64), nullable=True))
    op.add_column("shares", sa.Column("html_snapshot_asset_id", sa.String(length=64), nullable=True))
    with op.batch_alter_table("shares") as batch_op:
        batch_op.alter_column("markdown", existing_type=sa.Text(), nullable=True)
    op.create_index("ix_shares_markdown_asset_id", "shares", ["markdown_asset_id"])
    op.create_index("ix_shares_html_snapshot_asset_id", "shares", ["html_snapshot_asset_id"])


def downgrade() -> None:
    op.drop_index("ix_shares_html_snapshot_asset_id", table_name="shares")
    op.drop_index("ix_shares_markdown_asset_id", table_name="shares")
    with op.batch_alter_table("shares") as batch_op:
        batch_op.alter_column("markdown", existing_type=sa.Text(), nullable=False)
    op.drop_column("shares", "html_snapshot_asset_id")
    op.drop_column("shares", "markdown_asset_id")
