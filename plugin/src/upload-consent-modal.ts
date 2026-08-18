import { App, Modal, setIcon } from "obsidian";
import { appendDocferryLogo } from "./brand";
import { containModalFocus } from "./modal-focus";

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
    containModalFocus(this);

    const header = contentEl.createDiv({ cls: "docferry-consent-header" });
    appendDocferryLogo(header, "docferry-consent-logo").setAttr("aria-hidden", "true");
    const copy = header.createDiv({ cls: "docferry-consent-copy" });
    const title = this.context === "startup"
      ? "Privacy and security"
      : this.context === "detailed_note"
        ? "Before DocFerry prepares this link"
        : "Before you publish";
    copy.createEl("h2", {
      text: title,
      cls: "docferry-heading docferry-heading-2"
    });
    copy.createEl("p", {
      text: "Your vault stays on this device. DocFerry uploads content only when you choose to share or save a public link."
    });

    const summary = contentEl.createDiv({ cls: "docferry-consent-summary" });
    appendConsentItem(summary, "file-check-2", "You choose what leaves Obsidian", "Only the note, folder, files, or public link you select. Some supported links may use external AI to prepare a note.");
    appendConsentItem(summary, "shield-check", "Protected during transfer and storage", "Connections use HTTPS and stored content is encrypted. Attachments may upload straight to Tencent Cloud storage with a short-lived credential.");
    appendConsentItem(summary, "sliders-horizontal", "You stay in control", "Add a password or expiry, and stop a share whenever you need to.");

    contentEl.createEl("p", {
      cls: "docferry-consent-boundary",
      text: "DocFerry must decrypt content to display a share or create an import. This is not end-to-end or zero-knowledge encryption."
    });

    const details = contentEl.createEl("details", { cls: "docferry-consent-details" });
    details.createEl("summary", { text: "Privacy details" });
    const detailsBody = details.createDiv({ cls: "docferry-consent-details-body" });
    detailsBody.createEl("h3", { text: "What DocFerry receives", cls: "docferry-heading docferry-heading-4" });
    detailsBody.createEl("p", {
      text:
        "Sharing uploads the selected note or folder, its web snapshot, and referenced local files. Saving a supported public link sends its URL to DocFerry. For supported media, DocFerry may send a public YouTube URL or bounded audio or video content, including a reviewed public Bilibili stream, through OpenRouter to a server-selected AI model to create the note. OpenRouter and the selected model provider process that input. DocFerry does not send your Bondie identity, browser cookies, history, profile, or other vault files."
    });
    detailsBody.createEl("p", {
      text:
        "To keep publishing fast, referenced images and attachments may upload directly from this device to Tencent Cloud Object Storage (COS), a third-party storage provider. DocFerry issues a temporary credential that lasts about 30 minutes, works only for that single upload, and is never saved by the plugin. Only files referenced by the note you publish, and the optional Pro theme style snapshot, use this path; your note text is sent to DocFerry, not to cloud storage. If direct upload is unavailable or fails, the file is uploaded through the DocFerry server instead."
    });
    detailsBody.createEl("h3", { text: "Passwords, sessions, and retention", cls: "docferry-heading docferry-heading-4" });
    detailsBody.createEl("p", {
      text:
        "Share passwords are stored as one-way hashes. Your account token is stored by your operating system's secure storage on this device, not in plugin data. Temporary import content is cleared after its retention period. Uploaded assets stay stored while a share is live, and unreferenced assets become eligible for deletion after 7 days. Stopping a share makes its content unavailable right away; stored content is cleared after its retention period. Anyone with the link, and its password when enabled, can view the shared content."
    });
    const privacy = detailsBody.createEl("a", {
      text: "Read the DocFerry Privacy Policy",
      href: "https://docferry.bondie.io/privacy"
    });
    privacy.setAttr("target", "_blank");
    privacy.setAttr("rel", "noopener noreferrer");

    const buttons = contentEl.createDiv({ cls: "modal-button-container docferry-consent-actions" });
    const cancel = buttons.createEl("button", { text: this.context === "startup" ? "Not now" : "Cancel", attr: { type: "button" } });
    const accept = buttons.createEl("button", {
      text: this.context === "startup" ? "Continue" : this.context === "detailed_note" ? "Continue" : "Publish",
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

function appendConsentItem(containerEl: HTMLElement, iconName: string, title: string, description: string): void {
  const item = containerEl.createDiv({ cls: "docferry-consent-summary-item" });
  const icon = item.createSpan({ cls: "docferry-consent-summary-icon", attr: { "aria-hidden": "true" } });
  setIcon(icon, iconName);
  const copy = item.createDiv();
  copy.createEl("h3", { text: title, cls: "docferry-heading docferry-heading-4" });
  copy.createEl("p", { text: description });
}
