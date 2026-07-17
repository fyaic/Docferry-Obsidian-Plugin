export type VaultPathExists = (path: string) => boolean;

export function resolveVaultDragPath(
  activePath: string | null,
  rawTransferText: string,
  exists: VaultPathExists
): string | null {
  const activeCandidate = normalizeVaultPathCandidate(activePath || "");
  if (activeCandidate && exists(activeCandidate)) return activeCandidate;

  const transferCandidate = normalizeVaultPathCandidate(rawTransferText);
  return transferCandidate && exists(transferCandidate) ? transferCandidate : null;
}

export function normalizeVaultPathCandidate(value: string): string | null {
  const raw = value.trim();
  if (!raw || hasControlCharacters(raw)) return null;

  if (/^obsidian:\/\//i.test(raw)) {
    const fileFromUri = filePathFromObsidianUri(raw);
    if (fileFromUri) return cleanVaultPath(fileFromUri);
    return cleanVaultPath(raw.replace(/^obsidian:\/\//i, ""));
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return null;
  return cleanVaultPath(raw);
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function filePathFromObsidianUri(value: string): string | null {
  try {
    const parsed = new URL(value);
    const file = parsed.searchParams.get("file");
    return file || null;
  } catch {
    return null;
  }
}

function cleanVaultPath(value: string): string | null {
  const cleaned = value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/").trim();
  if (!cleaned || cleaned === "." || cleaned.split("/").some((part) => part === "..")) return null;
  return cleaned;
}
