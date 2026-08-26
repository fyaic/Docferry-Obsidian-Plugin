import type { HostPlatform } from "./host-platform";

export type VaultIdentityHasher = (value: string) => Promise<string>;

export function canonicalVaultPath(value: string, platform: HostPlatform): string {
  let normalized = value.replace(/\\/g, "/").replace(/\/+$/, "").normalize("NFC");
  if (platform === "win32") normalized = normalized.toLocaleLowerCase("en-US");
  return normalized;
}

export function canonicalVaultName(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return (segments[segments.length - 1] ?? "").normalize("NFC");
}

export async function buildVaultIdentity(
  rawBasePath: string,
  resolvedBasePath: string,
  previousVaultName: string,
  hash: VaultIdentityHasher,
  platform: HostPlatform
): Promise<{ vaultId: string; legacyVaultIds: string[] }> {
  const canonicalPath = canonicalVaultPath(resolvedBasePath || rawBasePath, platform);
  const canonicalName = canonicalVaultName(canonicalPath) || previousVaultName.normalize("NFC");
  const canonicalSource = `${canonicalName}|${canonicalPath}`;
  const vaultId = `vlt_${(await hash(canonicalSource)).slice(0, 24)}`;

  const legacySources = new Set<string>([
    `vlt:${previousVaultName}|${rawBasePath}`,
    `vlt:${previousVaultName}|${resolvedBasePath}`,
    `workspace:${rawBasePath}`,
    `workspace:${resolvedBasePath}`,
    `workspace:${canonicalPath}`
  ]);
  const legacyVaultIds: string[] = [];
  for (const source of legacySources) {
    const separator = source.indexOf(":");
    const kind = source.slice(0, separator);
    const value = source.slice(separator + 1);
    if (!value) continue;
    const candidate = `${kind}_${(await hash(value)).slice(0, 24)}`;
    if (candidate !== vaultId && !legacyVaultIds.includes(candidate)) legacyVaultIds.push(candidate);
  }
  return { vaultId, legacyVaultIds };
}

export function buildVaultSourceAliases(
  rawBasePath: string,
  resolvedBasePath: string,
  relativePath: string,
  resolvedSourcePath = ""
): string[] {
  const relative = relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").normalize("NFC");
  if (relative.split("/").includes("..")) return [];
  const join = (base: string): string => {
    const normalizedBase = base.replace(/\\/g, "/").replace(/\/+$/, "").normalize("NFC");
    return relative && relative !== "." ? `${normalizedBase}/${relative}` : normalizedBase;
  };
  const aliases = [rawBasePath, resolvedBasePath].filter(Boolean).map(join);
  if (resolvedSourcePath) {
    const normalizedSource = resolvedSourcePath.replace(/\\/g, "/").normalize("NFC");
    const normalizedRoot = resolvedBasePath.replace(/\\/g, "/").replace(/\/+$/, "").normalize("NFC");
    if (normalizedSource === normalizedRoot || normalizedSource.startsWith(`${normalizedRoot}/`)) {
      aliases.push(normalizedSource);
    }
  }
  return [...new Set(aliases)];
}
