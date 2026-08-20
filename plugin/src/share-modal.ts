import { App, Modal, Notice, Setting } from "obsidian";
import { renderDocferryHeader } from "./brand";
import { containModalFocus } from "./modal-focus";
import { resolveExpirySelection } from "./publish-state";
import type { PublishOptions } from "./types";

export interface ShareModalDefaults {
  title: string;
  passwordEnabled: boolean;
  passwordAlreadySet: boolean;
  expiresInDays: string;
  existingExpiresAt?: string | null;
  isUpdate: boolean;
  canUseThemeStyling: boolean;
  useThemeStyling: boolean;
}

export class ShareModal extends Modal {
  private resolver!: (value: PublishOptions | null) => void;
  private done = false;
  private title: string;
  private passwordEnabled: boolean;
  private password = "";
  private expiresInDays: string;
  private useThemeStyling: boolean;

  constructor(app: App, private readonly defaults: ShareModalDefaults) {
    super(app);
    this.title = defaults.title;
    this.passwordEnabled = defaults.passwordEnabled;
    this.expiresInDays = defaults.expiresInDays;
    this.useThemeStyling = defaults.canUseThemeStyling && defaults.useThemeStyling;
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
    contentEl.addClass("docferry-share-modal");
    containModalFocus(this);
    renderDocferryHeader(
      contentEl,
      this.defaults.isUpdate ? "Update this share" : "Share this note",
      this.defaults.isUpdate
        ? "Refresh the existing link with the latest version of this note."
        : "Create a share link. Add a password or expiry only when you need one."
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
      .setName("Link expires")
      .addDropdown((dropdown) =>
        (this.expiresInDays === "keep"
          ? dropdown.addOption("keep", "Keep current expiration")
          : dropdown)
          .addOption("never", "Never")
          .addOption("30", "30 days")
          .setValue(this.expiresInDays)
          .onChange((value) => {
            this.expiresInDays = value;
          })
      );

    if (this.defaults.canUseThemeStyling) {
      new Setting(contentEl)
        .setName("Use my Obsidian theme")
        .setDesc("Bring over colors, borders, callouts, and code styling while keeping DocFerry's clean reading layout.")
        .addToggle((toggle) =>
          toggle.setValue(this.useThemeStyling).onChange((value) => {
            this.useThemeStyling = value;
          })
        );
    }

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
      if (this.passwordEnabled && !this.password.trim() && !this.defaults.passwordAlreadySet) {
        new Notice("Password is required when password protection is enabled.");
        return;
      }
      this.finish({
        title,
        passwordEnabled: this.passwordEnabled,
        password: this.passwordEnabled ? this.password : undefined,
        expiresAt: this.resolveExpiresAt(),
        expirySelection: this.expiresInDays,
        useThemeStyling: this.defaults.canUseThemeStyling && this.useThemeStyling
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
    return resolveExpirySelection(this.expiresInDays, this.defaults.existingExpiresAt);
  }
}
