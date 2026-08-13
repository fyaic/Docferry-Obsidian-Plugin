import { App, Modal } from "obsidian";
import { appendDocferryLogo } from "./brand";

export type UploadConsentContext = "startup" | "publish" | "detailed_note";

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
    const title = this.context === "startup"
      ? "Privacy and security"
      : this.context === "detailed_note"
        ? "Before you create this note"
        : "Before you publish";
    copy.createDiv({
      text: title,
      cls: "docferry-heading docferry-heading-2"
    });
    copy.createEl("p", {
      text:
        "Your vault stays on this device. DocFerry uploads content only for actions you start, such as publishing or creating a detailed note."
    });

    const details = contentEl.createDiv({ cls: "docferry-consent-details" });
    details.createDiv({ text: "What is protected", cls: "docferry-heading docferry-heading-4" });
    details.createEl("p", {
      text:
        "Published notes, folder snapshots, selected assets, detailed-note source data and results, and sensitive share details are encrypted while stored on DocFerry servers. Connections use HTTPS, temporary detailed-note content is cleared after its retention period, and share passwords are stored as one-way hashes."
    });
    details.createDiv({ text: "What is shared", cls: "docferry-heading docferry-heading-4" });
    details.createEl("p", {
      text:
        "Only the note or folder you select, its web snapshot, and explicitly referenced local assets are uploaded. When you choose Detailed note, the selected public URL is sent to DocFerry so the server can retrieve the public page or available media metadata and captions. DocFerry does not read your browser cookies, history, or profile, and caption mode does not download the full audio or video. Linked vault notes are not included unless you publish them."
    });
    details.createDiv({ text: "Important boundary", cls: "docferry-heading docferry-heading-4" });
    details.createEl("p", {
      text:
        "This is server-side encryption, not end-to-end or zero-knowledge encryption. DocFerry must decrypt content to show a share or provide an import. Anyone with access to the link, and its password when enabled, can view the content."
    });
    details.createEl("p", {
      text:
        "Your account token stays in Obsidian plugin storage on this device. You can add a password, set an expiration, or stop sharing at any time."
    });
    const privacy = details.createEl("a", {
      text: "Read the DocFerry Privacy Policy",
      href: "https://docferry.fuyonder.tech/privacy"
    });
    privacy.setAttr("target", "_blank");
    privacy.setAttr("rel", "noopener noreferrer");

    const buttons = contentEl.createDiv({ cls: "modal-button-container docferry-consent-actions" });
    const cancel = buttons.createEl("button", { text: this.context === "startup" ? "Not now" : "Cancel", attr: { type: "button" } });
    const accept = buttons.createEl("button", {
      text: this.context === "startup" ? "Continue" : this.context === "detailed_note" ? "Create note" : "Publish",
      cls: "mod-cta",
      attr: { type: "button" }
    });

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
