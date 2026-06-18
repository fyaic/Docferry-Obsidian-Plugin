import docferryLogoUrl from "./assets/docferry-logo.png";

export const DOCFERRY_PRODUCT_NAME = "DocFerry";
export const DOCFERRY_PRODUCT_DESCRIPTION = "Secure single-note sharing for Obsidian.";
export const DOCFERRY_WEBSITE_URL = "https://bondie.io/research/docferry";

export function renderDocferryHeader(containerEl: HTMLElement, title: string, description?: string): HTMLElement {
  const header = containerEl.createDiv({ cls: "docferry-plugin-header" });
  const logo = header.createDiv({ cls: "docferry-plugin-logo", attr: { "aria-hidden": "true" } });
  logo.createEl("img", { attr: { alt: "", src: docferryLogoUrl } });

  const copy = header.createDiv({ cls: "docferry-plugin-header-copy" });
  copy.createEl("h2", { text: title });
  if (description) {
    copy.createEl("p", { text: description });
  }
  return header;
}
