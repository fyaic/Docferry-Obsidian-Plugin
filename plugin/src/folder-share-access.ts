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

/**
 * Whether folder-share entry points (file menu, command palette, dashboard
 * drop cue) should be visible. An unknown membership keeps entries visible;
 * the publish flow re-checks access with a fresh snapshot before publishing.
 */
export function canShowFolderShareEntry(
  membership: MembershipSnapshot | null | undefined
): boolean {
  if (!membership) return true;
  return folderShareAccess(membership, false) !== "upgrade_required";
}
