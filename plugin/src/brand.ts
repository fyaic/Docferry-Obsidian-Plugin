import logo128Base64 from "../logo-128.base64";

export const DOCFERRY_PRODUCT_NAME = "DocFerry";
export const DOCFERRY_PRODUCT_DESCRIPTION = "Secure single-note sharing for Obsidian.";
export const DOCFERRY_LOGO_128_DATA_URI = `data:image/png;base64,${logo128Base64.trim()}`;

export function appendDocferryLogo(containerEl: HTMLElement, className = "docferry-plugin-logo"): HTMLElement {
  const frame = containerEl.createDiv({ cls: className });
  frame.createEl("img", {
    attr: {
      alt: "",
      src: DOCFERRY_LOGO_128_DATA_URI,
      decoding: "async",
      loading: "lazy"
    }
  });
  return frame;
}

export function renderDocferryHeader(containerEl: HTMLElement, title: string, description?: string): void {
  const header = containerEl.createDiv({ cls: "docferry-plugin-header" });
  appendDocferryLogo(header, "docferry-plugin-logo").setAttr("aria-hidden", "true");

  const copy = header.createDiv({ cls: "docferry-plugin-header-copy" });
  copy.createDiv({ text: title, cls: "docferry-heading docferry-heading-2" });
  if (description) {
    copy.createEl("p", { text: description });
  }
}
