import type { ShareStatus } from "./types";

export function hasActiveShareLink(status: ShareStatus): boolean {
  return status === "published" || status === "password_protected";
}

export function shareListSummary(statuses: readonly ShareStatus[]): string {
  const liveCount = statuses.filter(hasActiveShareLink).length;
  const pastCount = statuses.length - liveCount;
  const parts: string[] = [];

  if (liveCount) parts.push(`${liveCount} live ${liveCount === 1 ? "share" : "shares"}`);
  if (pastCount) parts.push(`${pastCount} past ${pastCount === 1 ? "share" : "shares"}`);

  return parts.length ? `${parts.join(", ")}.` : "No shares yet.";
}

// Vault gate for updating an existing share from the share list. A share whose
// vault_id was never reported (CLI/agent-kit created shares) may be claimed by
// the vault that owns the source note; a reported mismatch stays rejected.
export function resolveShareUpdateVaultGate(
  shareVaultId: string | null | undefined,
  localVaultId: string,
  acceptedAliases: readonly string[] = []
): "update" | "claim" | "migrate" | "wrong-vault" {
  if (!shareVaultId) return "claim";
  if (shareVaultId === localVaultId) return "update";
  return acceptedAliases.includes(shareVaultId) ? "migrate" : "wrong-vault";
}

export function expectedVaultIdForClaim(
  gate: "update" | "claim" | "migrate",
  shareVaultId: string | null | undefined
): string | null | undefined {
  if (gate === "claim") return null;
  if (gate === "migrate") return shareVaultId || null;
  return undefined;
}

// Legacy CLI shares stored the source path as an absolute path inside the
// originating vault; strip that prefix so the path resolves vault-relative.
export function vaultRelativeShareSourcePath(
  sourcePath: string,
  vaultBasePath: string,
  caseInsensitive = false
): string {
  const normalizedSourcePath = sourcePath.replace(/\\/g, "/").normalize("NFC");
  const normalizedVaultBasePath = vaultBasePath.replace(/\\/g, "/").replace(/\/+$/, "").normalize("NFC");
  if (!normalizedVaultBasePath) return sourcePath;
  const prefix = `${normalizedVaultBasePath}/`;
  const sourceForComparison = caseInsensitive ? normalizedSourcePath.toLocaleLowerCase("en-US") : normalizedSourcePath;
  const prefixForComparison = caseInsensitive ? prefix.toLocaleLowerCase("en-US") : prefix;
  return sourceForComparison.startsWith(prefixForComparison) ? normalizedSourcePath.slice(prefix.length) : sourcePath;
}

export function sharePathsEqual(left: string, right: string, caseInsensitive: boolean): boolean {
  const normalize = (value: string): string => {
    const path = value.replace(/\\/g, "/").normalize("NFC");
    return caseInsensitive ? path.toLocaleLowerCase("en-US") : path;
  };
  return normalize(left) === normalize(right);
}

export function resolveRememberedSharePathGate(
  rememberedSourcePath: string,
  currentSourcePath: string,
  localPathsWithShareId: readonly string[],
  caseInsensitive = false
): "update" | "move" | "ambiguous" {
  const uniquePaths = new Set(
    localPathsWithShareId.map((path) => {
      const normalized = path.replace(/\\/g, "/").normalize("NFC");
      return caseInsensitive ? normalized.toLocaleLowerCase("en-US") : normalized;
    })
  );
  if (uniquePaths.size > 1) return "ambiguous";
  return sharePathsEqual(rememberedSourcePath, currentSourcePath, caseInsensitive) ? "update" : "move";
}

interface FolderShareIdentity {
  vault_id?: string | null;
  source_folder: string;
  status: ShareStatus;
}

export function selectExistingFolderShare<T extends FolderShareIdentity>(
  selectedShare: T | undefined,
  candidates: readonly T[],
  sourceFolder: string,
  acceptedVaultIds: ReadonlySet<string>,
  caseInsensitive = false,
  sourceAliases: readonly string[] = []
): T | null | undefined {
  if (selectedShare) return selectedShare;
  const matches = candidates.filter((item) =>
    (item.vault_id
      ? acceptedVaultIds.has(item.vault_id) && sharePathsEqual(item.source_folder, sourceFolder, caseInsensitive)
      : sourceAliases.some((alias) => sharePathsEqual(item.source_folder, alias, caseInsensitive))) &&
    item.status !== "stopped" &&
    item.status !== "expired"
  );
  const canonical = matches.filter((item) => Boolean(item.vault_id && acceptedVaultIds.has(item.vault_id)));
  if (canonical.length === 1) return canonical[0];
  if (canonical.length > 1 || matches.length > 1) return null;
  return matches[0];
}

export function sourcePathMatchesAliases(
  sourcePath: string,
  aliases: readonly string[],
  caseInsensitive = false
): boolean {
  return aliases.some((alias) => sharePathsEqual(sourcePath, alias, caseInsensitive));
}

// A pre-vault CLI/MCP Share may store the vault-relative source path. This
// fallback is only for an owner-selected Share followed by an explicit claim
// confirmation; automatic source discovery must continue to use physical
// aliases so two vaults with the same relative path cannot claim each other.
export function explicitClaimSourceMatches(
  rememberedSourcePath: string,
  currentVaultRelativePath: string,
  physicalAliases: readonly string[],
  caseInsensitive = false
): boolean {
  return sharePathsEqual(rememberedSourcePath, currentVaultRelativePath, caseInsensitive)
    || sourcePathMatchesAliases(rememberedSourcePath, physicalAliases, caseInsensitive);
}

interface NoteShareIdentity {
  vault_id?: string | null;
  source_path: string;
  status: ShareStatus;
}

export function selectExistingNoteShare<T extends NoteShareIdentity>(
  candidates: readonly T[],
  sourcePath: string,
  acceptedVaultIds: ReadonlySet<string>,
  sourcePathInVault: (candidate: T) => string,
  caseInsensitive = false
): T | null | undefined {
  const matches = candidates.filter((item) =>
    (!item.vault_id || acceptedVaultIds.has(item.vault_id)) &&
    sharePathsEqual(sourcePathInVault(item), sourcePath, caseInsensitive) &&
    item.status !== "stopped" &&
    item.status !== "expired"
  );
  const canonical = matches.filter((item) => Boolean(item.vault_id && acceptedVaultIds.has(item.vault_id)));
  if (canonical.length === 1) return canonical[0];
  if (canonical.length > 1 || matches.length > 1) return null;
  return matches[0];
}

export async function continueShareUpdate(
  gate: "update" | "claim" | "migrate",
  confirmClaim: () => Promise<boolean>,
  update: () => Promise<void>
): Promise<boolean> {
  if (gate !== "update" && !(await confirmClaim())) return false;
  await update();
  return true;
}
