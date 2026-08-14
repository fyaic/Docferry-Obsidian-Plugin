import type { MembershipSnapshot } from "./settings";

export type FolderShareAccess = "allowed" | "limit_reached" | "upgrade_required";

export function folderShareAccess(
  membership: MembershipSnapshot | null | undefined,
  hasExistingShare: boolean
): FolderShareAccess {
  if (!membership || membership.activeFolderShareLimit === 0) return "upgrade_required";
  if (!hasExistingShare && !membership.canCreateFolderShare) return "limit_reached";
  return "allowed";
}
