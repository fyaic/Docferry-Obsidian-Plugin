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
    vault_name?: string;
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

export interface ShareListItemResponse {
  share_id: string;
  slug: string;
  url: string;
  vault_id?: string | null;
  vault_name?: string | null;
  source_path: string;
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
  shares: ShareListItemResponse[];
  total: number;
  limit: number;
  offset: number;
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
  auth_profile?: string | null;
  login_url: string;
  callback_protocol: string;
  callback_url?: string | null;
  product_key?: string | null;
  synapsehub_base_url?: string | null;
  auth_config_url?: string | null;
  distribution_bundle_url?: string | null;
  account_center_url?: string | null;
  billing?: BillingConfig | null;
}

export interface AuthExchangeResponse {
  access_token: string;
  token_type?: string;
  refresh_token?: string | null;
  expires_at?: string | null;
  expires_in?: number;
  product_subject_id?: string;
  product_key?: string;
  product_instance_id?: string | null;
  display_user?: DisplayUser | null;
}

export interface AuthWhoamiResponse {
  authenticated: boolean;
  auth_type: string;
  owner_id: string;
  product_subject_id?: string | null;
  product_key?: string | null;
  product_instance_id?: string | null;
  scopes: string[];
  expires_at?: string | null;
  display_user?: DisplayUser | null;
}

export interface DashboardLinkResponse {
  dashboard_url: string;
}

export interface DisplayUser {
  email?: string | null;
  name?: string | null;
  picture?: string | null;
}

export interface BillingPlan {
  plan_key: string;
  display_name: string;
  entitlement_key: string;
  amount_minor_units: number;
  currency: string;
  billing_interval: string;
  test_only?: boolean;
  capabilities: string[];
}

export interface BillingConfig {
  enabled: boolean;
  provider: string;
  default_plan_key: string;
  plans: BillingPlan[];
  redirect_origin?: string | null;
  checkout_endpoint: string;
  portal_endpoint: string;
  membership_endpoint: string;
}

export interface MembershipResponse {
  authenticated: boolean;
  product_key: string;
  product_subject_id: string;
  source: string;
  plan_key: string;
  plan_display_name: string;
  entitlement_key?: string | null;
  active_share_count: number;
  active_share_limit: number;
  max_single_file_size_bytes: number;
  can_create_share: boolean;
  limit_source: string;
  entitlements: Array<{ key: string; status: string; expires_at?: string | null }>;
  capabilities: Array<{ key: string; status: string; source_entitlement_key: string }>;
  feature_gates: Record<string, boolean>;
  cache: { status: string; ttl_seconds: number };
  billing: BillingConfig;
  unavailable_reason?: string | null;
}

export interface AccessRequestResponse {
  request_id: string;
  status: "received";
  message: string;
}

export interface BillingCheckoutSessionResponse {
  redirect_url: string;
  checkout_session: {
    product_key?: string | null;
    plan_key?: string | null;
    entitlement_key?: string | null;
    status?: string | null;
    expires_at?: string | null;
  };
}

export interface BillingPortalSessionResponse {
  redirect_url: string;
  customer_portal_session: {
    product_key?: string | null;
  };
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
