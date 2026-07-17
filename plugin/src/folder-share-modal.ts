import { App, Modal, Notice, Setting } from "obsidian";
import { renderDocferryHeader } from "./brand";
import type { PublishOptions } from "./types";

export class FolderShareModal extends Modal {
  private resolver!: (value: PublishOptions | null) => void;
  private done = false;
  private title: string;
  private passwordEnabled: boolean;
  private password = "";
  private expiresInDays: string;

  constructor(
    app: App,
    private readonly defaults: {
      title: string;
      passwordEnabled: boolean;
      passwordAlreadySet: boolean;
      expiresInDays: string;
      documentCount: number;
      isUpdate: boolean;
    }
  ) {
    super(app);
    this.title = defaults.title;
    this.passwordEnabled = defaults.passwordEnabled;
    this.expiresInDays = defaults.expiresInDays;
    this.documentCount = defaults.documentCount;
  }

  private readonly documentCount: number;

  openAndGetResult(): Promise<PublishOptions | null> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      super.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("docferry-folder-share-modal");
    renderDocferryHeader(
      contentEl,
      this.defaults.isUpdate ? "Update folder share" : "Publish folder",
      `${this.documentCount} Markdown ${this.documentCount === 1 ? "note" : "notes"} will share one private folder link.`
    );

    new Setting(contentEl).setName("Title").addText((text) => {
      text.setValue(this.title).onChange((value) => {
        this.title = value;
      });
    });

    const passwordContainer = contentEl.createDiv();
    const renderPassword = () => {
      passwordContainer.empty();
      if (!this.passwordEnabled) return;
      new Setting(passwordContainer).setName("Password").addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("Folder password").onChange((value) => {
          this.password = value;
        });
      });
    };

    new Setting(contentEl)
      .setName("Password protection")
      .setDesc("One password protects every note in this folder link.")
      .addToggle((toggle) => toggle.setValue(this.passwordEnabled).onChange((value) => {
        this.passwordEnabled = value;
        renderPassword();
      }));
    renderPassword();

    new Setting(contentEl).setName("Expires").addDropdown((dropdown) => dropdown
      .addOption("never", "Never")
      .addOption("30", "30 days")
      .setValue(this.expiresInDays)
      .onChange((value) => {
        this.expiresInDays = value;
      }));

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.finish(null));
    buttons.createEl("button", {
      text: this.defaults.isUpdate ? "Update folder" : "Publish folder",
      cls: "mod-cta"
    }).addEventListener("click", () => {
      const title = this.title.trim();
      if (!title) {
        new Notice("Title is required.");
        return;
      }
      if (this.passwordEnabled && !this.password.trim() && !this.defaults.passwordAlreadySet) {
        new Notice("Password is required when protection is enabled.");
        return;
      }
      this.finish({
        title,
        passwordEnabled: this.passwordEnabled,
        password: this.passwordEnabled ? this.password : undefined,
        expiresAt: this.resolveExpiresAt()
      });
    });
  }

  onClose(): void {
    if (!this.done) this.finish(null);
  }

  private finish(value: PublishOptions | null): void {
    if (this.done) return;
    this.done = true;
    this.resolver(value);
    this.close();
  }

  private resolveExpiresAt(): string | null {
    if (this.expiresInDays === "never") return null;
    const days = Number(this.expiresInDays);
    if (!Number.isFinite(days) || days <= 0) return null;
    const expires = new Date();
    expires.setDate(expires.getDate() + days);
    return expires.toISOString();
  }
}
