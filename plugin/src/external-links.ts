import { shell } from "electron";
import { Notice } from "obsidian";

/**
 * Opens a secure external URL in the system browser. Resolves true when the
 * browser accepted the handoff; on failure shows a notice and resolves false
 * so callers can keep pre-handoff state intact.
 */
export async function openExternalUrl(value: string): Promise<boolean> {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      new Notice("DocFerry only opens secure HTTPS links.");
      return false;
    }
    await shell.openExternal(url.toString());
    return true;
  } catch {
    new Notice("DocFerry could not open your system browser.");
    return false;
  }
}
