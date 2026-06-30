import { App, TFile } from "obsidian";
import type { ShareMeta, ShareResponse } from "./types";

const FIELD_ID = "df_id";
const FIELD_URL = "df_url";
const FIELD_UPDATED = "df_updated";
const FIELD_PASSWORD_ENABLED = "df_protected";
const FIELD_EXPIRES = "df_expires";

export function readShareMeta(app: App, file: TFile): ShareMeta {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!frontmatter) return {};

  return {
    id: readString(frontmatter[FIELD_ID]),
    url: readString(frontmatter[FIELD_URL]),
    updated: readString(frontmatter[FIELD_UPDATED]),
    passwordEnabled: readBoolean(frontmatter[FIELD_PASSWORD_ENABLED]),
    expires: readString(frontmatter[FIELD_EXPIRES]) ?? null
  };
}

export async function writeShareMeta(
  app: App,
  file: TFile,
  response: ShareResponse,
  options: { passwordEnabled: boolean; expiresAt?: string | null }
): Promise<void> {
  await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
    frontmatter[FIELD_ID] = response.share_id;
    frontmatter[FIELD_URL] = response.url;
    frontmatter[FIELD_UPDATED] = response.updated_at;
    frontmatter[FIELD_PASSWORD_ENABLED] = options.passwordEnabled;
    frontmatter[FIELD_EXPIRES] = options.expiresAt ?? null;
  });
}

export async function clearShareMeta(app: App, file: TFile): Promise<void> {
  await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
    delete frontmatter[FIELD_ID];
    delete frontmatter[FIELD_URL];
    delete frontmatter[FIELD_UPDATED];
    delete frontmatter[FIELD_PASSWORD_ENABLED];
    delete frontmatter[FIELD_EXPIRES];
  });
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
