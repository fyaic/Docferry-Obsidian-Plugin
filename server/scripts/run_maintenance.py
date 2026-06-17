#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import platform
import secrets
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy.exc import SQLAlchemyError

from app.config import Settings
from app.database import make_engine, make_session_factory
from app.models import SystemEvent


@dataclass(frozen=True)
class Step:
    name: str
    command: list[str]


def main() -> int:
    parser = argparse.ArgumentParser(description="Run DocFerry backup and retention maintenance.")
    parser.add_argument("--backup-root", default=os.getenv("DOCFERRY_BACKUP_ROOT", "/root/backups/docferry"))
    parser.add_argument("--object-storage-root", default=os.getenv("DOCFERRY_OBJECT_STORAGE_ROOT", "./.local/object-storage"))
    parser.add_argument("--compose-file", default="docker-compose.prod.yml")
    parser.add_argument("--backup-retention-days", type=int, default=int(os.getenv("DOCFERRY_BACKUP_RETENTION_DAYS", "30")))
    parser.add_argument("--backup-keep-last", type=int, default=int(os.getenv("DOCFERRY_BACKUP_KEEP_LAST", "7")))
    parser.add_argument("--asset-older-than-days", type=int, default=int(os.getenv("DOCFERRY_ASSET_GC_DAYS", "7")))
    parser.add_argument("--event-older-than-days", type=int, default=int(os.getenv("DOCFERRY_ACCESS_EVENT_RETENTION_DAYS", "90")))
    parser.add_argument("--alert-webhook-url", default=os.getenv("DOCFERRY_MAINTENANCE_ALERT_WEBHOOK_URL"))
    parser.add_argument(
        "--alert-on",
        choices=("failure", "always", "never"),
        default=os.getenv("DOCFERRY_MAINTENANCE_ALERT_ON", "failure"),
    )
    parser.add_argument("--skip-backup", action="store_true")
    parser.add_argument("--skip-backup-prune", action="store_true")
    parser.add_argument("--skip-assets-gc", action="store_true")
    parser.add_argument("--skip-access-events-gc", action="store_true")
    parser.add_argument("--apply", action="store_true", help="Run mutating maintenance. Default is dry-run.")
    args = parser.parse_args()

    invalid = validate_args(args)
    if invalid:
        print(invalid, file=sys.stderr)
        return 2

    server_root = Path(__file__).resolve().parents[1]
    started_at = utc_now()
    steps = build_steps(args, server_root)
    step_results: list[dict[str, Any]] = []
    ok = True

    for step in steps:
        result = run_step(step, server_root)
        step_results.append(result)
        if result["returncode"] != 0:
            ok = False
            break

    finished_at = utc_now()
    summary: dict[str, Any] = {
        "ok": ok,
        "apply": args.apply,
        "host": platform.node(),
        "started_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "duration_seconds": round((finished_at - started_at).total_seconds(), 3),
        "git_commit": git_short_sha(server_root),
        "steps": step_results,
    }

    event_payload = build_event_payload(summary)
    summary["event_log"] = record_system_event(event_payload)

    if should_alert(ok, args.alert_on, args.alert_webhook_url):
        summary["alert"] = send_alert(args.alert_webhook_url, event_payload)

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if ok else 1


def validate_args(args: argparse.Namespace) -> str | None:
    checks = {
        "--backup-retention-days": args.backup_retention_days,
        "--backup-keep-last": args.backup_keep_last,
        "--asset-older-than-days": args.asset_older_than_days,
        "--event-older-than-days": args.event_older_than_days,
    }
    for name, value in checks.items():
        if value < 0:
            return f"run-maintenance: {name} must be >= 0"
    return None


def build_steps(args: argparse.Namespace, server_root: Path) -> list[Step]:
    python = sys.executable
    steps: list[Step] = []
    if not args.skip_backup:
        command = [
            python,
            str(server_root / "scripts" / "backup_docferry.py"),
            "--backup-root",
            args.backup_root,
            "--object-storage-root",
            args.object_storage_root,
            "--compose-file",
            args.compose_file,
        ]
        if args.apply:
            command.append("--apply")
        steps.append(Step("backup", command))

    if not args.skip_backup_prune:
        command = [
            python,
            str(server_root / "scripts" / "prune_backups.py"),
            "--backup-root",
            args.backup_root,
            "--older-than-days",
            str(args.backup_retention_days),
            "--keep-last",
            str(args.backup_keep_last),
        ]
        if args.apply:
            command.append("--apply")
        steps.append(Step("backup_prune", command))

    if not args.skip_assets_gc:
        command = [
            python,
            str(server_root / "scripts" / "gc_assets.py"),
            "--object-storage-root",
            args.object_storage_root,
            "--older-than-days",
            str(args.asset_older_than_days),
        ]
        if args.apply:
            command.append("--apply")
        steps.append(Step("assets_gc", command))

    if not args.skip_access_events_gc:
        command = [
            python,
            str(server_root / "scripts" / "gc_access_events.py"),
            "--older-than-days",
            str(args.event_older_than_days),
        ]
        if args.apply:
            command.append("--apply")
        steps.append(Step("access_events_gc", command))

    return steps


def run_step(step: Step, server_root: Path) -> dict[str, Any]:
    started = utc_now()
    completed = subprocess.run(step.command, cwd=server_root, capture_output=True, text=True)
    finished = utc_now()
    return {
        "name": step.name,
        "returncode": completed.returncode,
        "duration_seconds": round((finished - started).total_seconds(), 3),
        "output": parse_or_tail(completed.stdout),
        "stderr": tail(completed.stderr),
    }


def parse_or_tail(value: str) -> Any:
    stripped = value.strip()
    if not stripped:
        return None
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        return tail(stripped)


def tail(value: str, limit: int = 4000) -> str | None:
    stripped = value.strip()
    if not stripped:
        return None
    return stripped[-limit:]


def should_alert(ok: bool, alert_on: str, webhook_url: str | None) -> bool:
    if not webhook_url or alert_on == "never":
        return False
    return alert_on == "always" or (alert_on == "failure" and not ok)


def build_event_payload(summary: dict[str, Any]) -> dict[str, Any]:
    event = "docferry_maintenance_succeeded" if summary["ok"] else "docferry_maintenance_failed"
    return {"event": event, "summary": summary}


def record_system_event(payload: dict[str, Any], database_url: str | None = None) -> dict[str, Any]:
    settings = Settings.from_env()
    event_type = str(payload.get("event") or "docferry_maintenance_event")
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    severity = "info" if summary.get("ok") else "critical"
    try:
        engine = make_engine(database_url or settings.database_url)
        session_factory = make_session_factory(engine)
        with session_factory() as session:
            event = SystemEvent(
                id=generate_event_id(),
                event_type=event_type,
                severity=severity,
                source="docferry-maintenance",
                dedupe_key=str(summary.get("started_at") or ""),
                payload=payload,
            )
            session.add(event)
            session.commit()
            return {"ok": True, "event_id": event.id, "event_type": event_type}
    except SQLAlchemyError as exc:
        return {"ok": False, "error": exc.__class__.__name__}


def generate_event_id() -> str:
    return f"evt_{secrets.token_urlsafe(12)}"


def send_alert(webhook_url: str | None, payload: dict[str, Any]) -> dict[str, Any]:
    assert webhook_url
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        webhook_url,
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": "docferry-maintenance/0.1"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return {"ok": True, "status": response.status}
    except (urllib.error.URLError, TimeoutError) as exc:
        return {"ok": False, "error": exc.__class__.__name__, "message": str(exc)}


def git_short_sha(server_root: Path) -> str:
    try:
        completed = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=server_root,
            check=True,
            capture_output=True,
            text=True,
        )
        return completed.stdout.strip() or "nogit"
    except Exception:
        return "nogit"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


if __name__ == "__main__":
    raise SystemExit(main())
