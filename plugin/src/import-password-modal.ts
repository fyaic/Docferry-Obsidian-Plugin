import { App, Modal, Notice, Setting } from "obsidian";
import { renderDocferryHeader } from "./brand";

export class ImportPasswordModal extends Modal {
  private resolver!: (value: string | null) => void;
  private done = false;
  private password = "";

  constructor(app: App) {
    super(app);
  }

  openAndGetPassword(): Promise<string | null> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      super.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("docferry-password-modal");
    renderDocferryHeader(contentEl, "Password required", "Enter the password for this shared document.");

    new Setting(contentEl)
      .setName("Password")
      .setDesc("The password is used once to import this DocFerry URL.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.addClass("docferry-password-input");
        text.setPlaceholder("Share password").onChange((value) => {
          this.password = value;
        });
        window.setTimeout(() => text.inputEl.focus(), 50);
      });

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => {
      this.finish(null);
    });
    buttons.createEl("button", { text: "Continue", cls: "mod-cta" }).addEventListener("click", () => {
      const password = this.password.trim();
      if (!password) {
        new Notice("Password is required.");
        return;
      }
      this.finish(password);
    });
  }

  onClose(): void {
    if (!this.done) this.finish(null);
  }

  private finish(value: string | null): void {
    if (this.done) return;
    this.done = true;
    this.resolver(value);
    this.close();
  }
}
