"""Add share link index tables.

Revision ID: 0004_share_links
Revises: 0003_assets
Create Date: 2026-06-12
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0004_share_links"
down_revision = "0003_assets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("shares", sa.Column("vault_id", sa.String(length=128), nullable=True))
    op.add_column("shares", sa.Column("source_path_normalized", sa.String(length=1024), nullable=True))
    op.add_column("shares", sa.Column("doc_identity", sa.String(length=128), nullable=True))
    op.create_index("ix_shares_vault_id", "shares", ["vault_id"])
    op.create_index("ix_shares_source_path_normalized", "shares", ["source_path_normalized"])
    op.create_index("ix_shares_doc_identity", "shares", ["doc_identity"])

    op.create_table(
        "share_links",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("source_share_id", sa.String(length=64), sa.ForeignKey("shares.id"), nullable=False),
        sa.Column("owner_id", sa.String(length=64), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("vault_id", sa.String(length=128), nullable=True),
        sa.Column("raw_target", sa.String(length=1024), nullable=False),
        sa.Column("target_path", sa.String(length=1024), nullable=True),
        sa.Column("target_doc_identity", sa.String(length=128), nullable=True),
        sa.Column("target_subpath", sa.String(length=512), nullable=True),
        sa.Column("label", sa.String(length=512), nullable=True),
        sa.Column("link_kind", sa.String(length=40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_share_links_source_share_id", "share_links", ["source_share_id"])
    op.create_index("ix_share_links_owner_id", "share_links", ["owner_id"])
    op.create_index("ix_share_links_vault_id", "share_links", ["vault_id"])
    op.create_index("ix_share_links_target_path", "share_links", ["target_path"])
    op.create_index("ix_share_links_target_doc_identity", "share_links", ["target_doc_identity"])
    op.create_index("ix_share_links_owner_vault_target_path", "share_links", ["owner_id", "vault_id", "target_path"])
    op.create_index(
        "ix_share_links_owner_vault_target_doc",
        "share_links",
        ["owner_id", "vault_id", "target_doc_identity"],
    )


def downgrade() -> None:
    op.drop_index("ix_share_links_owner_vault_target_doc", table_name="share_links")
    op.drop_index("ix_share_links_owner_vault_target_path", table_name="share_links")
    op.drop_index("ix_share_links_target_doc_identity", table_name="share_links")
    op.drop_index("ix_share_links_target_path", table_name="share_links")
    op.drop_index("ix_share_links_vault_id", table_name="share_links")
    op.drop_index("ix_share_links_owner_id", table_name="share_links")
    op.drop_index("ix_share_links_source_share_id", table_name="share_links")
    op.drop_table("share_links")

    op.drop_index("ix_shares_doc_identity", table_name="shares")
    op.drop_index("ix_shares_source_path_normalized", table_name="shares")
    op.drop_index("ix_shares_vault_id", table_name="shares")
    op.drop_column("shares", "doc_identity")
    op.drop_column("shares", "source_path_normalized")
    op.drop_column("shares", "vault_id")
