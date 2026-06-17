from __future__ import annotations

from hashlib import sha256
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.markdown import render_markdown

FIXTURE = Path(__file__).parent / "fixtures" / "complex-share-note.md"
PNG_BYTES = b"\x89PNG\r\n\x1a\nDocferry complex regression image\n"
CSS_BYTES = b".markdown-preview-view .callout { border-color: #123456; }\n"


def make_client(tmp_path: Path) -> TestClient:
    app = create_app(
        Settings(
            api_token="test-token",
            public_base_url="http://testserver",
            database_url="sqlite+pysqlite:///:memory:",
            cookie_secret="test-secret",
            object_storage_root=str(tmp_path / "objects"),
        )
    )
    return TestClient(app)


def auth_headers() -> dict[str, str]:
    return {"Authorization": "Bearer test-token"}


def upload_asset(
    client: TestClient,
    body: bytes,
    content_type: str = "image/png",
    filename: str = "regression-chart.png",
) -> dict[str, object]:
    response = client.post(
        "/v0/assets",
        content=body,
        headers={
            **auth_headers(),
            "Content-Type": content_type,
            "X-Share-Asset-Hash": f"sha256:{sha256(body).hexdigest()}",
            "X-Share-Asset-Filename": filename,
        },
    )
    assert response.status_code == 200
    return response.json()


def share_payload(
    markdown: str,
    asset_id: str,
    *,
    html_snapshot: str | None,
    css_asset_id: str | None = None,
) -> dict[str, object]:
    assets = [{"asset_id": asset_id, "role": "image", "original_path": "images/regression-chart.png"}]
    if css_asset_id:
        assets.append(
            {
                "asset_id": css_asset_id,
                "role": "css",
                "original_path": "docferry-obsidian-theme-snapshot.css",
            }
        )
    return {
        "source_path": "Regression/complex-share-note.md",
        "source_hash": f"sha256:{sha256(markdown.encode('utf-8')).hexdigest()}",
        "title": "Docferry Complex Regression Note",
        "markdown": markdown,
        "html_snapshot": html_snapshot,
        "css_asset_id": css_asset_id,
        "assets": assets,
        "expires_at": None,
        "client": {"plugin_id": "regression", "plugin_version": "0.0.1", "obsidian_version": "test"},
    }


def test_complex_markdown_fallback_preserves_obsidian_reading_elements() -> None:
    rendered = render_markdown(FIXTURE.read_text(encoding="utf-8"))

    assert 'class="callout"' in rendered
    assert "Single document boundary" in rendered
    assert "<table>" in rendered
    assert 'class="embed embed-missing image-embed"' in rendered
    assert 'class="internal-link"' in rendered
    assert "single document boundary" in rendered
    assert "dataview" in rendered


def test_complex_snapshot_rewrites_assets_and_enforces_stopped_boundary(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    markdown = FIXTURE.read_text(encoding="utf-8")
    asset = upload_asset(client, PNG_BYTES)
    asset_id = str(asset["asset_id"])
    css_asset = upload_asset(client, CSS_BYTES, "text/css", "docferry-obsidian-theme-snapshot.css")
    css_asset_id = str(css_asset["asset_id"])
    html_snapshot = (
        '<h1>Docferry Complex Regression Note</h1>'
        '<div class="callout" data-callout="important">Single document boundary</div>'
        '<table><tbody><tr><td>Image asset</td></tr></tbody></table>'
        f'<p><img src="docferry-asset://{asset_id}" alt="Regression chart"></p>'
        '<p><a class="internal-link" href="#">single document boundary</a></p>'
    )

    created = client.post(
        "/v0/shares",
        json=share_payload(markdown, asset_id, html_snapshot=html_snapshot, css_asset_id=css_asset_id),
        headers=auth_headers(),
    )
    assert created.status_code == 200
    share = created.json()

    page = client.get(f"/s/{share['slug']}")
    assert page.status_code == 200
    assert f"/s/{share['slug']}/assets/{asset_id}" in page.text
    assert f"/s/{share['slug']}/assets/{css_asset_id}" in page.text
    assert 'data-docferry-theme-snapshot="true"' in page.text
    assert "docferry-asset://" not in page.text
    assert "Regression/complex-share-note.md" not in page.text

    asset_response = client.get(f"/s/{share['slug']}/assets/{asset_id}")
    assert asset_response.status_code == 200
    assert asset_response.content == PNG_BYTES

    css_response = client.get(f"/s/{share['slug']}/assets/{css_asset_id}")
    assert css_response.status_code == 200
    assert css_response.content == CSS_BYTES
    assert css_response.headers["content-type"].startswith("text/css")

    stopped = client.delete(f"/v0/shares/{share['share_id']}", headers=auth_headers())
    assert stopped.status_code == 200
    assert client.get(f"/s/{share['slug']}").status_code == 410
    assert client.get(f"/s/{share['slug']}/assets/{asset_id}").status_code == 410
    assert client.get(f"/s/{share['slug']}/assets/{css_asset_id}").status_code == 410


def test_complex_share_rejects_unlinked_asset_access(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    markdown = FIXTURE.read_text(encoding="utf-8")
    asset = upload_asset(client, PNG_BYTES)
    unlinked = upload_asset(client, b"\x89PNG\r\n\x1a\nunlinked\n")

    created = client.post(
        "/v0/shares",
        json=share_payload(markdown, str(asset["asset_id"]), html_snapshot=None),
        headers=auth_headers(),
    )
    assert created.status_code == 200
    share = created.json()

    response = client.get(f"/s/{share['slug']}/assets/{unlinked['asset_id']}")
    assert response.status_code == 404
