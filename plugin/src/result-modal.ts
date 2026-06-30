import { App, Modal, Notice, Setting } from "obsidian";
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
    renderDocferryHeader(contentEl, "Share link ready", "This URL opens only the published document.");
    contentEl.createEl("p", { text: this.title, cls: "setting-item-description" });

    new Setting(contentEl)
      .setName("URL")
      .setDesc(this.url)
      .addButton((button) =>
        button.setButtonText("Copy").onClick(async () => {
          await navigator.clipboard.writeText(this.url);
          new Notice("Link copied");
        })
      )
      .addButton((button) =>
        button.setButtonText("Open").onClick(() => {
          window.open(this.url);
        })
      );

    new Setting(contentEl).setName("Updated").setDesc(this.updatedAt);

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Done", cls: "mod-cta" }).addEventListener("click", () => {
      this.close();
    });
  }
}
