import * as Obsidian from "obsidian";

type ObsidianRuntime = typeof Obsidian & {
  openExternal?: (url: string) => void;
};

export function openExternalUrl(value: string): void {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only secure web links can be opened externally.");
  }

  const runtime = Obsidian as ObsidianRuntime;
  if (typeof runtime.openExternal === "function") {
    runtime.openExternal(url.toString());
    return;
  }

  window.open(url.toString(), "_blank", "noopener");
}
