export type ExternalLinkProvider =
  | "youtube"
  | "tiktok"
  | "bilibili"
  | "douyin"
  | "wechat"
  | "vimeo"
  | "audio"
  | "video"
  | "web";

export interface ExternalLinkNote {
  url: URL;
  provider: ExternalLinkProvider;
  title: string;
  markdown: string;
}

const PROVIDER_LABELS: Record<ExternalLinkProvider, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  bilibili: "Bilibili",
  douyin: "Douyin",
  wechat: "WeChat",
  vimeo: "Vimeo",
  audio: "Audio",
  video: "Video",
  web: "Web"
};

export function validatedExternalImportUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid web URL.");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error("Only public http or https links can be imported.");
  }
  return parsed;
}

export function externalLinkProvider(url: URL): ExternalLinkProvider {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be" || isHostOrSubdomain(host, "youtube.com")) return "youtube";
  if (isHostOrSubdomain(host, "tiktok.com")) return "tiktok";
  if (host === "b23.tv" || isHostOrSubdomain(host, "bilibili.com")) return "bilibili";
  if (isHostOrSubdomain(host, "douyin.com")) return "douyin";
  if (host === "mp.weixin.qq.com") return "wechat";
  if (isHostOrSubdomain(host, "vimeo.com")) return "vimeo";
  if (/\.(mp3|m4a|wav|ogg)$/i.test(url.pathname)) return "audio";
  if (/\.(mp4|webm|mov)$/i.test(url.pathname)) return "video";
  return "web";
}

export function externalLinkProviderLabel(provider: ExternalLinkProvider): string {
  return PROVIDER_LABELS[provider];
}

export function externalLinkTitle(url: URL, provider: ExternalLinkProvider): string {
  const pathPart = url.pathname.split("/").filter(Boolean).pop();
  const videoId = provider === "youtube" ? url.searchParams.get("v") || pathPart : pathPart;
  const detail = safeTitleDetail(safeDecodeURIComponent(videoId || url.hostname.replace(/^www\./, "")));
  return `${externalLinkProviderLabel(provider)} - ${detail}`;
}

export function buildExternalLinkNote(value: string, importedAt = new Date().toISOString()): ExternalLinkNote {
  const url = validatedExternalImportUrl(value);
  const provider = externalLinkProvider(url);
  const title = externalLinkTitle(url, provider);
  const markdown = [
    "---",
    "docferry_import:",
    "  type: link",
    `  source_url: ${JSON.stringify(url.href)}`,
    `  provider: ${provider}`,
    `  imported_at: ${JSON.stringify(importedAt)}`,
    "  parse_status: link_only",
    "---",
    "",
    `# ${title}`,
    "",
    `[Open original link](<${url.href}>)`,
    ""
  ].join("\n");
  return { url, provider, title, markdown };
}

function isHostOrSubdomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function safeTitleDetail(value: string): string {
  const sanitized = replaceControlCharacters(value, "-")
    .replace(/[\\/:*?"<>|#[\]^]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^-+|-+$/g, "")
    .trim()
    .slice(0, 120)
    .trim();
  return sanitized || "link";
}

function replaceControlCharacters(value: string, replacement: string): string {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? replacement : character;
  }).join("");
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
