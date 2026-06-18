"""Merge cloud quota and legacy SynapseHub auth branches.

Revision ID: 0011_merge_cloud_synapse
Revises: 0010_free_quota_five, 0007_synapsehub_auth
Create Date: 2026-06-17 00:00:00.000000
"""

from collections.abc import Sequence


revision: str = "0011_merge_cloud_synapse"
down_revision: str | tuple[str, ...] | None = (
    "0010_free_quota_five",
    "0007_synapsehub_auth",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """No-op merge point for deployments that already contain SynapseHub auth."""


def downgrade() -> None:
    """No-op merge point."""
