import { App, Modal, Notice, Setting } from "obsidian";
import { renderDocferryHeader } from "./brand";
import type { PublishOptions } from "./types";

export interface ShareModalDefaults {
  title: string;
  passwordEnabled: boolean;
  expiresInDays: string;
  isUpdate: boolean;
}

export class ShareModal extends Modal {
  private resolver!: (value: PublishOptions | null) => void;
  private done = false;
  private title: string;
  private passwordEnabled: boolean;
  private password = "";
  private expiresInDays: string;

  constructor(app: App, private readonly defaults: ShareModalDefaults) {
    super(app);
    this.title = defaults.title;
    this.passwordEnabled = defaults.passwordEnabled;
    this.expiresInDays = defaults.expiresInDays;
  }

  openAndGetResult(): Promise<PublishOptions | null> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      super.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    renderDocferryHeader(
      contentEl,
      this.defaults.isUpdate ? "Update share link" : "Publish share link",
      "Publish exactly one Obsidian note as a secure DocFerry URL."
    );

    new Setting(contentEl).setName("Title").addText((text) => {
      text.setValue(this.title).onChange((value) => {
        this.title = value;
      });
      text.inputEl.addClass("docferry-title-input");
    });

    const passwordContainer = contentEl.createDiv();
    const renderPassword = () => {
      passwordContainer.empty();
      if (!this.passwordEnabled) return;
      new Setting(passwordContainer).setName("Password").addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("Optional password").onChange((value) => {
          this.password = value;
        });
      });
    };

    new Setting(contentEl)
      .setName("Password protection")
      .setDesc("Protect this share link with a document-level password.")
      .addToggle((toggle) =>
        toggle.setValue(this.passwordEnabled).onChange((value) => {
          this.passwordEnabled = value;
          renderPassword();
        })
      );

    renderPassword();

    new Setting(contentEl)
      .setName("Expires")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("never", "Never")
          .addOption("30", "30 days")
          .setValue(this.expiresInDays)
          .onChange((value) => {
            this.expiresInDays = value;
          })
      );

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => {
      this.finish(null);
    });
    const publishButton = buttons.createEl("button", {
      text: this.defaults.isUpdate ? "Update" : "Publish",
      cls: "mod-cta"
    });
    publishButton.addEventListener("click", () => {
      const title = this.title.trim();
      if (!title) {
        new Notice("Title is required.");
        return;
      }
      if (this.passwordEnabled && !this.password.trim()) {
        new Notice("Password is required when password protection is enabled.");
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
