#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path


BUNDLE_PATTERN = re.compile(r"^(?P<stamp>\d{8}T\d{6}Z)-(?P<suffix>.+)$")


@dataclass(frozen=True)
class BackupBundle:
    path: Path
    created_at: datetime


def main() -> int:
    parser = argparse.ArgumentParser(description="Dry-run or delete old DocFerry backup bundles.")
    parser.add_argument("--backup-root", default=os.getenv("DOCFERRY_BACKUP_ROOT", "/root/backups/docferry"))
    parser.add_argument("--older-than-days", type=int, default=int(os.getenv("DOCFERRY_BACKUP_RETENTION_DAYS", "30")))
    parser.add_argument("--keep-last", type=int, default=int(os.getenv("DOCFERRY_BACKUP_KEEP_LAST", "7")))
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--now", help="UTC timestamp for deterministic tests, e.g. 2026-06-15T00:00:00Z.")
    parser.add_argument("--apply", action="store_true", help="Delete selected bundles. Default is dry-run.")
    args = parser.parse_args()

    if args.older_than_days < 0:
        print("prune-backups: --older-than-days must be >= 0", file=sys.stderr)
        return 2
    if args.keep_last < 0:
        print("prune-backups: --keep-last must be >= 0", file=sys.stderr)
        return 2
    if args.limit <= 0:
        print("prune-backups: --limit must be > 0", file=sys.stderr)
        return 2

    backup_root = Path(args.backup_root).expanduser().resolve()
    now = parse_now(args.now)
    cutoff = now - timedelta(days=args.older_than_days)
    bundles, ignored = discover_bundles(backup_root)
    candidates = select_candidates(bundles, cutoff, args.keep_last, args.limit)

    deleted: list[dict[str, object]] = []
    for bundle in candidates:
        deleted.append({"path": str(bundle.path), "created_at": bundle.created_at.isoformat()})
        if args.apply:
            shutil.rmtree(bundle.path)

    print(
        json.dumps(
            {
                "ok": True,
                "apply": args.apply,
                "backup_root": str(backup_root),
                "older_than_days": args.older_than_days,
                "keep_last": args.keep_last,
                "cutoff": cutoff.isoformat(),
                "bundle_count": len(bundles),
                "ignored_count": len(ignored),
                "candidate_count": len(candidates),
                "deleted_count": len(candidates) if args.apply else 0,
                "candidates": deleted,
                "ignored": [str(path) for path in ignored],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


def parse_now(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    normalized = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def discover_bundles(backup_root: Path) -> tuple[list[BackupBundle], list[Path]]:
    if not backup_root.exists():
        return [], []
    bundles: list[BackupBundle] = []
    ignored: list[Path] = []
    for path in backup_root.iterdir():
        if not path.is_dir():
            ignored.append(path)
            continue
        match = BUNDLE_PATTERN.match(path.name)
        if not match:
            ignored.append(path)
            continue
        created_at = datetime.strptime(match.group("stamp"), "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        bundles.append(BackupBundle(path=path, created_at=created_at))
    bundles.sort(key=lambda item: item.created_at, reverse=True)
    return bundles, ignored


def select_candidates(
    bundles: list[BackupBundle],
    cutoff: datetime,
    keep_last: int,
    limit: int,
) -> list[BackupBundle]:
    protected = {bundle.path for bundle in bundles[:keep_last]}
    candidates = [bundle for bundle in bundles if bundle.path not in protected and bundle.created_at < cutoff]
    return candidates[:limit]


if __name__ == "__main__":
    raise SystemExit(main())
