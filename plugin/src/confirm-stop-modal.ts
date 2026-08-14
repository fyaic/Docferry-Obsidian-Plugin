import { App, Modal } from "obsidian";
import { renderDocferryHeader } from "./brand";

export function confirmStopShare(app: App, title: string, sourcePath?: string | null): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmShareActionModal(
      app,
      "Stop sharing?",
      "The public DocFerry link will stop opening this content.",
      "Keep share",
      "Stop sharing",
      title,
      sourcePath || "",
      resolve
    ).open();
  });
}

export function confirmDeleteShareHistory(app: App, title: string, sourcePath?: string | null): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmShareActionModal(
      app,
      "Delete share history?",
      "This removes the stopped record from DocFerry. The source file in your vault is not deleted.",
      "Keep history",
      "Delete history",
      title,
      sourcePath || "",
      resolve
    ).open();
  });
}

class ConfirmShareActionModal extends Modal {
  private done = false;

  constructor(
    app: App,
    private readonly heading: string,
    private readonly description: string,
    private readonly cancelLabel: string,
    private readonly confirmLabel: string,
    private readonly title: string,
    private readonly sourcePath: string,
    private readonly resolve: (confirmed: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    renderDocferryHeader(contentEl, this.heading, this.description);
    contentEl.createEl("p", {
      text: this.title,
      cls: "setting-item-description"
    });
    if (this.sourcePath) {
      contentEl.createEl("p", {
        text: this.sourcePath,
        cls: "setting-item-description"
      });
    }

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: this.cancelLabel }).addEventListener("click", () => {
      this.finish(false);
    });
    buttons.createEl("button", { text: this.confirmLabel, cls: "mod-warning" }).addEventListener("click", () => {
      this.finish(true);
    });
  }

  onClose(): void {
    if (!this.done) this.finish(false);
  }

  private finish(confirmed: boolean): void {
    if (this.done) return;
    this.done = true;
    this.resolve(confirmed);
    this.close();
  }
}
