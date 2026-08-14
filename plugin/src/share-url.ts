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
