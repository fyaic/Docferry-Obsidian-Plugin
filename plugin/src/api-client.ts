import { requestUrl } from "obsidian";
import COS from "cos-js-sdk-v5";
import type {
  AccessRequestResponse,
  AssetResponse,
  AssetUploadIntentResponse,
  AuthConfig,
  AuthExchangeResponse,
  AuthWhoamiResponse,
  DashboardLinkResponse,
  DeviceAuthorizationCodeResponse,
  DeleteShareResponse,
  DeleteShareRecordResponse,
  FolderShareDocumentPayload,
  FolderShareDocumentResponse,
  FolderShareDraftPayload,
  FolderShareDraftResponse,
  FolderShareListResponse,
  FolderShareResponse,
  MembershipResponse,
  MediaNoteJobResponse,
  PendingAuthExchangeResponse,
  SharePayload,
  ShareImportPayloadResponse,
  ShareListResponse,
  ShareLinksResponse,
  ShareResponse,
  ShareStatusResponse
} from "./types";
import type { DocferrySettings } from "./settings";
import { isInvalidProductSessionError } from "./session-errors";
import { isSameDocferryOrigin, parseDocferryShareUrl } from "./share-url";

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    request_id?: string;
    details?: Record<string, unknown>;
  };
}

export interface ShareImportSession {
  payload: ShareImportPayloadResponse;
  cookieHeader?: string;
}

export class ShareApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly requestId?: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}

export class ShareApiClient {
  constructor(
    private readonly getSettings: () => DocferrySettings,
    private readonly pluginVersion: string,
    private readonly onInvalidSession?: (error: ShareApiError) => void
  ) {}

  async health(): Promise<{ ok: boolean; service: string; version: string }> {
    return this.getJson("/v0/health");
  }

  async createShare(payload: SharePayload, idempotencyKey?: string): Promise<ShareResponse> {
    return this.postJson(
      "/v0/shares",
      payload,
      idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}
    );
  }

  async resolveShareCreate(idempotencyKey: string): Promise<ShareResponse> {
    return this.getJson(`/v0/shares/idempotency/${encodeURIComponent(idempotencyKey)}`);
  }

  async updateShare(shareId: string, payload: SharePayload): Promise<ShareResponse> {
    return this.putJson(`/v0/shares/${encodeURIComponent(shareId)}`, payload);
  }

  async getShareStatus(shareId: string): Promise<ShareStatusResponse> {
    return this.getJson(`/v0/shares/${encodeURIComponent(shareId)}`);
  }

  async listShares(): Promise<ShareListResponse> {
    return this.getJson("/v0/shares?limit=100");
  }

  async getShareLinks(shareId: string): Promise<ShareLinksResponse> {
    return this.getJson(`/v0/shares/${encodeURIComponent(shareId)}/links`);
  }

  async deleteShare(shareId: string): Promise<DeleteShareResponse> {
    return this.deleteJson(`/v0/shares/${encodeURIComponent(shareId)}`);
  }

  async deleteShareRecord(shareId: string): Promise<DeleteShareRecordResponse> {
    return this.deleteJson(`/v0/shares/${encodeURIComponent(shareId)}/record`);
  }

  async createFolderShareDraft(payload: FolderShareDraftPayload): Promise<FolderShareDraftResponse> {
    return this.postJson("/v0/folder-shares/drafts", payload);
  }

  async putFolderShareDocument(
    revisionId: string,
    routeKey: string,
    payload: FolderShareDocumentPayload
  ): Promise<FolderShareDocumentResponse> {
    return this.putJson(
      `/v0/folder-shares/drafts/${encodeURIComponent(revisionId)}/documents/${encodeURIComponent(routeKey)}`,
      payload
    );
  }

  async commitFolderShareDraft(
    revisionId: string,
    payload: { password?: string; password_mode: "keep" | "set" | "clear"; expires_at?: string | null }
  ): Promise<FolderShareResponse> {
    return this.postJson(`/v0/folder-shares/drafts/${encodeURIComponent(revisionId)}/commit`, payload);
  }

  async listFolderShares(): Promise<FolderShareListResponse> {
    return this.getJson("/v0/folder-shares");
  }

  async deleteFolderShare(folderShareId: string): Promise<DeleteShareResponse> {
    return this.deleteJson(`/v0/folder-shares/${encodeURIComponent(folderShareId)}`);
  }

  async deleteFolderShareRecord(folderShareId: string): Promise<DeleteShareRecordResponse> {
    return this.deleteJson(`/v0/folder-shares/${encodeURIComponent(folderShareId)}/record`);
  }

  async uploadAsset(
    data: ArrayBuffer,
    filename: string,
    contentType: string,
    contentHash: string
  ): Promise<AssetResponse> {
    try {
      const intent = await this.createAssetUploadIntent(data, filename, contentType, contentHash);
      if (intent.mode === "already_uploaded" && intent.asset) return intent.asset;
      if (intent.mode === "tencent_cos" && intent.asset_id && intent.storage_key && intent.upload) {
        await this.uploadAssetToCos(data, contentType, contentHash, intent.upload);
        return await this.completeAssetUpload(intent.asset_id, {
          filename,
          content_type: contentType,
          byte_length: data.byteLength,
          hash: contentHash,
          storage_key: intent.storage_key
        });
      }
    } catch {
      console.warn("DocFerry direct asset upload failed; retrying through the API proxy.");
    }
    return this.uploadAssetViaApi(data, filename, contentType, contentHash);
  }

  private async createAssetUploadIntent(
    data: ArrayBuffer,
    filename: string,
    contentType: string,
    contentHash: string
  ): Promise<AssetUploadIntentResponse> {
    return this.postJson("/v0/assets/intents", {
      filename,
      content_type: contentType,
      byte_length: data.byteLength,
      hash: contentHash
    });
  }

  private async completeAssetUpload(
    assetId: string,
    payload: {
      filename: string;
      content_type: string;
      byte_length: number;
      hash: string;
      storage_key: string;
    }
  ): Promise<AssetResponse> {
    return this.postJson(`/v0/assets/${encodeURIComponent(assetId)}/complete`, payload);
  }

  private async uploadAssetToCos(
    data: ArrayBuffer,
    contentType: string,
    contentHash: string,
    upload: NonNullable<AssetUploadIntentResponse["upload"]>
  ): Promise<void> {
    const credentials = upload.credentials;
    const cos = new COS({
      SecretId: credentials.tmp_secret_id,
      SecretKey: credentials.tmp_secret_key,
      SecurityToken: credentials.session_token,
      StartTime: credentials.start_time,
      ExpiredTime: credentials.expired_time
    });
    const body = new Blob([data], { type: contentType });
    await cos.uploadFile({
      Bucket: upload.bucket,
      Region: upload.region,
      Key: upload.key,
      Body: body,
      ContentType: contentType,
      SliceSize: upload.slice_size,
      Headers: {
        ...(upload.headers || {}),
        "Content-Type": contentType,
        "x-cos-meta-docferry-sha256": contentHash
      }
    });
  }

  private async uploadAssetViaApi(
    data: ArrayBuffer,
    filename: string,
    contentType: string,
    contentHash: string
  ): Promise<AssetResponse> {
    const res = await requestUrl({
      url: this.url("/v0/assets"),
      method: "POST",
      headers: {
        ...this.headers(false),
        "Content-Type": contentType,
        "X-Share-Asset-Hash": contentHash,
        "X-Share-Asset-Filename": safeHeaderValue(filename)
      },
      body: data,
      throw: false
    });
    return this.parse<AssetResponse>(res.status, res.text);
  }

  async getAuthConfig(): Promise<AuthConfig> {
    return this.getJson("/v0/auth/config");
  }

  async exchangePendingAuth(state: string, codeVerifier: string): Promise<AuthExchangeResponse | PendingAuthExchangeResponse> {
    return this.postJson("/v0/auth/exchange/pending", { state, code_verifier: codeVerifier });
  }

  async createDeviceAuthorization(payload: {
    client_instance_id: string;
    plugin_version: string;
    platform: string;
    instance_type: "obsidian_plugin";
    intent: "login" | "signup" | "switch_account";
  }): Promise<DeviceAuthorizationCodeResponse> {
    return this.postJson("/v0/auth/device/code", payload);
  }

  async exchangeDeviceAuthorization(deviceCode: string): Promise<AuthExchangeResponse> {
    return this.postJson("/v0/auth/device/token", { device_code: deviceCode });
  }

  async whoami(): Promise<AuthWhoamiResponse> {
    return this.getJson("/v0/auth/whoami");
  }

  async createDashboardLink(targetPath: string): Promise<DashboardLinkResponse> {
    return this.postJson("/v0/auth/dashboard-link", {
      target_path: targetPath
    });
  }

  async getMembership(refresh = false): Promise<MembershipResponse> {
    return this.getJson(`/v0/membership${refresh ? "?refresh=true" : ""}`);
  }

  async createAccessRequest(payload: {
    source: "plugin_settings" | "plugin_dashboard";
    requested_access: "higher_limits";
    current_plan_key?: string | null;
    active_share_count?: number | null;
    active_share_limit?: number | null;
  }): Promise<AccessRequestResponse> {
    return this.postJson("/v0/access-requests", payload);
  }

  async createMediaNoteJob(sourceUrl: string, idempotencyKey: string): Promise<MediaNoteJobResponse> {
    return this.postJson(
      "/v0/media-note/jobs",
      { source_url: sourceUrl, output_language: "source" },
      { "Idempotency-Key": idempotencyKey }
    );
  }

  async getMediaNoteJob(jobId: string): Promise<MediaNoteJobResponse> {
    return this.getJson(`/v0/media-note/jobs/${encodeURIComponent(jobId)}`);
  }

  async cancelMediaNoteJob(jobId: string): Promise<MediaNoteJobResponse> {
    return this.postJson(`/v0/media-note/jobs/${encodeURIComponent(jobId)}/cancel`, {});
  }

  async logout(): Promise<{ ok: boolean }> {
    return this.postJson("/v0/auth/logout", {});
  }

  /** Revokes a token that has not been adopted into the active plugin session. */
  async logoutToken(token: string): Promise<{ ok: boolean }> {
    const res = await requestUrl({
      url: this.url("/v0/auth/logout"),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Share-Plugin-Version": this.pluginVersion,
        Authorization: `Bearer ${token}`
      },
      body: "{}",
      throw: false
    });
    return this.parse<{ ok: boolean }>(res.status, res.text, false);
  }

  async getShareImportPayload(shareUrl: string, password?: string): Promise<ShareImportSession> {
    const target = parseDocferryShareUrl(shareUrl, this.getSettings().serverUrl);
    if (!target) {
      throw new ShareApiError("Use a share link from this DocFerry service.", 0, "invalid_share_url");
    }
    const { baseUrl, slug } = target;
    const importUrl = `${baseUrl}/s/${encodeURIComponent(slug)}/import`;
    let res = await requestUrl({
      url: importUrl,
      method: "GET",
      throw: false
    });

    let cookieHeader: string | undefined;
    if (res.status === 401 && password) {
      const passwordRes = await requestUrl({
        url: `${baseUrl}/s/${encodeURIComponent(slug)}/password`,
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ password }),
        throw: false
      });
      this.parse<{ ok: boolean }>(passwordRes.status, passwordRes.text);
      cookieHeader = cookieHeaderFrom(passwordRes.headers);
      res = await requestUrl({
        url: importUrl,
        method: "GET",
        headers: cookieHeader ? { Cookie: cookieHeader } : {},
        throw: false
      });
    }

    return {
      payload: this.parse<ShareImportPayloadResponse>(res.status, res.text),
      cookieHeader
    };
  }

  async downloadImportAsset(url: string, cookieHeader?: string): Promise<ArrayBuffer> {
    if (!isSameDocferryOrigin(url, this.getSettings().serverUrl)) {
      throw new ShareApiError("The share included an invalid asset URL.", 0, "invalid_import_asset_url");
    }
    const res = await requestUrl({
      url,
      method: "GET",
      headers: cookieHeader ? { Cookie: cookieHeader } : {},
      throw: false
    });
    if (res.status >= 200 && res.status < 300) return res.arrayBuffer;
    this.parse<never>(res.status, res.text);
    throw new ShareApiError("Asset download failed.", res.status);
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await requestUrl({
      url: this.url(path),
      method: "GET",
      headers: this.headers(false),
      throw: false
    });
    return this.parse<T>(res.status, res.text);
  }

  private async postJson<T>(path: string, body: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
    const res = await requestUrl({
      url: this.url(path),
      method: "POST",
      headers: { ...this.headers(true), ...extraHeaders },
      body: JSON.stringify(body),
      throw: false
    });
    return this.parse<T>(res.status, res.text);
  }

  private async putJson<T>(path: string, body: unknown): Promise<T> {
    const res = await requestUrl({
      url: this.url(path),
      method: "PUT",
      headers: this.headers(true),
      body: JSON.stringify(body),
      throw: false
    });
    return this.parse<T>(res.status, res.text);
  }

  private async deleteJson<T>(path: string): Promise<T> {
    const res = await requestUrl({
      url: this.url(path),
      method: "DELETE",
      headers: this.headers(false),
      throw: false
    });
    return this.parse<T>(res.status, res.text);
  }

  private url(path: string): string {
    const base = this.getSettings().serverUrl.replace(/\/+$/, "");
    return `${base}${path}`;
  }

  private headers(json: boolean): Record<string, string> {
    const settings = this.getSettings();
    const headers: Record<string, string> = {
      "X-Share-Plugin-Version": this.pluginVersion
    };
    if (json) headers["Content-Type"] = "application/json";
    const token = settings.sessionToken;
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  private parse<T>(status: number, text: string, notifyInvalidSession = true): T {
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }

    if (status >= 200 && status < 300) return parsed as T;

    const envelope = parsed as ErrorEnvelope | undefined;
    const message = envelope?.error?.message || text || `Request failed with ${status}`;
    const error = new ShareApiError(
      message,
      status,
      envelope?.error?.code,
      envelope?.error?.request_id,
      envelope?.error?.details
    );
    if (notifyInvalidSession && isInvalidProductSessionError(error)) this.onInvalidSession?.(error);
    throw error;
  }
}

function safeHeaderValue(value: string): string {
  return encodeURIComponent(value).slice(0, 255);
}

function cookieHeaderFrom(headers: Record<string, string>): string | undefined {
  const value = headers["set-cookie"] || headers["Set-Cookie"];
  if (!value) return undefined;
  const firstCookie = String(value).split(",", 1)[0]?.split(";", 1)[0]?.trim();
  return firstCookie || undefined;
}
