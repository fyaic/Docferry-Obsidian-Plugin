import { App, Modal, Notice, Setting } from "obsidian";
import { renderDocferryHeader } from "./brand";
import type { Translate } from "./i18n";
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

  constructor(
    app: App,
    private readonly defaults: ShareModalDefaults,
    private readonly t: Translate
  ) {
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
      this.defaults.isUpdate ? this.t("modal.share.updateTitle") : this.t("modal.share.publishTitle"),
      this.t("modal.share.description")
    );

    new Setting(contentEl).setName(this.t("modal.share.title")).addText((text) => {
      text.setValue(this.title).onChange((value) => {
        this.title = value;
      });
      text.inputEl.addClass("docferry-title-input");
    });

    const passwordContainer = contentEl.createDiv();
    const renderPassword = () => {
      passwordContainer.empty();
      if (!this.passwordEnabled) return;
      new Setting(passwordContainer).setName(this.t("modal.share.password")).addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder(this.t("modal.share.passwordPlaceholder")).onChange((value) => {
          this.password = value;
        });
      });
    };

    new Setting(contentEl)
      .setName(this.t("modal.share.passwordProtection"))
      .setDesc(this.t("modal.share.passwordProtectionDesc"))
      .addToggle((toggle) =>
        toggle.setValue(this.passwordEnabled).onChange((value) => {
          this.passwordEnabled = value;
          renderPassword();
        })
      );

    renderPassword();

    new Setting(contentEl)
      .setName(this.t("modal.share.expires"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("never", this.t("settings.expiration.never"))
          .addOption("30", this.t("settings.expiration.thirtyDays"))
          .setValue(this.expiresInDays)
          .onChange((value) => {
            this.expiresInDays = value;
          })
      );

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: this.t("modal.share.cancel") }).addEventListener("click", () => {
      this.finish(null);
    });
    const publishButton = buttons.createEl("button", {
      text: this.defaults.isUpdate ? this.t("modal.share.update") : this.t("modal.share.publish"),
      cls: "mod-cta"
    });
    publishButton.addEventListener("click", () => {
      const title = this.title.trim();
      if (!title) {
        new Notice(this.t("modal.share.titleRequired"));
        return;
      }
      if (this.passwordEnabled && !this.password.trim()) {
        new Notice(this.t("modal.share.passwordRequired"));
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
