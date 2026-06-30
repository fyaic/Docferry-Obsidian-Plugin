import { App, Modal } from "obsidian";
import { appendDocferryLogo } from "./brand";

export type UploadConsentContext = "startup" | "publish";

export function confirmDocferryUploadNotice(app: App, context: UploadConsentContext = "publish"): Promise<boolean> {
  return new Promise((resolve) => {
    new DocferryUploadConsentModal(app, context, resolve).open();
  });
}

class DocferryUploadConsentModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly context: UploadConsentContext,
    private readonly resolve: (accepted: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("docferry-upload-consent-modal");

    const header = contentEl.createDiv({ cls: "docferry-consent-header" });
    appendDocferryLogo(header, "docferry-consent-logo").setAttr("aria-hidden", "true");
    const copy = header.createDiv({ cls: "docferry-consent-copy" });
    copy.createEl("h2", { text: this.context === "startup" ? "Before using DocFerry" : "Publish with DocFerry" });
    copy.createEl("p", {
      text:
        "DocFerry does not upload your vault automatically. When you publish, the selected note and explicitly referenced local assets are sent to DocFerry servers so the share link can open on the web."
    });

    const details = contentEl.createDiv({ cls: "docferry-consent-details" });
    details.createEl("p", {
      text: "Only publish notes you intend to share. Linked notes are not uploaded unless you publish them separately."
    });
    details.createEl("p", {
      text: "You can protect a share with a password, set an expiration, or stop sharing later. Readers with access may already have viewed the content before a share is stopped."
    });
    details.createEl("p", {
      text: "Account tokens stay in Obsidian plugin storage on this device. DocFerry writes share metadata to the note frontmatter and writes imported shares only to the folder you choose."
    });

    const buttons = contentEl.createDiv({ cls: "modal-button-container docferry-consent-actions" });
    const cancel = buttons.createEl("button", { text: this.context === "startup" ? "Not now" : "Cancel", attr: { type: "button" } });
    const accept = buttons.createEl("button", { text: "I understand", cls: "mod-cta", attr: { type: "button" } });

    cancel.addEventListener("click", () => this.closeWith(false));
    accept.addEventListener("click", () => this.closeWith(true));
  }

  onClose(): void {
    if (!this.settled) {
      this.settled = true;
      this.resolve(false);
    }
    this.contentEl.empty();
  }

  private closeWith(accepted: boolean): void {
    this.settled = true;
    this.resolve(accepted);
    this.close();
  }
}
