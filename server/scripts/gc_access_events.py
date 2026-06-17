#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import timedelta
from pathlib import Path

from sqlalchemy import delete, select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings
from app.database import make_engine, make_session_factory
from app.models import ShareAccessEvent, utc_now


def main() -> int:
    parser = argparse.ArgumentParser(description="Dry-run or delete old DocFerry share access events.")
    parser.add_argument("--database-url", default=os.getenv("DOCFERRY_DATABASE_URL", Settings.database_url))
    parser.add_argument("--older-than-days", type=int, default=90)
    parser.add_argument("--limit", type=int, default=10000)
    parser.add_argument("--share-id")
    parser.add_argument("--event-type")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    if args.older_than_days < 0:
        print("gc-access-events: --older-than-days must be >= 0", file=sys.stderr)
        return 2
    if args.limit <= 0:
        print("gc-access-events: --limit must be > 0", file=sys.stderr)
        return 2

    engine = make_engine(args.database_url)
    session_factory = make_session_factory(engine)
    cutoff = utc_now() - timedelta(days=args.older_than_days)

    with session_factory() as db:
        statement = (
            select(ShareAccessEvent.id)
            .where(ShareAccessEvent.created_at < cutoff)
            .order_by(ShareAccessEvent.created_at)
            .limit(args.limit)
        )
        if args.share_id:
            statement = statement.where(ShareAccessEvent.share_id == args.share_id)
        if args.event_type:
            statement = statement.where(ShareAccessEvent.event_type == args.event_type)

        event_ids = list(db.execute(statement).scalars().all())
        if args.apply and event_ids:
            db.execute(delete(ShareAccessEvent).where(ShareAccessEvent.id.in_(event_ids)))
            db.commit()

    print(
        json.dumps(
            {
                "ok": True,
                "apply": args.apply,
                "older_than_days": args.older_than_days,
                "limit": args.limit,
                "share_id": args.share_id,
                "event_type": args.event_type,
                "candidate_count": len(event_ids),
                "deleted_count": len(event_ids) if args.apply else 0,
                "event_ids": event_ids,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
