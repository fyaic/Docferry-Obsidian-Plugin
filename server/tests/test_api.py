from __future__ import annotations

import subprocess
import sys
import json
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import Settings
from app.main import create_app
from app.markdown import render_markdown
from app.models import Asset, Share, ShareAccessEvent, ShareAsset, User, UserToken, utc_now
from app.security import hash_cloud_token

TEST_MASTER_KEY_B64 = "eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHg="


def make_client(**settings_overrides) -> TestClient:
    settings = {
        "api_token": "test-token",
        "public_base_url": "http://testserver",
        "database_url": "sqlite+pysqlite:///:memory:",
        "cookie_secret": "test-secret",
    }
    settings.update(settings_overrides)
    app = create_app(Settings(**settings))
    return TestClient(app)


def auth_headers() -> dict[str, str]:
    return {"Authorization": "Bearer test-token"}


def cloud_auth_headers(
    client: TestClient,
    *,
    token: str,
    user_id: str,
    label: str | None = "Free token",
    active_share_limit: int = 10,
    revoked: bool = False,
) -> dict[str, str]:
    now = utc_now()
    session_factory = client.app.state.session_factory
    settings = client.app.state.settings
    token_id = f"tok_{sha256(token.encode('utf-8')).hexdigest()[:16]}"
    with session_factory() as session:
        user = session.get(User, user_id)
        if not user:
            user = User(id=user_id, email=None, display_name=user_id, created_at=now, updated_at=now)
            session.add(user)
        user_token = session.get(UserToken, token_id)
        if not user_token:
            user_token = UserToken(
                id=token_id,
                user_id=user_id,
                token_hash=hash_cloud_token(token, settings),
                label=label,
                active_share_limit=active_share_limit,
                created_at=now,
                updated_at=now,
            )
            session.add(user_token)
        user_token.revoked_at = now if revoked else None
        session.commit()
    return {"Authorization": f"Bearer {token}"}


def asset_headers(data: bytes, content_type: str = "image/png", filename: str = "chart.png") -> dict[str, str]:
    headers = auth_headers()
    headers.update(
        {
            "Content-Type": content_type,
            "X-Share-Asset-Hash": f"sha256:{sha256(data).hexdigest()}",
            "X-Share-Asset-Filename": filename,
        }
    )
    return headers


def access_events(client: TestClient) -> list[ShareAccessEvent]:
    session_factory = client.app.state.session_factory
    with session_factory() as session:
        return list(
            session.execute(select(ShareAccessEvent).order_by(ShareAccessEvent.created_at)).scalars().all()
        )


def access_event_types(client: TestClient) -> list[str]:
    return [event.event_type for event in access_events(client)]


def utc_datetime_days_ago(days: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days)


def payload(**overrides):
    data = {
        "source_path": "Notes/hello.md",
        "source_hash": "sha256:test",
        "title": "Hello",
        "markdown": "# Hello\n\nThis is a shared note.",
        "html_snapshot": None,
        "css_asset_id": None,
        "assets": [],
        "expires_at": None,
        "client": {
            "plugin_id": "docferry",
            "plugin_version": "0.0.6",
            "obsidian_version": "1.5.0",
        },
    }
    data.update(overrides)
    return data


def test_health() -> None:
    client = make_client()
    response = client.get("/v0/health")
    assert response.status_code == 200
    assert response.json()["service"] == "docferry-share"


def test_create_share_requires_token() -> None:
    client = make_client()
    response = client.post("/v0/shares", json=payload())
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "missing_auth_token"


def test_account_status_for_self_host_token() -> None:
    client = make_client()
    client.post("/v0/shares", json=payload(), headers=auth_headers())

    response = client.get("/v0/account", headers=auth_headers())

    assert response.status_code == 200
    account = response.json()["account"]
    assert account["owner_id"] == "usr_local"
    assert account["mode"] == "self_host"
    assert account["active_shares"] == 1
    assert account["active_share_limit"] == 0
    assert account["remaining_active_shares"] is None


def test_cloud_token_is_hashed_and_scoped_to_owner() -> None:
    client = make_client()
    token_a = "dfc_test_owner_a_token"
    token_b = "dfc_test_owner_b_token"
    headers_a = cloud_auth_headers(
        client,
        token=token_a,
        user_id="usr_cloud_a",
        label="Owner A token",
        active_share_limit=2,
    )
    headers_b = cloud_auth_headers(client, token=token_b, user_id="usr_cloud_b", label="Owner B token")

    created = client.post("/v0/shares", json=payload(title="Owner A"), headers=headers_a)

    assert created.status_code == 200
    body = created.json()
    account = client.get("/v0/account", headers=headers_a)
    assert account.status_code == 200
    account_body = account.json()["account"]
    assert account_body["owner_id"] == "usr_cloud_a"
    assert account_body["mode"] == "cloud"
    assert account_body["token_label"] == "Owner A token"
    assert account_body["active_shares"] == 1
    assert account_body["remaining_active_shares"] == 1

    with client.app.state.session_factory() as session:
        token_rows = session.execute(select(UserToken)).scalars().all()
        assert {row.user_id for row in token_rows} == {"usr_cloud_a", "usr_cloud_b"}
        assert all(row.token_hash not in {token_a, token_b} for row in token_rows)
        assert session.get(UserToken, f"tok_{sha256(token_a.encode('utf-8')).hexdigest()[:16]}").last_used_at is not None

    hidden = client.get(f"/v0/shares/{body['share_id']}", headers=headers_b)
    assert hidden.status_code == 404
    assert hidden.json()["error"]["code"] == "share_not_found"

    denied_update = client.put(f"/v0/shares/{body['share_id']}", json=payload(title="Wrong owner"), headers=headers_b)
    assert denied_update.status_code == 404
    denied_delete = client.delete(f"/v0/shares/{body['share_id']}", headers=headers_b)
    assert denied_delete.status_code == 404

    owner_status = client.get(f"/v0/shares/{body['share_id']}", headers=headers_a)
    assert owner_status.status_code == 200
    assert owner_status.json()["title"] == "Owner A"


def test_cloud_active_share_quota_lifecycle() -> None:
    client = make_client()
    headers = cloud_auth_headers(client, token="dfc_quota_lifecycle_token", user_id="usr_cloud_quota")
    created_shares = []
    for index in range(10):
        response = client.post(
            "/v0/shares",
            json=payload(
                source_path=f"Notes/quota-{index}.md",
                source_hash=f"sha256:quota-{index}",
                title=f"Quota {index}",
            ),
            headers=headers,
        )
        assert response.status_code == 200
        created_shares.append(response.json())

    blocked = client.post(
        "/v0/shares",
        json=payload(source_path="Notes/quota-blocked.md", source_hash="sha256:quota-blocked"),
        headers=headers,
    )
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "share_quota_exceeded"
    assert blocked.json()["error"]["message"] == "You have reached the 10 active shares included with DocFerry Cloud."

    updated = client.put(
        f"/v0/shares/{created_shares[-1]['share_id']}",
        json=payload(source_path="Notes/quota-9.md", source_hash="sha256:quota-9-updated", title="Updated tenth"),
        headers=headers,
    )
    assert updated.status_code == 200

    deleted = client.delete(f"/v0/shares/{created_shares[0]['share_id']}", headers=headers)
    assert deleted.status_code == 200

    replacement = client.post(
        "/v0/shares",
        json=payload(source_path="Notes/quota-replacement.md", source_hash="sha256:quota-replacement"),
        headers=headers,
    )
    assert replacement.status_code == 200

    account = client.get("/v0/account", headers=headers)
    assert account.status_code == 200
    assert account.json()["account"]["active_shares"] == 10
    assert account.json()["account"]["remaining_active_shares"] == 0


def test_expired_shares_do_not_count_toward_cloud_quota() -> None:
    client = make_client()
    headers = cloud_auth_headers(
        client,
        token="dfc_expired_quota_token",
        user_id="usr_cloud_expired_quota",
        active_share_limit=1,
    )

    expired = client.post(
        "/v0/shares",
        json=payload(
            source_path="Notes/expired.md",
            source_hash="sha256:expired",
            expires_at=datetime(2000, 1, 1, tzinfo=timezone.utc).isoformat(),
        ),
        headers=headers,
    )
    assert expired.status_code == 200

    account = client.get("/v0/account", headers=headers)
    assert account.status_code == 200
    assert account.json()["account"]["active_shares"] == 0
    assert account.json()["account"]["remaining_active_shares"] == 1

    active = client.post(
        "/v0/shares",
        json=payload(source_path="Notes/active.md", source_hash="sha256:active"),
        headers=headers,
    )
    assert active.status_code == 200

    blocked = client.post(
        "/v0/shares",
        json=payload(source_path="Notes/blocked.md", source_hash="sha256:blocked"),
        headers=headers,
    )
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "share_quota_exceeded"


def test_revoked_cloud_token_is_rejected() -> None:
    client = make_client()
    headers = cloud_auth_headers(client, token="dfc_revoked_token", user_id="usr_cloud_revoked", revoked=True)

    response = client.get("/v0/account", headers=headers)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "revoked_auth_token"


def test_create_and_view_share() -> None:
    client = make_client()
    response = client.post("/v0/shares", json=payload(), headers=auth_headers())
    assert response.status_code == 200
    body = response.json()
    assert body["url"].startswith("http://testserver/s/")
    assert body["status"] == "published"
    assert body["password_enabled"] is False

    page = client.get(f"/s/{body['slug']}")
    assert page.status_code == 200
    assert "<h1>Hello</h1>" in page.text
    assert "This is a shared note." in page.text
    events = access_events(client)
    assert [event.event_type for event in events] == ["view"]
    assert events[0].share_id == body["share_id"]
    assert events[0].slug == body["slug"]
    assert events[0].status_code == 200
    assert events[0].ip_hash and events[0].ip_hash.startswith("sha256:")


def test_update_share_keeps_slug() -> None:
    client = make_client()
    created = client.post("/v0/shares", json=payload(), headers=auth_headers()).json()
    updated = client.put(
        f"/v0/shares/{created['share_id']}",
        json=payload(title="Updated", markdown="# Updated"),
        headers=auth_headers(),
    )
    assert updated.status_code == 200
    assert updated.json()["slug"] == created["slug"]
    assert client.get(f"/s/{created['slug']}").text.count("Updated") >= 1


def test_legacy_obsidian_plugin_title_falls_back_to_source_filename() -> None:
    client = make_client()
    created = client.post(
        "/v0/shares",
        json=payload(
            source_path="Folder/陈天桥 - AI赋能 - AI原生 - AI启迪.md",
            title="**AI 时代的拟物化陷阱**",
            client={"plugin_id": "fuyou-share", "plugin_version": "0.0.1", "obsidian_version": "unknown"},
        ),
        headers=auth_headers(),
    )

    assert created.status_code == 200
    body = created.json()
    status = client.get(f"/v0/shares/{body['share_id']}", headers=auth_headers())
    assert status.json()["title"] == "陈天桥 - AI赋能 - AI原生 - AI启迪"


def test_current_obsidian_plugin_preserves_custom_title() -> None:
    client = make_client()
    created = client.post(
        "/v0/shares",
        json=payload(
            source_path="Folder/陈天桥 - AI赋能 - AI原生 - AI启迪.md",
            title="AI 时代的拟物化陷阱",
            client={"plugin_id": "docferry", "plugin_version": "0.0.6", "obsidian_version": "unknown"},
        ),
        headers=auth_headers(),
    )

    assert created.status_code == 200
    body = created.json()
    status = client.get(f"/v0/shares/{body['share_id']}", headers=auth_headers())
    assert status.json()["title"] == "AI 时代的拟物化陷阱"


def test_get_share_status_for_known_share_only() -> None:
    client = make_client()
    created = client.post(
        "/v0/shares",
        json=payload(password="secret"),
        headers=auth_headers(),
    ).json()

    status = client.get(f"/v0/shares/{created['share_id']}", headers=auth_headers())
    assert status.status_code == 200
    body = status.json()
    assert body["share_id"] == created["share_id"]
    assert body["source_path"] == "Notes/hello.md"
    assert body["status"] == "password_protected"
    assert body["password_enabled"] is True

    missing = client.get("/v0/shares/sh_missing", headers=auth_headers())
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "share_not_found"


def test_auth_exchange_is_explicitly_manual_token_only() -> None:
    client = make_client()
    response = client.post(
        "/v0/auth/exchange",
        json={"code": "code-from-legacy-auth-flow", "redirect_uri": "obsidian://docferry/auth"},
    )
    assert response.status_code == 501
    assert response.json()["error"]["code"] == "manual_token_only"
    assert response.json()["error"]["message"] == "DocFerry uses manually issued Cloud tokens in this release."


def test_production_requires_master_key() -> None:
    with pytest.raises(RuntimeError, match="DOCFERRY_MASTER_KEY_B64"):
        create_app(Settings(environment="production", token_hash_secret="production-token-secret"))


def test_cos_object_key_prefix_and_resource_scope() -> None:
    from app.config import Settings
    from app.cos_sts import cos_object_key, cos_resource_for_key

    settings = Settings(
        cos_bucket="docferry-1250000000",
        cos_region="ap-guangzhou",
        cos_object_key_prefix="docferry",
    )
    object_key = cos_object_key(settings, "assets/usr_local/ab/hash")

    assert object_key == "docferry/assets/usr_local/ab/hash"
    assert (
        cos_resource_for_key(settings, object_key)
        == "qcs::cos:ap-guangzhou:uid/1250000000:prefix//1250000000/docferry/docferry/assets/usr_local/ab/hash"
    )


def test_upload_asset_and_read_through_share_proxy(tmp_path) -> None:
    client = make_client(object_storage_root=str(tmp_path))
    image = b"\x89PNG\r\n\x1a\nimage-bytes"
    uploaded = client.post("/v0/assets", content=image, headers=asset_headers(image))

    assert uploaded.status_code == 200
    asset = uploaded.json()
    assert asset["asset_id"].startswith("asset_")
    assert asset["hash"] == f"sha256:{sha256(image).hexdigest()}"
    assert asset["content_type"] == "image/png"
    assert asset["byte_length"] == len(image)
    assert asset["url"] is None

    created = client.post(
        "/v0/shares",
        json=payload(
            html_snapshot=f'<p><img src="docferry-asset://{asset["asset_id"]}" alt="chart"></p>',
            assets=[
                {
                    "asset_id": asset["asset_id"],
                    "role": "image",
                    "original_path": "images/chart.png",
                }
            ]
        ),
        headers=auth_headers(),
    ).json()

    page = client.get(f"/s/{created['slug']}")
    assert page.status_code == 200
    assert f'/s/{created["slug"]}/assets/{asset["asset_id"]}' in page.text

    proxied = client.get(f"/s/{created['slug']}/assets/{asset['asset_id']}")
    assert proxied.status_code == 200
    assert proxied.content == image
    assert proxied.headers["content-type"].startswith("image/png")
    assert "no-transform" in proxied.headers["cache-control"]

    unrelated = client.post("/v0/shares", json=payload(title="No asset"), headers=auth_headers()).json()
    missing = client.get(f"/s/{unrelated['slug']}/assets/{asset['asset_id']}")
    assert missing.status_code == 404


def test_encrypted_share_fields_are_not_plaintext_and_are_rendered() -> None:
    client = make_client(master_key_b64=TEST_MASTER_KEY_B64)
    markdown = "# Secret Note\n\nHidden body."
    html_snapshot = "<h1>Secret HTML</h1><p>Hidden body.</p>"
    created = client.post(
        "/v0/shares",
        json=payload(markdown=markdown, html_snapshot=html_snapshot),
        headers=auth_headers(),
    )

    assert created.status_code == 200
    body = created.json()
    with client.app.state.session_factory() as session:
        share = session.execute(select(Share).where(Share.id == body["share_id"])).scalar_one()
        assert share.markdown is not None
        assert share.html_snapshot is not None
        assert '"df_enc":1' in share.markdown
        assert markdown not in share.markdown
        assert html_snapshot not in share.html_snapshot

    page = client.get(f"/s/{body['slug']}")
    assert page.status_code == 200
    assert "Secret HTML" in page.text
    assert "Hidden body." in page.text

    imported = client.get(f"/s/{body['slug']}/import")
    assert imported.status_code == 200
    assert imported.json()["markdown"] == markdown


def test_encrypted_asset_object_hides_plaintext_and_serves_decrypted(tmp_path) -> None:
    client = make_client(object_storage_root=str(tmp_path), master_key_b64=TEST_MASTER_KEY_B64)
    image = b"\x89PNG\r\n\x1a\nencrypted-image-bytes"
    uploaded = client.post("/v0/assets", content=image, headers=asset_headers(image))

    assert uploaded.status_code == 200
    asset = uploaded.json()
    with client.app.state.session_factory() as session:
        asset_row = session.get(Asset, asset["asset_id"])
        raw = client.app.state.object_storage.path_for_key(asset_row.storage_key).read_bytes()
        assert raw.startswith(b"DFENC1\n")
        assert image not in raw

    created = client.post(
        "/v0/shares",
        json=payload(assets=[{"asset_id": asset["asset_id"], "role": "image"}]),
        headers=auth_headers(),
    ).json()
    proxied = client.get(f"/s/{created['slug']}/assets/{asset['asset_id']}")
    assert proxied.status_code == 200
    assert proxied.content == image


def test_encrypted_objectized_snapshot_imports_decrypted_markdown(tmp_path) -> None:
    client = make_client(object_storage_root=str(tmp_path), snapshot_max_db_bytes=32, master_key_b64=TEST_MASTER_KEY_B64)
    markdown = "# Large secret\n\n" + ("hidden " * 40)
    created = client.post("/v0/shares", json=payload(markdown=markdown), headers=auth_headers())

    assert created.status_code == 200
    body = created.json()
    with client.app.state.session_factory() as session:
        share = session.execute(select(Share).where(Share.id == body["share_id"])).scalar_one()
        assert share.markdown is None
        asset = session.get(Asset, share.markdown_asset_id)
        raw = client.app.state.object_storage.path_for_key(asset.storage_key).read_bytes()
        assert raw.startswith(b"DFENC1\n")
        assert markdown.encode("utf-8") not in raw

    page = client.get(f"/s/{body['slug']}")
    assert page.status_code == 200
    assert "Large secret" in page.text

    imported = client.get(f"/s/{body['slug']}/import")
    assert imported.status_code == 200
    assert imported.json()["markdown"] == markdown


def test_legacy_plaintext_db_fields_read_with_encryption_enabled() -> None:
    client = make_client(master_key_b64=TEST_MASTER_KEY_B64)
    created = client.post("/v0/shares", json=payload(), headers=auth_headers()).json()
    legacy_markdown = "# Legacy Plaintext\n\nStill readable."
    with client.app.state.session_factory() as session:
        share = session.execute(select(Share).where(Share.id == created["share_id"])).scalar_one()
        share.markdown = legacy_markdown
        share.html_snapshot = None
        session.commit()

    page = client.get(f"/s/{created['slug']}")
    assert page.status_code == 200
    assert "Legacy Plaintext" in page.text

    imported = client.get(f"/s/{created['slug']}/import")
    assert imported.status_code == 200
    assert imported.json()["markdown"] == legacy_markdown


def test_legacy_plaintext_object_reads_with_encryption_enabled(tmp_path) -> None:
    client = make_client(object_storage_root=str(tmp_path), master_key_b64=TEST_MASTER_KEY_B64)
    image = b"\x89PNG\r\n\x1a\nlegacy-plaintext-object"
    asset = client.post("/v0/assets", content=image, headers=asset_headers(image)).json()
    created = client.post(
        "/v0/shares",
        json=payload(assets=[{"asset_id": asset["asset_id"], "role": "image"}]),
        headers=auth_headers(),
    ).json()

    with client.app.state.session_factory() as session:
        asset_row = session.get(Asset, asset["asset_id"])
        client.app.state.object_storage.put(asset_row.storage_key, image)

    proxied = client.get(f"/s/{created['slug']}/assets/{asset['asset_id']}")
    assert proxied.status_code == 200
    assert proxied.content == image


def test_asset_upload_intent_falls_back_without_cos_config(tmp_path) -> None:
    client = make_client(object_storage_root=str(tmp_path))
    image = b"\x89PNG\r\n\x1a\nimage-bytes"
    response = client.post(
        "/v0/assets/intents",
        json={
            "filename": "chart.png",
            "content_type": "image/png",
            "byte_length": len(image),
            "hash": f"sha256:{sha256(image).hexdigest()}",
        },
        headers=auth_headers(),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "api_proxy"
    assert body["fallback_url"] == "/v0/assets"
    assert body["storage_key"].startswith("assets/usr_local/")
    assert body["asset"] is None


def test_asset_upload_intent_reuses_existing_asset(tmp_path) -> None:
    client = make_client(object_storage_root=str(tmp_path))
    image = b"\x89PNG\r\n\x1a\nimage-bytes"
    uploaded = client.post("/v0/assets", content=image, headers=asset_headers(image)).json()

    response = client.post(
        "/v0/assets/intents",
        json={
            "filename": "chart.png",
            "content_type": "image/png",
            "byte_length": len(image),
            "hash": uploaded["hash"],
        },
        headers=auth_headers(),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "already_uploaded"
    assert body["asset"]["asset_id"] == uploaded["asset_id"]


def test_asset_upload_intent_returns_cos_upload_target(tmp_path, monkeypatch) -> None:
    from app import main as main_module
    from app.cos_sts import CosCredentials, CosUploadTarget

    def fake_target(settings, storage_key):  # type: ignore[no-untyped-def]
        return CosUploadTarget(
            bucket=settings.cos_bucket,
            region=settings.cos_region,
            key=f"docferry/{storage_key}",
            slice_size=5 * 1024 * 1024,
            credentials=CosCredentials(
                tmp_secret_id="tmp-secret-id",
                tmp_secret_key="tmp-secret-key",
                session_token="session-token",
                start_time=1_800_000_000,
                expired_time=1_800_001_800,
            ),
        )

    monkeypatch.setattr(main_module, "create_cos_upload_target", fake_target)
    client = make_client(
        object_storage_root=str(tmp_path),
        cos_direct_upload_enabled=True,
        cos_secret_id="secret-id",
        cos_secret_key="secret-key",
        cos_bucket="docferry-1250000000",
        cos_region="ap-guangzhou",
    )
    image = b"\x89PNG\r\n\x1a\ncos-image"
    response = client.post(
        "/v0/assets/intents",
        json={
            "filename": "chart.png",
            "content_type": "image/png",
            "byte_length": len(image),
            "hash": f"sha256:{sha256(image).hexdigest()}",
        },
        headers=auth_headers(),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "tencent_cos"
    assert body["asset_id"].startswith("asset_")
    assert body["upload"]["provider"] == "tencent_cos"
    assert body["upload"]["bucket"] == "docferry-1250000000"
    assert body["upload"]["credentials"]["session_token"] == "session-token"
    assert body["upload"]["headers"]["x-cos-meta-docferry-sha256"].startswith("sha256:")


def test_encryption_forces_asset_upload_intent_api_proxy(tmp_path, monkeypatch) -> None:
    from app import main as main_module

    def unexpected_target(settings, storage_key):  # type: ignore[no-untyped-def]
        raise AssertionError("direct upload target should not be created when encryption is enabled")

    monkeypatch.setattr(main_module, "create_cos_upload_target", unexpected_target)
    client = make_client(
        object_storage_root=str(tmp_path),
        master_key_b64=TEST_MASTER_KEY_B64,
        cos_direct_upload_enabled=True,
        cos_secret_id="secret-id",
        cos_secret_key="secret-key",
        cos_bucket="docferry-1250000000",
        cos_region="ap-guangzhou",
    )
    image = b"\x89PNG\r\n\x1a\nencrypted-cos-fallback"
    response = client.post(
        "/v0/assets/intents",
        json={
            "filename": "chart.png",
            "content_type": "image/png",
            "byte_length": len(image),
            "hash": f"sha256:{sha256(image).hexdigest()}",
        },
        headers=auth_headers(),
    )

    assert response.status_code == 200
    assert response.json()["mode"] == "api_proxy"


def test_complete_direct_asset_upload_commits_existing_object(tmp_path) -> None:
    client = make_client(object_storage_root=str(tmp_path))
    image = b"\x89PNG\r\n\x1a\ndirect-image"
    content_hash = f"sha256:{sha256(image).hexdigest()}"
    storage = client.app.state.object_storage
    storage_key = storage.storage_key("usr_local", content_hash)
    storage.put(storage_key, image)

    completed = client.post(
        "/v0/assets/asset_directtest/complete",
        json={
            "filename": "direct.png",
            "content_type": "image/png",
            "byte_length": len(image),
            "hash": content_hash,
            "storage_key": storage_key,
        },
        headers=auth_headers(),
    )

    assert completed.status_code == 200
    asset = completed.json()
    assert asset["asset_id"] == "asset_directtest"
    assert asset["hash"] == content_hash

    created = client.post(
        "/v0/shares",
        json=payload(assets=[{"asset_id": asset["asset_id"], "role": "image"}]),
        headers=auth_headers(),
    ).json()
    proxied = client.get(f"/s/{created['slug']}/assets/{asset['asset_id']}")
    assert proxied.status_code == 200
    assert proxied.content == image


def test_css_asset_is_linked_from_viewer(tmp_path) -> None:
    client = make_client(object_storage_root=str(tmp_path))
    css = b".markdown-preview-view .callout { border-color: #123456; }"
    uploaded = client.post("/v0/assets", content=css, headers=asset_headers(css, "text/css"))

    assert uploaded.status_code == 200
    asset = uploaded.json()
    created = client.post(
        "/v0/shares",
        json=payload(
            html_snapshot='<div class="callout">Styled by snapshot</div>',
            css_asset_id=asset["asset_id"],
            assets=[
                {
                    "asset_id": asset["asset_id"],
                    "role": "css",
                    "original_path": "docferry-obsidian-theme-snapshot.css",
                }
            ],
        ),
        headers=auth_headers(),
    ).json()

    page = client.get(f"/s/{created['slug']}")
    assert page.status_code == 200
    assert f'/s/{created["slug"]}/assets/{asset["asset_id"]}' in page.text
    assert 'data-docferry-theme-snapshot="true"' in page.text
    assert ".reader-page .markdown-body img" in page.text

    proxied = client.get(f"/s/{created['slug']}/assets/{asset['asset_id']}")
    assert proxied.status_code == 200
    assert proxied.content == css
    assert proxied.headers["content-type"].startswith("text/css")


def test_share_rejects_invalid_css_asset_reference(tmp_path) -> None:
    client = make_client(object_storage_root=str(tmp_path))
    css = b".markdown-preview-view { color: #123456; }"
    image = b"\x89PNG\r\n\x1a\nnot-css"
    css_asset = client.post("/v0/assets", content=css, headers=asset_headers(css, "text/css")).json()
    image_asset = client.post("/v0/assets", content=image, headers=asset_headers(image)).json()

    missing_link = client.post(
        "/v0/shares",
        json=payload(css_asset_id=css_asset["asset_id"], assets=[]),
        headers=auth_headers(),
    )
    assert missing_link.status_code == 400
    assert missing_link.json()["error"]["code"] == "invalid_css_asset"

    wrong_role = client.post(
        "/v0/shares",
        json=payload(css_asset_id=css_asset["asset_id"], assets=[{"asset_id": css_asset["asset_id"], "role": "image"}]),
        headers=auth_headers(),
    )
    assert wrong_role.status_code == 400
    assert wrong_role.json()["error"]["code"] == "invalid_css_asset"

    wrong_type = client.post(
        "/v0/shares",
        json=payload(css_asset_id=image_asset["asset_id"], assets=[{"asset_id": image_asset["asset_id"], "role": "css"}]),
        headers=auth_headers(),
    )
    assert wrong_type.status_code == 400
    assert wrong_type.json()["error"]["code"] == "invalid_css_asset"


def test_password_protected_share_assets_require_password(tmp_path) -> None:
    client = make_client(object_storage_root=str(tmp_path))
    image = b"\x89PNG\r\n\x1a\nprotected-image"
    asset = client.post("/v0/assets", content=image, headers=asset_headers(image)).json()
    created = client.post(
        "/v0/shares",
        json=payload(password="secret", assets=[{"asset_id": asset["asset_id"], "role": "image"}]),
        headers=auth_headers(),
    ).json()

    locked = client.get(f"/s/{created['slug']}/assets/{asset['asset_id']}")
    assert locked.status_code == 401

    client.post(f"/s/{created['slug']}/password", json={"password": "secret"})
    opened = client.get(f"/s/{created['slug']}/assets/{asset['asset_id']}")
    assert opened.status_code == 200
    assert opened.content == image


def test_asset_upload_validation(tmp_path) -> None:
    client = make_client(object_storage_root=str(tmp_path), asset_max_bytes=4)
    image = b"image"

    too_large = client.post("/v0/assets", content=image, headers=asset_headers(image))
    assert too_large.status_code == 413
    assert too_large.json()["error"]["code"] == "asset_too_large"

    small = b"img"
    bad_type = client.post("/v0/assets", content=small, headers=asset_headers(small, "text/html"))
    assert bad_type.status_code == 415
    assert bad_type.json()["error"]["code"] == "asset_type_not_allowed"

    headers = asset_headers(small)
    headers["X-Share-Asset-Hash"] = "sha256:wrong"
    bad_hash = client.post("/v0/assets", content=small, headers=headers)
    assert bad_hash.status_code == 400
    assert bad_hash.json()["error"]["code"] == "asset_hash_mismatch"


def test_asset_owner_quota_is_enforced(tmp_path) -> None:
    client = make_client(object_storage_root=str(tmp_path), asset_owner_quota_bytes=4)
    first = b"1234"
    second = b"5678"

    uploaded = client.post("/v0/assets", content=first, headers=asset_headers(first))
    assert uploaded.status_code == 200

    duplicate = client.post("/v0/assets", content=first, headers=asset_headers(first))
    assert duplicate.status_code == 200
    assert duplicate.json()["asset_id"] == uploaded.json()["asset_id"]

    over_quota = client.post("/v0/assets", content=second, headers=asset_headers(second, filename="second.png"))
    assert over_quota.status_code == 413
    assert over_quota.json()["error"]["code"] == "asset_quota_exceeded"


def test_share_asset_count_limit_is_enforced(tmp_path) -> None:
    client = make_client(object_storage_root=str(tmp_path), asset_max_per_share=1)
    first = b"\x89PNG\r\n\x1a\nfirst"
    second = b"\x89PNG\r\n\x1a\nsecond"
    first_asset = client.post("/v0/assets", content=first, headers=asset_headers(first, filename="first.png")).json()
    second_asset = client.post("/v0/assets", content=second, headers=asset_headers(second, filename="second.png")).json()

    response = client.post(
        "/v0/shares",
        json=payload(
            assets=[
                {"asset_id": first_asset["asset_id"], "role": "image"},
                {"asset_id": second_asset["asset_id"], "role": "image"},
            ]
        ),
        headers=auth_headers(),
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "share_asset_limit_exceeded"


def test_share_rejects_unknown_asset() -> None:
    client = make_client()
    response = client.post(
        "/v0/shares",
        json=payload(assets=[{"asset_id": "asset_missing", "role": "image"}]),
        headers=auth_headers(),
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_asset"


def test_get_share_events_requires_auth_and_known_share() -> None:
    client = make_client()
    created = client.post(
        "/v0/shares",
        json=payload(password="secret"),
        headers=auth_headers(),
    ).json()
    client.get(f"/s/{created['slug']}")
    client.post(f"/s/{created['slug']}/password", json={"password": "wrong"})

    unauthorized = client.get(f"/v0/shares/{created['share_id']}/events")
    assert unauthorized.status_code == 401

    events = client.get(f"/v0/shares/{created['share_id']}/events", headers=auth_headers())
    assert events.status_code == 200
    body = events.json()
    assert body["share_id"] == created["share_id"]
    assert body["slug"] == created["slug"]
    assert [event["event_type"] for event in body["events"]] == ["password_failed", "password_required"]
    assert body["events"][0]["ip_hash"].startswith("sha256:")
    assert body["events"][0]["event_id"].startswith("evt_")

    limited = client.get(f"/v0/shares/{created['share_id']}/events?limit=1", headers=auth_headers())
    assert limited.status_code == 200
    assert len(limited.json()["events"]) == 1

    missing = client.get("/v0/shares/sh_missing/events", headers=auth_headers())
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "share_not_found"


def test_import_payload_respects_single_share_and_password_boundary() -> None:
    client = make_client()
    created = client.post(
        "/v0/shares",
        json=payload(password="secret"),
        headers=auth_headers(),
    ).json()

    locked = client.get(f"/s/{created['slug']}/import")
    assert locked.status_code == 401
    assert locked.json()["error"]["code"] == "password_required"

    ok = client.post(f"/s/{created['slug']}/password", json={"password": "secret"})
    assert ok.status_code == 200

    imported = client.get(f"/s/{created['slug']}/import")
    assert imported.status_code == 200
    body = imported.json()
    assert body["slug"] == created["slug"]
    assert body["title"] == "Hello"
    assert body["markdown"] == "# Hello\n\nThis is a shared note."
    assert body["assets"] == []
    assert "source_path" not in body
    assert access_event_types(client) == ["password_required", "password_success", "import"]


def test_import_payload_includes_explicit_non_css_assets(tmp_path) -> None:
    client = make_client(object_storage_root=str(tmp_path))
    image = b"\x89PNG\r\n\x1a\nimport-image"
    pdf = b"%PDF-1.4\nimport-pdf\n"
    css = b".markdown-body { color: #123456; }"
    image_asset = client.post("/v0/assets", content=image, headers=asset_headers(image)).json()
    pdf_asset = client.post(
        "/v0/assets",
        content=pdf,
        headers=asset_headers(pdf, "application/pdf", "brief.pdf"),
    ).json()
    css_asset = client.post("/v0/assets", content=css, headers=asset_headers(css, "text/css", "theme.css")).json()

    created = client.post(
        "/v0/shares",
        json=payload(
            markdown="# Hello\n\n![Chart](images/chart.png)\n\n[Brief](attachments/brief.pdf)",
            css_asset_id=css_asset["asset_id"],
            assets=[
                {"asset_id": image_asset["asset_id"], "role": "image", "original_path": "images/chart.png"},
                {"asset_id": pdf_asset["asset_id"], "role": "attachment", "original_path": "attachments/brief.pdf"},
                {"asset_id": css_asset["asset_id"], "role": "css", "original_path": "theme.css"},
            ],
        ),
        headers=auth_headers(),
    ).json()

    imported = client.get(f"/s/{created['slug']}/import")
    assert imported.status_code == 200
    assets = imported.json()["assets"]
    assert [asset["role"] for asset in assets] == ["image", "attachment"]
    assert assets[0]["original_path"] == "images/chart.png"
    assert assets[0]["url"] == f"http://testserver/s/{created['slug']}/assets/{image_asset['asset_id']}"
    assert assets[1]["filename"] == "brief.pdf"
    assert assets[1]["content_type"] == "application/pdf"
    assert "theme.css" not in str(assets)

    pdf_response = client.get(assets[1]["url"])
    assert pdf_response.status_code == 200
    assert pdf_response.content == pdf

    client.delete(f"/v0/shares/{created['share_id']}", headers=auth_headers())
    assert client.get(assets[1]["url"]).status_code == 410


def test_large_markdown_and_html_snapshot_are_objectized(tmp_path) -> None:
    client = make_client(object_storage_root=str(tmp_path), snapshot_max_db_bytes=32)
    markdown = "# Large note\n\n" + ("body " * 40)
    html_snapshot = "<h1>Rendered large note</h1><p>" + ("body " * 40) + "</p>"

    created = client.post(
        "/v0/shares",
        json=payload(markdown=markdown, html_snapshot=html_snapshot),
        headers=auth_headers(),
    )

    assert created.status_code == 200
    body = created.json()
    session_factory = client.app.state.session_factory
    with session_factory() as session:
        share = session.execute(select(Share).where(Share.id == body["share_id"])).scalar_one()
        assert share.markdown is None
        assert share.html_snapshot is None
        assert share.markdown_asset_id
        assert share.html_snapshot_asset_id
        snapshot_assets = session.execute(
            select(Asset).where(Asset.id.in_([share.markdown_asset_id, share.html_snapshot_asset_id]))
        ).scalars().all()
        assert {asset.content_type for asset in snapshot_assets} == {"text/markdown", "text/html"}

    page = client.get(f"/s/{body['slug']}")
    assert page.status_code == 200
    assert "Rendered large note" in page.text

    imported = client.get(f"/s/{body['slug']}/import")
    assert imported.status_code == 200
    assert imported.json()["markdown"] == markdown
    assert imported.json()["assets"] == []


def test_gc_assets_keeps_objectized_snapshot_assets(tmp_path) -> None:
    database_path = tmp_path / "docferry.db"
    object_root = tmp_path / "objects"
    client = make_client(
        database_url=f"sqlite+pysqlite:///{database_path}",
        object_storage_root=str(object_root),
        snapshot_max_db_bytes=32,
    )
    markdown = "# Large note\n\n" + ("body " * 40)
    created = client.post(
        "/v0/shares",
        json=payload(markdown=markdown),
        headers=auth_headers(),
    )
    assert created.status_code == 200

    script = Path(__file__).resolve().parents[1] / "scripts" / "gc_assets.py"
    dry_run = subprocess.run(
        [
            sys.executable,
            str(script),
            "--database-url",
            f"sqlite+pysqlite:///{database_path}",
            "--object-storage-root",
            str(object_root),
            "--older-than-days",
            "0",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    assert '"candidate_count": 0' in dry_run.stdout
    assert [path for path in object_root.rglob("*") if path.is_file()]


def test_gc_assets_dry_run_and_apply(tmp_path) -> None:
    database_path = tmp_path / "docferry.db"
    object_root = tmp_path / "objects"
    client = make_client(
        database_url=f"sqlite+pysqlite:///{database_path}",
        object_storage_root=str(object_root),
    )
    image = b"\x89PNG\r\n\x1a\norphan"
    uploaded = client.post("/v0/assets", content=image, headers=asset_headers(image))
    assert uploaded.status_code == 200
    assert [path for path in object_root.rglob("*") if path.is_file()]

    script = Path(__file__).resolve().parents[1] / "scripts" / "gc_assets.py"
    base_args = [
        sys.executable,
        str(script),
        "--database-url",
        f"sqlite+pysqlite:///{database_path}",
        "--object-storage-root",
        str(object_root),
        "--older-than-days",
        "0",
    ]

    dry_run = subprocess.run(base_args, check=True, capture_output=True, text=True)
    assert '"apply": false' in dry_run.stdout
    assert '"candidate_count": 1' in dry_run.stdout
    assert [path for path in object_root.rglob("*") if path.is_file()]

    applied = subprocess.run([*base_args, "--apply"], check=True, capture_output=True, text=True)
    assert '"apply": true' in applied.stdout
    assert '"deleted_count": 1' in applied.stdout
    assert not [path for path in object_root.rglob("*") if path.is_file()]


def test_gc_access_events_dry_run_and_apply(tmp_path) -> None:
    database_path = tmp_path / "docferry.db"
    client = make_client(database_url=f"sqlite+pysqlite:///{database_path}")
    created = client.post("/v0/shares", json=payload(), headers=auth_headers()).json()
    client.get(f"/s/{created['slug']}")

    session_factory = client.app.state.session_factory
    with session_factory() as session:
        event = session.execute(select(ShareAccessEvent)).scalar_one()
        event.created_at = utc_datetime_days_ago(120)
        session.commit()

    script = Path(__file__).resolve().parents[1] / "scripts" / "gc_access_events.py"
    base_args = [
        sys.executable,
        str(script),
        "--database-url",
        f"sqlite+pysqlite:///{database_path}",
        "--older-than-days",
        "90",
    ]

    dry_run = subprocess.run(base_args, check=True, capture_output=True, text=True)
    dry_run_body = json.loads(dry_run.stdout)
    assert dry_run_body["apply"] is False
    assert dry_run_body["candidate_count"] == 1
    assert dry_run_body["deleted_count"] == 0
    assert access_events(client)

    applied = subprocess.run([*base_args, "--apply"], check=True, capture_output=True, text=True)
    applied_body = json.loads(applied.stdout)
    assert applied_body["apply"] is True
    assert applied_body["deleted_count"] == 1
    assert access_events(client) == []


def test_backup_docferry_dry_run_outputs_plan_without_writing(tmp_path) -> None:
    backup_root = tmp_path / "backups"
    object_root = tmp_path / "objects"
    env_file = tmp_path / ".env.production"
    caddy_site = tmp_path / "docferry.caddy"
    object_root.mkdir()
    env_file.write_text("DOCFERRY_PUBLIC_BASE_URL=https://docferry.example\n", encoding="utf-8")
    caddy_site.write_text("docferry.example { reverse_proxy 127.0.0.1:8787 }\n", encoding="utf-8")

    script = Path(__file__).resolve().parents[1] / "scripts" / "backup_docferry.py"
    result = subprocess.run(
        [
            sys.executable,
            str(script),
            "--backup-root",
            str(backup_root),
            "--object-storage-root",
            str(object_root),
            "--env-file",
            str(env_file),
            "--caddy-site",
            str(caddy_site),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    body = json.loads(result.stdout)
    assert body["apply"] is False
    assert body["backup_id"]
    assert backup_root.exists() is False
    assert [operation["type"] for operation in body["operations"]] == [
        "postgres",
        "objects",
        "config_file",
        "config_file",
        "systemd_unit",
    ]


def test_import_payload_rejects_stopped_and_missing_shares() -> None:
    client = make_client()
    created = client.post("/v0/shares", json=payload(), headers=auth_headers()).json()
    client.delete(f"/v0/shares/{created['share_id']}", headers=auth_headers())

    stopped = client.get(f"/s/{created['slug']}/import")
    assert stopped.status_code == 410
    assert stopped.json()["error"]["code"] == "share_stopped"

    missing = client.get("/s/missing/import")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "share_not_found"


def test_delete_share_stops_viewer() -> None:
    client = make_client()
    created = client.post("/v0/shares", json=payload(), headers=auth_headers()).json()
    deleted = client.delete(f"/v0/shares/{created['share_id']}", headers=auth_headers())
    assert deleted.status_code == 200
    assert deleted.json()["share_id"] == created["share_id"]

    status = client.get(f"/v0/shares/{created['share_id']}", headers=auth_headers())
    assert status.status_code == 200
    assert status.json()["status"] == "stopped"

    page = client.get(f"/s/{created['slug']}")
    assert page.status_code == 410
    assert "Sharing stopped" in page.text
    assert "stopped" in access_event_types(client)


def test_delete_share_removes_server_content_and_unreferenced_objects(tmp_path) -> None:
    client = make_client(object_storage_root=str(tmp_path), snapshot_max_db_bytes=16, master_key_b64=TEST_MASTER_KEY_B64)
    image = b"\x89PNG\r\n\x1a\nsensitive-image"
    uploaded = client.post("/v0/assets", content=image, headers=asset_headers(image)).json()
    markdown = "# Sensitive\n\n" + ("secret " * 20)
    html_snapshot = "<main>Sensitive HTML snapshot</main>"
    created = client.post(
        "/v0/shares",
        json=payload(
            markdown=markdown,
            html_snapshot=html_snapshot,
            assets=[{"asset_id": uploaded["asset_id"], "role": "image"}],
            password="secret",
        ),
        headers=auth_headers(),
    ).json()

    with client.app.state.session_factory() as session:
        share = session.execute(select(Share).where(Share.id == created["share_id"])).scalar_one()
        asset_ids = {uploaded["asset_id"], share.markdown_asset_id, share.html_snapshot_asset_id} - {None}
        storage_paths = [
            client.app.state.object_storage.path_for_key(session.get(Asset, asset_id).storage_key)
            for asset_id in asset_ids
        ]
        assert all(path.exists() for path in storage_paths)

    deleted = client.delete(f"/v0/shares/{created['share_id']}", headers=auth_headers())
    assert deleted.status_code == 200

    with client.app.state.session_factory() as session:
        stopped = session.get(Share, created["share_id"])
        assert stopped.stopped_at is not None
        assert stopped.title == "Stopped share"
        assert stopped.source_path == ""
        assert stopped.source_hash == "revoked"
        assert stopped.markdown is None
        assert stopped.markdown_asset_id is None
        assert stopped.html_snapshot is None
        assert stopped.html_snapshot_asset_id is None
        assert stopped.password_hash is None
        assert stopped.assets == []
        assert session.execute(select(ShareAsset).where(ShareAsset.share_id == stopped.id)).scalars().all() == []
        for asset_id in asset_ids:
            assert session.get(Asset, asset_id) is None

    assert all(not path.exists() for path in storage_paths)


def test_delete_share_keeps_assets_used_by_other_active_share(tmp_path) -> None:
    client = make_client(object_storage_root=str(tmp_path), master_key_b64=TEST_MASTER_KEY_B64)
    image = b"\x89PNG\r\n\x1a\nshared-image"
    uploaded = client.post("/v0/assets", content=image, headers=asset_headers(image)).json()
    first = client.post(
        "/v0/shares",
        json=payload(assets=[{"asset_id": uploaded["asset_id"], "role": "image"}]),
        headers=auth_headers(),
    ).json()
    second = client.post(
        "/v0/shares",
        json=payload(source_hash="sha256:test-2", assets=[{"asset_id": uploaded["asset_id"], "role": "image"}]),
        headers=auth_headers(),
    ).json()

    with client.app.state.session_factory() as session:
        asset = session.get(Asset, uploaded["asset_id"])
        storage_path = client.app.state.object_storage.path_for_key(asset.storage_key)
        assert storage_path.exists()

    deleted = client.delete(f"/v0/shares/{first['share_id']}", headers=auth_headers())
    assert deleted.status_code == 200

    with client.app.state.session_factory() as session:
        assert session.get(Asset, uploaded["asset_id"]) is not None
        first_links = session.execute(select(ShareAsset).where(ShareAsset.share_id == first["share_id"])).scalars().all()
        second_links = session.execute(select(ShareAsset).where(ShareAsset.share_id == second["share_id"])).scalars().all()
        assert first_links == []
        assert len(second_links) == 1

    assert storage_path.exists()
    proxied = client.get(f"/s/{second['slug']}/assets/{uploaded['asset_id']}")
    assert proxied.status_code == 200
    assert proxied.content == image


def test_update_share_prunes_replaced_snapshot_object(tmp_path) -> None:
    client = make_client(object_storage_root=str(tmp_path), snapshot_max_db_bytes=16, master_key_b64=TEST_MASTER_KEY_B64)
    first_markdown = "# Version one\n\n" + ("alpha " * 20)
    second_markdown = "# Version two\n\n" + ("bravo " * 20)
    created = client.post("/v0/shares", json=payload(markdown=first_markdown), headers=auth_headers()).json()

    with client.app.state.session_factory() as session:
        share = session.get(Share, created["share_id"])
        old_asset_id = share.markdown_asset_id
        old_asset = session.get(Asset, old_asset_id)
        old_path = client.app.state.object_storage.path_for_key(old_asset.storage_key)
        assert old_path.exists()

    updated = client.put(
        f"/v0/shares/{created['share_id']}",
        json=payload(markdown=second_markdown),
        headers=auth_headers(),
    )
    assert updated.status_code == 200

    with client.app.state.session_factory() as session:
        share = session.get(Share, created["share_id"])
        assert share.markdown_asset_id != old_asset_id
        assert session.get(Asset, old_asset_id) is None
        assert session.get(Asset, share.markdown_asset_id) is not None

    assert not old_path.exists()


def test_password_protected_share() -> None:
    client = make_client()
    created = client.post(
        "/v0/shares",
        json=payload(password="secret"),
        headers=auth_headers(),
    ).json()
    protected = client.get(f"/s/{created['slug']}")
    assert protected.status_code == 401
    assert "Protected share" in protected.text

    bad = client.post(f"/s/{created['slug']}/password", json={"password": "wrong"})
    assert bad.status_code == 401
    assert bad.json()["error"]["code"] == "password_invalid"

    ok = client.post(f"/s/{created['slug']}/password", json={"password": "secret"})
    assert ok.status_code == 200
    assert ok.json()["ok"] is True
    opened = client.get(f"/s/{created['slug']}")
    assert opened.status_code == 200
    assert "This is a shared note." in opened.text
    assert access_event_types(client) == ["password_required", "password_failed", "password_success", "view"]


def test_password_attempts_are_rate_limited_per_share_and_ip() -> None:
    client = make_client(password_failed_limit=2, password_failed_window_seconds=600)
    created = client.post(
        "/v0/shares",
        json=payload(password="secret"),
        headers=auth_headers(),
    ).json()

    first = client.post(f"/s/{created['slug']}/password", json={"password": "wrong"})
    second = client.post(f"/s/{created['slug']}/password", json={"password": "still-wrong"})
    limited = client.post(f"/s/{created['slug']}/password", json={"password": "secret"})

    assert first.status_code == 401
    assert second.status_code == 401
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "password_rate_limited"
    assert access_event_types(client) == ["password_failed", "password_failed", "password_rate_limited"]


def test_expired_share() -> None:
    client = make_client()
    created = client.post(
        "/v0/shares",
        json=payload(expires_at=datetime(2000, 1, 1, tzinfo=timezone.utc).isoformat()),
        headers=auth_headers(),
    ).json()
    page = client.get(f"/s/{created['slug']}")
    assert page.status_code == 410
    assert "Share expired" in page.text
    assert access_event_types(client) == ["expired"]


def test_missing_share_records_access_event() -> None:
    client = make_client()
    page = client.get("/s/missing")
    assert page.status_code == 404
    events = access_events(client)
    assert len(events) == 1
    assert events[0].event_type == "not_found"
    assert events[0].share_id is None
    assert events[0].slug == "missing"
    assert events[0].status_code == 404


def test_obsidian_markdown_fallback_elements() -> None:
    html = render_markdown(
        "> [!important]\n"
        "> Share doc, not share folder.\n\n"
        "[[Internal Note|Readable label]]\n\n"
        "![[chart.png]]\n"
    )
    assert 'class="callout"' in html
    assert "Share doc, not share folder." in html
    assert 'class="internal-link"' in html
    assert "Readable label" in html
    assert 'class="embed embed-missing image-embed"' in html


def test_internal_link_redirects_to_published_share() -> None:
    client = make_client()
    target = client.post(
        "/v0/shares",
        json=payload(source_path="Knowledge/Target Note.md", title="Target Note"),
        headers=auth_headers(),
    ).json()
    source_html = (
        '<p><a data-href="Target Note" href="Target Note" '
        'class="internal-link" target="_blank" rel="noopener nofollow">Target Note</a></p>'
    )
    source = client.post(
        "/v0/shares",
        json=payload(source_path="Knowledge/Source.md", title="Source", html_snapshot=source_html),
        headers=auth_headers(),
    ).json()

    page = client.get(f"/s/{source['slug']}")
    assert page.status_code == 200
    assert f'/s/{source["slug"]}/link?target=Target%20Note' in page.text
    assert ' href="Target Note"' not in page.text
    assert 'target="_blank"' not in page.text

    resolved = client.get(f"/s/{source['slug']}/link?target=Target%20Note", follow_redirects=False)
    assert resolved.status_code == 302
    assert resolved.headers["location"] == f"http://testserver/s/{target['slug']}"


def test_internal_link_index_resolves_with_vault_scope_and_status_api() -> None:
    client = make_client()
    target = client.post(
        "/v0/shares",
        json=payload(vault_id="vlt_alpha", source_path="Knowledge/Target Note.md", title="Target Note"),
        headers=auth_headers(),
    ).json()
    client.post(
        "/v0/shares",
        json=payload(vault_id="vlt_beta", source_path="Knowledge/Target Note.md", title="Wrong Vault Target"),
        headers=auth_headers(),
    )
    source_html = (
        '<p><a data-href="Target Note#Intro" href="Target Note#Intro" '
        'class="internal-link">Target Note</a></p>'
    )
    source = client.post(
        "/v0/shares",
        json=payload(
            vault_id="vlt_alpha",
            source_path="Knowledge/Source.md",
            title="Source",
            html_snapshot=source_html,
            outbound_links=[
                {
                    "raw_target": "Target Note#Intro",
                    "target_path": "Knowledge/Target Note.md",
                    "target_subpath": "Intro",
                    "label": "Target Note",
                    "link_kind": "wiki",
                }
            ],
        ),
        headers=auth_headers(),
    ).json()

    page = client.get(f"/s/{source['slug']}")
    assert page.status_code == 200
    assert f'/s/{source["slug"]}/link?target=Target%20Note%23Intro' in page.text

    resolved = client.get(f"/s/{source['slug']}/link?target=Target%20Note%23Intro", follow_redirects=False)
    assert resolved.status_code == 302
    assert resolved.headers["location"] == f"http://testserver/s/{target['slug']}"

    links = client.get(f"/v0/shares/{source['share_id']}/links", headers=auth_headers())
    assert links.status_code == 200
    link = links.json()["links"][0]
    assert link["raw_target"] == "Target Note#Intro"
    assert link["target_path"] == "Knowledge/Target Note.md"
    assert link["target_subpath"] == "Intro"
    assert link["status"] == "resolved"
    assert link["target_share_id"] == target["share_id"]
    assert link["target_url"] == f"http://testserver/s/{target['slug']}"


def test_internal_link_index_does_not_cross_vault() -> None:
    client = make_client()
    client.post(
        "/v0/shares",
        json=payload(vault_id="vlt_beta", source_path="Knowledge/Target Note.md", title="Wrong Vault Target"),
        headers=auth_headers(),
    )
    source = client.post(
        "/v0/shares",
        json=payload(
            vault_id="vlt_alpha",
            source_path="Knowledge/Source.md",
            title="Source",
            outbound_links=[
                {
                    "raw_target": "Target Note",
                    "target_path": "Knowledge/Target Note.md",
                    "link_kind": "wiki",
                }
            ],
        ),
        headers=auth_headers(),
    ).json()

    resolved = client.get(f"/s/{source['slug']}/link?target=Target%20Note", follow_redirects=False)
    assert resolved.status_code == 404
    assert "Linked note is not published" in resolved.text

    links = client.get(f"/v0/shares/{source['share_id']}/links", headers=auth_headers())
    assert links.status_code == 200
    assert links.json()["links"][0]["status"] == "unpublished"


def test_update_share_replaces_internal_link_index() -> None:
    client = make_client()
    source = client.post(
        "/v0/shares",
        json=payload(
            source_path="Knowledge/Source.md",
            outbound_links=[{"raw_target": "Old Target", "target_path": "Knowledge/Old Target.md", "link_kind": "wiki"}],
        ),
        headers=auth_headers(),
    ).json()

    initial_links = client.get(f"/v0/shares/{source['share_id']}/links", headers=auth_headers())
    assert initial_links.status_code == 200
    assert len(initial_links.json()["links"]) == 1

    updated = client.put(
        f"/v0/shares/{source['share_id']}",
        json=payload(source_path="Knowledge/Source.md", outbound_links=[]),
        headers=auth_headers(),
    )
    assert updated.status_code == 200

    replaced_links = client.get(f"/v0/shares/{source['share_id']}/links", headers=auth_headers())
    assert replaced_links.status_code == 200
    assert replaced_links.json()["links"] == []


def test_internal_link_to_unpublished_share_returns_state_page() -> None:
    client = make_client()
    source = client.post(
        "/v0/shares",
        json=payload(source_path="Knowledge/Source.md", title="Source"),
        headers=auth_headers(),
    ).json()

    resolved = client.get(f"/s/{source['slug']}/link?target=Missing%20Note", follow_redirects=False)
    assert resolved.status_code == 404
    assert "Linked note is not published" in resolved.text


def test_internal_link_with_ambiguous_basename_does_not_guess() -> None:
    client = make_client()
    client.post(
        "/v0/shares",
        json=payload(source_path="Team A/Same.md", title="Same A"),
        headers=auth_headers(),
    )
    client.post(
        "/v0/shares",
        json=payload(source_path="Team B/Same.md", title="Same B"),
        headers=auth_headers(),
    )
    source = client.post(
        "/v0/shares",
        json=payload(source_path="Knowledge/Source.md", title="Source"),
        headers=auth_headers(),
    ).json()

    ambiguous = client.get(f"/s/{source['slug']}/link?target=Same", follow_redirects=False)
    assert ambiguous.status_code == 409
    assert "Linked note is ambiguous" in ambiguous.text

    exact = client.get(f"/s/{source['slug']}/link?target=Team%20A%2FSame", follow_redirects=False)
    assert exact.status_code == 302
