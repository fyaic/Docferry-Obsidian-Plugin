export interface DocferryShareTarget {
  baseUrl: string;
  slug: string;
}

export function parseDocferryShareUrl(value: unknown, serviceUrl: unknown): DocferryShareTarget | null {
  const raw = typeof value === "string" ? value.trim() : "";
  const serviceRaw = typeof serviceUrl === "string" ? serviceUrl.trim() : "";
  try {
    const parsed = new URL(raw);
    const service = new URL(serviceRaw);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== service.origin) return null;
    if (parsed.username || parsed.password || parts.length !== 2 || parts[0] !== "s" || !parts[1]) return null;
    return { baseUrl: parsed.origin, slug: parts[1] };
  } catch {
    return null;
  }
}

export function isSameDocferryOrigin(value: unknown, serviceUrl: unknown): boolean {
  const raw = typeof value === "string" ? value.trim() : "";
  const serviceRaw = typeof serviceUrl === "string" ? serviceUrl.trim() : "";
  try {
    const parsed = new URL(raw);
    const service = new URL(serviceRaw);
    return ["http:", "https:"].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password &&
      parsed.origin === service.origin;
  } catch {
    return false;
  }
}

export function shareMetaBelongsToService(
  meta: { id?: string; url?: string },
  serviceUrl: string
): boolean {
  return Boolean(meta.id && meta.url && parseDocferryShareUrl(meta.url, serviceUrl));
}

export interface LegacyShareMeta {
  id: string;
  url: string;
}

/**
 * Returns the stored share reference when it points at a different (legacy)
 * service or is malformed, so the caller can preserve it before overwrite.
 * Returns null when the reference belongs to the current service or is
 * incomplete (nothing worth preserving).
 */
export function legacyShareMetaForService(
  meta: { id?: string; url?: string },
  serviceUrl: string
): LegacyShareMeta | null {
  if (!meta.id || !meta.url) return null;
  if (shareMetaBelongsToService(meta, serviceUrl)) return null;
  return { id: meta.id, url: meta.url };
}

/**
 * Decides which `df_legacy_*` fields to write. The first preserved legacy
 * reference wins: fields already present are never overwritten.
 */
export function legacyFrontmatterFields(
  existing: Record<string, unknown>,
  legacy: LegacyShareMeta
): Record<string, string> {
  const fields: Record<string, string> = {};
  if (typeof existing.df_legacy_id !== "string" || existing.df_legacy_id.length === 0) {
    fields.df_legacy_id = legacy.id;
  }
  if (typeof existing.df_legacy_url !== "string" || existing.df_legacy_url.length === 0) {
    fields.df_legacy_url = legacy.url;
  }
  return fields;
}
