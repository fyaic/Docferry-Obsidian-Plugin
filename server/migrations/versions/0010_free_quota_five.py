"""Reduce free Cloud active-share quota to five.

Revision ID: 0010_free_quota_five
Revises: 0009_cloud_claims
Create Date: 2026-06-17
"""

from __future__ import annotations

from alembic import op

revision = "0010_free_quota_five"
down_revision = "0009_cloud_claims"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE user_tokens SET active_share_limit = 5 WHERE active_share_limit = 10")


def downgrade() -> None:
    op.execute("UPDATE user_tokens SET active_share_limit = 10 WHERE active_share_limit = 5")
