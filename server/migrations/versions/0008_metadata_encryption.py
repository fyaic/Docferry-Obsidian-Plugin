"""Add encrypted metadata columns and blind indexes.

Revision ID: 0008_metadata_encryption
Revises: 0007_user_tokens
Create Date: 2026-06-17 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0008_metadata_encryption"
down_revision = "0007_user_tokens"
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


def _add_column_if_missing(inspector: sa.Inspector, table_name: str, column: sa.Column) -> None:
    if not _column_exists(inspector, table_name, column.name):
        op.add_column(table_name, column)


def _drop_column_if_exists(inspector: sa.Inspector, table_name: str, column_name: str) -> None:
    if _column_exists(inspector, table_name, column_name):
        op.drop_column(table_name, column_name)


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


def _drop_index_if_exists(inspector: sa.Inspector, index_name: str, table_name: str) -> None:
    if _index_exists(inspector, table_name, index_name):
        op.drop_index(index_name, table_name=table_name)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    for column in (
        sa.Column("title_enc", sa.Text(), nullable=True),
        sa.Column("vault_id_enc", sa.Text(), nullable=True),
        sa.Column("vault_id_index", sa.String(length=64), nullable=True),
        sa.Column("source_path_enc", sa.Text(), nullable=True),
        sa.Column("source_path_normalized_enc", sa.Text(), nullable=True),
        sa.Column("source_path_full_index", sa.String(length=64), nullable=True),
        sa.Column("source_path_extless_index", sa.String(length=64), nullable=True),
        sa.Column("source_path_basename_index", sa.String(length=64), nullable=True),
        sa.Column("source_path_basename_extless_index", sa.String(length=64), nullable=True),
        sa.Column("doc_identity_enc", sa.Text(), nullable=True),
        sa.Column("doc_identity_index", sa.String(length=64), nullable=True),
        sa.Column("source_hash_enc", sa.Text(), nullable=True),
        sa.Column("source_hash_index", sa.String(length=64), nullable=True),
        sa.Column("assets_enc", sa.Text(), nullable=True),
        sa.Column("client_enc", sa.Text(), nullable=True),
    ):
        _add_column_if_missing(inspector, "shares", column)
    for column in (
        "vault_id_index",
        "source_path_full_index",
        "source_path_extless_index",
        "source_path_basename_index",
        "source_path_basename_extless_index",
        "doc_identity_index",
        "source_hash_index",
    ):
        _create_index_if_missing(inspector, f"ix_shares_{column}", "shares", [column])

    for column in (
        sa.Column("hash_enc", sa.Text(), nullable=True),
        sa.Column("hash_index", sa.String(length=64), nullable=True),
        sa.Column("filename_enc", sa.Text(), nullable=True),
    ):
        _add_column_if_missing(inspector, "assets", column)
    _create_index_if_missing(inspector, "ix_assets_hash_index", "assets", ["hash_index"])
    _create_index_if_missing(
        inspector,
        "uq_assets_owner_hash_index",
        "assets",
        ["owner_id", "hash_index"],
        unique=True,
    )

    _add_column_if_missing(inspector, "share_assets", sa.Column("original_path_enc", sa.Text(), nullable=True))

    for column in (
        sa.Column("vault_id_enc", sa.Text(), nullable=True),
        sa.Column("vault_id_index", sa.String(length=64), nullable=True),
        sa.Column("raw_target_enc", sa.Text(), nullable=True),
        sa.Column("raw_target_index", sa.String(length=64), nullable=True),
        sa.Column("target_path_enc", sa.Text(), nullable=True),
        sa.Column("target_path_full_index", sa.String(length=64), nullable=True),
        sa.Column("target_path_extless_index", sa.String(length=64), nullable=True),
        sa.Column("target_path_basename_index", sa.String(length=64), nullable=True),
        sa.Column("target_path_basename_extless_index", sa.String(length=64), nullable=True),
        sa.Column("target_doc_identity_enc", sa.Text(), nullable=True),
        sa.Column("target_doc_identity_index", sa.String(length=64), nullable=True),
        sa.Column("target_subpath_enc", sa.Text(), nullable=True),
        sa.Column("label_enc", sa.Text(), nullable=True),
    ):
        _add_column_if_missing(inspector, "share_links", column)
    for column in (
        "vault_id_index",
        "raw_target_index",
        "target_path_full_index",
        "target_path_extless_index",
        "target_path_basename_index",
        "target_path_basename_extless_index",
        "target_doc_identity_index",
    ):
        _create_index_if_missing(inspector, f"ix_share_links_{column}", "share_links", [column])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    for column in (
        "target_doc_identity_index",
        "target_path_basename_extless_index",
        "target_path_basename_index",
        "target_path_extless_index",
        "target_path_full_index",
        "raw_target_index",
        "vault_id_index",
    ):
        _drop_index_if_exists(inspector, f"ix_share_links_{column}", "share_links")
    for column in (
        "label_enc",
        "target_subpath_enc",
        "target_doc_identity_index",
        "target_doc_identity_enc",
        "target_path_basename_extless_index",
        "target_path_basename_index",
        "target_path_extless_index",
        "target_path_full_index",
        "target_path_enc",
        "raw_target_index",
        "raw_target_enc",
        "vault_id_index",
        "vault_id_enc",
    ):
        _drop_column_if_exists(inspector, "share_links", column)

    _drop_column_if_exists(inspector, "share_assets", "original_path_enc")

    _drop_index_if_exists(inspector, "uq_assets_owner_hash_index", "assets")
    _drop_index_if_exists(inspector, "ix_assets_hash_index", "assets")
    for column in ("filename_enc", "hash_index", "hash_enc"):
        _drop_column_if_exists(inspector, "assets", column)

    for column in (
        "source_hash_index",
        "doc_identity_index",
        "source_path_basename_extless_index",
        "source_path_basename_index",
        "source_path_extless_index",
        "source_path_full_index",
        "vault_id_index",
    ):
        _drop_index_if_exists(inspector, f"ix_shares_{column}", "shares")
    for column in (
        "client_enc",
        "assets_enc",
        "source_hash_index",
        "source_hash_enc",
        "doc_identity_index",
        "doc_identity_enc",
        "source_path_basename_extless_index",
        "source_path_basename_index",
        "source_path_extless_index",
        "source_path_full_index",
        "source_path_normalized_enc",
        "source_path_enc",
        "vault_id_index",
        "vault_id_enc",
        "title_enc",
    ):
        _drop_column_if_exists(inspector, "shares", column)
