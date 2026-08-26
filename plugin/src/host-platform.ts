import { Platform } from "obsidian";

export type HostPlatform = "darwin" | "linux" | "win32";

/**
 * Host platform helpers backed by Obsidian's typed Platform API instead of
 * Node's `process.platform`, so the source never depends on @types/node being
 * resolvable (the community review environment does not load it).
 */
export function isWindowsHost(): boolean {
  return Platform.isWin;
}

export function hostPlatform(): HostPlatform {
  if (Platform.isWin) return "win32";
  if (Platform.isMacOS) return "darwin";
  return "linux";
}
