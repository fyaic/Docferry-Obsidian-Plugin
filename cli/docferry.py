#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from http.cookiejar import CookieJar
from pathlib import Path
from pathlib import PurePosixPath
from urllib.error import HTTPError
from urllib.parse import urljoin, urlparse
from urllib.request import HTTPCookieProcessor, ProxyHandler, Request, build_opener


@dataclass
class Response:
    status_code: int
    text: str

    def json(self) -> dict[str, object]:
        return json.loads(self.text) if self.text else {}


@dataclass
class BinaryResponse:
    status_code: int
    body: bytes


class Client:
    def __init__(self, base_url: str, token: str | None) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.opener = build_opener(HTTPCookieProcessor(CookieJar()), ProxyHandler({}))

    def request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, object] | None = None,
        auth: bool = False,
    ) -> Response:
        data = None
        headers = {"User-Agent": "DocferryCLI/0.0.1"}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if auth:
            if not self.token:
                raise CliError("Missing API token. Use --token or DOCFERRY_API_TOKEN.")
            headers["Authorization"] = f"Bearer {self.token}"
        request = Request(urljoin(f"{self.base_url}/", path.lstrip("/")), data=data, headers=headers, method=method)
        try:
            response = self.opener.open(request, timeout=20)
            return Response(response.status, response.read().decode("utf-8"))
        except HTTPError as exc:
            return Response(exc.code, exc.read().decode("utf-8"))

    def get(self, path: str, *, auth: bool = False) -> Response:
        return self.request("GET", path, auth=auth)

    def get_bytes(self, path_or_url: str) -> BinaryResponse:
        parsed = urlparse(path_or_url)
        url = path_or_url if parsed.scheme and parsed.netloc else urljoin(f"{self.base_url}/", path_or_url.lstrip("/"))
        request = Request(url, headers={"User-Agent": "DocferryCLI/0.0.1"}, method="GET")
        try:
            response = self.opener.open(request, timeout=30)
            return BinaryResponse(response.status, response.read())
        except HTTPError as exc:
            return BinaryResponse(exc.code, exc.read())

    def post(self, path: str, *, body: dict[str, object] | None = None, auth: bool = False) -> Response:
        return self.request("POST", path, body=body, auth=auth)

    def put(self, path: str, *, body: dict[str, object], auth: bool = False) -> Response:
        return self.request("PUT", path, body=body, auth=auth)

    def delete(self, path: str, *, auth: bool = False) -> Response:
        return self.request("DELETE", path, auth=auth)


class CliError(Exception):
    pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Docferry command line client.")
    parser.add_argument("--server-url", default=os.getenv("DOCFERRY_SERVER_URL", "http://127.0.0.1:8787"))
    parser.add_argument("--token", default=os.getenv("DOCFERRY_API_TOKEN"))
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("health")

    publish = subparsers.add_parser("publish")
    publish.add_argument("file")
    publish.add_argument("--title")
    publish.add_argument("--source-path")
    publish.add_argument("--password")
    publish.add_argument("--expires-at")

    update = subparsers.add_parser("update")
    update.add_argument("share_id")
    update.add_argument("file")
    update.add_argument("--title")
    update.add_argument("--source-path")
    update.add_argument("--password")
    update.add_argument("--password-mode", choices=["keep", "set", "clear"], default="keep")
    update.add_argument("--expires-at")

    status = subparsers.add_parser("status")
    status.add_argument("share_id")

    events = subparsers.add_parser("events")
    events.add_argument("share_id")
    events.add_argument("--limit", type=int, default=50)

    revoke = subparsers.add_parser("revoke")
    revoke.add_argument("share_id")

    import_url = subparsers.add_parser("import-url")
    import_url.add_argument("url")
    import_url.add_argument("--output", required=True)
    import_url.add_argument("--password")
    import_url.add_argument("--overwrite", action="store_true")

    args = parser.parse_args()

    try:
        client = Client(args.server_url, args.token)
        if args.command == "health":
            print_json(require_ok(client.get("/v0/health"), "health").json())
        elif args.command == "publish":
            print_json(require_ok(client.post("/v0/shares", body=share_payload(args), auth=True), "publish").json())
        elif args.command == "update":
            print_json(
                require_ok(
                    client.put(f"/v0/shares/{args.share_id}", body=share_payload(args, is_update=True), auth=True),
                    "update",
                ).json()
            )
        elif args.command == "status":
            print_json(require_ok(client.get(f"/v0/shares/{args.share_id}", auth=True), "status").json())
        elif args.command == "events":
            print_json(
                require_ok(client.get(f"/v0/shares/{args.share_id}/events?limit={args.limit}", auth=True), "events").json()
            )
        elif args.command == "revoke":
            print_json(require_ok(client.delete(f"/v0/shares/{args.share_id}", auth=True), "revoke").json())
        elif args.command == "import-url":
            import_share(args)
        else:
            raise CliError(f"Unsupported command: {args.command}")
    except CliError as exc:
        print(f"docferry: {exc}", file=sys.stderr)
        return 1
    return 0


def share_payload(args: argparse.Namespace, *, is_update: bool = False) -> dict[str, object]:
    file_path = Path(args.file)
    markdown = file_path.read_text(encoding="utf-8")
    title = args.title or title_from_markdown(markdown) or file_path.stem
    payload: dict[str, object] = {
        "source_path": args.source_path or str(file_path),
        "source_hash": f"sha256:{hashlib.sha256(markdown.encode('utf-8')).hexdigest()}",
        "title": title,
        "markdown": markdown,
        "html_snapshot": None,
        "css_asset_id": None,
        "assets": [],
        "expires_at": args.expires_at,
        "client": {
            "plugin_id": "docferry-cli",
            "plugin_version": "0.0.1",
            "obsidian_version": "cli",
        },
    }
    if args.password:
        payload["password"] = args.password
    if is_update:
        payload["password_mode"] = args.password_mode
    return payload


def import_share(args: argparse.Namespace) -> None:
    base_url, slug = parse_share_url(args.url)
    client = Client(base_url, None)
    response = client.get(f"/s/{slug}/import")
    if response.status_code == 401 and args.password:
        require_ok(client.post(f"/s/{slug}/password", body={"password": args.password}), "password")
        response = client.get(f"/s/{slug}/import")
    body = require_ok(response, "import-url").json()
    output = resolve_output_path(Path(args.output), str(body["title"]))
    if output.exists() and not args.overwrite:
        raise CliError(f"Output already exists: {output}. Use --overwrite to replace it.")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(str(body["markdown"]), encoding="utf-8")
    imported_assets = import_assets(client, output.parent, body.get("assets", []), args.overwrite)
    print_json({"output": str(output), "slug": body["slug"], "title": body["title"], "assets": imported_assets})


def import_assets(client: Client, root: Path, assets: object, overwrite: bool) -> list[dict[str, str]]:
    if not isinstance(assets, list):
        return []
    imported: list[dict[str, str]] = []
    for asset in assets:
        if not isinstance(asset, dict):
            continue
        url = asset.get("url")
        if not isinstance(url, str) or not url:
            continue
        output = resolve_asset_output_path(
            root,
            str(asset.get("original_path") or ""),
            str(asset.get("filename") or asset.get("asset_id") or "attachment"),
        )
        if output.exists() and not overwrite:
            raise CliError(f"Asset already exists: {output}. Use --overwrite to replace it.")
        response = client.get_bytes(url)
        if response.status_code != 200:
            raise CliError(f"asset import failed: {response.status_code}: {url}")
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(response.body)
        imported.append({"asset_id": str(asset.get("asset_id") or ""), "output": str(output)})
    return imported


def parse_share_url(value: str) -> tuple[str, str]:
    parsed = urlparse(value)
    if not parsed.scheme or not parsed.netloc:
        raise CliError("Share URL must include scheme and host.")
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) < 2 or parts[0] != "s":
        raise CliError("Share URL must look like https://host/s/{slug}.")
    return f"{parsed.scheme}://{parsed.netloc}", parts[1]


def resolve_output_path(path: Path, title: str) -> Path:
    if path.exists() and path.is_dir():
        return path / f"{safe_filename(title)}.md"
    if path.suffix:
        return path
    return path / f"{safe_filename(title)}.md"


def resolve_asset_output_path(root: Path, original_path: str, filename: str) -> Path:
    candidate = original_path.split("#", 1)[0].split("?", 1)[0].replace("\\", "/").strip()
    if not candidate:
        candidate = f"attachments/{filename}"
    parts = [
        safe_filename(part)
        for part in PurePosixPath(candidate).parts
        if part not in {"", ".", "..", "/"}
    ]
    if not parts:
        parts = ["attachments", safe_filename(filename)]
    output = root.joinpath(*parts)
    root_resolved = root.resolve()
    output_resolved = output.resolve()
    if not output_resolved.is_relative_to(root_resolved):
        return root / "attachments" / safe_filename(filename)
    return output


def title_from_markdown(markdown: str) -> str | None:
    match = re.search(r"^#\s+(.+)$", markdown, flags=re.MULTILINE)
    return match.group(1).strip() if match else None


def safe_filename(value: str) -> str:
    name = re.sub(r"[\\/:*?\"<>|]+", "-", value).strip().strip(".")
    return name[:120] or f"docferry-import-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"


def require_ok(response: Response, label: str) -> Response:
    if 200 <= response.status_code < 300:
        return response
    try:
        body = response.json()
        error = body.get("error")
        if isinstance(error, dict):
            raise CliError(f"{label} failed: {response.status_code} {error.get('code')}: {error.get('message')}")
    except json.JSONDecodeError:
        pass
    raise CliError(f"{label} failed: {response.status_code}: {response.text[:500]}")


def print_json(value: object) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    raise SystemExit(main())
