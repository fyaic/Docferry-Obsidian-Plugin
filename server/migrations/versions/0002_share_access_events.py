"""Add share access events.

Revision ID: 0002_share_access_events
Revises: 0001_initial
Create Date: 2026-06-10
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0002_share_access_events"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "share_access_events",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("share_id", sa.String(length=64), sa.ForeignKey("shares.id"), nullable=True),
        sa.Column("slug", sa.String(length=32), nullable=True),
        sa.Column("event_type", sa.String(length=40), nullable=False),
        sa.Column("request_id", sa.String(length=64), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("ip_hash", sa.String(length=128), nullable=True),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_share_access_events_event_type", "share_access_events", ["event_type"])
    op.create_index("ix_share_access_events_request_id", "share_access_events", ["request_id"])
    op.create_index("ix_share_access_events_share_id", "share_access_events", ["share_id"])
    op.create_index("ix_share_access_events_slug", "share_access_events", ["slug"])


def downgrade() -> None:
    op.drop_index("ix_share_access_events_slug", table_name="share_access_events")
    op.drop_index("ix_share_access_events_share_id", table_name="share_access_events")
    op.drop_index("ix_share_access_events_request_id", table_name="share_access_events")
    op.drop_index("ix_share_access_events_event_type", table_name="share_access_events")
    op.drop_table("share_access_events")
