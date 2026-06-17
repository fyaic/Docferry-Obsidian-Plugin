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
from .models import Asset, Share, ShareAccessEvent, ShareAsset, ShareLink, utc_now
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
    DeleteShareResponse,
    HealthResponse,
    PasswordPayload,
    ShareAccessEventResponse,
    ShareAccessEventsResponse,
    ShareImportPayloadResponse,
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
    hash_password,
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
            provider="manual_token",
            login_url="",
            callback_protocol="docferry",
        )

    @app.post("/v0/auth/exchange")
    def auth_exchange(payload: AuthExchangePayload, request: Request):
        _ = payload
        return JSONResponse(
            status_code=501,
            content=error_envelope(
                "manual_token_only",
                "DocFerry uses manually issued Cloud tokens in this release.",
                request.state.request_id,
            ),
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

        existing = db.execute(
            select(Asset).where(Asset.owner_id == auth.user_id, Asset.hash == payload.hash)
        ).scalar_one_or_none()
        if existing:
            existing.last_used_at = utc_now()
            return AssetUploadIntentResponse(mode="already_uploaded", asset=asset_response(existing))

        validate_owner_asset_quota(db, auth.user_id, payload.byte_length, settings)
        storage_key = storage.storage_key(auth.user_id, payload.hash)
        if encryption.enabled or not cos_direct_upload_configured(settings):
            return AssetUploadIntentResponse(mode="api_proxy", storage_key=storage_key, fallback_url="/v0/assets")

        try:
            target = create_cos_upload_target(settings, storage_key)
        except CosStsError as exc:
            logging.getLogger("docferry").warning("cos_sts_failed", extra={"error": str(exc)})
            return AssetUploadIntentResponse(mode="api_proxy", storage_key=storage_key, fallback_url="/v0/assets")

        return AssetUploadIntentResponse(
            mode="tencent_cos",
            asset_id=generate_prefixed_id("asset"),
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
        expected_storage_key = storage.storage_key(auth.user_id, payload.hash)
        if payload.storage_key != expected_storage_key:
            raise ApiError(400, "invalid_storage_key", "Asset storage key does not match hash.")

        existing_id = db.get(Asset, asset_id)
        if existing_id:
            if existing_id.hash != payload.hash:
                raise ApiError(409, "asset_id_conflict", "Asset id already belongs to another upload.")
            existing_id.last_used_at = utc_now()
            return asset_response(existing_id)

        existing = db.execute(
            select(Asset).where(Asset.owner_id == auth.user_id, Asset.hash == payload.hash)
        ).scalar_one_or_none()
        if existing:
            existing.last_used_at = utc_now()
            return asset_response(existing)

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
            hash=payload.hash,
            filename=safe_asset_filename(payload.filename),
            content_type=content_type,
            byte_length=payload.byte_length,
            storage_key=payload.storage_key,
            public_url=None,
            last_used_at=utc_now(),
        )
        storage.put(asset.storage_key, encryption.encrypt_bytes(completed_data, asset_bytes_aad(asset.id)))
        db.add(asset)
        db.flush()
        return asset_response(asset)

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

        existing = db.execute(
            select(Asset).where(Asset.owner_id == auth.user_id, Asset.hash == actual_hash)
        ).scalar_one_or_none()
        if existing:
            existing.last_used_at = utc_now()
            return asset_response(existing)

        validate_owner_asset_quota(db, auth.user_id, len(body), settings)

        asset = Asset(
            id=generate_prefixed_id("asset"),
            owner_id=auth.user_id,
            hash=actual_hash,
            filename=safe_asset_filename(request.headers.get("x-share-asset-filename")),
            content_type=content_type,
            byte_length=len(body),
            storage_key=storage.storage_key(auth.user_id, actual_hash),
            public_url=None,
            last_used_at=utc_now(),
        )
        storage.put(asset.storage_key, encryption.encrypt_bytes(body, asset_bytes_aad(asset.id)))
        db.add(asset)
        db.flush()
        return asset_response(asset)

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
            title=resolved_payload_title(payload),
            vault_id=payload.vault_id,
            source_path=payload.source_path,
            source_path_normalized=payload.source_path_normalized or normalize_share_path(payload.source_path),
            doc_identity=payload.doc_identity,
            source_hash=payload.source_hash,
            markdown=markdown,
            markdown_asset_id=markdown_asset_id,
            html_snapshot=html_snapshot,
            html_snapshot_asset_id=html_snapshot_asset_id,
            render_mode="html_snapshot" if payload.html_snapshot else "markdown_fallback",
            css_asset_id=payload.css_asset_id,
            assets=[asset.model_dump(exclude_none=True) for asset in payload.assets],
            client=payload.client.model_dump(),
            password_hash=hash_password(payload.password) if payload.password else None,
            expires_at=payload.expires_at,
            last_published_at=utc_now(),
        )
        db.add(share)
        db.flush()
        replace_share_assets(db, share, payload.assets)
        replace_share_links(db, share, payload.outbound_links)
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

        share.title = resolved_payload_title(payload)
        share.vault_id = payload.vault_id
        share.source_path = payload.source_path
        share.source_path_normalized = payload.source_path_normalized or normalize_share_path(payload.source_path)
        share.doc_identity = payload.doc_identity
        share.source_hash = payload.source_hash
        share.markdown = markdown
        share.markdown_asset_id = markdown_asset_id
        share.html_snapshot = html_snapshot
        share.html_snapshot_asset_id = html_snapshot_asset_id
        share.render_mode = "html_snapshot" if payload.html_snapshot else "markdown_fallback"
        share.css_asset_id = payload.css_asset_id
        share.assets = [asset.model_dump(exclude_none=True) for asset in payload.assets]
        share.client = payload.client.model_dump()
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
        replace_share_assets(db, share, payload.assets)
        replace_share_links(db, share, payload.outbound_links)
        prune_unreferenced_assets(db, storage, previous_asset_ids)
        return share_response(share, request, settings, include_created=False)

    @app.get("/v0/shares/{share_id}", response_model=ShareStatusResponse)
    def get_share_status(
        share_id: str,
        request: Request,
        auth: AuthContext = Depends(require_auth),
        db: Session = Depends(get_db),
        settings: Settings = Depends(get_settings),
    ) -> ShareStatusResponse:
        share = get_share_by_id(db, share_id, auth.user_id)
        return share_status_response(share, request, settings)

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
            links=[share_link_status_response(db, link, share, request, settings) for link in links],
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
            return html(password_page(slug, share.title), 401)
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
        return html(document_page(share, markdown, html_snapshot), 200)

    @app.get("/s/{slug}/link", response_class=HTMLResponse)
    def resolve_share_link(
        slug: str,
        request: Request,
        target: str = Query(..., min_length=1, max_length=1024),
        db: Session = Depends(get_db),
        settings: Settings = Depends(get_settings),
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
            return html(password_page(slug, share.title), 401)

        target_share, status = resolve_internal_link_target(db, share, target)
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
            title=share.title,
            markdown=markdown,
            source_hash=share.source_hash,
            assets=share_import_assets(db, share, request, settings),
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
            return html(password_page(slug, share.title, "Too many password attempts. Try again later."), 429)

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
            return html(password_page(slug, share.title, "Password is incorrect."), 401)

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


def replace_share_assets(db: Session, share: Share, asset_refs: list) -> None:
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
                original_path=asset_ref.original_path,
            )
        )
    validate_css_asset_reference(share, linked_assets, linked_roles)


def replace_share_links(db: Session, share: Share, outbound_links: list) -> None:
    db.execute(delete(ShareLink).where(ShareLink.source_share_id == share.id))
    seen: set[tuple[str, str | None, str | None, str]] = set()
    for outbound_link in outbound_links:
        validate_link_kind(outbound_link.link_kind)
        raw_target = outbound_link.raw_target.strip()
        target_path = normalize_share_path(outbound_link.target_path) if outbound_link.target_path else None
        target_doc_identity = outbound_link.target_doc_identity.strip() if outbound_link.target_doc_identity else None
        key = (normalize_obsidian_link_target(raw_target), target_path, target_doc_identity, outbound_link.link_kind)
        if key in seen:
            continue
        seen.add(key)
        db.add(
            ShareLink(
                id=generate_prefixed_id("lnk"),
                source_share_id=share.id,
                owner_id=share.owner_id,
                vault_id=share.vault_id,
                raw_target=raw_target,
                target_path=target_path,
                target_doc_identity=target_doc_identity,
                target_subpath=outbound_link.target_subpath.strip() if outbound_link.target_subpath else None,
                label=outbound_link.label.strip() if outbound_link.label else None,
                link_kind=outbound_link.link_kind,
            )
        )


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
    share.vault_id = None
    share.source_path = ""
    share.source_path_normalized = None
    share.doc_identity = None
    share.source_hash = "revoked"
    share.markdown = None
    share.markdown_asset_id = None
    share.html_snapshot = None
    share.html_snapshot_asset_id = None
    share.render_mode = "markdown_fallback"
    share.css_asset_id = None
    share.assets = []
    share.client = {}
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
    existing = db.execute(
        select(Asset).where(Asset.owner_id == owner_id, Asset.hash == content_hash)
    ).scalar_one_or_none()
    if existing:
        existing.last_used_at = utc_now()
        return None, existing.id

    validate_owner_asset_quota(db, owner_id, len(data), settings)
    asset_id = generate_prefixed_id("asset")

    asset = Asset(
        id=asset_id,
        owner_id=owner_id,
        hash=content_hash,
        filename=safe_asset_filename(filename),
        content_type=content_type,
        byte_length=len(data),
        storage_key=storage.storage_key(owner_id, content_hash),
        public_url=None,
        last_used_at=utc_now(),
    )
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


def asset_response(asset: Asset) -> AssetResponse:
    return AssetResponse(
        asset_id=asset.id,
        hash=asset.hash,
        content_type=asset.content_type,
        byte_length=asset.byte_length,
        url=asset.public_url,
    )


def share_import_assets(
    db: Session, share: Share, request: Request, settings: Settings
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
                original_path=link.original_path,
                filename=asset.filename,
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
            "You have reached the 10 active shares included with DocFerry Cloud.",
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


def share_status_response(share: Share, request: Request, settings: Settings) -> ShareStatusResponse:
    return ShareStatusResponse(
        share_id=share.id,
        slug=share.slug,
        url=share_url(share, request, settings),
        source_path=share.source_path,
        source_hash=share.source_hash,
        title=share.title,
        status=share_status(share),
        password_enabled=share.password_hash is not None,
        expires_at=share.expires_at,
        stopped_at=share.stopped_at,
        created_at=share.created_at,
        updated_at=share.updated_at,
        last_published_at=share.last_published_at,
    )


def resolved_payload_title(payload: SharePayload) -> str:
    if payload.client.plugin_id == "fuyou-share" and payload.client.plugin_version == "0.0.1":
        return title_from_source_path(payload.source_path)
    return payload.title


def title_from_source_path(source_path: str) -> str:
    filename = PurePath(source_path.replace("\\", "/")).name
    if filename.lower().endswith(".md"):
        return filename[:-3] or filename
    return filename or source_path


def resolve_internal_link_target(db: Session, source_share: Share, raw_target: str) -> tuple[Share | None, str]:
    target = normalize_obsidian_link_target(raw_target)
    if not target or is_external_link_target(target):
        return None, "unsupported"

    indexed_target = resolve_internal_link_target_from_index(db, source_share, target)
    if indexed_target[1] != "no_index":
        return indexed_target

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
        score = internal_link_match_score(candidate.source_path, target_full_keys, target_basename_key)
        if score:
            scored.append((score, candidate))

    if not scored:
        return None, "not_published"

    scored.sort(key=lambda item: item[0], reverse=True)
    best_score = scored[0][0]
    best_matches = [candidate for score, candidate in scored if score == best_score]
    if best_score < 3 and len({normalized_path_without_known_extension(item.source_path) for item in best_matches}) > 1:
        return None, "ambiguous"
    return best_matches[0], "ok"


def resolve_internal_link_target_from_index(
    db: Session, source_share: Share, normalized_target: str
) -> tuple[Share | None, str]:
    links = (
        db.execute(select(ShareLink).where(ShareLink.source_share_id == source_share.id).order_by(ShareLink.created_at))
        .scalars()
        .all()
    )
    if not links:
        return None, "no_index"

    matches = [link for link in links if normalize_obsidian_link_target(link.raw_target) == normalized_target]
    if not matches:
        return None, "not_published"

    resolved: list[Share] = []
    unresolved = False
    for link in matches:
        target_share = find_indexed_target_share(db, source_share, link)
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


def find_indexed_target_share(db: Session, source_share: Share, link: ShareLink) -> Share | None:
    if link.target_doc_identity:
        statement = select(Share).where(
            Share.owner_id == source_share.owner_id,
            Share.doc_identity == link.target_doc_identity,
            Share.stopped_at.is_(None),
        )
        if source_share.vault_id:
            statement = statement.where(Share.vault_id == source_share.vault_id)
        target = newest_active_share(db, statement)
        if target:
            return target

    if link.target_path:
        target_path = normalize_share_path(link.target_path)
        target_keys = normalized_full_path_keys(target_path)
        statement = select(Share).where(
            Share.owner_id == source_share.owner_id,
            Share.stopped_at.is_(None),
        )
        if source_share.vault_id:
            statement = statement.where(Share.vault_id == source_share.vault_id)
        candidates = db.execute(statement.order_by(Share.last_published_at.desc(), Share.updated_at.desc())).scalars().all()
        matches = [
            candidate
            for candidate in candidates
            if not (candidate.expires_at and coerce_aware(candidate.expires_at) <= utc_now())
            and source_path_keys(candidate).intersection(target_keys)
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


def source_path_keys(share: Share) -> set[str]:
    if share.source_path_normalized:
        keys = normalized_full_path_keys(share.source_path_normalized)
    else:
        keys = set()
    keys.update(normalized_full_path_keys(share.source_path))
    return keys


def share_link_status_response(
    db: Session, link: ShareLink, source_share: Share, request: Request, settings: Settings
) -> ShareLinkStatusResponse:
    target_share, status = resolve_internal_link_target_from_index(
        db, source_share, normalize_obsidian_link_target(link.raw_target)
    )
    if status in {"no_index", "not_published"}:
        status = "unpublished"
    return ShareLinkStatusResponse(
        link_id=link.id,
        raw_target=link.raw_target,
        target_path=link.target_path,
        target_subpath=link.target_subpath,
        label=link.label,
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
    ip = forwarded_ip(request) or (request.client.host if request.client else None)
    if not ip:
        return None
    digest = sha256(f"{settings.cookie_secret}:{ip}".encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def forwarded_ip(request: Request) -> str | None:
    forwarded_for = request.headers.get("x-forwarded-for")
    if not forwarded_for:
        return None
    first_ip = forwarded_for.split(",", 1)[0].strip()
    return first_ip or None


app = create_app()
