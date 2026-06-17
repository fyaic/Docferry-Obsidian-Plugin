#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a DocFerry PostgreSQL/object/config backup bundle.")
    parser.add_argument("--backup-root", default=os.getenv("DOCFERRY_BACKUP_ROOT", "/root/backups/docferry"))
    parser.add_argument(
        "--object-storage-root",
        default=os.getenv("DOCFERRY_OBJECT_STORAGE_ROOT", Settings.object_storage_root),
    )
    parser.add_argument("--compose-file", default="docker-compose.prod.yml")
    parser.add_argument("--env-file", default=".env.production")
    parser.add_argument("--caddy-site", default="/etc/caddy/sites-available/docferry.example.com.caddy")
    parser.add_argument("--systemd-unit", default="docferry-api")
    parser.add_argument("--skip-postgres", action="store_true")
    parser.add_argument("--skip-objects", action="store_true")
    parser.add_argument("--skip-configs", action="store_true")
    parser.add_argument("--apply", action="store_true", help="Write backup files. Default is dry-run.")
    args = parser.parse_args()

    server_root = Path(__file__).resolve().parents[1]
    backup_root = Path(args.backup_root).expanduser().resolve()
    object_root = Path(args.object_storage_root).expanduser().resolve()
    backup_id = f"{utc_stamp()}-{git_short_sha(server_root)}"
    bundle_root = backup_root / backup_id

    operations: list[dict[str, object]] = []
    if not args.skip_postgres:
        operations.append(postgres_operation(server_root, bundle_root, args.compose_file))
    if not args.skip_objects:
        operations.append(objects_operation(object_root, bundle_root))
    if not args.skip_configs:
        operations.extend(config_operations(server_root, bundle_root, args.env_file, args.caddy_site, args.systemd_unit))

    if args.apply:
        bundle_root.mkdir(parents=True, exist_ok=False)
        bundle_root.chmod(0o700)
        for operation in operations:
            execute_operation(operation)

    print(
        json.dumps(
            {
                "ok": True,
                "apply": args.apply,
                "backup_id": backup_id,
                "bundle_root": str(bundle_root),
                "operations": operations,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


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


def postgres_operation(server_root: Path, bundle_root: Path, compose_file: str) -> dict[str, object]:
    dump_path = bundle_root / "postgres" / "docferry.dump"
    return {
        "type": "postgres",
        "output": str(dump_path),
        "command": [
            "docker",
            "compose",
            "-f",
            compose_file,
            "exec",
            "-T",
            "db",
            "pg_dump",
            "-U",
            "docferry",
            "-d",
            "docferry",
            "--format=custom",
            "--no-owner",
            "--no-acl",
        ],
        "cwd": str(server_root),
        "verify_command": [
            "docker",
            "compose",
            "-f",
            compose_file,
            "exec",
            "-T",
            "db",
            "pg_restore",
            "--list",
        ],
    }


def objects_operation(object_root: Path, bundle_root: Path) -> dict[str, object]:
    destination = bundle_root / "objects"
    return {
        "type": "objects",
        "source": str(object_root),
        "destination": str(destination),
        "command": ["rsync", "-a", "--delete", f"{object_root}/", f"{destination}/"],
    }


def config_operations(
    server_root: Path,
    bundle_root: Path,
    env_file: str,
    caddy_site: str,
    systemd_unit: str,
) -> list[dict[str, object]]:
    configs_root = bundle_root / "configs"
    return [
        {
            "type": "config_file",
            "source": str((server_root / env_file).resolve()),
            "destination": str(configs_root / ".env.production"),
            "required": False,
        },
        {
            "type": "config_file",
            "source": str(Path(caddy_site).expanduser()),
            "destination": str(configs_root / "docferry.example.com.caddy"),
            "required": False,
        },
        {
            "type": "systemd_unit",
            "unit": systemd_unit,
            "destination": str(configs_root / f"{systemd_unit}.service.txt"),
            "command": ["systemctl", "cat", systemd_unit],
        },
    ]


def execute_operation(operation: dict[str, object]) -> None:
    operation_type = operation["type"]
    if operation_type == "postgres":
        output = Path(str(operation["output"]))
        output.parent.mkdir(parents=True, exist_ok=True)
        command = list(operation["command"])  # type: ignore[arg-type]
        with output.open("wb") as handle:
            subprocess.run(command, cwd=str(operation["cwd"]), check=True, stdout=handle)
        output.chmod(0o600)
        verify_command = list(operation["verify_command"])  # type: ignore[arg-type]
        with output.open("rb") as handle:
            subprocess.run(verify_command, cwd=str(operation["cwd"]), check=True, stdin=handle, stdout=subprocess.DEVNULL)
        return

    if operation_type == "objects":
        destination = Path(str(operation["destination"]))
        destination.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(list(operation["command"]), check=True)  # type: ignore[arg-type]
        chmod_tree(destination)
        return

    if operation_type == "config_file":
        source = Path(str(operation["source"]))
        destination = Path(str(operation["destination"]))
        required = bool(operation.get("required", False))
        if not source.exists():
            if required:
                raise FileNotFoundError(source)
            operation["skipped"] = True
            operation["reason"] = "source_missing"
            return
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        destination.chmod(0o600)
        return

    if operation_type == "systemd_unit":
        destination = Path(str(operation["destination"]))
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("wb") as handle:
            subprocess.run(list(operation["command"]), check=True, stdout=handle)  # type: ignore[arg-type]
        destination.chmod(0o600)
        return

    raise ValueError(f"Unknown operation type: {operation_type}")


def chmod_tree(path: Path) -> None:
    if not path.exists():
        return
    for child in path.rglob("*"):
        if child.is_dir():
            child.chmod(0o700)
        elif child.is_file():
            child.chmod(0o600)
    path.chmod(0o700)


if __name__ == "__main__":
    raise SystemExit(main())
