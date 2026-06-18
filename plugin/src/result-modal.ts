import { App, Modal, Notice, Setting } from "obsidian";
import { renderDocferryHeader } from "./brand";
import type { Translate } from "./i18n";

export class ResultModal extends Modal {
  constructor(
    app: App,
    private readonly title: string,
    private readonly url: string,
    private readonly updatedAt: string,
    private readonly t: Translate
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    renderDocferryHeader(contentEl, this.t("modal.result.title"), this.t("modal.result.description"));
    contentEl.createEl("p", { text: this.title, cls: "setting-item-description" });

    new Setting(contentEl)
      .setName(this.t("modal.result.url"))
      .setDesc(this.url)
      .addButton((button) => {
        button.setButtonText(this.t("modal.result.copy")).onClick(async () => {
          await navigator.clipboard.writeText(this.url);
          new Notice(this.t("modal.result.linkCopied"));
        });
      })
      .addButton((button) => {
        button.setButtonText(this.t("modal.result.open")).onClick(() => {
          window.open(this.url);
        });
      });

    new Setting(contentEl).setName(this.t("modal.result.updated")).setDesc(this.updatedAt);

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: this.t("modal.result.done"), cls: "mod-cta" }).addEventListener("click", () => {
      this.close();
    });
  }
}
