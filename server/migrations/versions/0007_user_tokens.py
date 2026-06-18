"""Add user token table.

Revision ID: 0007_user_tokens
Revises: 0006_system_events
Create Date: 2026-06-17
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0007_user_tokens"
down_revision = "0006_system_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "user_tokens" in inspector.get_table_names():
        return

    op.create_table(
        "user_tokens",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("user_id", sa.String(length=64), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=160), nullable=True),
        sa.Column("active_share_limit", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_user_tokens_user_id", "user_tokens", ["user_id"])
    op.create_index("ix_user_tokens_token_hash", "user_tokens", ["token_hash"], unique=True)


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "user_tokens" not in inspector.get_table_names():
        return

    op.drop_index("ix_user_tokens_token_hash", table_name="user_tokens")
    op.drop_index("ix_user_tokens_user_id", table_name="user_tokens")
    op.drop_table("user_tokens")
