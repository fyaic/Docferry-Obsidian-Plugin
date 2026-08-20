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
  localVaultId: string
): "update" | "claim" | "wrong-vault" {
  if (!shareVaultId) return "claim";
  return shareVaultId === localVaultId ? "update" : "wrong-vault";
}

// Legacy CLI shares stored the source path as an absolute path inside the
// originating vault; strip that prefix so the path resolves vault-relative.
export function vaultRelativeShareSourcePath(sourcePath: string, vaultBasePath: string): string {
  const prefix = `${vaultBasePath}/`;
  return sourcePath.startsWith(prefix) ? sourcePath.slice(prefix.length) : sourcePath;
}
