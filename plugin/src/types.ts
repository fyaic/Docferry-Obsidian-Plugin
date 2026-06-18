export interface ShareMeta {
  id?: string;
  url?: string;
  updated?: string;
  passwordEnabled?: boolean;
  expires?: string | null;
}

export interface PublishOptions {
  title: string;
  passwordEnabled: boolean;
  password?: string;
  expiresAt?: string | null;
}

export interface SharePayload {
  vault_id: string | null;
  source_path: string;
  source_path_normalized: string | null;
  doc_identity: string | null;
  source_hash: string;
  title: string;
  markdown: string;
  html_snapshot: string | null;
  css_asset_id: string | null;
  assets: Array<{
    asset_id: string;
    role: string;
    original_path?: string;
  }>;
  outbound_links: Array<{
    raw_target: string;
    target_path?: string | null;
    target_doc_identity?: string | null;
    target_subpath?: string | null;
    label?: string | null;
    link_kind: "wiki" | "markdown_relative" | "embed";
  }>;
  password?: string;
  password_mode?: "keep" | "set" | "clear";
  expires_at: string | null;
  client: {
    plugin_id: string;
    plugin_version: string;
    obsidian_version: string;
  };
}

export interface AssetResponse {
  asset_id: string;
  hash: string;
  content_type: string;
  byte_length: number;
  url?: string | null;
}

export interface AssetUploadIntentResponse {
  mode: "already_uploaded" | "api_proxy" | "tencent_cos";
  asset_id?: string | null;
  asset?: AssetResponse | null;
  storage_key?: string | null;
  upload?: {
    provider: "tencent_cos";
    bucket: string;
    region: string;
    key: string;
    slice_size: number;
    credentials: {
      tmp_secret_id: string;
      tmp_secret_key: string;
      session_token: string;
      start_time: number;
      expired_time: number;
    };
    headers?: Record<string, string>;
  } | null;
  fallback_url?: string | null;
  expires_at?: string | null;
}

export interface ShareResponse {
  share_id: string;
  slug: string;
  url: string;
  status: ShareStatus;
  password_enabled: boolean;
  expires_at?: string | null;
  created_at?: string;
  updated_at: string;
}

export type ShareStatus = "published" | "password_protected" | "expired" | "stopped";

export interface ShareStatusResponse {
  share_id: string;
  slug: string;
  url: string;
  source_path: string;
  source_hash: string;
  title: string;
  status: ShareStatus;
  password_enabled: boolean;
  expires_at?: string | null;
  stopped_at?: string | null;
  created_at: string;
  updated_at: string;
  last_published_at: string;
}

export interface ShareListResponse {
  shares: ShareStatusResponse[];
}

export interface ShareLinkStatusResponse {
  link_id: string;
  raw_target: string;
  target_path?: string | null;
  target_subpath?: string | null;
  label?: string | null;
  link_kind: string;
  status: "resolved" | "unpublished" | "ambiguous" | "unsupported";
  target_share_id?: string | null;
  target_url?: string | null;
}

export interface ShareLinksResponse {
  share_id: string;
  slug: string;
  links: ShareLinkStatusResponse[];
}

export interface DeleteShareResponse {
  share_id: string;
  stopped_at: string;
}

export interface AuthConfig {
  provider: string;
  login_url: string;
  callback_protocol: string;
}

export interface AuthExchangeResponse {
  access_token: string;
  refresh_token?: string | null;
  expires_at?: string | null;
}

export interface ShareImportAsset {
  asset_id: string;
  role: string;
  original_path?: string | null;
  filename: string;
  content_type: string;
  byte_length: number;
  url: string;
}

export interface ShareImportPayloadResponse {
  slug: string;
  title: string;
  markdown: string;
  source_hash: string;
  assets: ShareImportAsset[];
  updated_at: string;
}
