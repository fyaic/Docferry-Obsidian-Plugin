import { App, Modal } from "obsidian";
import { renderDocferryHeader } from "./brand";

/**
 * Offers a visible sign-in action before a publish dead end. Confirming means
 * the caller may remember the publish intent and resume it after login.
 */
export function confirmLoginToPublish(app: App, targetLabel: string, sourcePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    new LoginToPublishModal(app, targetLabel, sourcePath, resolve).open();
  });
}

class LoginToPublishModal extends Modal {
  private done = false;

  constructor(
    app: App,
    private readonly targetLabel: string,
    private readonly sourcePath: string,
    private readonly resolve: (confirmed: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    renderDocferryHeader(
      contentEl,
      "Sign in to publish",
      "Publishing uses the hosted DocFerry service with your Bondie account. After signing in, DocFerry returns to this publish so you can confirm it."
    );
    contentEl.createEl("p", { text: this.targetLabel, cls: "setting-item-description" });
    if (this.sourcePath) {
      contentEl.createEl("p", { text: this.sourcePath, cls: "setting-item-description" });
    }

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Not now" }).addEventListener("click", () => {
      this.finish(false);
    });
    buttons.createEl("button", { text: "Connect account", cls: "mod-cta" }).addEventListener("click", () => {
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
