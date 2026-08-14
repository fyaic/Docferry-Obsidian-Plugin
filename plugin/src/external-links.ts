import { shell } from "electron";
import { Notice } from "obsidian";

export function openExternalUrl(value: string): void {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("Only secure web links can be opened externally.");
  }

  void shell.openExternal(url.toString()).catch(() => {
    new Notice("DocFerry could not open your system browser.");
  });
}
