import { App, TFile } from "obsidian";
import type { ShareMeta, ShareResponse } from "./types";

const FIELD_ID = "df_id";
const FIELD_URL = "df_url";
const FIELD_UPDATED = "df_updated";
const FIELD_PASSWORD_ENABLED = "df_protected";
const FIELD_EXPIRES = "df_expires";

const DOCFERRY_LEGACY_FIELDS = {
  id: "docferry_share_id",
  url: "docferry_share_url",
  updated: "docferry_share_updated",
  passwordEnabled: "docferry_share_password_enabled",
  expires: "docferry_share_expires"
} as const;

export function readShareMeta(app: App, file: TFile): ShareMeta {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!frontmatter) return {};

  return {
    id: readString(frontmatter[FIELD_ID]) ?? readString(frontmatter[DOCFERRY_LEGACY_FIELDS.id]),
    url: readString(frontmatter[FIELD_URL]) ?? readString(frontmatter[DOCFERRY_LEGACY_FIELDS.url]),
    updated:
      readString(frontmatter[FIELD_UPDATED]) ??
      readString(frontmatter[DOCFERRY_LEGACY_FIELDS.updated]),
    passwordEnabled:
      readBoolean(frontmatter[FIELD_PASSWORD_ENABLED]) ??
      readBoolean(frontmatter[DOCFERRY_LEGACY_FIELDS.passwordEnabled]),
    expires:
      readString(frontmatter[FIELD_EXPIRES]) ??
      readString(frontmatter[DOCFERRY_LEGACY_FIELDS.expires]) ??
      null
  };
}

export async function writeShareMeta(
  app: App,
  file: TFile,
  response: ShareResponse,
  options: { passwordEnabled: boolean; expiresAt?: string | null }
): Promise<void> {
  await app.fileManager.processFrontMatter(file, (raw) => {
    const frontmatter = asFrontmatter(raw);
    frontmatter[FIELD_ID] = response.share_id;
    frontmatter[FIELD_URL] = response.url;
    frontmatter[FIELD_UPDATED] = response.updated_at;
    frontmatter[FIELD_PASSWORD_ENABLED] = options.passwordEnabled;
    frontmatter[FIELD_EXPIRES] = options.expiresAt ?? null;
    deleteLegacyFields(frontmatter);
  });
}

export async function clearShareMeta(app: App, file: TFile): Promise<void> {
  await app.fileManager.processFrontMatter(file, (raw) => {
    const frontmatter = asFrontmatter(raw);
    delete frontmatter[FIELD_ID];
    delete frontmatter[FIELD_URL];
    delete frontmatter[FIELD_UPDATED];
    delete frontmatter[FIELD_PASSWORD_ENABLED];
    delete frontmatter[FIELD_EXPIRES];
    deleteLegacyFields(frontmatter);
  });
}

function deleteLegacyFields(frontmatter: Record<string, unknown>): void {
  delete frontmatter[DOCFERRY_LEGACY_FIELDS.id];
  delete frontmatter[DOCFERRY_LEGACY_FIELDS.url];
  delete frontmatter[DOCFERRY_LEGACY_FIELDS.updated];
  delete frontmatter[DOCFERRY_LEGACY_FIELDS.passwordEnabled];
  delete frontmatter[DOCFERRY_LEGACY_FIELDS.expires];
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asFrontmatter(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
