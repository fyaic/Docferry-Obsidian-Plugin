import { App, Modal, Setting } from "obsidian";
import type { Translate } from "./i18n";

export class ConfirmModal extends Modal {
  private resolve!: (confirmed: boolean) => void;
  private resolved = false;

  constructor(
    app: App,
    private readonly titleText: string,
    private readonly t: Translate
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    new Setting(contentEl).setName(this.titleText).setHeading();

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    buttons
      .createEl("button", { text: this.t("modal.confirm.cancel") })
      .addEventListener("click", () => {
        this.confirm(false);
      });
    buttons
      .createEl("button", { text: this.t("modal.confirm.confirm"), cls: "mod-warning" })
      .addEventListener("click", () => {
        this.confirm(true);
      });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.resolve(false);
    }
  }

  openAndConfirm(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }

  private confirm(value: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve(value);
    this.close();
  }
}
