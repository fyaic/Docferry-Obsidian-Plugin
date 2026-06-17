# server

FastAPI service for DocFerry share links. It supports both the hosted DocFerry Cloud free-quota path and custom self-hosted deployments: publish one Markdown note, return a share URL, render a read-only viewer, protect shares with passwords and expirations, update or stop shares, expose account quota, validate Cloud tokens, and store note body/object bytes with server-side encrypted-at-rest storage.

## Responsibilities

- Accept publish requests from the Obsidian plugin.
- Store Markdown, HTML snapshots, CSS snapshots, and attachments.
- Generate public share URLs.
- Enforce password protection, expiration, access logging, and stop-sharing behavior.
- Serve read-only viewer pages.
- Update an existing share URL.
- Stop an existing share.
- Isolate owners by Cloud token and enforce the 10 active shares free quota.
- Encrypt note body fields and object bytes at rest.
- Return import payloads for one DocFerry share URL.

## Why Not Reuse A Third-Party Backend

Share Note, QuickShare, Org Share, and similar projects can be useful references, but DocFerry needs its own protocol, data model, deployment model, privacy boundary, and service controls.

## Local Run

Install dependencies:

```bash
uv venv
uv pip install -e ".[dev]"
```

Start PostgreSQL:

```bash
docker compose up -d db
```

Start the API:

```bash
DOCFERRY_DATABASE_URL="postgresql+psycopg://docferry:docferry@127.0.0.1:5432/docferry" \
DOCFERRY_API_TOKEN="dev-token" \
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8787
```

Plugin settings for local development:

```text
Service mode: Custom self-hosted server
Server URL: http://127.0.0.1:8787
Server token: dev-token
```

## API

Implemented:

- `GET /v0/health`
- `GET /v0/account`
- `GET /v0/auth/config`
- `POST /v0/auth/exchange`, which currently returns `manual_token_only`
- `POST /v0/assets/intents`
- `POST /v0/assets/{asset_id}/complete`
- `POST /v0/assets`
- `POST /v0/shares`
- `PUT /v0/shares/{share_id}`
- `GET /v0/shares/{share_id}`
- `GET /v0/shares/{share_id}/events`
- `GET /v0/shares/{share_id}/links`
- `DELETE /v0/shares/{share_id}`
- `GET /s/{slug}`
- `GET /s/{slug}/link`
- `GET /s/{slug}/import`
- `GET /s/{slug}/assets/{asset_id}`
- `POST /s/{slug}/password`

Not implemented:

- User admin dashboard.
- OAuth or SSO token exchange.
- MCP server.

## Viewer Rendering

The viewer prefers the HTML snapshot uploaded by the Obsidian plugin. The plugin renders the note locally with Obsidian's `MarkdownRenderer`, then uploads referenced images, CSS snapshots, and large Markdown/HTML snapshots as object assets. The server still provides fallback CSS and Markdown rendering for:

- Callouts.
- Wiki links.
- Missing image embeds.
- Mermaid snapshot SVG handoff.
- Feishu Docs-only component fallback notices.

The public viewer only exposes assets explicitly referenced by the current share. It does not provide folder, vault, or global directory browsing.

## Database And Production Settings

Development can use SQLite. Docker, staging, and production should use PostgreSQL. Alembic migrations live in `migrations/versions/`.

Production Cloud deployments must configure:

- `DOCFERRY_ENV=production`
- `DOCFERRY_MASTER_KEY_B64`
- `DOCFERRY_TOKEN_HASH_SECRET`
- `DOCFERRY_COOKIE_SECRET`
- `DOCFERRY_DATABASE_URL`

`DOCFERRY_MASTER_KEY_B64` must decode to a 32-byte master key. Production startup fails when the master key is missing.

## Verification

Run tests:

```bash
uv run pytest
```

Run a live smoke test after starting the service:

```bash
uv run python scripts/smoke_test.py --base-url http://127.0.0.1:8787 --token dev-token
```

By default, the smoke test creates 10 active shares, verifies that the 11th create returns `share_quota_exceeded`, and cleans up smoke shares. If the token is not dedicated to smoke testing, use `--skip-quota`:

```bash
uv run python scripts/smoke_test.py --base-url http://127.0.0.1:8787 --token dev-token --skip-quota
```

Asset GC defaults to dry-run and only lists unreferenced assets older than the retention window:

```bash
uv run python scripts/gc_assets.py \
  --database-url "$DOCFERRY_DATABASE_URL" \
  --object-storage-root "$DOCFERRY_OBJECT_STORAGE_ROOT" \
  --older-than-days 7
```

Apply asset GC only after reviewing candidates:

```bash
uv run python scripts/gc_assets.py \
  --database-url "$DOCFERRY_DATABASE_URL" \
  --object-storage-root "$DOCFERRY_OBJECT_STORAGE_ROOT" \
  --older-than-days 7 \
  --apply
```

The maintenance entrypoint defaults to dry-run and can combine backup, backup pruning, asset GC, and access-event GC:

```bash
uv run python scripts/run_maintenance.py
```

Restore drill validates the latest backup bundle against a temporary database:

```bash
uv run python scripts/restore_drill.py --backup-root /root/backups/docferry
```

Production timer templates:

- `deploy/docferry-maintenance.service.example`
- `deploy/docferry-maintenance.timer.example`

## Cloud Deployment

Standard server path:

```bash
/opt/docferry/server
```

The production Compose file manages PostgreSQL only:

```bash
docker-compose.prod.yml
```

First deployment:

```bash
cp .env.production.example .env.production
# Edit .env.production with HTTPS public base URL, database password, master key, token hash secret, and cookie secret.
docker compose --env-file .env.production -f docker-compose.prod.yml config
docker compose --env-file .env.production -f docker-compose.prod.yml up -d db
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip -i https://mirrors.cloud.tencent.com/pypi/simple
.venv/bin/python -m pip install -e . -i https://mirrors.cloud.tencent.com/pypi/simple
cp deploy/docferry-api.service.example /etc/systemd/system/docferry-api.service
systemctl daemon-reload
systemctl enable --now docferry-api
curl http://127.0.0.1:8787/v0/health
```

Generate secrets:

```bash
python - <<'PY'
import base64, secrets
print("DOCFERRY_MASTER_KEY_B64=" + base64.b64encode(secrets.token_bytes(32)).decode())
print("DOCFERRY_TOKEN_HASH_SECRET=" + secrets.token_urlsafe(48))
print("DOCFERRY_COOKIE_SECRET=" + secrets.token_urlsafe(48))
print("DOCFERRY_API_TOKEN=" + secrets.token_urlsafe(48))
PY
```

Issue a Cloud token through the helper:

```bash
uv run python scripts/issue_cloud_token.py --user-id usr_tommy --label tommy-free --limit 10
```

FastAPI runs under host systemd. PostgreSQL runs through Docker Compose. The public endpoint must be an HTTPS domain, with nginx proxying to `127.0.0.1:8787`. A Tencent Cloud IP can be used for staging or preflight, but it must not be embedded as the public Cloud endpoint in the plugin.

Before release:

```bash
uv run python scripts/smoke_test.py --base-url https://<docferry-domain> --token <cloud-token>
uv run python scripts/run_maintenance.py --apply
uv run python scripts/restore_drill.py --backup-root /root/backups/docferry
```

See `deploy/CLOUD_RELEASE_CHECKLIST.md` for the full gate list.
