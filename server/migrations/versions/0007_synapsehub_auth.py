"""Add SynapseHub auth session tables.

Revision ID: 0007_synapsehub_auth
Revises: 0006_system_events
Create Date: 2026-06-16
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0007_synapsehub_auth"
down_revision = "0006_system_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("shares", sa.Column("owner_product_subject_id", sa.String(length=128), nullable=True))
    op.add_column("assets", sa.Column("owner_product_subject_id", sa.String(length=128), nullable=True))
    op.add_column("share_links", sa.Column("owner_product_subject_id", sa.String(length=128), nullable=True))
    op.create_index("ix_shares_owner_product_subject_id", "shares", ["owner_product_subject_id"])
    op.create_index("ix_assets_owner_product_subject_id", "assets", ["owner_product_subject_id"])
    op.create_index("ix_share_links_owner_product_subject_id", "share_links", ["owner_product_subject_id"])

    op.create_table(
        "docferry_auth_codes",
        sa.Column("code_hash", sa.String(length=128), primary_key=True),
        sa.Column("state", sa.String(length=512), nullable=False),
        sa.Column("product_subject_id", sa.String(length=128), nullable=False),
        sa.Column("subject_id", sa.String(length=128), nullable=True),
        sa.Column("product_key", sa.String(length=64), nullable=False),
        sa.Column("product_instance_id", sa.String(length=128), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_docferry_auth_codes_state", "docferry_auth_codes", ["state"])
    op.create_index("ix_docferry_auth_codes_product_subject_id", "docferry_auth_codes", ["product_subject_id"])
    op.create_index("ix_docferry_auth_codes_product_key", "docferry_auth_codes", ["product_key"])
    op.create_index("ix_docferry_auth_codes_expires_at", "docferry_auth_codes", ["expires_at"])

    op.create_table(
        "docferry_auth_sessions",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("token_hash", sa.String(length=128), nullable=False, unique=True),
        sa.Column("product_subject_id", sa.String(length=128), nullable=False),
        sa.Column("subject_id", sa.String(length=128), nullable=True),
        sa.Column("product_key", sa.String(length=64), nullable=False),
        sa.Column("product_instance_id", sa.String(length=128), nullable=True),
        sa.Column("scopes", sa.JSON(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_docferry_auth_sessions_token_hash", "docferry_auth_sessions", ["token_hash"])
    op.create_index(
        "ix_docferry_auth_sessions_product_subject_id",
        "docferry_auth_sessions",
        ["product_subject_id"],
    )
    op.create_index("ix_docferry_auth_sessions_product_key", "docferry_auth_sessions", ["product_key"])
    op.create_index("ix_docferry_auth_sessions_expires_at", "docferry_auth_sessions", ["expires_at"])
    op.create_index("ix_docferry_auth_sessions_revoked_at", "docferry_auth_sessions", ["revoked_at"])

    op.create_table(
        "docferry_plugin_instances",
        sa.Column("product_instance_id", sa.String(length=128), primary_key=True),
        sa.Column("product_subject_id", sa.String(length=128), nullable=False),
        sa.Column("subject_id", sa.String(length=128), nullable=True),
        sa.Column("client_instance_id", sa.String(length=128), nullable=True),
        sa.Column("plugin_version", sa.String(length=40), nullable=True),
        sa.Column("platform", sa.String(length=80), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_docferry_plugin_instances_product_subject_id",
        "docferry_plugin_instances",
        ["product_subject_id"],
    )
    op.create_index("ix_docferry_plugin_instances_revoked_at", "docferry_plugin_instances", ["revoked_at"])


def downgrade() -> None:
    op.drop_index("ix_docferry_plugin_instances_revoked_at", table_name="docferry_plugin_instances")
    op.drop_index("ix_docferry_plugin_instances_product_subject_id", table_name="docferry_plugin_instances")
    op.drop_table("docferry_plugin_instances")

    op.drop_index("ix_docferry_auth_sessions_revoked_at", table_name="docferry_auth_sessions")
    op.drop_index("ix_docferry_auth_sessions_expires_at", table_name="docferry_auth_sessions")
    op.drop_index("ix_docferry_auth_sessions_product_key", table_name="docferry_auth_sessions")
    op.drop_index("ix_docferry_auth_sessions_product_subject_id", table_name="docferry_auth_sessions")
    op.drop_index("ix_docferry_auth_sessions_token_hash", table_name="docferry_auth_sessions")
    op.drop_table("docferry_auth_sessions")

    op.drop_index("ix_docferry_auth_codes_expires_at", table_name="docferry_auth_codes")
    op.drop_index("ix_docferry_auth_codes_product_key", table_name="docferry_auth_codes")
    op.drop_index("ix_docferry_auth_codes_product_subject_id", table_name="docferry_auth_codes")
    op.drop_index("ix_docferry_auth_codes_state", table_name="docferry_auth_codes")
    op.drop_table("docferry_auth_codes")

    op.drop_index("ix_share_links_owner_product_subject_id", table_name="share_links")
    op.drop_index("ix_assets_owner_product_subject_id", table_name="assets")
    op.drop_index("ix_shares_owner_product_subject_id", table_name="shares")
    op.drop_column("share_links", "owner_product_subject_id")
    op.drop_column("assets", "owner_product_subject_id")
    op.drop_column("shares", "owner_product_subject_id")
