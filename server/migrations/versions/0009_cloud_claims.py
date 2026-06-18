"""Add anonymous cloud claim tables.

Revision ID: 0009_cloud_claims
Revises: 0008_metadata_encryption
Create Date: 2026-06-17
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0009_cloud_claims"
down_revision = "0008_metadata_encryption"
branch_labels = None
depends_on = None


def _table_exists(inspector: sa.Inspector, table_name: str) -> bool:
    return table_name in inspector.get_table_names()


def _column_exists(inspector: sa.Inspector, table_name: str, column_name: str) -> bool:
    if not _table_exists(inspector, table_name):
        return False
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def _index_exists(inspector: sa.Inspector, table_name: str, index_name: str) -> bool:
    if not _table_exists(inspector, table_name):
        return False
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def _create_index_if_missing(
    inspector: sa.Inspector,
    index_name: str,
    table_name: str,
    columns: list[str],
    *,
    unique: bool = False,
) -> None:
    if not _index_exists(inspector, table_name, index_name):
        op.create_index(index_name, table_name, columns, unique=unique)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not _table_exists(inspector, "cloud_installs"):
        op.create_table(
            "cloud_installs",
            sa.Column("id", sa.String(length=64), primary_key=True),
            sa.Column("install_id_hash", sa.String(length=64), nullable=False),
            sa.Column("user_id", sa.String(length=64), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("first_claimed_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_claimed_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("replacement_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("last_ip_hash", sa.String(length=64), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
        inspector = sa.inspect(op.get_bind())
    _create_index_if_missing(
        inspector,
        "ix_cloud_installs_install_id_hash",
        "cloud_installs",
        ["install_id_hash"],
        unique=True,
    )
    _create_index_if_missing(inspector, "ix_cloud_installs_user_id", "cloud_installs", ["user_id"])

    inspector = sa.inspect(op.get_bind())
    if not _table_exists(inspector, "cloud_claim_events"):
        op.create_table(
            "cloud_claim_events",
            sa.Column("id", sa.String(length=64), primary_key=True),
            sa.Column("install_id_hash", sa.String(length=64), nullable=False),
            sa.Column("ip_hash", sa.String(length=64), nullable=True),
            sa.Column("result", sa.String(length=40), nullable=False),
            sa.Column("plugin_version", sa.String(length=40), nullable=True),
            sa.Column("obsidian_version", sa.String(length=40), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        inspector = sa.inspect(op.get_bind())
    _create_index_if_missing(
        inspector,
        "ix_cloud_claim_events_install_id_hash",
        "cloud_claim_events",
        ["install_id_hash"],
    )
    _create_index_if_missing(inspector, "ix_cloud_claim_events_ip_hash", "cloud_claim_events", ["ip_hash"])
    _create_index_if_missing(inspector, "ix_cloud_claim_events_result", "cloud_claim_events", ["result"])
    _create_index_if_missing(
        inspector,
        "ix_cloud_claim_events_created_at",
        "cloud_claim_events",
        ["created_at"],
    )

    inspector = sa.inspect(op.get_bind())
    if not _column_exists(inspector, "user_tokens", "install_id"):
        with op.batch_alter_table("user_tokens", recreate="always") as batch_op:
            batch_op.add_column(sa.Column("install_id", sa.String(length=64), nullable=True))
            batch_op.create_foreign_key(
                "fk_user_tokens_install_id_cloud_installs",
                "cloud_installs",
                ["install_id"],
                ["id"],
            )
            batch_op.create_index("ix_user_tokens_install_id", ["install_id"])
    elif not _index_exists(inspector, "user_tokens", "ix_user_tokens_install_id"):
        op.create_index("ix_user_tokens_install_id", "user_tokens", ["install_id"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if _column_exists(inspector, "user_tokens", "install_id"):
        with op.batch_alter_table("user_tokens", recreate="always") as batch_op:
            if _index_exists(inspector, "user_tokens", "ix_user_tokens_install_id"):
                batch_op.drop_index("ix_user_tokens_install_id")
            batch_op.drop_constraint("fk_user_tokens_install_id_cloud_installs", type_="foreignkey")
            batch_op.drop_column("install_id")

    inspector = sa.inspect(op.get_bind())
    if _table_exists(inspector, "cloud_claim_events"):
        for index_name in (
            "ix_cloud_claim_events_created_at",
            "ix_cloud_claim_events_result",
            "ix_cloud_claim_events_ip_hash",
            "ix_cloud_claim_events_install_id_hash",
        ):
            if _index_exists(inspector, "cloud_claim_events", index_name):
                op.drop_index(index_name, table_name="cloud_claim_events")
        op.drop_table("cloud_claim_events")

    inspector = sa.inspect(op.get_bind())
    if _table_exists(inspector, "cloud_installs"):
        for index_name in ("ix_cloud_installs_user_id", "ix_cloud_installs_install_id_hash"):
            if _index_exists(inspector, "cloud_installs", index_name):
                op.drop_index(index_name, table_name="cloud_installs")
        op.drop_table("cloud_installs")
