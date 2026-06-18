from __future__ import annotations

import json
import importlib.util
import os
import subprocess
import sys
from pathlib import Path

from app.database import Base, make_engine, make_session_factory
from app.models import Asset, Share, ShareAsset, ShareLink, SystemEvent, User  # noqa: F401


SERVER_ROOT = Path(__file__).resolve().parents[1]
BACKUP_DOCFERRY_PATH = SERVER_ROOT / "scripts" / "backup_docferry.py"
RESTORE_DRILL_PATH = SERVER_ROOT / "scripts" / "restore_drill.py"
RUN_MAINTENANCE_PATH = SERVER_ROOT / "scripts" / "run_maintenance.py"
TEST_MASTER_KEY_B64 = "eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHg="


def run_script(*args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, *args],
        cwd=SERVER_ROOT,
        check=True,
        capture_output=True,
        text=True,
        env={**os.environ, **(env or {})},
    )


def test_prune_backups_keeps_recent_and_ignored_entries(tmp_path: Path) -> None:
    old_bundle = tmp_path / "20260101T000000Z-old"
    kept_by_count = tmp_path / "20260109T000000Z-new"
    ignored = tmp_path / "manual"
    old_bundle.mkdir()
    kept_by_count.mkdir()
    ignored.mkdir()

    completed = run_script(
        "scripts/prune_backups.py",
        "--backup-root",
        str(tmp_path),
        "--older-than-days",
        "3",
        "--keep-last",
        "1",
        "--now",
        "2026-01-10T00:00:00Z",
    )
    body = json.loads(completed.stdout)

    assert body["apply"] is False
    assert body["bundle_count"] == 2
    assert body["ignored_count"] == 1
    assert body["candidate_count"] == 1
    assert body["deleted_count"] == 0
    assert body["candidates"][0]["path"] == str(old_bundle.resolve())
    assert old_bundle.exists()
    assert kept_by_count.exists()
    assert ignored.exists()


def test_prune_backups_apply_deletes_only_candidates(tmp_path: Path) -> None:
    old_bundle = tmp_path / "20260101T000000Z-old"
    kept_by_count = tmp_path / "20260109T000000Z-new"
    old_bundle.mkdir()
    kept_by_count.mkdir()

    completed = run_script(
        "scripts/prune_backups.py",
        "--backup-root",
        str(tmp_path),
        "--older-than-days",
        "3",
        "--keep-last",
        "1",
        "--now",
        "2026-01-10T00:00:00Z",
        "--apply",
    )
    body = json.loads(completed.stdout)

    assert body["apply"] is True
    assert body["candidate_count"] == 1
    assert body["deleted_count"] == 1
    assert not old_bundle.exists()
    assert kept_by_count.exists()


def test_run_maintenance_can_emit_empty_dry_run_plan() -> None:
    completed = run_script(
        "scripts/run_maintenance.py",
        "--skip-backup",
        "--skip-backup-prune",
        "--skip-assets-gc",
        "--skip-access-events-gc",
        "--alert-on",
        "never",
    )
    body = json.loads(completed.stdout)

    assert body["ok"] is True
    assert body["apply"] is False
    assert body["steps"] == []
    assert "event_log" in body


def test_run_maintenance_records_system_event(tmp_path: Path) -> None:
    run_maintenance = load_script_module("run_maintenance", RUN_MAINTENANCE_PATH)
    database_url = f"sqlite:///{tmp_path / 'events.db'}"
    engine = make_engine(database_url)
    Base.metadata.create_all(bind=engine)

    payload = {
        "event": "docferry_maintenance_succeeded",
        "summary": {
            "ok": True,
            "started_at": "2026-06-16T00:00:00+00:00",
            "steps": [],
        },
    }
    result = run_maintenance.record_system_event(payload, database_url=database_url)

    assert result["ok"] is True
    assert result["event_type"] == "docferry_maintenance_succeeded"
    session_factory = make_session_factory(engine)
    with session_factory() as session:
        events = session.query(SystemEvent).all()
    assert len(events) == 1
    assert events[0].source == "docferry-maintenance"
    assert events[0].severity == "info"
    assert events[0].payload["event"] == "docferry_maintenance_succeeded"


def test_metadata_backfill_encrypts_legacy_rows(tmp_path: Path) -> None:
    database_url = f"sqlite:///{tmp_path / 'metadata.db'}"
    engine = make_engine(database_url)
    Base.metadata.create_all(bind=engine)
    session_factory = make_session_factory(engine)
    with session_factory() as session:
        session.add(User(id="usr_legacy"))
        session.add(
            Asset(
                id="asset_legacy",
                owner_id="usr_legacy",
                hash="sha256:legacy-asset-secret",
                filename="legacy-secret.png",
                content_type="image/png",
                byte_length=16,
                storage_key="assets/usr_legacy/le/legacy-asset-secret",
            )
        )
        session.add(
            Share(
                id="sh_legacy",
                owner_id="usr_legacy",
                slug="legacy",
                title="Legacy Secret Title",
                vault_id="legacy-vault-secret",
                source_path="Legacy/Secret Path.md",
                source_path_normalized="Legacy/Secret Path.md",
                doc_identity="legacy-doc-secret",
                source_hash="sha256:legacy-source-secret",
                markdown="# legacy",
                render_mode="markdown_fallback",
                assets=[{"asset_id": "asset_legacy", "original_path": "legacy-secret.png"}],
                client={"plugin_version": "legacy-client-secret"},
            )
        )
        session.add(
            ShareAsset(
                share_id="sh_legacy",
                asset_id="asset_legacy",
                role="image",
                original_path="attachments/legacy-secret.png",
            )
        )
        session.add(
            ShareLink(
                id="lnk_legacy",
                source_share_id="sh_legacy",
                owner_id="usr_legacy",
                vault_id="legacy-vault-secret",
                raw_target="Legacy Target Secret#Intro",
                target_path="Legacy/Target Secret.md",
                target_doc_identity="legacy-target-doc-secret",
                target_subpath="Intro",
                label="Legacy Label Secret",
                link_kind="wiki",
            )
        )
        session.commit()

    completed = run_script(
        "scripts/backfill_metadata_encryption.py",
        "--database-url",
        database_url,
        "--apply",
        env={
            "DOCFERRY_MASTER_KEY_B64": TEST_MASTER_KEY_B64,
            "DOCFERRY_BLIND_INDEX_SECRET": "test-blind-index-secret",
        },
    )
    body = json.loads(completed.stdout)
    assert body["apply"] is True
    assert body["shares"] == 1
    assert body["assets"] == 1
    assert body["share_assets"] == 1
    assert body["share_links"] == 1

    with session_factory() as session:
        share = session.get(Share, "sh_legacy")
        asset = session.get(Asset, "asset_legacy")
        share_asset = session.get(ShareAsset, ("sh_legacy", "asset_legacy"))
        link = session.get(ShareLink, "lnk_legacy")

        assert share.title == "Encrypted share"
        assert share.title_enc and '"df_enc":1' in share.title_enc
        assert share.source_path == ""
        assert share.source_path_full_index
        assert share.doc_identity is None
        assert share.client == {}
        assert asset.hash.startswith("encrypted:")
        assert asset.hash_enc and '"df_enc":1' in asset.hash_enc
        assert asset.hash_index
        assert asset.filename == "asset"
        assert asset.filename_enc and '"df_enc":1' in asset.filename_enc
        assert share_asset.original_path is None
        assert share_asset.original_path_enc and '"df_enc":1' in share_asset.original_path_enc
        assert link.raw_target == "[encrypted]"
        assert link.raw_target_enc and '"df_enc":1' in link.raw_target_enc
        assert link.raw_target_index
        assert link.target_path is None
        assert link.target_path_full_index
        assert link.label is None


def test_backup_config_files_are_written_private(tmp_path: Path) -> None:
    backup_docferry = load_script_module("backup_docferry", BACKUP_DOCFERRY_PATH)
    source = tmp_path / "source.env"
    destination = tmp_path / "bundle" / "configs" / ".env.production"
    source.write_text("DOCFERRY_TOKEN=redacted\n", encoding="utf-8")

    backup_docferry.execute_operation(
        {
            "type": "config_file",
            "source": str(source),
            "destination": str(destination),
            "required": True,
        }
    )

    assert destination.read_text(encoding="utf-8") == "DOCFERRY_TOKEN=redacted\n"
    if os.name != "nt":
        assert destination.stat().st_mode & 0o777 == 0o600


def test_backup_chmod_tree_makes_objects_private(tmp_path: Path) -> None:
    backup_docferry = load_script_module("backup_docferry_chmod", BACKUP_DOCFERRY_PATH)
    object_root = tmp_path / "objects"
    nested = object_root / "nested"
    nested.mkdir(parents=True)
    file_path = nested / "image.png"
    file_path.write_bytes(b"image")

    backup_docferry.chmod_tree(object_root)

    if os.name != "nt":
        assert object_root.stat().st_mode & 0o777 == 0o700
        assert nested.stat().st_mode & 0o777 == 0o700
        assert file_path.stat().st_mode & 0o777 == 0o600


def test_restore_drill_latest_bundle_and_url_helpers(tmp_path: Path) -> None:
    restore_drill = load_restore_drill_module()
    older = tmp_path / "20260101T000000Z-old"
    newer = tmp_path / "20260102T000000Z-new"
    ignored = tmp_path / "manual"
    for bundle in (older, newer):
        (bundle / "postgres").mkdir(parents=True)
        (bundle / "postgres" / "docferry.dump").write_bytes(b"dump")
        (bundle / "objects").mkdir()
    ignored.mkdir()

    assert restore_drill.latest_bundle(tmp_path) == newer
    assert restore_drill.safe_temp_db_name("docferry_restore_20260102_000000") == "docferry_restore_20260102_000000"
    assert (
        restore_drill.restore_database_url(
            "postgresql+psycopg://docferry:secret@127.0.0.1:55432/docferry",
            "docferry_restore",
        )
        == "postgresql+psycopg://docferry:secret@127.0.0.1:55432/docferry_restore"
    )


def test_restore_drill_rejects_production_database_name() -> None:
    restore_drill = load_restore_drill_module()

    try:
        restore_drill.safe_temp_db_name("docferry")
    except ValueError as exc:
        assert "production" in str(exc)
    else:
        raise AssertionError("Expected production DB name to be rejected")


def load_restore_drill_module():
    return load_script_module("restore_drill", RESTORE_DRILL_PATH)


def load_script_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module
