#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy.engine import make_url

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings


BUNDLE_PATTERN = re.compile(r"^\d{8}T\d{6}Z-.+$")
TEMP_DB_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")


@dataclass(frozen=True)
class BackupBundle:
    root: Path
    postgres_dump: Path
    objects_root: Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Restore a DocFerry backup bundle into a temporary DB and verify it.")
    parser.add_argument("--backup-root", default=os.getenv("DOCFERRY_BACKUP_ROOT", "/root/backups/docferry"))
    parser.add_argument("--bundle", help="Backup bundle path. Defaults to latest bundle under --backup-root.")
    parser.add_argument("--compose-file", default="docker-compose.prod.yml")
    parser.add_argument("--database-url", default=os.getenv("DOCFERRY_DATABASE_URL", Settings.database_url))
    parser.add_argument("--temp-db-name", default=f"docferry_restore_{utc_stamp()}")
    parser.add_argument("--slug", help="Optional share slug to verify through a temporary API.")
    parser.add_argument("--expect-title", help="Optional text expected in the temporary API share page.")
    parser.add_argument("--api-port", type=int, default=18878)
    parser.add_argument("--skip-api", action="store_true")
    parser.add_argument("--keep-temp-db", action="store_true")
    parser.add_argument("--apply", action="store_true", help="Create/restore/drop temp DB. Default is dry-run.")
    args = parser.parse_args()

    server_root = Path(__file__).resolve().parents[1]
    backup_root = Path(args.backup_root).expanduser().resolve()
    bundle = resolve_bundle(backup_root, args.bundle)
    temp_db_name = safe_temp_db_name(args.temp_db_name)
    plan = {
        "temp_db_name": temp_db_name,
        "bundle_root": str(bundle.root),
        "postgres_dump": str(bundle.postgres_dump),
        "objects_root": str(bundle.objects_root),
        "api_smoke": bool(args.slug and not args.skip_api),
        "api_port": args.api_port,
    }

    if not args.apply:
        print(json.dumps({"ok": True, "apply": False, "plan": plan}, ensure_ascii=False, indent=2))
        return 0

    created_db = False
    api_result: dict[str, Any] | None = None
    try:
        run_compose(args.compose_file, ["createdb", "-U", "docferry", temp_db_name], server_root)
        created_db = True
        restore_dump(args.compose_file, bundle.postgres_dump, temp_db_name, server_root)
        db_counts = query_db_counts(args.compose_file, temp_db_name, server_root)
        asset_check = verify_asset_files(args.compose_file, temp_db_name, bundle.objects_root, server_root)
        if args.slug and not args.skip_api:
            api_result = run_api_smoke(
                server_root=server_root,
                database_url=restore_database_url(args.database_url, temp_db_name),
                object_storage_root=bundle.objects_root,
                port=args.api_port,
                slug=args.slug,
                expect_title=args.expect_title,
            )
        result = {
            "ok": True,
            "apply": True,
            "plan": plan,
            "db_counts": db_counts,
            "asset_check": asset_check,
            "api_smoke": api_result,
            "cleanup": {"temp_db_dropped": False, "kept": args.keep_temp_db},
        }
        return_code = 0
    except Exception as exc:
        result = {
            "ok": False,
            "apply": True,
            "plan": plan,
            "error": {"type": exc.__class__.__name__, "message": str(exc)},
            "cleanup": {"temp_db_dropped": False, "kept": args.keep_temp_db},
        }
        return_code = 1
    finally:
        if created_db and not args.keep_temp_db:
            drop_result = drop_temp_db(args.compose_file, temp_db_name, server_root)
            if "result" in locals():
                result["cleanup"] = {"temp_db_dropped": drop_result, "kept": False}

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return return_code


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")


def resolve_bundle(backup_root: Path, bundle_arg: str | None) -> BackupBundle:
    root = Path(bundle_arg).expanduser().resolve() if bundle_arg else latest_bundle(backup_root)
    postgres_dump = root / "postgres" / "docferry.dump"
    objects_root = root / "objects"
    missing = [path for path in (root, postgres_dump, objects_root) if not path.exists()]
    if missing:
        raise FileNotFoundError(", ".join(str(path) for path in missing))
    return BackupBundle(root=root, postgres_dump=postgres_dump, objects_root=objects_root)


def latest_bundle(backup_root: Path) -> Path:
    if not backup_root.exists():
        raise FileNotFoundError(backup_root)
    candidates = [path for path in backup_root.iterdir() if path.is_dir() and BUNDLE_PATTERN.match(path.name)]
    if not candidates:
        raise FileNotFoundError(f"No backup bundle under {backup_root}")
    return sorted(candidates, key=lambda item: item.name, reverse=True)[0]


def safe_temp_db_name(value: str) -> str:
    normalized = value.strip()
    if not TEMP_DB_PATTERN.match(normalized):
        raise ValueError("Invalid temp DB name.")
    if normalized == "docferry":
        raise ValueError("Refusing to use production database name.")
    return normalized


def run_compose(compose_file: str, command: list[str], server_root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["docker", "compose", "-f", compose_file, "exec", "-T", "db", *command],
        cwd=server_root,
        check=True,
        capture_output=True,
        text=True,
    )


def restore_dump(compose_file: str, dump_path: Path, temp_db_name: str, server_root: Path) -> None:
    with dump_path.open("rb") as handle:
        subprocess.run(
            [
                "docker",
                "compose",
                "-f",
                compose_file,
                "exec",
                "-T",
                "db",
                "pg_restore",
                "-U",
                "docferry",
                "-d",
                temp_db_name,
                "--no-owner",
                "--no-acl",
            ],
            cwd=server_root,
            check=True,
            stdin=handle,
            stdout=subprocess.DEVNULL,
        )


def query_db_counts(compose_file: str, temp_db_name: str, server_root: Path) -> dict[str, int | str]:
    sql = """
select
  (select version_num from alembic_version limit 1) as alembic_version,
  (select count(*) from shares) as shares,
  (select count(*) from assets) as assets,
  (select count(*) from share_access_events) as share_access_events,
  (select count(*) from share_links) as share_links
;
"""
    completed = run_compose(
        compose_file,
        ["psql", "-U", "docferry", "-d", temp_db_name, "-t", "-A", "-F", "|", "-c", sql],
        server_root,
    )
    values = completed.stdout.strip().split("|")
    if len(values) != 5:
        raise RuntimeError(f"Unexpected count query output: {completed.stdout.strip()}")
    return {
        "alembic_version": values[0],
        "shares": int(values[1]),
        "assets": int(values[2]),
        "share_access_events": int(values[3]),
        "share_links": int(values[4]),
    }


def verify_asset_files(
    compose_file: str,
    temp_db_name: str,
    objects_root: Path,
    server_root: Path,
) -> dict[str, Any]:
    completed = run_compose(
        compose_file,
        ["psql", "-U", "docferry", "-d", temp_db_name, "-t", "-A", "-c", "select storage_key from assets order by id;"],
        server_root,
    )
    keys = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
    missing = [key for key in keys if not (objects_root / key).is_file()]
    return {"asset_files_total": len(keys), "missing": len(missing), "missing_keys": missing[:20]}


def restore_database_url(database_url: str, temp_db_name: str) -> str:
    url = make_url(database_url)
    return url.set(database=temp_db_name).render_as_string(hide_password=False)


def run_api_smoke(
    server_root: Path,
    database_url: str,
    object_storage_root: Path,
    port: int,
    slug: str,
    expect_title: str | None,
) -> dict[str, Any]:
    env = os.environ.copy()
    env["DOCFERRY_DATABASE_URL"] = database_url
    env["DOCFERRY_OBJECT_STORAGE_ROOT"] = str(object_storage_root)
    env["DOCFERRY_PUBLIC_BASE_URL"] = f"http://127.0.0.1:{port}"
    process = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)],
        cwd=server_root,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    try:
        health = wait_for_http(f"http://127.0.0.1:{port}/v0/health")
        page = fetch_text(f"http://127.0.0.1:{port}/s/{slug}")
        expected_title_found = None if expect_title is None else expect_title in page
        if expect_title and not expected_title_found:
            raise RuntimeError("Expected title was not found in restored share page.")
        return {
            "health": health,
            "slug": slug,
            "page_status": 200,
            "expected_title_found": expected_title_found,
        }
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=10)


def wait_for_http(url: str, attempts: int = 30, delay_seconds: float = 0.25) -> dict[str, Any]:
    last_error = None
    for _ in range(attempts):
        try:
            return json.loads(fetch_text(url))
        except Exception as exc:
            last_error = exc
            time.sleep(delay_seconds)
    raise RuntimeError(f"Temporary API did not become healthy: {last_error}")


def fetch_text(url: str) -> str:
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            return response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} from {url}: {body[:200]}") from exc


def drop_temp_db(compose_file: str, temp_db_name: str, server_root: Path) -> bool:
    run_compose(compose_file, ["dropdb", "-U", "docferry", "--if-exists", temp_db_name], server_root)
    return True


if __name__ == "__main__":
    raise SystemExit(main())
