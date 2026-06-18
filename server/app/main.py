from __future__ import annotations

import uuid
import logging
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import PurePath
from time import perf_counter
from urllib.parse import unquote

from fastapi import Depends, FastAPI, Form, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session, sessionmaker

from .config import Settings, validate_runtime_settings
from .cos_sts import CosStsError, cos_direct_upload_configured, create_cos_upload_target
from .database import init_database, make_engine, make_session_factory, session_scope
from .encryption import EncryptionService, asset_bytes_aad, share_html_aad, share_markdown_aad
from .errors import ApiError, api_error_handler, error_envelope
from .logging import configure_logging
from .metadata_security import (
    blind_index,
    decrypt_metadata_json,
    decrypt_metadata_text,
    encrypt_metadata_json,
    encrypt_metadata_text,
)
from .models import Asset, Share, ShareAccessEvent, ShareAsset, ShareLink, utc_now
from .models import CloudClaimEvent, CloudInstall, User, UserToken
from .schemas import (
    AssetResponse,
    AssetUploadCompletePayload,
    AssetUploadCredentials,
    AssetUploadIntentPayload,
    AssetUploadIntentResponse,
    AssetUploadTarget,
    AccountInfo,
    AccountResponse,
    AuthConfigResponse,
    AuthExchangePayload,
    CloudClaimPayload,
    CloudClaimResponse,
    DeleteShareResponse,
    HealthResponse,
    PasswordPayload,
    ShareAccessEventResponse,
    ShareAccessEventsResponse,
    ShareImportPayloadResponse,
    ShareListResponse,
    ShareLinksResponse,
    ShareLinkStatusResponse,
    SharePayload,
    ShareResponse,
    ShareStatus,
    ShareStatusResponse,
)
from .security import (
    AuthContext,
    access_cookie_name,
    generate_prefixed_id,
    generate_slug,
    hash_cloud_claim_ip,
    hash_cloud_install_id,
    hash_cloud_token,
    hash_password,
    make_cloud_token,
    require_bearer_token,
    sign_share_access,
    verify_password,
    verify_share_access,
)
from .storage import FileObjectStorage, normalize_sha256
from .viewer import document_page, password_page, status_page


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or Settings.from_env()
    validate_runtime_settings(resolved_settings)
    configure_logging(resolved_settings.log_format, resolved_settings.log_level)
    engine = make_engine(resolved_settings.database_url)
    session_factory = make_session_factory(engine)
    init_database(engine, resolved_settings)

    app = FastAPI(title="Docferry Share Server", version=resolved_settings.version)
    app.state.settings = resolved_settings
    app.state.session_factory = session_factory
    app.state.object_storage = FileObjectStorage(resolved_settings.object_storage_root)
    app.state.encryption = EncryptionService(resolved_settings)
    app.add_exception_handler(ApiError, api_error_handler)

    @app.middleware("http")
    async def add_request_id(request: Request, call_next):  # type: ignore[no-untyped-def]
        request.state.request_id = f"req_{uuid.uuid4().hex[:16]}"
        started = perf_counter()
        status_code = 500
        error_type = None
        try:
            response = await call_next(request)
            status_code = response.status_code
            response.headers["X-Request-Id"] = request.state.request_id
            return response
        except Exception as exc:
            error_type = exc.__class__.__name__
            raise
        finally:
            log_request(request, status_code, started, error_type)

    def get_settings(request: Request) -> Settings:
        return request.app.state.settings

    def get_db(request: Request):
        session_factory: sessionmaker[Session] = request.app.state.session_factory
        yield from session_scope(session_factory)

    def get_storage(request: Request) -> FileObjectStorage:
        return request.app.state.object_storage

    def get_encryption(request: Request) -> EncryptionService:
        return request.app.state.encryption

    def require_auth(
        request: Request,
        db: Session = Depends(get_db),
        settings: Settings = Depends(get_settings),
    ) -> AuthContext:
        return require_bearer_token(request, settings, db)

    @app.get("/v0/health", response_model=HealthResponse)
    def health(settings: Settings = Depends(get_settings)) -> HealthResponse:
        return HealthResponse(ok=True, service=settings.service_name, version=settings.version)

    @app.get("/v0/account", response_model=AccountResponse)
    def account_status(
        auth: AuthContext = Depends(require_auth),
        db: Session = Depends(get_db),
    ) -> AccountResponse:
        active_shares = active_share_count(db, auth.user_id)
        remaining = None if auth.active_share_limit <= 0 else max(auth.active_share_limit - active_shares, 0)
        return AccountResponse(
            account=AccountInfo(
                owner_id=auth.user_id,
                mode=auth.mode,
                token_label=auth.token_label,
                active_shares=active_shares,
                active_share_limit=auth.active_share_limit,
                remaining_active_shares=remaining,
            )
        )

    @app.get("/v0/auth/config", response_model=AuthConfigResponse)
    def auth_config(settings: Settings = Depends(get_settings)) -> AuthConfigResponse:
        _ = settings
        return AuthConfigResponse(
            provider="anonymous_cloud_claim",
            login_url="/v0/cloud/claim",
            callback_protocol="docferry",
        )

    @app.post("/v0/auth/exchange")
    def auth_exchange(payload: AuthExchangePayload, request: Request):
        _ = payload
        return JSONResponse(
            status_code=501,
            content=error_envelope(
                "cloud_claim_required",
                "DocFerry Cloud uses in-plugin anonymous claim in this release.",
                request.state.request_id,
            ),
        )

    @app.post("/v0/cloud/claim", response_model=CloudClaimResponse)
    def claim_cloud_token(
        payload: CloudClaimPayload,
        request: Request,
        db: Session = Depends(get_db),
        settings: Settings = Depends(get_settings),
    ) -> CloudClaimResponse:
        if not settings.cloud_claim_enabled:
            raise ApiError(403, "cloud_claim_disabled", "DocFerry Cloud automatic claim is temporarily unavailable.")
        if payload.claim_version != 1 or payload.plugin_id != "docferry" or not payload.plugin_version.strip():
            raise ApiError(400, "invalid_claim_request", "Invalid DocFerry Cloud claim request.")

        install_id = payload.install_id.strip()
        if not is_valid_cloud_install_id(install_id):
            raise ApiError(400, "invalid_install_id", "Install ID must be a random dfi_ value generated locally.")

        now = utc_now()
        install_id_hash = hash_cloud_install_id(install_id, settings)
        requester_ip = request_ip(request, settings) or ""
        claim_ip_hash = hash_cloud_claim_ip(requester_ip, settings) if requester_ip else None

        if is_cloud_claim_rate_limited(db, settings, install_id_hash, claim_ip_hash, now):
            record_cloud_claim_event(db, install_id_hash, claim_ip_hash, "rate_limited", payload, now)
            db.commit()
            raise ApiError(429, "cloud_claim_rate_limited", "Too many DocFerry Cloud claim attempts. Please try again later.")

        install = db.execute(
            select(CloudInstall).where(CloudInstall.install_id_hash == install_id_hash)
        ).scalar_one_or_none()
        result = "issued"
        if install is None:
            user = User(
                id=generate_prefixed_id("usr_anon"),
                email=None,
                display_name="Anonymous DocFerry Cloud user",
                created_at=now,
                updated_at=now,
            )
            db.add(user)
            db.flush()
            install = CloudInstall(
                id=generate_prefixed_id("ins"),
                install_id_hash=install_id_hash,
                user_id=user.id,
                first_claimed_at=now,
                last_claimed_at=now,
                replacement_count=0,
                last_ip_hash=claim_ip_hash,
                created_at=now,
                updated_at=now,
            )
            db.add(install)
        else:
            result = "replaced"
            install.last_claimed_at = now
            install.replacement_count += 1
            install.last_ip_hash = claim_ip_hash
            install.updated_at = now
            active_tokens = db.execute(
                select(UserToken).where(UserToken.install_id == install.id, UserToken.revoked_at.is_(None))
            ).scalars()
            for token_row in active_tokens:
                token_row.revoked_at = now
                token_row.updated_at = now

        token = make_cloud_token()
        db.add(
            UserToken(
                id=generate_prefixed_id("tok"),
                user_id=install.user_id,
                install_id=install.id,
                token_hash=hash_cloud_token(token, settings),
                label="anonymous-free",
                active_share_limit=settings.default_active_share_limit,
                created_at=now,
                updated_at=now,
            )
        )
        record_cloud_claim_event(db, install_id_hash, claim_ip_hash, result, payload, now)

        active_shares = active_share_count(db, install.user_id)
        remaining = max(settings.default_active_share_limit - active_shares, 0)
        return CloudClaimResponse(
            token=token,
            account=AccountInfo(
                owner_id=install.user_id,
                mode="cloud",
                token_label="anonymous-free",
                active_shares=active_shares,
                active_share_limit=settings.default_active_share_limit,
                remaining_active_shares=remaining,
            ),
            issued_at=now,
        )

    @app.post("/v0/assets/intents", response_model=AssetUploadIntentResponse)
    def create_asset_upload_intent(
        payload: AssetUploadIntentPayload,
        auth: AuthContext = Depends(require_auth),
        db: Session = Depends(get_db),
        settings: Settings = Depends(get_settings),
        storage: FileObjectStorage = Depends(get_storage),
        encryption: EncryptionService = Depends(get_encryption),
    ) -> AssetUploadIntentResponse:
        content_type = normalized_content_type(payload.content_type)
        validate_asset_upload_metadata(payload.byte_length, content_type, payload.hash, settings)

        existing = find_asset_by_hash(db, auth.user_id, payload.hash, settings)
        if existing:
            existing.last_used_at = utc_now()
            return AssetUploadIntentResponse(mode="already_uploaded", asset=asset_response(existing, encryption))

        validate_owner_asset_quota(db, auth.user_id, payload.byte_length, settings)
        asset_id = generate_prefixed_id("asset")
        storage_key = storage.asset_storage_key(auth.user_id, asset_id)
        if encryption.enabled or not cos_direct_upload_configured(settings):
            return AssetUploadIntentResponse(
                mode="api_proxy",
                asset_id=asset_id,
                storage_key=storage_key,
                fallback_url="/v0/assets",
            )

        try:
            target = create_cos_upload_target(settings, storage_key)
        except CosStsError as exc:
            logging.getLogger("docferry").warning("cos_sts_failed", extra={"error": str(exc)})
            return AssetUploadIntentResponse(mode="api_proxy", storage_key=storage_key, fallback_url="/v0/assets")

        return AssetUploadIntentResponse(
            mode="tencent_cos",
            asset_id=asset_id,
            storage_key=storage_key,
            upload=AssetUploadTarget(
                provider="tencent_cos",
                bucket=target.bucket,
                region=target.region,
                key=target.key,
                slice_size=target.slice_size,
                credentials=AssetUploadCredentials(
                    tmp_secret_id=target.credentials.tmp_secret_id,
                    tmp_secret_key=target.credentials.tmp_secret_key,
                    session_token=target.credentials.session_token,
                    start_time=target.credentials.start_time,
                    expired_time=target.credentials.expired_time,
                ),
                headers={
                    "Content-Type": content_type,
                    "x-cos-meta-docferry-sha256": payload.hash,
                },
            ),
            expires_at=datetime.fromtimestamp(target.credentials.expired_time, timezone.utc),
        )

    @app.post("/v0/assets/{asset_id}/complete", response_model=AssetResponse)
    def complete_asset_upload(
        asset_id: str,
        payload: AssetUploadCompletePayload,
        auth: AuthContext = Depends(require_auth),
        db: Session = Depends(get_db),
        settings: Settings = Depends(get_settings),
        storage: FileObjectStorage = Depends(get_storage),
        encryption: EncryptionService = Depends(get_encryption),
    ) -> AssetResponse:
        content_type = normalized_content_type(payload.content_type)
        validate_asset_upload_metadata(payload.byte_length, content_type, payload.hash, settings)
        expected_storage_keys = {
            storage.asset_storage_key(auth.user_id, asset_id),
            storage.storage_key(auth.user_id, payload.hash),
        }
        if payload.storage_key not in expected_storage_keys:
            raise ApiError(400, "invalid_storage_key", "Asset storage key does not match hash.")

        existing_id = db.get(Asset, asset_id)
        if existing_id:
            if asset_hash_value(encryption, existing_id) != payload.hash:
                raise ApiError(409, "asset_id_conflict", "Asset id already belongs to another upload.")
            existing_id.last_used_at = utc_now()
            return asset_response(existing_id, encryption)

        existing = find_asset_by_hash(db, auth.user_id, payload.hash, settings)
        if existing:
            existing.last_used_at = utc_now()
            return asset_response(existing, encryption)

        validate_owner_asset_quota(db, auth.user_id, payload.byte_length, settings)
        final_asset_id = asset_id if asset_id.startswith("asset_") else generate_prefixed_id("asset")
        completed_data = validate_completed_asset(
            storage,
            encryption,
            final_asset_id,
            payload.storage_key,
            payload.byte_length,
            payload.hash,
            settings,
        )

        asset = Asset(
            id=final_asset_id,
            owner_id=auth.user_id,
            hash=f"{METADATA_HASH_PREFIX}{final_asset_id}",
            filename=METADATA_FILENAME_PLACEHOLDER,
            content_type=content_type,
            byte_length=payload.byte_length,
            storage_key=payload.storage_key,
            public_url=None,
            last_used_at=utc_now(),
        )
        apply_asset_metadata(asset, encryption, settings, payload.hash, payload.filename)
        storage.put(asset.storage_key, encryption.encrypt_bytes(completed_data, asset_bytes_aad(asset.id)))
        db.add(asset)
        db.flush()
        return asset_response(asset, encryption)

    @app.post("/v0/assets", response_model=AssetResponse)
    async def upload_asset(
        request: Request,
        auth: AuthContext = Depends(require_auth),
        db: Session = Depends(get_db),
        settings: Settings = Depends(get_settings),
        storage: FileObjectStorage = Depends(get_storage),
        encryption: EncryptionService = Depends(get_encryption),
    ) -> AssetResponse:
        body = await request.body()
        validate_asset_size(body, settings)
        content_type = normalized_content_type(request.headers.get("content-type"))
        validate_asset_content_type(content_type)
        expected_hash = request.headers.get("x-share-asset-hash", "")
        actual_hash = f"sha256:{sha256(body).hexdigest()}"
        if expected_hash != actual_hash:
            raise ApiError(400, "asset_hash_mismatch", "Asset hash does not match request body.")

        existing = find_asset_by_hash(db, auth.user_id, actual_hash, settings)
        if existing:
            existing.last_used_at = utc_now()
            return asset_response(existing, encryption)

        validate_owner_asset_quota(db, auth.user_id, len(body), settings)

        asset_id = generate_prefixed_id("asset")
        asset = Asset(
            id=asset_id,
            owner_id=auth.user_id,
            hash=f"{METADATA_HASH_PREFIX}{asset_id}",
            filename=METADATA_FILENAME_PLACEHOLDER,
            content_type=content_type,
            byte_length=len(body),
            storage_key=storage.asset_storage_key(auth.user_id, asset_id),
            public_url=None,
            last_used_at=utc_now(),
        )
        apply_asset_metadata(
            asset,
            encryption,
            settings,
            actual_hash,
            safe_asset_filename(request.headers.get("x-share-asset-filename")),
        )
        storage.put(asset.storage_key, encryption.encrypt_bytes(body, asset_bytes_aad(asset.id)))
        db.add(asset)
        db.flush()
        return asset_response(asset, encryption)

    @app.post("/v0/shares", response_model=ShareResponse)
    def create_share(
        payload: SharePayload,
        request: Request,
        auth: AuthContext = Depends(require_auth),
        db: Session = Depends(get_db),
        settings: Settings = Depends(get_settings),
        storage: FileObjectStorage = Depends(get_storage),
        encryption: EncryptionService = Depends(get_encryption),
    ) -> ShareResponse:
        validate_share_asset_count(payload.assets, settings)
        enforce_active_share_quota(db, auth)
        share_id = generate_prefixed_id("sh")
        markdown, markdown_asset_id = store_snapshot_text(
            db,
            storage,
            encryption,
            auth.user_id,
            payload.markdown,
            f"{title_from_source_path(payload.source_path)}.md",
            "text/markdown",
            settings,
            share_markdown_aad(share_id),
        )
        html_snapshot, html_snapshot_asset_id = store_snapshot_text(
            db,
            storage,
            encryption,
            auth.user_id,
            payload.html_snapshot,
            f"{title_from_source_path(payload.source_path)}.html",
            "text/html",
            settings,
            share_html_aad(share_id),
        )
        share = Share(
            id=share_id,
            owner_id=auth.user_id,
            slug=unique_slug(db),
            title=METADATA_TITLE_PLACEHOLDER,
            vault_id=None,
            source_path=METADATA_PATH_PLACEHOLDER,
            source_path_normalized=None,
            doc_identity=None,
            source_hash=f"{METADATA_HASH_PREFIX}{share_id}",
            markdown=markdown,
            markdown_asset_id=markdown_asset_id,
            html_snapshot=html_snapshot,
            html_snapshot_asset_id=html_snapshot_asset_id,
            render_mode="html_snapshot" if payload.html_snapshot else "markdown_fallback",
            css_asset_id=payload.css_asset_id,
            assets=[],
            client={},
            password_hash=hash_password(payload.password) if payload.password else None,
            expires_at=payload.expires_at,
            last_published_at=utc_now(),
        )
        apply_share_metadata(share, payload, encryption, settings)
        db.add(share)
        db.flush()
        replace_share_assets(db, share, payload.assets, encryption)
        replace_share_links(db, share, payload.outbound_links, encryption, settings)
        return share_response(share, request, settings, include_created=True)

    @app.put("/v0/shares/{share_id}", response_model=ShareResponse)
    def update_share(
        share_id: str,
        payload: SharePayload,
        request: Request,
        auth: AuthContext = Depends(require_auth),
        db: Session = Depends(get_db),
        settings: Settings = Depends(get_settings),
        storage: FileObjectStorage = Depends(get_storage),
        encryption: EncryptionService = Depends(get_encryption),
    ) -> ShareResponse:
        validate_share_asset_count(payload.assets, settings)
        share = get_share_by_id(db, share_id, auth.user_id)
        if share.stopped_at:
            raise ApiError(410, "share_stopped", "Share has been stopped.")
        previous_asset_ids = collect_share_asset_ids(db, share)
        markdown, markdown_asset_id = store_snapshot_text(
            db,
            storage,
            encryption,
            share.owner_id,
            payload.markdown,
            f"{title_from_source_path(payload.source_path)}.md",
            "text/markdown",
            settings,
            share_markdown_aad(share.id),
        )
        html_snapshot, html_snapshot_asset_id = store_snapshot_text(
            db,
            storage,
            encryption,
            share.owner_id,
            payload.html_snapshot,
            f"{title_from_source_path(payload.source_path)}.html",
            "text/html",
            settings,
            share_html_aad(share.id),
        )

        apply_share_metadata(share, payload, encryption, settings)
        share.markdown = markdown
        share.markdown_asset_id = markdown_asset_id
        share.html_snapshot = html_snapshot
        share.html_snapshot_asset_id = html_snapshot_asset_id
        share.render_mode = "html_snapshot" if payload.html_snapshot else "markdown_fallback"
        share.css_asset_id = payload.css_asset_id
        share.expires_at = payload.expires_at
        share.updated_at = utc_now()
        share.last_published_at = share.updated_at

        if payload.password_mode == "set":
            if not payload.password:
                raise ApiError(400, "invalid_request", "Password is required when password_mode is set.")
            share.password_hash = hash_password(payload.password)
        elif payload.password_mode == "clear":
            share.password_hash = None
        elif payload.password_mode in (None, "keep") and payload.password:
            share.password_hash = hash_password(payload.password)

        db.flush()
        replace_share_assets(db, share, payload.assets, encryption)
        replace_share_links(db, share, payload.outbound_links, encryption, settings)
        prune_unreferenced_assets(db, storage, previous_asset_ids)
        return share_response(share, request, settings, include_created=False)

    @app.get("/v0/shares", response_model=ShareListResponse)
    def list_shares(
        request: Request,
        include_stopped: bool = Query(default=True),
        limit: int = Query(default=100, ge=1, le=500),
        offset: int = Query(default=0, ge=0),
        auth: AuthContext = Depends(require_auth),
        db: Session = Depends(get_db),
        settings: Settings = Depends(get_settings),
        encryption: EncryptionService = Depends(get_encryption),
    ) -> ShareListResponse:
        statement = select(Share).where(Share.owner_id == auth.user_id)
        if not include_stopped:
            statement = statement.where(Share.stopped_at.is_(None))
        shares = (
            db.execute(statement.order_by(Share.updated_at.desc(), Share.id.desc()).offset(offset).limit(limit))
            .scalars()
            .all()
        )
        return ShareListResponse(
            shares=[share_status_response(share, request, settings, encryption) for share in shares]
        )

    @app.get("/v0/shares/{share_id}", response_model=ShareStatusResponse)
    def get_share_status(
        share_id: str,
        request: Request,
        auth: AuthContext = Depends(require_auth),
        db: Session = Depends(get_db),
        settings: Settings = Depends(get_settings),
        encryption: EncryptionService = Depends(get_encryption),
    ) -> ShareStatusResponse:
        share = get_share_by_id(db, share_id, auth.user_id)
        return share_status_response(share, request, settings, encryption)

    @app.get(
        "/v0/shares/{share_id}/events",
        response_model=ShareAccessEventsResponse,
    )
    def get_share_events(
        share_id: str,
        limit: int = Query(default=50, ge=1, le=200),
        auth: AuthContext = Depends(require_auth),
        db: Session = Depends(get_db),
    ) -> ShareAccessEventsResponse:
        share = get_share_by_id(db, share_id, auth.user_id)
        events = (
            db.execute(
                select(ShareAccessEvent)
                .where(ShareAccessEvent.share_id == share.id)
                .order_by(ShareAccessEvent.created_at.desc(), ShareAccessEvent.id.desc())
                .limit(limit)
            )
            .scalars()
            .all()
        )
        return ShareAccessEventsResponse(
            share_id=share.id,
            slug=share.slug,
            events=[
                ShareAccessEventResponse(
                    event_id=event.id,
                    event_type=event.event_type,
                    status_code=event.status_code,
                    slug=event.slug,
                    ip_hash=event.ip_hash,
                    user_agent=event.user_agent,
                    details=event.details,
                    created_at=event.created_at,
                )
                for event in events
            ],
        )

    @app.get(
        "/v0/shares/{share_id}/links",
        response_model=ShareLinksResponse,
    )
    def get_share_links(
        share_id: str,
        request: Request,
        auth: AuthContext = Depends(require_auth),
        db: Session = Depends(get_db),
        settings: Settings = Depends(get_settings),
        encryption: EncryptionService = Depends(get_encryption),
    ) -> ShareLinksResponse:
        share = get_share_by_id(db, share_id, auth.user_id)
        links = (
            db.execute(select(ShareLink).where(ShareLink.source_share_id == share.id).order_by(ShareLink.created_at))
            .scalars()
            .all()
        )
        return ShareLinksResponse(
            share_id=share.id,
            slug=share.slug,
            links=[share_link_status_response(db, link, share, request, settings, encryption) for link in links],
        )

    @app.delete("/v0/shares/{share_id}", response_model=DeleteShareResponse)
    def delete_share(
        share_id: str,
        auth: AuthContext = Depends(require_auth),
        db: Session = Depends(get_db),
        storage: FileObjectStorage = Depends(get_storage),
    ) -> DeleteShareResponse:
        share = get_share_by_id(db, share_id, auth.user_id)
        asset_ids = collect_share_asset_ids(db, share)
        if not share.stopped_at:
            share.stopped_at = utc_now()
            share.updated_at = share.stopped_at
        clear_share_server_content(db, share)
        db.flush()
        prune_unreferenced_assets(db, storage, asset_ids)
        return DeleteShareResponse(share_id=share.id, stopped_at=share.stopped_at)

    @app.get("/s/{slug}", response_class=HTMLResponse)
    def view_share(
        slug: str,
        request: Request,
        db: Session = Depends(get_db),
        settings: Settings = Depends(get_settings),
        storage: FileObjectStorage = Depends(get_storage),
        encryption: EncryptionService = Depends(get_encryption),
    ) -> HTMLResponse:
        share = db.execute(select(Share).where(Share.slug == slug)).scalar_one_or_none()
        if not share:
            record_access_event(db, request, settings, "not_found", 404, slug=slug)
            return html(status_page("Share not found", "The requested share link does not exist.", "Not found"), 404)
        unavailable = unavailable_response(share, request, db, settings)
        if unavailable:
            return unavailable
        if share.password_hash and not verify_share_access(settings, share.id, request.cookies.get(access_cookie_name(slug))):
            record_access_event(db, request, settings, "password_required", 401, share=share)
            return html(password_page(slug, share_title(encryption, share)), 401)
        try:
            markdown = share_markdown(db, storage, encryption, share)
            html_snapshot = share_html_snapshot(db, storage, encryption, share)
        except SnapshotAssetMissing:
            record_access_event(db, request, settings, "content_missing", 500, share=share)
            return html(
                status_page(
                    "Share content unavailable",
                    "The published document snapshot is missing from object storage.",
                    "Unavailable",
                ),
                500,
            )
        record_access_event(db, request, settings, "view", 200, share=share)
        return html(
            document_page(
                share,
                markdown,
                html_snapshot,
                title=share_title(encryption, share),
                asset_refs=share_assets_payload(encryption, share),
            ),
            200,
        )

    @app.get("/s/{slug}/link", response_class=HTMLResponse)
    def resolve_share_link(
        slug: str,
        request: Request,
        target: str = Query(..., min_length=1, max_length=1024),
        db: Session = Depends(get_db),
        settings: Settings = Depends(get_settings),
        encryption: EncryptionService = Depends(get_encryption),
    ):
        share = db.execute(select(Share).where(Share.slug == slug)).scalar_one_or_none()
        if not share:
            record_access_event(db, request, settings, "not_found", 404, slug=slug)
            return html(status_page("Share not found", "The source share link does not exist.", "Not found"), 404)
        unavailable = unavailable_response(share, request, db, settings)
        if unavailable:
            return unavailable
        if share.password_hash and not verify_share_access(settings, share.id, request.cookies.get(access_cookie_name(slug))):
            record_access_event(db, request, settings, "password_required", 401, share=share)
            return html(password_page(slug, share_title(encryption, share)), 401)

        target_share, status = resolve_internal_link_target(db, share, target, settings, encryption)
        if target_share:
            return RedirectResponse(share_url(target_share, request, settings), status_code=302)
        if status == "ambiguous":
            return html(
                status_page(
                    "Linked note is ambiguous",
                    "More than one published document matches this Obsidian link.",
                    "Ambiguous link",
                ),
                409,
            )
        if status == "unsupported":
            return html(
                status_page(
                    "Linked note is unsupported",
                    "This Obsidian link type cannot be resolved by Docferry yet.",
                    "Unsupported link",
                ),
                422,
            )
        return html(
            status_page(
                "Linked note is not published",
                "This Obsidian link does not have a published Docferry share yet.",
                "Unpublished link",
            ),
            404,
        )

    @app.get("/s/{slug}/import", response_model=ShareImportPayloadResponse)
    def import_share(
        slug: str,
        request: Request,
        db: Session = Depends(get_db),
        settings: Settings = Depends(get_settings),
        storage: FileObjectStorage = Depends(get_storage),
        encryption: EncryptionService = Depends(get_encryption),
    ):
        share = db.execute(select(Share).where(Share.slug == slug)).scalar_one_or_none()
        if not share:
            record_access_event(db, request, settings, "not_found", 404, slug=slug)
            return JSONResponse(
                status_code=404,
                content=error_envelope("share_not_found", "Share not found.", request.state.request_id),
            )
        unavailable = unavailable_json_response(share, request, db, settings)
        if unavailable:
            return unavailable
        if share.password_hash and not verify_share_access(settings, share.id, request.cookies.get(access_cookie_name(slug))):
            record_access_event(db, request, settings, "password_required", 401, share=share)
            return JSONResponse(
                status_code=401,
                content=error_envelope("password_required", "Password is required.", request.state.request_id),
            )
        try:
            markdown = share_markdown(db, storage, encryption, share)
        except SnapshotAssetMissing:
            record_access_event(db, request, settings, "content_missing", 500, share=share)
            return JSONResponse(
                status_code=500,
                content=error_envelope(
                    "share_content_missing",
                    "The published document snapshot is missing from object storage.",
                    request.state.request_id,
                ),
            )
        record_access_event(db, request, settings, "import", 200, share=share)
        return ShareImportPayloadResponse(
            slug=share.slug,
            title=share_title(encryption, share),
            markdown=markdown,
            source_hash=share_source_hash(encryption, share),
            assets=share_import_assets(db, share, request, settings, encryption),
            updated_at=share.updated_at,
        )

    @app.get("/s/{slug}/assets/{asset_id}")
    def view_share_asset(
        slug: str,
        asset_id: str,
        request: Request,
        db: Session = Depends(get_db),
        settings: Settings = Depends(get_settings),
        storage: FileObjectStorage = Depends(get_storage),
        encryption: EncryptionService = Depends(get_encryption),
    ) -> Response:
        share = db.execute(select(Share).where(Share.slug == slug)).scalar_one_or_none()
        if not share:
            return Response(status_code=404)
        if share.stopped_at:
            return Response(status_code=410)
        if share.expires_at and coerce_aware(share.expires_at) <= utc_now():
            return Response(status_code=410)
        if share.password_hash and not verify_share_access(settings, share.id, request.cookies.get(access_cookie_name(slug))):
            return Response(status_code=401)

        link = db.execute(
            select(ShareAsset).where(ShareAsset.share_id == share.id, ShareAsset.asset_id == asset_id)
        ).scalar_one_or_none()
        if not link:
            return Response(status_code=404)
        asset = db.execute(select(Asset).where(Asset.id == asset_id)).scalar_one_or_none()
        if not asset:
            return Response(status_code=404)
        try:
            body = encryption.decrypt_bytes(storage.get(asset.storage_key), asset_bytes_aad(asset.id))
        except (FileNotFoundError, ValueError):
            return Response(status_code=404)
        return Response(
            content=body,
            media_type=asset.content_type,
            headers={
                "Cache-Control": "private, max-age=300, no-transform",
                "X-Content-Type-Options": "nosniff",
                "X-Robots-Tag": "noindex, nofollow",
            },
        )

    @app.post("/s/{slug}/password")
    async def submit_password(
        slug: str,
        request: Request,
        db: Session = Depends(get_db),
        settings: Settings = Depends(get_settings),
        encryption: EncryptionService = Depends(get_encryption),
        form_password: str | None = Form(default=None, alias="password"),
    ):
        share = db.execute(select(Share).where(Share.slug == slug)).scalar_one_or_none()
        if not share:
            record_access_event(db, request, settings, "not_found", 404, slug=slug)
            return html(status_page("Share not found", "The requested share link does not exist.", "Not found"), 404)
        unavailable = unavailable_response(share, request, db, settings)
        if unavailable:
            return unavailable

        password = form_password
        wants_json = "application/json" in request.headers.get("content-type", "")
        if share.password_hash and is_password_rate_limited(db, request, settings, share):
            record_access_event(
                db,
                request,
                settings,
                "password_rate_limited",
                429,
                share=share,
                details={
                    "limit": str(settings.password_failed_limit),
                    "window_seconds": str(settings.password_failed_window_seconds),
                },
            )
            if wants_json:
                return JSONResponse(
                    status_code=429,
                    content=error_envelope(
                        "password_rate_limited",
                        "Too many password attempts. Try again later.",
                        request.state.request_id,
                    ),
                )
            return html(password_page(slug, share_title(encryption, share), "Too many password attempts. Try again later."), 429)

        if wants_json:
            try:
                payload = PasswordPayload.model_validate(await request.json())
                password = payload.password
            except Exception:
                return JSONResponse(
                    status_code=400,
                    content=error_envelope("invalid_request", "Password is required.", request.state.request_id),
                )

        if not share.password_hash or not password or not verify_password(share.password_hash, password):
            record_access_event(db, request, settings, "password_failed", 401, share=share)
            if wants_json:
                return JSONResponse(
                    status_code=401,
                    content=error_envelope("password_invalid", "Password is incorrect.", request.state.request_id),
                )
            return html(password_page(slug, share_title(encryption, share), "Password is incorrect."), 401)

        cookie_value = sign_share_access(settings, share.id)
        record_access_event(db, request, settings, "password_success", 200 if wants_json else 303, share=share)
        if wants_json:
            response = JSONResponse({"ok": True, "redirect": f"/s/{slug}"})
        else:
            response = RedirectResponse(f"/s/{slug}", status_code=303)
        response.set_cookie(
            key=access_cookie_name(slug),
            value=cookie_value,
            httponly=True,
            samesite="lax",
            max_age=60 * 60 * 12,
        )
        return response

    return app


def log_request(request: Request, status_code: int, started: float, error_type: str | None) -> None:
    route = request.scope.get("route")
    path_template = getattr(route, "path", None) or request.url.path
    logging.getLogger("docferry.request").info(
        "http_request",
        extra={
            "event": "http_request",
            "request_id": request.state.request_id,
            "method": request.method,
            "path": request.url.path,
            "path_template": path_template,
            "status_code": status_code,
            "duration_ms": round((perf_counter() - started) * 1000, 2),
            "error_type": error_type,
        },
    )


METADATA_TITLE_PLACEHOLDER = "Encrypted share"
METADATA_PATH_PLACEHOLDER = ""
METADATA_HASH_PREFIX = "encrypted:"
METADATA_RAW_TARGET_PLACEHOLDER = "[encrypted]"
METADATA_FILENAME_PLACEHOLDER = "asset"


def canonical_hash_index_value(value: str) -> str:
    return normalize_sha256(value).strip().lower()


def text_index(settings: Settings, purpose: str, value: str | None, *, lowercase: bool = False) -> str | None:
    if value is None:
        return None
    candidate = value.strip()
    if lowercase:
        candidate = candidate.lower()
    return blind_index(settings, purpose, candidate)


def doc_path_index_components(value: str | None) -> dict[str, str | None]:
    if not value:
        return {"full": None, "extless": None, "basename": None, "basename_extless": None}
    normalized = normalize_share_path(value)
    if not normalized:
        return {"full": None, "extless": None, "basename": None, "basename_extless": None}
    basename = normalized.rsplit("/", 1)[-1]
    return {
        "full": normalized.lower(),
        "extless": normalized_path_without_known_extension(normalized).lower(),
        "basename": basename.lower(),
        "basename_extless": normalized_path_without_known_extension(basename).lower(),
    }


def doc_path_blind_indexes(settings: Settings, value: str | None) -> dict[str, str | None]:
    return {
        key: blind_index(settings, f"doc_path.{key}", component)
        for key, component in doc_path_index_components(value).items()
    }


def assign_share_path_indexes(share: Share, settings: Settings, value: str | None) -> None:
    indexes = doc_path_blind_indexes(settings, value)
    share.source_path_full_index = indexes["full"]
    share.source_path_extless_index = indexes["extless"]
    share.source_path_basename_index = indexes["basename"]
    share.source_path_basename_extless_index = indexes["basename_extless"]


def assign_link_target_path_indexes(link: ShareLink, settings: Settings, value: str | None) -> None:
    indexes = doc_path_blind_indexes(settings, value)
    link.target_path_full_index = indexes["full"]
    link.target_path_extless_index = indexes["extless"]
    link.target_path_basename_index = indexes["basename"]
    link.target_path_basename_extless_index = indexes["basename_extless"]


def share_path_index_values(share: Share) -> set[str]:
    return {
        value
        for value in (
            share.source_path_full_index,
            share.source_path_extless_index,
            share.source_path_basename_index,
            share.source_path_basename_extless_index,
        )
        if value
    }


def link_target_path_index_values(link: ShareLink) -> set[str]:
    return {
        value
        for value in (
            link.target_path_full_index,
            link.target_path_extless_index,
            link.target_path_basename_index,
            link.target_path_basename_extless_index,
        )
        if value
    }


def link_target_path_indexes(link: ShareLink) -> dict[str, str | None]:
    return {
        "full": link.target_path_full_index,
        "extless": link.target_path_extless_index,
        "basename": link.target_path_basename_index,
        "basename_extless": link.target_path_basename_extless_index,
    }


def source_path_index_score(share: Share, target_indexes: dict[str, str | None]) -> int:
    if target_indexes.get("full") and share.source_path_full_index == target_indexes["full"]:
        return 4
    if target_indexes.get("extless") and share.source_path_extless_index == target_indexes["extless"]:
        return 3
    if target_indexes.get("basename") and share.source_path_basename_index == target_indexes["basename"]:
        return 2
    if (
        target_indexes.get("basename_extless")
        and share.source_path_basename_extless_index == target_indexes["basename_extless"]
    ):
        return 1
    return 0


def link_target_path_primary_index_values(link: ShareLink) -> set[str]:
    return {value for value in (link.target_path_full_index, link.target_path_extless_index) if value}


def link_target_path_basename_index_values(link: ShareLink) -> set[str]:
    return {value for value in (link.target_path_basename_index, link.target_path_basename_extless_index) if value}


def share_title(encryption: EncryptionService, share: Share) -> str:
    return (
        decrypt_metadata_text(encryption, "share", "title", share.id, share.title_enc, share.title, "")
        or ""
    )


def share_vault_id(encryption: EncryptionService, share: Share) -> str | None:
    return decrypt_metadata_text(encryption, "share", "vault_id", share.id, share.vault_id_enc, share.vault_id)


def share_source_path(encryption: EncryptionService, share: Share) -> str:
    return (
        decrypt_metadata_text(
            encryption,
            "share",
            "source_path",
            share.id,
            share.source_path_enc,
            share.source_path,
            "",
        )
        or ""
    )


def share_source_path_normalized(encryption: EncryptionService, share: Share) -> str | None:
    return decrypt_metadata_text(
        encryption,
        "share",
        "source_path_normalized",
        share.id,
        share.source_path_normalized_enc,
        share.source_path_normalized,
    )


def share_doc_identity(encryption: EncryptionService, share: Share) -> str | None:
    return decrypt_metadata_text(
        encryption,
        "share",
        "doc_identity",
        share.id,
        share.doc_identity_enc,
        share.doc_identity,
    )


def share_source_hash(encryption: EncryptionService, share: Share) -> str:
    return (
        decrypt_metadata_text(
            encryption,
            "share",
            "source_hash",
            share.id,
            share.source_hash_enc,
            share.source_hash,
            "",
        )
        or ""
    )


def share_assets_payload(encryption: EncryptionService, share: Share) -> list[dict[str, str]]:
    return decrypt_metadata_json(encryption, "share", "assets", share.id, share.assets_enc, share.assets, [])


def share_client_payload(encryption: EncryptionService, share: Share) -> dict[str, str]:
    return decrypt_metadata_json(encryption, "share", "client", share.id, share.client_enc, share.client, {})


def asset_hash_value(encryption: EncryptionService, asset: Asset) -> str:
    return (
        decrypt_metadata_text(encryption, "asset", "hash", asset.id, asset.hash_enc, asset.hash, "")
        or ""
    )


def asset_filename(encryption: EncryptionService, asset: Asset) -> str:
    return (
        decrypt_metadata_text(encryption, "asset", "filename", asset.id, asset.filename_enc, asset.filename, "")
        or ""
    )


def share_asset_original_path(encryption: EncryptionService, link: ShareAsset) -> str | None:
    return decrypt_metadata_text(
        encryption,
        "share_asset",
        "original_path",
        f"{link.share_id}:{link.asset_id}",
        link.original_path_enc,
        link.original_path,
    )


def link_raw_target(encryption: EncryptionService, link: ShareLink) -> str:
    return (
        decrypt_metadata_text(
            encryption,
            "share_link",
            "raw_target",
            link.id,
            link.raw_target_enc,
            link.raw_target,
            "",
        )
        or ""
    )


def link_target_path(encryption: EncryptionService, link: ShareLink) -> str | None:
    return decrypt_metadata_text(
        encryption,
        "share_link",
        "target_path",
        link.id,
        link.target_path_enc,
        link.target_path,
    )


def link_target_doc_identity(encryption: EncryptionService, link: ShareLink) -> str | None:
    return decrypt_metadata_text(
        encryption,
        "share_link",
        "target_doc_identity",
        link.id,
        link.target_doc_identity_enc,
        link.target_doc_identity,
    )


def link_target_subpath(encryption: EncryptionService, link: ShareLink) -> str | None:
    return decrypt_metadata_text(
        encryption,
        "share_link",
        "target_subpath",
        link.id,
        link.target_subpath_enc,
        link.target_subpath,
    )


def link_label(encryption: EncryptionService, link: ShareLink) -> str | None:
    return decrypt_metadata_text(encryption, "share_link", "label", link.id, link.label_enc, link.label)


def apply_share_metadata(
    share: Share,
    payload: SharePayload,
    encryption: EncryptionService,
    settings: Settings,
) -> None:
    title = resolved_payload_title(payload)
    source_path_normalized = payload.source_path_normalized or normalize_share_path(payload.source_path)
    asset_refs = [asset.model_dump(exclude_none=True) for asset in payload.assets]
    client = payload.client.model_dump()

    share.title_enc = encrypt_metadata_text(encryption, "share", "title", share.id, title)
    share.title = METADATA_TITLE_PLACEHOLDER
    share.vault_id_enc = encrypt_metadata_text(encryption, "share", "vault_id", share.id, payload.vault_id)
    share.vault_id_index = text_index(settings, "vault_id", payload.vault_id)
    share.vault_id = None
    share.source_path_enc = encrypt_metadata_text(encryption, "share", "source_path", share.id, payload.source_path)
    share.source_path = METADATA_PATH_PLACEHOLDER
    share.source_path_normalized_enc = encrypt_metadata_text(
        encryption, "share", "source_path_normalized", share.id, source_path_normalized
    )
    share.source_path_normalized = None
    assign_share_path_indexes(share, settings, source_path_normalized)
    share.doc_identity_enc = encrypt_metadata_text(encryption, "share", "doc_identity", share.id, payload.doc_identity)
    share.doc_identity_index = text_index(settings, "doc_identity", payload.doc_identity)
    share.doc_identity = None
    share.source_hash_enc = encrypt_metadata_text(encryption, "share", "source_hash", share.id, payload.source_hash)
    share.source_hash_index = text_index(settings, "share.source_hash", payload.source_hash, lowercase=True)
    share.source_hash = f"{METADATA_HASH_PREFIX}{share.id}"
    share.assets_enc = encrypt_metadata_json(encryption, "share", "assets", share.id, asset_refs)
    share.assets = []
    share.client_enc = encrypt_metadata_json(encryption, "share", "client", share.id, client)
    share.client = {}


def apply_asset_metadata(
    asset: Asset,
    encryption: EncryptionService,
    settings: Settings,
    content_hash: str,
    filename: str,
) -> None:
    asset.hash_enc = encrypt_metadata_text(encryption, "asset", "hash", asset.id, content_hash)
    asset.hash_index = blind_index(settings, "asset.hash", canonical_hash_index_value(content_hash))
    asset.hash = f"{METADATA_HASH_PREFIX}{asset.id}"
    asset.filename_enc = encrypt_metadata_text(encryption, "asset", "filename", asset.id, safe_asset_filename(filename))
    asset.filename = METADATA_FILENAME_PLACEHOLDER


def find_asset_by_hash(db: Session, owner_id: str, content_hash: str, settings: Settings) -> Asset | None:
    hash_index = blind_index(settings, "asset.hash", canonical_hash_index_value(content_hash))
    if hash_index:
        existing = db.execute(
            select(Asset).where(Asset.owner_id == owner_id, Asset.hash_index == hash_index)
        ).scalar_one_or_none()
        if existing:
            return existing
    return db.execute(select(Asset).where(Asset.owner_id == owner_id, Asset.hash == content_hash)).scalar_one_or_none()


def replace_share_assets(
    db: Session,
    share: Share,
    asset_refs: list,
    encryption: EncryptionService,
) -> None:
    db.execute(delete(ShareAsset).where(ShareAsset.share_id == share.id))
    seen: set[str] = set()
    linked_assets: dict[str, Asset] = {}
    linked_roles: dict[str, str] = {}
    for asset_ref in asset_refs:
        if asset_ref.asset_id in seen:
            continue
        seen.add(asset_ref.asset_id)
        validate_asset_role(asset_ref.role)
        asset = db.execute(
            select(Asset).where(Asset.id == asset_ref.asset_id, Asset.owner_id == share.owner_id)
        ).scalar_one_or_none()
        if not asset:
            raise ApiError(400, "invalid_asset", f"Asset {asset_ref.asset_id} does not exist.")
        asset.last_used_at = utc_now()
        linked_assets[asset.id] = asset
        linked_roles[asset.id] = asset_ref.role
        db.add(
            ShareAsset(
                share_id=share.id,
                asset_id=asset.id,
                role=asset_ref.role,
                original_path=None,
                original_path_enc=encrypt_metadata_text(
                    encryption,
                    "share_asset",
                    "original_path",
                    f"{share.id}:{asset.id}",
                    asset_ref.original_path,
                ),
            )
        )
    validate_css_asset_reference(share, linked_assets, linked_roles)


def replace_share_links(
    db: Session,
    share: Share,
    outbound_links: list,
    encryption: EncryptionService,
    settings: Settings,
) -> None:
    db.execute(delete(ShareLink).where(ShareLink.source_share_id == share.id))
    seen: set[tuple[str, str | None, str | None, str]] = set()
    source_vault_id = share_vault_id(encryption, share)
    for outbound_link in outbound_links:
        validate_link_kind(outbound_link.link_kind)
        raw_target = outbound_link.raw_target.strip()
        target_path = normalize_share_path(outbound_link.target_path) if outbound_link.target_path else None
        target_doc_identity = outbound_link.target_doc_identity.strip() if outbound_link.target_doc_identity else None
        target_subpath = outbound_link.target_subpath.strip() if outbound_link.target_subpath else None
        label = outbound_link.label.strip() if outbound_link.label else None
        key = (normalize_obsidian_link_target(raw_target), target_path, target_doc_identity, outbound_link.link_kind)
        if key in seen:
            continue
        seen.add(key)
        link_id = generate_prefixed_id("lnk")
        link = ShareLink(
            id=link_id,
            source_share_id=share.id,
            owner_id=share.owner_id,
            vault_id=None,
            vault_id_enc=encrypt_metadata_text(encryption, "share_link", "vault_id", link_id, source_vault_id),
            vault_id_index=text_index(settings, "vault_id", source_vault_id),
            raw_target=METADATA_RAW_TARGET_PLACEHOLDER,
            raw_target_enc=encrypt_metadata_text(encryption, "share_link", "raw_target", link_id, raw_target),
            raw_target_index=blind_index(
                settings,
                "share_link.raw_target",
                normalize_obsidian_link_target(raw_target),
            ),
            target_path=None,
            target_path_enc=encrypt_metadata_text(encryption, "share_link", "target_path", link_id, target_path),
            target_doc_identity=None,
            target_doc_identity_enc=encrypt_metadata_text(
                encryption, "share_link", "target_doc_identity", link_id, target_doc_identity
            ),
            target_doc_identity_index=text_index(settings, "doc_identity", target_doc_identity),
            target_subpath=None,
            target_subpath_enc=encrypt_metadata_text(
                encryption, "share_link", "target_subpath", link_id, target_subpath
            ),
            label=None,
            label_enc=encrypt_metadata_text(encryption, "share_link", "label", link_id, label),
            link_kind=outbound_link.link_kind,
        )
        assign_link_target_path_indexes(link, settings, target_path)
        db.add(link)


def collect_share_asset_ids(db: Session, share: Share) -> set[str]:
    asset_ids = {
        asset_id
        for asset_id in (share.markdown_asset_id, share.html_snapshot_asset_id, share.css_asset_id)
        if asset_id
    }
    for asset_ref in share.assets or []:
        if isinstance(asset_ref, dict) and isinstance(asset_ref.get("asset_id"), str):
            asset_ids.add(asset_ref["asset_id"])
    asset_ids.update(
        db.execute(select(ShareAsset.asset_id).where(ShareAsset.share_id == share.id)).scalars().all()
    )
    return asset_ids


def clear_share_server_content(db: Session, share: Share) -> None:
    share.title = "Stopped share"
    share.title_enc = None
    share.vault_id = None
    share.vault_id_enc = None
    share.vault_id_index = None
    share.source_path = ""
    share.source_path_enc = None
    share.source_path_normalized = None
    share.source_path_normalized_enc = None
    share.source_path_full_index = None
    share.source_path_extless_index = None
    share.source_path_basename_index = None
    share.source_path_basename_extless_index = None
    share.doc_identity = None
    share.doc_identity_enc = None
    share.doc_identity_index = None
    share.source_hash = "revoked"
    share.source_hash_enc = None
    share.source_hash_index = None
    share.markdown = None
    share.markdown_asset_id = None
    share.html_snapshot = None
    share.html_snapshot_asset_id = None
    share.render_mode = "markdown_fallback"
    share.css_asset_id = None
    share.assets = []
    share.assets_enc = None
    share.client = {}
    share.client_enc = None
    share.password_hash = None
    db.execute(delete(ShareAsset).where(ShareAsset.share_id == share.id))
    db.execute(delete(ShareLink).where(ShareLink.source_share_id == share.id))
    db.execute(delete(ShareAccessEvent).where(ShareAccessEvent.share_id == share.id))


def prune_unreferenced_assets(db: Session, storage: FileObjectStorage, asset_ids: set[str]) -> None:
    for asset_id in sorted(asset_ids):
        if asset_has_active_reference(db, asset_id):
            continue
        db.execute(delete(ShareAsset).where(ShareAsset.asset_id == asset_id))
        asset = db.get(Asset, asset_id)
        if not asset:
            continue
        storage.delete(asset.storage_key)
        db.delete(asset)


def asset_has_active_reference(db: Session, asset_id: str) -> bool:
    direct_refs = db.execute(
        select(func.count())
        .select_from(Share)
        .where(
            Share.stopped_at.is_(None),
            or_(
                Share.markdown_asset_id == asset_id,
                Share.html_snapshot_asset_id == asset_id,
                Share.css_asset_id == asset_id,
            ),
        )
    ).scalar_one()
    if direct_refs:
        return True

    linked_refs = db.execute(
        select(func.count())
        .select_from(ShareAsset)
        .join(Share, ShareAsset.share_id == Share.id)
        .where(Share.stopped_at.is_(None), ShareAsset.asset_id == asset_id)
    ).scalar_one()
    return bool(linked_refs)


class SnapshotAssetMissing(RuntimeError):
    pass


def store_snapshot_text(
    db: Session,
    storage: FileObjectStorage,
    encryption: EncryptionService,
    owner_id: str,
    value: str | None,
    filename: str,
    content_type: str,
    settings: Settings,
    inline_aad: str,
) -> tuple[str | None, str | None]:
    if value is None:
        return None, None

    data = value.encode("utf-8")
    if len(data) <= max(0, settings.snapshot_max_db_bytes):
        return encryption.encrypt_text(value, inline_aad), None

    content_hash = f"sha256:{sha256(data).hexdigest()}"
    existing = find_asset_by_hash(db, owner_id, content_hash, settings)
    if existing:
        existing.last_used_at = utc_now()
        return None, existing.id

    validate_owner_asset_quota(db, owner_id, len(data), settings)
    asset_id = generate_prefixed_id("asset")

    asset = Asset(
        id=asset_id,
        owner_id=owner_id,
        hash=f"{METADATA_HASH_PREFIX}{asset_id}",
        filename=METADATA_FILENAME_PLACEHOLDER,
        content_type=content_type,
        byte_length=len(data),
        storage_key=storage.asset_storage_key(owner_id, asset_id),
        public_url=None,
        last_used_at=utc_now(),
    )
    apply_asset_metadata(asset, encryption, settings, content_hash, filename)
    storage.put(asset.storage_key, encryption.encrypt_bytes(data, asset_bytes_aad(asset.id)))
    db.add(asset)
    db.flush()
    return None, asset.id


def share_markdown(db: Session, storage: FileObjectStorage, encryption: EncryptionService, share: Share) -> str:
    if share.markdown is not None:
        decrypted = encryption.decrypt_text(share.markdown, share_markdown_aad(share.id))
        return decrypted or ""
    return read_snapshot_text_asset(db, storage, encryption, share.owner_id, share.markdown_asset_id)


def share_html_snapshot(db: Session, storage: FileObjectStorage, encryption: EncryptionService, share: Share) -> str | None:
    if share.html_snapshot is not None:
        return encryption.decrypt_text(share.html_snapshot, share_html_aad(share.id))
    if not share.html_snapshot_asset_id:
        return None
    return read_snapshot_text_asset(db, storage, encryption, share.owner_id, share.html_snapshot_asset_id)


def read_snapshot_text_asset(
    db: Session,
    storage: FileObjectStorage,
    encryption: EncryptionService,
    owner_id: str,
    asset_id: str | None,
) -> str:
    if not asset_id:
        raise SnapshotAssetMissing()
    asset = db.execute(select(Asset).where(Asset.id == asset_id, Asset.owner_id == owner_id)).scalar_one_or_none()
    if not asset:
        raise SnapshotAssetMissing()
    try:
        data = encryption.decrypt_bytes(storage.get(asset.storage_key), asset_bytes_aad(asset.id))
        return data.decode("utf-8")
    except (FileNotFoundError, UnicodeDecodeError, ValueError) as exc:
        raise SnapshotAssetMissing() from exc


def validate_link_kind(link_kind: str) -> None:
    allowed = {"wiki", "markdown_relative", "embed"}
    if link_kind not in allowed:
        raise ApiError(400, "invalid_link_kind", "Outbound link kind is not allowed.")


def validate_css_asset_reference(share: Share, linked_assets: dict[str, Asset], linked_roles: dict[str, str]) -> None:
    if not share.css_asset_id:
        return
    css_asset = linked_assets.get(share.css_asset_id)
    if not css_asset:
        raise ApiError(400, "invalid_css_asset", "CSS asset must be linked to this share.")
    if linked_roles.get(share.css_asset_id) != "css" or css_asset.content_type != "text/css":
        raise ApiError(400, "invalid_css_asset", "CSS asset must use role css and content type text/css.")


def validate_asset_size(body: bytes, settings: Settings) -> None:
    if not body:
        raise ApiError(400, "asset_empty", "Asset body is required.")
    if len(body) > settings.asset_max_bytes:
        raise ApiError(413, "asset_too_large", "Asset exceeds the configured size limit.")


def validate_asset_upload_metadata(byte_length: int, content_type: str, content_hash: str, settings: Settings) -> None:
    if byte_length <= 0:
        raise ApiError(400, "asset_empty", "Asset body is required.")
    if byte_length > settings.asset_max_bytes:
        raise ApiError(413, "asset_too_large", "Asset exceeds the configured size limit.")
    validate_asset_content_type(content_type)
    digest = normalize_sha256(content_hash)
    if len(digest) != 64 or any(char not in "0123456789abcdef" for char in digest.lower()):
        raise ApiError(400, "invalid_asset_hash", "Asset hash must use sha256 hex format.")


def validate_completed_asset(
    storage: FileObjectStorage,
    encryption: EncryptionService,
    asset_id: str,
    storage_key: str,
    expected_byte_length: int,
    expected_hash: str,
    settings: Settings,
) -> bytes:
    try:
        data = encryption.decrypt_bytes(storage.get(storage_key), asset_bytes_aad(asset_id))
    except FileNotFoundError as exc:
        raise ApiError(404, "asset_upload_incomplete", "Uploaded asset object was not found.") from exc
    except ValueError as exc:
        raise ApiError(400, "asset_decrypt_failed", "Uploaded asset object could not be decrypted.") from exc

    if len(data) != expected_byte_length:
        raise ApiError(400, "asset_size_mismatch", "Uploaded asset size does not match intent.")
    if settings.cos_direct_upload_verify_bytes:
        actual_hash = f"sha256:{sha256(data).hexdigest()}"
        if actual_hash != expected_hash:
            raise ApiError(400, "asset_hash_mismatch", "Uploaded asset hash does not match intent.")
    return data


def validate_owner_asset_quota(db: Session, owner_id: str, new_asset_bytes: int, settings: Settings) -> None:
    if settings.asset_owner_quota_bytes <= 0:
        return
    used = db.execute(select(func.coalesce(func.sum(Asset.byte_length), 0)).where(Asset.owner_id == owner_id)).scalar_one()
    if int(used) + new_asset_bytes > settings.asset_owner_quota_bytes:
        raise ApiError(413, "asset_quota_exceeded", "Asset storage quota exceeded.")


def validate_share_asset_count(asset_refs: list, settings: Settings) -> None:
    if settings.asset_max_per_share <= 0:
        return
    unique_asset_ids = {asset_ref.asset_id for asset_ref in asset_refs}
    if len(unique_asset_ids) > settings.asset_max_per_share:
        raise ApiError(400, "share_asset_limit_exceeded", "Share has too many linked assets.")


def normalized_content_type(value: str | None) -> str:
    return (value or "").split(";", 1)[0].strip().lower()


def validate_asset_content_type(content_type: str) -> None:
    allowed = {
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "text/css",
        "text/plain",
        "text/csv",
        "application/json",
        "application/pdf",
        "application/zip",
        "application/msword",
        "application/vnd.ms-excel",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "audio/mpeg",
        "audio/mp4",
        "audio/ogg",
        "audio/wav",
        "video/mp4",
        "video/quicktime",
        "video/webm",
        "font/otf",
        "font/ttf",
        "font/woff",
        "font/woff2",
    }
    if content_type not in allowed:
        raise ApiError(415, "asset_type_not_allowed", "Asset content type is not allowed.")


def validate_asset_role(role: str) -> None:
    allowed = {"image", "css", "font", "attachment", "video"}
    if role not in allowed:
        raise ApiError(400, "invalid_asset_role", "Asset role is not allowed.")


def safe_asset_filename(value: str | None) -> str:
    filename = PurePath((value or "asset").replace("\\", "/")).name.strip()
    if not filename or filename in {".", ".."}:
        return "asset"
    return filename[:255]


def asset_response(asset: Asset, encryption: EncryptionService) -> AssetResponse:
    return AssetResponse(
        asset_id=asset.id,
        hash=asset_hash_value(encryption, asset),
        content_type=asset.content_type,
        byte_length=asset.byte_length,
        url=asset.public_url,
    )


def share_import_assets(
    db: Session,
    share: Share,
    request: Request,
    settings: Settings,
    encryption: EncryptionService,
) -> list[ShareImportPayloadResponse.AssetManifestItem]:
    rows = (
        db.execute(
            select(ShareAsset, Asset)
            .join(Asset, Asset.id == ShareAsset.asset_id)
            .where(ShareAsset.share_id == share.id)
            .order_by(ShareAsset.created_at)
        )
        .all()
    )
    assets: list[ShareImportPayloadResponse.AssetManifestItem] = []
    for link, asset in rows:
        if link.role == "css":
            continue
        assets.append(
            ShareImportPayloadResponse.AssetManifestItem(
                asset_id=asset.id,
                role=link.role,
                original_path=share_asset_original_path(encryption, link),
                filename=asset_filename(encryption, asset),
                content_type=asset.content_type,
                byte_length=asset.byte_length,
                url=f"{share_url(share, request, settings)}/assets/{asset.id}",
            )
        )
    return assets


def get_share_by_id(db: Session, share_id: str, owner_id: str | None = None) -> Share:
    query = select(Share).where(Share.id == share_id)
    if owner_id is not None:
        query = query.where(Share.owner_id == owner_id)
    share = db.execute(query).scalar_one_or_none()
    if not share:
        raise ApiError(404, "share_not_found", "Share not found.")
    return share


def is_valid_cloud_install_id(value: str) -> bool:
    allowed = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    suffix = value[4:] if value.startswith("dfi_") else ""
    return 32 <= len(value) <= 200 and len(suffix) >= 28 and all(char in allowed for char in suffix)


def record_cloud_claim_event(
    db: Session,
    install_id_hash: str,
    claim_ip_hash: str | None,
    result: str,
    payload: CloudClaimPayload,
    now: datetime,
) -> None:
    db.add(
        CloudClaimEvent(
            id=generate_prefixed_id("evt"),
            install_id_hash=install_id_hash,
            ip_hash=claim_ip_hash,
            result=result,
            plugin_version=payload.plugin_version,
            obsidian_version=payload.obsidian_version,
            created_at=now,
        )
    )


def is_cloud_claim_rate_limited(
    db: Session,
    settings: Settings,
    install_id_hash: str,
    claim_ip_hash: str | None,
    now: datetime,
) -> bool:
    since = now - timedelta(hours=1)
    if settings.cloud_claim_install_hour_limit > 0:
        install_count = db.execute(
            select(func.count())
            .select_from(CloudClaimEvent)
            .where(
                CloudClaimEvent.install_id_hash == install_id_hash,
                CloudClaimEvent.created_at >= since,
            )
        ).scalar_one()
        if int(install_count) >= settings.cloud_claim_install_hour_limit:
            return True
    if claim_ip_hash and settings.cloud_claim_ip_hour_limit > 0:
        ip_count = db.execute(
            select(func.count())
            .select_from(CloudClaimEvent)
            .where(
                CloudClaimEvent.ip_hash == claim_ip_hash,
                CloudClaimEvent.created_at >= since,
            )
        ).scalar_one()
        if int(ip_count) >= settings.cloud_claim_ip_hour_limit:
            return True
    return False


def active_share_count(db: Session, owner_id: str) -> int:
    now = utc_now()
    return int(
        db.execute(
            select(func.count())
            .select_from(Share)
            .where(
                Share.owner_id == owner_id,
                Share.stopped_at.is_(None),
                (Share.expires_at.is_(None)) | (Share.expires_at > now),
            )
        ).scalar_one()
    )


def enforce_active_share_quota(db: Session, auth: AuthContext) -> None:
    if auth.active_share_limit <= 0:
        return
    if active_share_count(db, auth.user_id) >= auth.active_share_limit:
        raise ApiError(
            403,
            "share_quota_exceeded",
            "You have reached the 5 active shares included with DocFerry Cloud.",
        )


def unique_slug(db: Session) -> str:
    for _ in range(10):
        slug = generate_slug()
        exists = db.execute(select(Share.id).where(Share.slug == slug)).scalar_one_or_none()
        if not exists:
            return slug
    raise ApiError(500, "internal_error", "Could not allocate share slug.")


def share_response(share: Share, request: Request, settings: Settings, include_created: bool) -> ShareResponse:
    return ShareResponse(
        share_id=share.id,
        slug=share.slug,
        url=share_url(share, request, settings),
        status=share_status(share),
        password_enabled=share.password_hash is not None,
        expires_at=share.expires_at,
        created_at=share.created_at if include_created else None,
        updated_at=share.updated_at,
    )


def share_status_response(
    share: Share,
    request: Request,
    settings: Settings,
    encryption: EncryptionService,
) -> ShareStatusResponse:
    return ShareStatusResponse(
        share_id=share.id,
        slug=share.slug,
        url=share_url(share, request, settings),
        source_path=share_source_path(encryption, share),
        source_hash=share_source_hash(encryption, share),
        title=share_title(encryption, share),
        status=share_status(share),
        password_enabled=share.password_hash is not None,
        expires_at=share.expires_at,
        stopped_at=share.stopped_at,
        created_at=share.created_at,
        updated_at=share.updated_at,
        last_published_at=share.last_published_at,
    )


def resolved_payload_title(payload: SharePayload) -> str:
    return payload.title


def title_from_source_path(source_path: str) -> str:
    filename = PurePath(source_path.replace("\\", "/")).name
    if filename.lower().endswith(".md"):
        return filename[:-3] or filename
    return filename or source_path


def resolve_internal_link_target(
    db: Session,
    source_share: Share,
    raw_target: str,
    settings: Settings,
    encryption: EncryptionService,
) -> tuple[Share | None, str]:
    target = normalize_obsidian_link_target(raw_target)
    if not target or is_external_link_target(target):
        return None, "unsupported"

    indexed_target = resolve_internal_link_target_from_index(db, source_share, target, settings, encryption)
    if indexed_target[1] != "no_index":
        return indexed_target

    target_indexes = doc_path_blind_indexes(settings, target)
    path_target = find_target_share_by_path_index_values(
        db,
        source_share,
        target_indexes,
        settings,
        encryption,
    )
    if path_target[1] != "no_index":
        return path_target

    target_full_keys = normalized_full_path_keys(target)
    target_basename_key = normalized_basename_key(target)
    candidates = (
        db.execute(
            select(Share)
            .where(Share.owner_id == source_share.owner_id, Share.stopped_at.is_(None))
            .order_by(Share.last_published_at.desc(), Share.updated_at.desc())
        )
        .scalars()
        .all()
    )

    scored: list[tuple[int, Share]] = []
    for candidate in candidates:
        if candidate.expires_at and coerce_aware(candidate.expires_at) <= utc_now():
            continue
        score = internal_link_match_score(
            share_source_path(encryption, candidate),
            target_full_keys,
            target_basename_key,
        )
        if score:
            scored.append((score, candidate))

    if not scored:
        return None, "not_published"

    scored.sort(key=lambda item: item[0], reverse=True)
    best_score = scored[0][0]
    best_matches = [candidate for score, candidate in scored if score == best_score]
    if best_score < 3 and len(
        {normalized_path_without_known_extension(share_source_path(encryption, item)) for item in best_matches}
    ) > 1:
        return None, "ambiguous"
    return best_matches[0], "ok"


def resolve_internal_link_target_from_index(
    db: Session,
    source_share: Share,
    normalized_target: str,
    settings: Settings,
    encryption: EncryptionService,
) -> tuple[Share | None, str]:
    links = (
        db.execute(select(ShareLink).where(ShareLink.source_share_id == source_share.id).order_by(ShareLink.created_at))
        .scalars()
        .all()
    )
    if not links:
        return None, "no_index"

    target_index = blind_index(settings, "share_link.raw_target", normalized_target)
    indexed_links = [link for link in links if link.raw_target_index]
    if target_index and indexed_links:
        matches = [link for link in indexed_links if link.raw_target_index == target_index]
        if not matches:
            return None, "not_published"
    else:
        matches = [
            link
            for link in links
            if not link.raw_target_index
            and normalize_obsidian_link_target(link_raw_target(encryption, link)) == normalized_target
        ]
    if not matches:
        return None, "no_index" if not indexed_links else "not_published"

    resolved: list[Share] = []
    unresolved = False
    for link in matches:
        target_share = find_indexed_target_share(db, source_share, link, settings, encryption)
        if target_share:
            resolved.append(target_share)
        else:
            unresolved = True

    unique_resolved = list({share.id: share for share in resolved}.values())
    if len(unique_resolved) == 1:
        return unique_resolved[0], "ok"
    if len(unique_resolved) > 1:
        return None, "ambiguous"
    return None, "not_published" if unresolved else "unsupported"


def find_target_share_by_path_index_values(
    db: Session,
    source_share: Share,
    target_indexes: dict[str, str | None],
    settings: Settings,
    encryption: EncryptionService,
) -> tuple[Share | None, str]:
    usable_indexes = {value for value in target_indexes.values() if value}
    if not usable_indexes:
        return None, "no_index"
    source_vault_index = source_share.vault_id_index or text_index(
        settings,
        "vault_id",
        share_vault_id(encryption, source_share),
    )
    statement = select(Share).where(Share.owner_id == source_share.owner_id, Share.stopped_at.is_(None))
    if source_vault_index:
        statement = statement.where(Share.vault_id_index == source_vault_index)
    statement = statement.where(
        or_(
            Share.source_path_full_index.in_(usable_indexes),
            Share.source_path_extless_index.in_(usable_indexes),
            Share.source_path_basename_index.in_(usable_indexes),
            Share.source_path_basename_extless_index.in_(usable_indexes),
        )
    )
    candidates = [
        candidate
        for candidate in db.execute(statement.order_by(Share.last_published_at.desc(), Share.updated_at.desc()))
        .scalars()
        .all()
        if not (candidate.expires_at and coerce_aware(candidate.expires_at) <= utc_now())
    ]
    scored = [(source_path_index_score(candidate, target_indexes), candidate) for candidate in candidates]
    scored = [(score, candidate) for score, candidate in scored if score]
    if scored:
        best_score = max(score for score, _candidate in scored)
        matches = [candidate for score, candidate in scored if score == best_score]
    else:
        matches = []
    if len(matches) == 1:
        return matches[0], "ok"
    if len(matches) > 1:
        return None, "ambiguous"

    legacy_statement = select(Share.id).where(
        Share.owner_id == source_share.owner_id,
        Share.stopped_at.is_(None),
        Share.source_path_full_index.is_(None),
    )
    if db.execute(legacy_statement.limit(1)).first():
        return None, "no_index"
    return None, "not_published"


def find_indexed_target_share(
    db: Session,
    source_share: Share,
    link: ShareLink,
    settings: Settings,
    encryption: EncryptionService,
) -> Share | None:
    source_vault_index = source_share.vault_id_index or text_index(
        settings,
        "vault_id",
        share_vault_id(encryption, source_share),
    )
    if link.target_doc_identity_index:
        statement = select(Share).where(
            Share.owner_id == source_share.owner_id,
            Share.doc_identity_index == link.target_doc_identity_index,
            Share.stopped_at.is_(None),
        )
        if source_vault_index:
            statement = statement.where(Share.vault_id_index == source_vault_index)
        target = newest_active_share(db, statement)
        if target:
            return target

    legacy_target_doc_identity = link_target_doc_identity(encryption, link)
    legacy_source_vault_id = share_vault_id(encryption, source_share)
    if legacy_target_doc_identity:
        statement = select(Share).where(
            Share.owner_id == source_share.owner_id,
            Share.doc_identity == legacy_target_doc_identity,
            Share.stopped_at.is_(None),
        )
        if legacy_source_vault_id:
            statement = statement.where(Share.vault_id == legacy_source_vault_id)
        target = newest_active_share(db, statement)
        if target:
            return target

    path_target, status = find_target_share_by_path_index_values(
        db,
        source_share,
        link_target_path_indexes(link),
        settings,
        encryption,
    )
    if status == "ok":
        return path_target
    if status == "ambiguous":
        return None

    target_path = link_target_path(encryption, link)
    if target_path:
        target_keys = normalized_full_path_keys(normalize_share_path(target_path))
        statement = select(Share).where(Share.owner_id == source_share.owner_id, Share.stopped_at.is_(None))
        if legacy_source_vault_id:
            statement = statement.where(Share.vault_id == legacy_source_vault_id)
        candidates = db.execute(statement.order_by(Share.last_published_at.desc(), Share.updated_at.desc())).scalars().all()
        matches = [
            candidate
            for candidate in candidates
            if not (candidate.expires_at and coerce_aware(candidate.expires_at) <= utc_now())
            and source_path_keys(candidate, encryption).intersection(target_keys)
        ]
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            return None
    return None


def newest_active_share(db: Session, statement):
    candidates = db.execute(statement.order_by(Share.last_published_at.desc(), Share.updated_at.desc())).scalars().all()
    for candidate in candidates:
        if candidate.expires_at and coerce_aware(candidate.expires_at) <= utc_now():
            continue
        return candidate
    return None


def source_path_keys(share: Share, encryption: EncryptionService) -> set[str]:
    normalized = share_source_path_normalized(encryption, share)
    if normalized:
        keys = normalized_full_path_keys(normalized)
    else:
        keys = set()
    source_path = share_source_path(encryption, share)
    if source_path:
        keys.update(normalized_full_path_keys(source_path))
    return keys


def share_link_status_response(
    db: Session,
    link: ShareLink,
    source_share: Share,
    request: Request,
    settings: Settings,
    encryption: EncryptionService,
) -> ShareLinkStatusResponse:
    target_share, status = resolve_internal_link_target_from_index(
        db,
        source_share,
        normalize_obsidian_link_target(link_raw_target(encryption, link)),
        settings,
        encryption,
    )
    if status in {"no_index", "not_published"}:
        status = "unpublished"
    return ShareLinkStatusResponse(
        link_id=link.id,
        raw_target=link_raw_target(encryption, link),
        target_path=link_target_path(encryption, link),
        target_subpath=link_target_subpath(encryption, link),
        label=link_label(encryption, link),
        link_kind=link.link_kind,
        status="resolved" if target_share else status,  # type: ignore[arg-type]
        target_share_id=target_share.id if target_share else None,
        target_url=share_url(target_share, request, settings) if target_share else None,
    )


def normalize_obsidian_link_target(raw_target: str) -> str:
    target = unquote(raw_target).split("|", 1)[0].strip()
    target = target.split("#", 1)[0].split("^", 1)[0].strip()
    return normalize_share_path(target)


def is_external_link_target(target: str) -> bool:
    lowered = target.lower()
    return lowered.startswith(("http://", "https://", "mailto:", "obsidian://"))


def internal_link_match_score(source_path: str, target_full_keys: set[str], target_basename_key: str) -> int:
    source_full_keys = normalized_full_path_keys(source_path)
    if source_full_keys.intersection(target_full_keys):
        return 3
    if normalized_basename_key(source_path) == target_basename_key:
        return 2
    return 0


def normalized_full_path_keys(value: str) -> set[str]:
    normalized = normalize_share_path(value)
    without_extension = normalized_path_without_known_extension(normalized)
    return {normalized.lower(), without_extension.lower()}


def normalized_basename_key(value: str) -> str:
    return normalized_path_without_known_extension(normalize_share_path(value).rsplit("/", 1)[-1]).lower()


def normalized_path_without_known_extension(value: str) -> str:
    lowered = value.lower()
    for extension in (".md", ".canvas"):
        if lowered.endswith(extension):
            return value[: -len(extension)]
    return value


def normalize_share_path(value: str) -> str:
    return "/".join(part for part in value.replace("\\", "/").strip().strip("/").split("/") if part)


def share_url(share: Share, request: Request, settings: Settings) -> str:
    base = settings.public_base_url or str(request.base_url).rstrip("/")
    return f"{base}/s/{share.slug}"


def share_status(share: Share) -> ShareStatus:
    if share.stopped_at:
        return "stopped"
    if share.expires_at and coerce_aware(share.expires_at) <= utc_now():
        return "expired"
    if share.password_hash:
        return "password_protected"
    return "published"


def unavailable_response(
    share: Share,
    request: Request,
    db: Session,
    settings: Settings,
) -> HTMLResponse | None:
    if share.stopped_at:
        record_access_event(db, request, settings, "stopped", 410, share=share)
        return html(status_page("Sharing stopped", "This share link has been stopped.", "Stopped"), 410)
    if share.expires_at and coerce_aware(share.expires_at) <= utc_now():
        record_access_event(db, request, settings, "expired", 410, share=share)
        return html(status_page("Share expired", "This share link has expired.", "Expired"), 410)
    return None


def unavailable_json_response(
    share: Share,
    request: Request,
    db: Session,
    settings: Settings,
) -> JSONResponse | None:
    if share.stopped_at:
        record_access_event(db, request, settings, "stopped", 410, share=share)
        return JSONResponse(
            status_code=410,
            content=error_envelope("share_stopped", "Share has been stopped.", request.state.request_id),
        )
    if share.expires_at and coerce_aware(share.expires_at) <= utc_now():
        record_access_event(db, request, settings, "expired", 410, share=share)
        return JSONResponse(
            status_code=410,
            content=error_envelope("share_expired", "Share has expired.", request.state.request_id),
        )
    return None


def coerce_aware(value: datetime) -> datetime:
    if value.tzinfo:
        return value
    return value.replace(tzinfo=timezone.utc)


def html(body: str, status_code: int) -> HTMLResponse:
    return HTMLResponse(
        body,
        status_code=status_code,
        headers={
            "X-Robots-Tag": "noindex, nofollow",
            "Content-Security-Policy": "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'",
        },
    )


def record_access_event(
    db: Session,
    request: Request,
    settings: Settings,
    event_type: str,
    status_code: int,
    *,
    share: Share | None = None,
    slug: str | None = None,
    details: dict[str, str] | None = None,
) -> None:
    user_agent = request.headers.get("user-agent")
    event = ShareAccessEvent(
        id=generate_prefixed_id("evt"),
        share_id=share.id if share else None,
        slug=share.slug if share else slug,
        event_type=event_type,
        request_id=request.state.request_id,
        status_code=status_code,
        ip_hash=ip_hash(request, settings),
        user_agent=user_agent[:512] if user_agent else None,
        details=details or {},
    )
    db.add(event)


def is_password_rate_limited(db: Session, request: Request, settings: Settings, share: Share) -> bool:
    if settings.password_failed_limit <= 0 or settings.password_failed_window_seconds <= 0:
        return False
    hashed_ip = ip_hash(request, settings)
    if not hashed_ip:
        return False
    cutoff = utc_now() - timedelta(seconds=settings.password_failed_window_seconds)
    failed_count = db.execute(
        select(func.count())
        .select_from(ShareAccessEvent)
        .where(
            ShareAccessEvent.share_id == share.id,
            ShareAccessEvent.event_type == "password_failed",
            ShareAccessEvent.ip_hash == hashed_ip,
            ShareAccessEvent.created_at >= cutoff,
        )
    ).scalar_one()
    return failed_count >= settings.password_failed_limit


def ip_hash(request: Request, settings: Settings) -> str | None:
    ip = request_ip(request, settings)
    if not ip:
        return None
    digest = sha256(f"{settings.cookie_secret}:{ip}".encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def request_ip(request: Request, settings: Settings) -> str | None:
    return forwarded_ip(request, settings) or (request.client.host if request.client else None)


def forwarded_ip(request: Request, settings: Settings) -> str | None:
    remote_host = request.client.host if request.client else None
    if not remote_host or remote_host not in trusted_proxy_hosts(settings):
        return None
    real_ip = request.headers.get("x-real-ip")
    if real_ip and real_ip.strip():
        return real_ip.strip()
    forwarded_for = request.headers.get("x-forwarded-for")
    if not forwarded_for:
        return None
    forwarded_chain = [part.strip() for part in forwarded_for.split(",") if part.strip()]
    return forwarded_chain[-1] if forwarded_chain else None


def trusted_proxy_hosts(settings: Settings) -> set[str]:
    return {host.strip() for host in settings.trusted_proxy_hosts.split(",") if host.strip()}


app = create_app()
