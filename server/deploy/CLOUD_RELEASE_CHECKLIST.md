# DocFerry Cloud Release Checklist

This checklist is for the hosted DocFerry Cloud free-quota path. The Tencent Cloud Singapore IP can be used for staging and preflight only. Public plugin releases must use a stable HTTPS domain.

## Release Blockers

| Blocker | Release impact | Completion standard |
| :--- | :--- | :--- |
| HTTPS domain not confirmed | Do not set the plugin Cloud endpoint | `DOCFERRY_CLOUD_BASE_URL` is an HTTPS domain, not an HTTP IP |
| DNS ownership not confirmed | TLS cannot be issued reliably | Domain A/AAAA points to the deployment or reverse proxy |
| TLS certificate missing | Do not publish Cloud default | `curl -I https://<domain>/v0/health` succeeds |
| SSH access missing | Deployment cannot be performed | Operator can log in and restart systemd services |
| Production secrets missing | Cloud service must not start | `.env.production` contains generated master key, token hash secret, install hash secret, blind index secret, cookie secret, API token, and database password |
| Trusted proxy not configured | Claim and password IP limits may be spoofed or over-strict | `DOCFERRY_TRUSTED_PROXY_HOSTS` matches the reverse proxy IPs and nginx overwrites `X-Forwarded-For` with `$remote_addr` |
| Public privacy page stale | Do not publish plugin settings link | Bondie-hosted privacy page documents anonymous claim, random install ID, rate-limit hashes, encrypted-at-rest storage, and deletion behavior |
| Branded Cloud domain set | Submit only after DNS/TLS smoke passes | `DOCFERRY_CLOUD_BASE_URL` uses `https://docferry.bondie.io`, a Bondie-owned HTTPS domain |
| Database migrations not applied | Token/quota tables may be missing | `alembic upgrade head` succeeds from the release worktree |
| Legacy metadata backfill not run | Existing shares may retain plaintext metadata | `python scripts/backfill_metadata_encryption.py` dry-run reviewed, then `--apply` run with production key |
| Backup target not confirmed | Cloud service must not be public | PostgreSQL dump, object storage copy, config backup, and restore drill paths are known |
| Smoke test not passed | Cloud endpoint must not be made default | health, account, create, view, import, quota, stop, and cleanup pass |

## Required Runtime

- Ubuntu on Tencent Cloud or equivalent Linux host.
- FastAPI app managed by systemd.
- PostgreSQL managed by Docker Compose.
- nginx reverse proxy to `127.0.0.1:8787`.
- Let's Encrypt certbot or an operator-provided certificate.
- `.env.production` stored on the server only.

## Secret Generation

Generate secrets on the deployment machine or a trusted admin machine. Do not commit generated values.

```bash
python - <<'PY'
import base64, secrets
print("DOCFERRY_MASTER_KEY_B64=" + base64.b64encode(secrets.token_bytes(32)).decode())
print("DOCFERRY_TOKEN_HASH_SECRET=" + secrets.token_urlsafe(48))
print("DOCFERRY_INSTALL_HASH_SECRET=" + secrets.token_urlsafe(48))
print("DOCFERRY_BLIND_INDEX_SECRET=" + secrets.token_urlsafe(48))
print("DOCFERRY_COOKIE_SECRET=" + secrets.token_urlsafe(48))
print("DOCFERRY_API_TOKEN=" + secrets.token_urlsafe(48))
print("DOCFERRY_POSTGRES_PASSWORD=" + secrets.token_urlsafe(32))
PY
```

DocFerry Cloud tokens are normally issued by the plugin through `POST /v0/cloud/claim`. Use the helper only for support, migration, or local diagnostics:

```bash
uv run python scripts/issue_cloud_token.py --user-id usr_<name> --label <label>-free --limit 5
```

## Deployment Commands

```bash
cd /opt/docferry/server
cp .env.production.example .env.production
$EDITOR .env.production
docker compose --env-file .env.production -f docker-compose.prod.yml config
docker compose --env-file .env.production -f docker-compose.prod.yml up -d db
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -e .
sudo cp deploy/docferry-api.service.example /etc/systemd/system/docferry-api.service
sudo cp deploy/docferry-maintenance.service.example /etc/systemd/system/docferry-maintenance.service
sudo cp deploy/docferry-maintenance.timer.example /etc/systemd/system/docferry-maintenance.timer
sudo systemctl daemon-reload
sudo systemctl enable --now docferry-api
sudo systemctl enable --now docferry-maintenance.timer
```

## Smoke Tests

Staging can use localhost or a staging IP. Public release smoke must use the HTTPS domain.

```bash
curl -fsS https://<domain>/v0/health
curl -fsS -X POST https://<domain>/v0/cloud/claim \
  -H "Content-Type: application/json" \
  -d '{"install_id":"dfi_release_smoke_0123456789abcdefghijkl","claim_version":1,"plugin_id":"docferry","plugin_version":"0.0.6","obsidian_version":"smoke","client":{"platform":"desktop"}}'
curl -fsS -H "Authorization: Bearer <claimed-cloud-token>" https://<domain>/v0/account
uv run python scripts/smoke_test.py --base-url https://<domain> --token <claimed-cloud-token>
```

Use `--skip-quota` only when the token is not dedicated to release smoke.

## Encrypted-At-Rest Spot Checks

Run these only with synthetic smoke content.

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db \
  psql -U docferry -d docferry \
  -c "select markdown from shares where source_path like 'Smoke/%' order by created_at desc limit 1;"
grep -RIl "Local POC is alive" "$DOCFERRY_OBJECT_STORAGE_ROOT" || true
```

Expected result:

- Stored `markdown` is an AES-GCM JSON envelope when the content fits in DB.
- Object files do not contain the synthetic plaintext.
- Viewer and import payload still return decrypted content through the API.

## Backup And Restore

```bash
uv run python scripts/run_maintenance.py --apply
uv run python scripts/restore_drill.py --backup-root /root/backups/docferry
```

Do not publish DocFerry Cloud until backup and restore drill commands have succeeded or the operator explicitly accepts the risk.
