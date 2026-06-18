#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urljoin
from urllib.request import HTTPCookieProcessor, ProxyHandler, Request, build_opener

PNG_BYTES = b"\x89PNG\r\n\x1a\nDocferry complex regression image\n"


class RegressionError(Exception):
    pass


class Client:
    def __init__(self, base_url: str, token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.opener = build_opener(HTTPCookieProcessor(CookieJar()), ProxyHandler({}))

    def request(
        self,
        method: str,
        path: str,
        *,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
        auth: bool = False,
    ) -> tuple[int, bytes, str]:
        request_headers = {"User-Agent": "DocferryComplexRegression/0.0.6"}
        if headers:
            request_headers.update(headers)
        if auth:
            request_headers["Authorization"] = f"Bearer {self.token}"
        request = Request(
            urljoin(f"{self.base_url}/", path.lstrip("/")),
            data=body,
            headers=request_headers,
            method=method,
        )
        try:
            response = self.opener.open(request, timeout=30)
            return response.status, response.read(), response.headers.get("content-type", "")
        except HTTPError as exc:
            return exc.code, exc.read(), exc.headers.get("content-type", "")

    def json_request(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, object] | None = None,
        auth: bool = False,
    ) -> tuple[int, dict[str, object]]:
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        status, data, _ = self.request(
            method,
            path,
            body=body,
            headers={"Content-Type": "application/json"} if payload is not None else None,
            auth=auth,
        )
        parsed = json.loads(data.decode("utf-8")) if data else {}
        return status, parsed


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Docferry complex share regression against a live server.")
    parser.add_argument("--base-url", default=os.getenv("DOCFERRY_SERVER_URL", "http://127.0.0.1:8787"))
    parser.add_argument("--token-env", default="DOCFERRY_API_TOKEN")
    parser.add_argument(
        "--fixture",
        default=str(Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "complex-share-note.md"),
    )
    parser.add_argument("--keep-share", action="store_true")
    args = parser.parse_args()

    token = os.getenv(args.token_env)
    if not token:
        print(f"Missing token env var: {args.token_env}", file=sys.stderr)
        return 1

    try:
        result = run(args.base_url, token, Path(args.fixture), keep_share=args.keep_share)
    except RegressionError as exc:
        print(f"complex-regression: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def run(base_url: str, token: str, fixture: Path, *, keep_share: bool) -> dict[str, object]:
    markdown = fixture.read_text(encoding="utf-8")
    client = Client(base_url, token)

    status, health = client.json_request("GET", "/v0/health")
    require(status == 200, f"health failed: {status} {health}")

    asset_hash = f"sha256:{hashlib.sha256(PNG_BYTES).hexdigest()}"
    status, data, _ = client.request(
        "POST",
        "/v0/assets",
        body=PNG_BYTES,
        headers={
            "Content-Type": "image/png",
            "X-Share-Asset-Hash": asset_hash,
            "X-Share-Asset-Filename": "regression-chart.png",
        },
        auth=True,
    )
    asset = json.loads(data.decode("utf-8")) if data else {}
    require(status == 200, f"asset upload failed: {status} {asset}")
    asset_id = str(asset["asset_id"])
    require(asset.get("hash") == asset_hash, "asset hash mismatch")

    html_snapshot = (
        '<h1>Docferry Complex Regression Note</h1>'
        '<div class="callout" data-callout="important">Single document boundary</div>'
        '<table><tbody><tr><td>Image asset</td></tr></tbody></table>'
        f'<p><img src="docferry-asset://{asset_id}" alt="Regression chart"></p>'
        '<p><a class="internal-link" href="#">single document boundary</a></p>'
    )
    payload = {
        "source_path": "Regression/complex-share-note.md",
        "source_hash": f"sha256:{hashlib.sha256(markdown.encode('utf-8')).hexdigest()}",
        "title": "Docferry Complex Regression Note",
        "markdown": markdown,
        "html_snapshot": html_snapshot,
        "css_asset_id": None,
        "assets": [{"asset_id": asset_id, "role": "image", "original_path": "images/regression-chart.png"}],
        "expires_at": None,
        "client": {"plugin_id": "complex-regression", "plugin_version": "0.0.6", "obsidian_version": "script"},
    }
    status, share = client.json_request("POST", "/v0/shares", payload=payload, auth=True)
    require(status == 200, f"share create failed: {status} {share}")
    share_id = str(share["share_id"])
    slug = str(share["slug"])

    status, page, _ = client.request("GET", f"/s/{slug}")
    page_text = page.decode("utf-8", errors="replace")
    require(status == 200, f"viewer failed: {status}")
    require(f"/s/{slug}/assets/{asset_id}" in page_text, "asset URL was not rewritten")
    require("docferry-asset://" not in page_text, "asset placeholder leaked to viewer")
    require("Regression/complex-share-note.md" not in page_text, "source path leaked to viewer")

    status, proxied, _ = client.request("GET", f"/s/{slug}/assets/{asset_id}")
    require(status == 200, f"asset proxy failed: {status}")
    require(proxied == PNG_BYTES, "asset proxy bytes mismatch")

    stopped = False
    stopped_asset_status = None
    if not keep_share:
        status, stop_body = client.json_request("DELETE", f"/v0/shares/{share_id}", auth=True)
        require(status == 200, f"stop share failed: {status} {stop_body}")
        stopped = True
        stopped_asset_status, _, _ = client.request("GET", f"/s/{slug}/assets/{asset_id}")
        require(stopped_asset_status == 410, f"stopped asset boundary failed: {stopped_asset_status}")

    return {
        "ok": True,
        "base_url": base_url.rstrip("/"),
        "share_id": share_id,
        "slug": slug,
        "asset_id": asset_id,
        "stopped": stopped,
        "stopped_asset_status": stopped_asset_status,
    }


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RegressionError(message)


if __name__ == "__main__":
    raise SystemExit(main())
