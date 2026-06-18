#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import re
import secrets
import sys
import time
from dataclasses import dataclass
from http.cookiejar import CookieJar
from html import escape
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urljoin
from urllib.request import HTTPCookieProcessor, ProxyHandler, Request, build_opener

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}


class RegressionError(Exception):
    pass


@dataclass(frozen=True)
class AssetRef:
    original_path: str
    path: Path


@dataclass(frozen=True)
class UploadedAsset:
    asset_id: str
    original_path: str


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
        request_headers = {"User-Agent": "DocferryRealVaultRegression/0.0.6"}
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
            response = self.opener.open(request, timeout=60)
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
    parser = argparse.ArgumentParser(
        description="Publish real local vault notes as temporary protected Docferry regression shares."
    )
    parser.add_argument("--base-url", default=os.getenv("DOCFERRY_SERVER_URL", "http://127.0.0.1:8787"))
    parser.add_argument("--token-env", default="DOCFERRY_API_TOKEN")
    parser.add_argument("--token-data-json", help="Obsidian plugin data.json containing apiToken.")
    parser.add_argument("--vault-root", required=True)
    parser.add_argument("--doc", action="append", default=[], help="Markdown file path. Repeat for multiple docs.")
    parser.add_argument("--max-assets-per-doc", type=int, default=20)
    parser.add_argument("--keep-shares", action="store_true")
    parser.add_argument("--no-password", action="store_true")
    parser.add_argument("--strict-assets", action="store_true")
    args = parser.parse_args()

    try:
        token = load_token(args.token_env, args.token_data_json)
        result = run(
            base_url=args.base_url,
            token=token,
            vault_root=Path(args.vault_root).expanduser().resolve(),
            docs=[Path(item).expanduser().resolve() for item in args.doc],
            max_assets_per_doc=args.max_assets_per_doc,
            keep_shares=args.keep_shares,
            password_enabled=not args.no_password,
            strict_assets=args.strict_assets,
        )
    except RegressionError as exc:
        print(f"real-vault-regression: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def load_token(token_env: str, token_data_json: str | None) -> str:
    token = os.getenv(token_env, "")
    if token:
        return token
    if token_data_json:
        data_path = Path(token_data_json).expanduser()
        if data_path.exists():
            data = json.loads(data_path.read_text(encoding="utf-8"))
            token = str(data.get("apiToken") or "")
            if token:
                return token
    raise RegressionError(f"Missing token. Set {token_env} or pass --token-data-json.")


def run(
    *,
    base_url: str,
    token: str,
    vault_root: Path,
    docs: list[Path],
    max_assets_per_doc: int,
    keep_shares: bool,
    password_enabled: bool,
    strict_assets: bool,
) -> dict[str, object]:
    if not docs:
        raise RegressionError("At least one --doc is required.")
    if not vault_root.exists():
        raise RegressionError(f"Vault root does not exist: {vault_root}")

    client = Client(base_url, token)
    status, health = client.json_request("GET", "/v0/health")
    require(status == 200, f"health failed: {status} {health}")

    basename_index = build_basename_index(vault_root)
    results = []
    started = time.perf_counter()
    for doc in docs:
        results.append(
            run_doc(
                client=client,
                vault_root=vault_root,
                basename_index=basename_index,
                doc=doc,
                max_assets=max_assets_per_doc,
                keep_share=keep_shares,
                password_enabled=password_enabled,
                strict_assets=strict_assets,
            )
        )

    return {
        "ok": True,
        "base_url": base_url.rstrip("/"),
        "doc_count": len(results),
        "elapsed_ms": elapsed_ms(started),
        "docs": results,
    }


def run_doc(
    *,
    client: Client,
    vault_root: Path,
    basename_index: dict[str, list[Path]],
    doc: Path,
    max_assets: int,
    keep_share: bool,
    password_enabled: bool,
    strict_assets: bool,
) -> dict[str, object]:
    if not doc.exists():
        raise RegressionError(f"Document does not exist: {doc}")
    if doc.suffix.lower() != ".md":
        raise RegressionError(f"Document is not Markdown: {doc}")

    started = time.perf_counter()
    markdown = doc.read_text(encoding="utf-8")
    source_path = relative_source_path(vault_root, doc)
    title = doc.stem
    metrics = markdown_metrics(markdown)
    asset_refs, unresolved = resolve_image_refs(
        markdown=markdown,
        source_file=doc,
        vault_root=vault_root,
        basename_index=basename_index,
        max_assets=max_assets,
    )
    if strict_assets and unresolved:
        raise RegressionError(f"Unresolved image refs in {source_path}: {len(unresolved)}")

    upload_started = time.perf_counter()
    uploaded_assets = [upload_asset(client, asset_ref) for asset_ref in asset_refs]
    upload_elapsed = elapsed_ms(upload_started)

    password = secrets.token_urlsafe(18) if password_enabled else None
    html_snapshot = build_snapshot(markdown, uploaded_assets)
    payload = {
        "source_path": source_path,
        "source_hash": f"sha256:{hashlib.sha256(markdown.encode('utf-8')).hexdigest()}",
        "title": title,
        "markdown": markdown,
        "html_snapshot": html_snapshot,
        "css_asset_id": None,
        "assets": [
            {"asset_id": asset.asset_id, "role": "image", "original_path": asset.original_path}
            for asset in uploaded_assets
        ],
        "password": password,
        "expires_at": None,
        "client": {
            "plugin_id": "real-vault-regression",
            "plugin_version": "0.0.6",
            "obsidian_version": "script",
        },
    }

    create_started = time.perf_counter()
    status, share = client.json_request("POST", "/v0/shares", payload=payload, auth=True)
    create_elapsed = elapsed_ms(create_started)
    require(status == 200, f"share create failed for {source_path}: {status} {share}")
    share_id = str(share["share_id"])
    slug = str(share["slug"])

    try:
        if password_enabled:
            locked_status, _, _ = client.request("GET", f"/s/{slug}")
            require(locked_status == 401, f"locked viewer should require password: {locked_status}")
            unlock_status, unlock_body = client.json_request("POST", f"/s/{slug}/password", payload={"password": password})
            require(unlock_status == 200, f"password unlock failed: {unlock_status} {unlock_body}")

        view_started = time.perf_counter()
        view_status, page, _ = client.request("GET", f"/s/{slug}")
        view_elapsed = elapsed_ms(view_started)
        require(view_status == 200, f"viewer failed for {source_path}: {view_status}")
        page_text = page.decode("utf-8", errors="replace")
        require(title in page_text, f"title not found in viewer for {source_path}")
        require(source_path not in page_text, f"source path leaked in viewer for {source_path}")
        require("docferry-asset://" not in page_text, f"asset placeholder leaked for {source_path}")
        for asset in uploaded_assets:
            require(f"/s/{slug}/assets/{asset.asset_id}" in page_text, f"asset URL missing for {source_path}")

        import_status, imported = client.json_request("GET", f"/s/{slug}/import")
        require(import_status == 200, f"import payload failed: {import_status} {imported}")
        require(imported.get("source_hash") == payload["source_hash"], "import source hash mismatch")

        stopped = False
        stopped_viewer_status = None
        stopped_asset_statuses: list[int] = []
        if not keep_share:
            delete_status, deleted = client.json_request("DELETE", f"/v0/shares/{share_id}", auth=True)
            require(delete_status == 200, f"stop share failed: {delete_status} {deleted}")
            stopped = True
            stopped_viewer_status, _, _ = client.request("GET", f"/s/{slug}")
            require(stopped_viewer_status == 410, f"stopped viewer boundary failed: {stopped_viewer_status}")
            for asset in uploaded_assets:
                asset_status, _, _ = client.request("GET", f"/s/{slug}/assets/{asset.asset_id}")
                stopped_asset_statuses.append(asset_status)
                require(asset_status == 410, f"stopped asset boundary failed: {asset_status}")

        return {
            "ok": True,
            "source_path": source_path,
            "title": title,
            "share_id": share_id,
            "slug": slug,
            "stopped": stopped,
            "password_protected": password_enabled,
            "metrics": metrics,
            "assets": {
                "image_refs": len(extract_image_refs(markdown)),
                "resolved": len(asset_refs),
                "uploaded": len(uploaded_assets),
                "unresolved": len(unresolved),
                "truncated_by_limit": len(extract_image_refs(markdown)) > max_assets,
            },
            "checks": {
                "viewer_status": view_status,
                "import_status": import_status,
                "stopped_viewer_status": stopped_viewer_status,
                "stopped_asset_statuses": stopped_asset_statuses,
                "internal_link_rewrites": page_text.count(f"/s/{slug}/link?target="),
            },
            "timing_ms": {
                "upload_assets": upload_elapsed,
                "create_share": create_elapsed,
                "viewer": view_elapsed,
                "total": elapsed_ms(started),
            },
        }
    except Exception:
        if not keep_share:
            client.json_request("DELETE", f"/v0/shares/{share_id}", auth=True)
        raise


def markdown_metrics(markdown: str) -> dict[str, int]:
    lines = markdown.splitlines()
    return {
        "chars": len(markdown),
        "lines": len(lines),
        "headings": sum(1 for line in lines if line.startswith("#")),
        "tables": sum(1 for line in lines if line.strip().startswith("|")),
        "callouts": markdown.count("[!"),
        "code_fences": markdown.count("```"),
        "wiki_links": markdown.count("[["),
        "wiki_images": markdown.count("![["),
        "markdown_images": len(re.findall(r"!\[[^\]\n]*\]\(([^)\n]+)\)", markdown)),
    }


def extract_image_refs(markdown: str) -> list[str]:
    refs: list[str] = []
    for match in re.finditer(r"!\[\[([^\]\n]+)\]\]", markdown):
        ref = match.group(1).split("|", 1)[0].strip()
        if ref:
            refs.append(ref)
    for match in re.finditer(r"!\[[^\]\n]*\]\(([^)\n]+)\)", markdown):
        ref = match.group(1).split(None, 1)[0].strip().strip("<>")
        if ref and not re.match(r"^(https?:|data:)", ref, flags=re.IGNORECASE):
            refs.append(ref)
    return refs


def resolve_image_refs(
    *,
    markdown: str,
    source_file: Path,
    vault_root: Path,
    basename_index: dict[str, list[Path]],
    max_assets: int,
) -> tuple[list[AssetRef], list[str]]:
    refs = unique_preserving_order(extract_image_refs(markdown))[:max_assets]
    resolved: list[AssetRef] = []
    unresolved: list[str] = []
    for ref in refs:
        path = resolve_image_ref(ref, source_file, vault_root, basename_index)
        if path:
            resolved.append(AssetRef(original_path=ref, path=path))
        else:
            unresolved.append(ref)
    return resolved, unresolved


def resolve_image_ref(
    ref: str,
    source_file: Path,
    vault_root: Path,
    basename_index: dict[str, list[Path]],
) -> Path | None:
    normalized = ref.replace("\\", "/").split("#", 1)[0].strip().strip("/")
    candidates = [
        (source_file.parent / normalized).resolve(),
        (vault_root / normalized).resolve(),
    ]
    candidates.extend(basename_index.get(Path(normalized).name.lower(), []))
    for candidate in candidates:
        try:
            candidate.relative_to(vault_root)
        except ValueError:
            continue
        if candidate.exists() and candidate.suffix.lower() in IMAGE_EXTENSIONS:
            return candidate
    return None


def build_basename_index(vault_root: Path) -> dict[str, list[Path]]:
    index: dict[str, list[Path]] = {}
    for path in vault_root.rglob("*"):
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS:
            index.setdefault(path.name.lower(), []).append(path)
    return index


def upload_asset(client: Client, asset_ref: AssetRef) -> UploadedAsset:
    body = asset_ref.path.read_bytes()
    content_hash = f"sha256:{hashlib.sha256(body).hexdigest()}"
    content_type = mimetypes.guess_type(asset_ref.path.name)[0] or "application/octet-stream"
    status, data, _ = client.request(
        "POST",
        "/v0/assets",
        body=body,
        headers={
            "Content-Type": content_type,
            "X-Share-Asset-Hash": content_hash,
            "X-Share-Asset-Filename": quote(asset_ref.path.name)[:255],
        },
        auth=True,
    )
    parsed = json.loads(data.decode("utf-8")) if data else {}
    require(status == 200, f"asset upload failed for {asset_ref.original_path}: {status} {parsed}")
    return UploadedAsset(asset_id=str(parsed["asset_id"]), original_path=asset_ref.original_path)


def build_snapshot(markdown: str, assets: list[UploadedAsset]) -> str:
    from app.markdown import render_markdown

    html = render_markdown(markdown)
    if not assets:
        return html
    figures = []
    for asset in assets:
        figures.append(
            '<figure class="image-embed docferry-real-vault-asset">'
            f'<img src="docferry-asset://{escape(asset.asset_id, quote=True)}" alt="Uploaded local image">'
            "</figure>"
        )
    return html + '<section class="docferry-real-vault-assets">' + "".join(figures) + "</section>"


def relative_source_path(vault_root: Path, doc: Path) -> str:
    try:
        return doc.relative_to(vault_root).as_posix()
    except ValueError:
        return doc.name


def unique_preserving_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def elapsed_ms(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RegressionError(message)


if __name__ == "__main__":
    raise SystemExit(main())
