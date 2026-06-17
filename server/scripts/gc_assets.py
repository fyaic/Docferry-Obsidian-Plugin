#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import timedelta
from pathlib import Path

from sqlalchemy import func, select, union_all

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings
from app.database import make_engine, make_session_factory
from app.models import Asset, Share, ShareAsset, utc_now
from app.storage import FileObjectStorage


def main() -> int:
    parser = argparse.ArgumentParser(description="Dry-run or delete unreferenced Docferry assets.")
    parser.add_argument("--database-url", default=os.getenv("DOCFERRY_DATABASE_URL", Settings.database_url))
    parser.add_argument(
        "--object-storage-root",
        default=os.getenv("DOCFERRY_OBJECT_STORAGE_ROOT", Settings.object_storage_root),
    )
    parser.add_argument("--older-than-days", type=int, default=7)
    parser.add_argument("--owner-id")
    parser.add_argument("--limit", type=int, default=1000)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    if args.older_than_days < 0:
        print("gc-assets: --older-than-days must be >= 0", file=sys.stderr)
        return 2
    if args.limit <= 0:
        print("gc-assets: --limit must be > 0", file=sys.stderr)
        return 2

    engine = make_engine(args.database_url)
    session_factory = make_session_factory(engine)
    storage = FileObjectStorage(args.object_storage_root)

    cutoff = utc_now() - timedelta(days=args.older_than_days)
    with session_factory() as db:
        referenced_asset_ids = union_all(
            select(ShareAsset.asset_id.label("asset_id")),
            select(Share.markdown_asset_id.label("asset_id")).where(Share.markdown_asset_id.is_not(None)),
            select(Share.html_snapshot_asset_id.label("asset_id")).where(Share.html_snapshot_asset_id.is_not(None)),
        ).subquery()
        statement = (
            select(Asset)
            .where(Asset.id.not_in(select(referenced_asset_ids.c.asset_id)))
            .where(func.coalesce(Asset.last_used_at, Asset.created_at) < cutoff)
            .order_by(Asset.created_at)
            .limit(args.limit)
        )
        if args.owner_id:
            statement = statement.where(Asset.owner_id == args.owner_id)

        candidates = list(db.execute(statement).scalars().all())
        deleted = []
        for asset in candidates:
            file_deleted = False
            if args.apply:
                file_deleted = storage.delete(asset.storage_key)
                db.delete(asset)
            deleted.append(
                {
                    "asset_id": asset.id,
                    "owner_id": asset.owner_id,
                    "byte_length": asset.byte_length,
                    "content_type": asset.content_type,
                    "storage_key": asset.storage_key,
                    "file_deleted": file_deleted,
                }
            )
        if args.apply:
            db.commit()

    print(
        json.dumps(
            {
                "ok": True,
                "apply": args.apply,
                "older_than_days": args.older_than_days,
                "candidate_count": len(candidates),
                "deleted_count": len(deleted) if args.apply else 0,
                "assets": deleted,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
