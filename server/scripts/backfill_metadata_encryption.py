#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import replace
from pathlib import Path

from sqlalchemy import or_, select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings
from app.database import make_engine, make_session_factory
from app.encryption import EncryptionService
from app.main import (
    METADATA_HASH_PREFIX,
    METADATA_PATH_PLACEHOLDER,
    METADATA_RAW_TARGET_PLACEHOLDER,
    METADATA_TITLE_PLACEHOLDER,
    apply_asset_metadata,
    assign_link_target_path_indexes,
    assign_share_path_indexes,
    normalize_obsidian_link_target,
    normalize_share_path,
    text_index,
)
from app.metadata_security import blind_index, encrypt_metadata_json, encrypt_metadata_text
from app.models import Asset, Share, ShareAsset, ShareLink


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill legacy plaintext metadata into encrypted fields and blind indexes."
    )
    parser.add_argument("--database-url", default=os.getenv("DOCFERRY_DATABASE_URL", Settings.database_url))
    parser.add_argument("--owner-id")
    parser.add_argument("--limit", type=int, default=1000)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    if args.limit <= 0:
        print("backfill-metadata-encryption: --limit must be > 0", file=sys.stderr)
        return 2

    settings = replace(Settings.from_env(), database_url=args.database_url)
    encryption = EncryptionService(settings)
    if args.apply and not encryption.enabled:
        print("backfill-metadata-encryption: DOCFERRY_MASTER_KEY_B64 is required with --apply", file=sys.stderr)
        return 2

    engine = make_engine(settings.database_url)
    session_factory = make_session_factory(engine)
    summary = {
        "apply": args.apply,
        "shares": 0,
        "assets": 0,
        "share_assets": 0,
        "share_links": 0,
        "skipped": 0,
    }

    with session_factory() as db:
        share_statement = (
            select(Share)
            .where(Share.stopped_at.is_(None))
            .where(
                or_(
                    Share.title_enc.is_(None),
                    Share.source_path_enc.is_(None),
                    Share.source_hash_enc.is_(None),
                    Share.client_enc.is_(None),
                )
            )
            .order_by(Share.created_at)
            .limit(args.limit)
        )
        if args.owner_id:
            share_statement = share_statement.where(Share.owner_id == args.owner_id)
        for share in db.execute(share_statement).scalars().all():
            if share.source_hash.startswith(METADATA_HASH_PREFIX):
                summary["skipped"] += 1
                continue
            summary["shares"] += 1
            if args.apply:
                source_path_normalized = share.source_path_normalized or normalize_share_path(share.source_path)
                share.title_enc = encrypt_metadata_text(encryption, "share", "title", share.id, share.title)
                share.title = METADATA_TITLE_PLACEHOLDER
                share.vault_id_enc = encrypt_metadata_text(encryption, "share", "vault_id", share.id, share.vault_id)
                share.vault_id_index = text_index(settings, "vault_id", share.vault_id)
                share.vault_id = None
                share.source_path_enc = encrypt_metadata_text(
                    encryption, "share", "source_path", share.id, share.source_path
                )
                share.source_path = METADATA_PATH_PLACEHOLDER
                share.source_path_normalized_enc = encrypt_metadata_text(
                    encryption,
                    "share",
                    "source_path_normalized",
                    share.id,
                    source_path_normalized,
                )
                share.source_path_normalized = None
                assign_share_path_indexes(share, settings, source_path_normalized)
                share.doc_identity_enc = encrypt_metadata_text(
                    encryption, "share", "doc_identity", share.id, share.doc_identity
                )
                share.doc_identity_index = text_index(settings, "doc_identity", share.doc_identity)
                share.doc_identity = None
                share.source_hash_enc = encrypt_metadata_text(
                    encryption, "share", "source_hash", share.id, share.source_hash
                )
                share.source_hash_index = text_index(settings, "share.source_hash", share.source_hash, lowercase=True)
                share.source_hash = f"{METADATA_HASH_PREFIX}{share.id}"
                share.assets_enc = encrypt_metadata_json(encryption, "share", "assets", share.id, share.assets or [])
                share.assets = []
                share.client_enc = encrypt_metadata_json(encryption, "share", "client", share.id, share.client or {})
                share.client = {}

        asset_statement = (
            select(Asset)
            .where(or_(Asset.hash_enc.is_(None), Asset.filename_enc.is_(None)))
            .order_by(Asset.created_at)
            .limit(args.limit)
        )
        if args.owner_id:
            asset_statement = asset_statement.where(Asset.owner_id == args.owner_id)
        for asset in db.execute(asset_statement).scalars().all():
            if asset.hash.startswith(METADATA_HASH_PREFIX):
                summary["skipped"] += 1
                continue
            summary["assets"] += 1
            if args.apply:
                apply_asset_metadata(asset, encryption, settings, asset.hash, asset.filename)

        share_asset_statement = (
            select(ShareAsset)
            .where(ShareAsset.original_path.is_not(None), ShareAsset.original_path_enc.is_(None))
            .order_by(ShareAsset.created_at)
            .limit(args.limit)
        )
        if args.owner_id:
            share_asset_statement = share_asset_statement.join(Share, Share.id == ShareAsset.share_id).where(
                Share.owner_id == args.owner_id
            )
        for link in db.execute(share_asset_statement).scalars().all():
            summary["share_assets"] += 1
            if args.apply:
                link.original_path_enc = encrypt_metadata_text(
                    encryption,
                    "share_asset",
                    "original_path",
                    f"{link.share_id}:{link.asset_id}",
                    link.original_path,
                )
                link.original_path = None

        share_link_statement = (
            select(ShareLink)
            .where(or_(ShareLink.raw_target_enc.is_(None), ShareLink.raw_target_index.is_(None)))
            .order_by(ShareLink.created_at)
            .limit(args.limit)
        )
        if args.owner_id:
            share_link_statement = share_link_statement.where(ShareLink.owner_id == args.owner_id)
        for link in db.execute(share_link_statement).scalars().all():
            if link.raw_target == METADATA_RAW_TARGET_PLACEHOLDER:
                summary["skipped"] += 1
                continue
            summary["share_links"] += 1
            if args.apply:
                target_path = normalize_share_path(link.target_path) if link.target_path else None
                link.vault_id_enc = encrypt_metadata_text(encryption, "share_link", "vault_id", link.id, link.vault_id)
                link.vault_id_index = text_index(settings, "vault_id", link.vault_id)
                link.vault_id = None
                link.raw_target_enc = encrypt_metadata_text(
                    encryption, "share_link", "raw_target", link.id, link.raw_target
                )
                link.raw_target_index = blind_index(
                    settings,
                    "share_link.raw_target",
                    normalize_obsidian_link_target(link.raw_target),
                )
                link.raw_target = METADATA_RAW_TARGET_PLACEHOLDER
                link.target_path_enc = encrypt_metadata_text(
                    encryption, "share_link", "target_path", link.id, target_path
                )
                assign_link_target_path_indexes(link, settings, target_path)
                link.target_path = None
                link.target_doc_identity_enc = encrypt_metadata_text(
                    encryption,
                    "share_link",
                    "target_doc_identity",
                    link.id,
                    link.target_doc_identity,
                )
                link.target_doc_identity_index = text_index(settings, "doc_identity", link.target_doc_identity)
                link.target_doc_identity = None
                link.target_subpath_enc = encrypt_metadata_text(
                    encryption, "share_link", "target_subpath", link.id, link.target_subpath
                )
                link.target_subpath = None
                link.label_enc = encrypt_metadata_text(encryption, "share_link", "label", link.id, link.label)
                link.label = None

        if args.apply:
            db.commit()

    print(json.dumps(summary, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
