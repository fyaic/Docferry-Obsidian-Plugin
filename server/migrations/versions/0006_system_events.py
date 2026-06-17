"""Add system event log table.

Revision ID: 0006_system_events
Revises: 0005_snapshot_assets
Create Date: 2026-06-16
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0006_system_events"
down_revision = "0005_snapshot_assets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "system_events",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("event_type", sa.String(length=80), nullable=False),
        sa.Column("severity", sa.String(length=24), nullable=False),
        sa.Column("source", sa.String(length=80), nullable=False),
        sa.Column("dedupe_key", sa.String(length=160), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_system_events_event_type", "system_events", ["event_type"])
    op.create_index("ix_system_events_severity", "system_events", ["severity"])
    op.create_index("ix_system_events_source", "system_events", ["source"])
    op.create_index("ix_system_events_dedupe_key", "system_events", ["dedupe_key"])


def downgrade() -> None:
    op.drop_index("ix_system_events_dedupe_key", table_name="system_events")
    op.drop_index("ix_system_events_source", table_name="system_events")
    op.drop_index("ix_system_events_severity", table_name="system_events")
    op.drop_index("ix_system_events_event_type", table_name="system_events")
    op.drop_table("system_events")
