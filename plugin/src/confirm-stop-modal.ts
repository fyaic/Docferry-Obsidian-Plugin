import { App, Modal } from "obsidian";
import { renderDocferryHeader } from "./brand";

export function confirmStopShare(app: App, title: string, sourcePath?: string | null): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmStopShareModal(app, title, sourcePath || "", resolve).open();
  });
}

class ConfirmStopShareModal extends Modal {
  private done = false;

  constructor(
    app: App,
    private readonly title: string,
    private readonly sourcePath: string,
    private readonly resolve: (confirmed: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    renderDocferryHeader(contentEl, "Stop sharing?", "The public DocFerry link will stop opening this note.");
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
    buttons.createEl("button", { text: "Keep share" }).addEventListener("click", () => {
      this.finish(false);
    });
    buttons.createEl("button", { text: "Stop sharing", cls: "mod-warning" }).addEventListener("click", () => {
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
