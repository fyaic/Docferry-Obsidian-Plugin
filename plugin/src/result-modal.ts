import { App, Modal, Notice, setIcon } from "obsidian";
import { renderDocferryHeader } from "./brand";

export class ResultModal extends Modal {
  constructor(
    app: App,
    private readonly title: string,
    private readonly url: string,
    private readonly updatedAt: string
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("docferry-result-modal");

    renderDocferryHeader(contentEl, "Share link ready", "Your published document is ready to open or copy.");

    const card = contentEl.createDiv({ cls: "docferry-result-card" });
    const titleBlock = card.createDiv({ cls: "docferry-result-title-block" });
    titleBlock.createSpan({ text: "Published note", cls: "docferry-result-label" });
    titleBlock.createDiv({ text: this.title, cls: "docferry-heading docferry-heading-3 docferry-result-title" });

    const linkBlock = card.createDiv({ cls: "docferry-result-link" });
    linkBlock.createSpan({ text: "Share URL", cls: "docferry-result-label" });
    linkBlock.createEl("code", { text: this.url });

    const meta = card.createDiv({ cls: "docferry-result-meta" });
    meta.createSpan({ text: "Updated" });
    meta.createSpan({ text: this.updatedAt });

    const buttons = contentEl.createDiv({ cls: "docferry-result-actions modal-button-container" });
    const copyButton = buttons.createEl("button", { cls: "mod-cta", attr: { type: "button" } });
    appendButtonLabel(copyButton, "copy", "Copy link");
    copyButton.addEventListener("click", () => {
      void this.copyLink();
    });

    const openButton = buttons.createEl("button", { attr: { type: "button" } });
    appendButtonLabel(openButton, "external-link", "Open");
    openButton.addEventListener("click", () => {
      window.open(this.url);
    });

    const doneButton = buttons.createEl("button", { attr: { type: "button" } });
    appendButtonLabel(doneButton, "check", "Done");
    doneButton.addEventListener("click", () => {
      this.close();
    });
  }

  private async copyLink(): Promise<void> {
    await navigator.clipboard.writeText(this.url);
    new Notice("Link copied");
  }
}

function appendButtonLabel(button: HTMLElement, iconName: string, label: string): void {
  const icon = button.createSpan({ cls: "docferry-button-icon", attr: { "aria-hidden": "true" } });
  setIcon(icon, iconName);
  button.createSpan({ text: label });
}
