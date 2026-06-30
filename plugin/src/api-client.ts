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
  DeleteShareResponse,
  MembershipResponse,
  SharePayload,
  ShareImportPayloadResponse,
  ShareListResponse,
  ShareLinksResponse,
  ShareResponse,
  ShareStatusResponse
} from "./types";
import type { DocferrySettings } from "./settings";

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
    private readonly pluginVersion: string
  ) {}

  async health(): Promise<{ ok: boolean; service: string; version: string }> {
    return this.getJson("/v0/health");
  }

  async createShare(payload: SharePayload): Promise<ShareResponse> {
    return this.postJson("/v0/shares", payload);
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

  async validateAuthToken(): Promise<void> {
    try {
      await this.getJson("/v0/shares/sh_token_probe");
    } catch (error) {
      if (error instanceof ShareApiError && error.status === 404 && error.code === "share_not_found") {
        return;
      }
      throw error;
    }
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
    } catch (error) {
      console.warn("DocFerry direct asset upload failed, falling back to API proxy.", error);
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

  async exchangeAuthCode(code: string, redirectUri: string, state?: string): Promise<AuthExchangeResponse> {
    return this.postJson("/v0/auth/exchange", {
      code,
      state,
      redirect_uri: redirectUri
    });
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

  async logout(): Promise<{ ok: boolean }> {
    return this.postJson("/v0/auth/logout", {});
  }

  async getShareImportPayload(shareUrl: string, password?: string): Promise<ShareImportSession> {
    const { baseUrl, slug } = parseShareUrl(shareUrl);
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

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await requestUrl({
      url: this.url(path),
      method: "POST",
      headers: this.headers(true),
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
    const token = settings.authMode === "company-sso" ? settings.sessionToken : settings.manualApiToken || settings.apiToken;
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  private parse<T>(status: number, text: string): T {
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
    throw new ShareApiError(
      message,
      status,
      envelope?.error?.code,
      envelope?.error?.request_id,
      envelope?.error?.details
    );
  }
}

function safeHeaderValue(value: string): string {
  return encodeURIComponent(value).slice(0, 255);
}

function parseShareUrl(value: unknown): { baseUrl: string; slug: string } {
  const raw = typeof value === "string" ? value : "";
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new ShareApiError("Share URL must include scheme and host.", 0, "invalid_share_url");
  }
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (!parsed.protocol.startsWith("http") || !parsed.host || parts.length < 2 || parts[0] !== "s") {
    throw new ShareApiError("Share URL must look like https://host/s/{slug}.", 0, "invalid_share_url");
  }
  return {
    baseUrl: `${parsed.protocol}//${parsed.host}`,
    slug: parts[1]
  };
}

function cookieHeaderFrom(headers: Record<string, string>): string | undefined {
  const value = headers["set-cookie"] || headers["Set-Cookie"];
  if (!value) return undefined;
  const firstCookie = String(value).split(",", 1)[0]?.split(";", 1)[0]?.trim();
  return firstCookie || undefined;
}
