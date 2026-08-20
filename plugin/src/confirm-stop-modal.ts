import { App, Modal } from "obsidian";
import { renderDocferryHeader } from "./brand";

export function confirmStopShare(app: App, title: string, sourcePath?: string | null): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmShareActionModal(
      app,
      "Stop sharing?",
      "The public DocFerry link will stop opening this content.",
      "Keep share",
      "Stop sharing",
      title,
      sourcePath || "",
      resolve
    ).open();
  });
}

export function confirmDeleteShareHistory(app: App, title: string, sourcePath?: string | null): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmShareActionModal(
      app,
      "Delete share history?",
      "This removes the stopped record from DocFerry. The source file in your vault is not deleted.",
      "Keep history",
      "Delete history",
      title,
      sourcePath || "",
      resolve
    ).open();
  });
}

export function confirmUnreachableShareRepublish(
  app: App,
  title: string,
  sourcePath: string | null | undefined,
  previousUrl: string
): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmShareActionModal(
      app,
      "Publish a new link for this note?",
      "The previous share link is not visible to the current Bondie account. It may belong to a " +
        "different account or may have been deleted. Publishing creates a new link under the " +
        "current account; the previous reference is preserved in the note's properties as " +
        "df_legacy_url.",
      "Cancel",
      "Publish new link",
      title,
      sourcePath || "",
      resolve,
      previousUrl ? [previousUrl] : []
    ).open();
  });
}

export function confirmLegacyShareMigration(
  app: App,
  title: string,
  sourcePath: string | null | undefined,
  legacyUrl: string
): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmShareActionModal(
      app,
      "Republish from the legacy free service?",
      "This note was shared with the earlier DocFerry free service. That link may still be live, " +
        "but it can no longer be managed from this vault. Publishing creates a new link on the current " +
        "DocFerry service; the old link is preserved in the note's properties as df_legacy_url.",
      "Cancel",
      "Publish new link",
      title,
      sourcePath || "",
      resolve,
      [legacyUrl]
    ).open();
  });
}

export function confirmRecoveredShareReassignment(
  app: App,
  previousPath: string,
  currentTitle: string,
  currentPath: string
): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmShareActionModal(
      app,
      "Use the recovered link for this note?",
      "DocFerry recovered a publish that began for a note at a different path. Continuing updates that same public link with the note and sharing options shown now; it does not create a second link.",
      "Cancel",
      "Use recovered link",
      currentTitle,
      currentPath,
      resolve,
      [`Previous path: ${previousPath}`]
    ).open();
  });
}

export function confirmStopRecoveredShareBeforeAccountChange(
  app: App,
  title: string,
  previousPath: string
): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmShareActionModal(
      app,
      "Stop the unfinished share and change accounts?",
      "DocFerry recovered a public link but can no longer find its source note in this vault. To avoid leaving an unknown public link behind, changing accounts will stop that link first.",
      "Keep account connected",
      "Stop share and continue",
      title,
      previousPath,
      resolve
    ).open();
  });
}

export function confirmStopRecoveredShare(app: App, title: string, previousPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmShareActionModal(
      app,
      "Stop the recovered share?",
      "DocFerry recovered a public link for a note that is no longer at its original path. Stop that link now, then publish the current note again to create a separate link.",
      "Keep recovered link",
      "Stop recovered link",
      title,
      previousPath,
      resolve
    ).open();
  });
}

class ConfirmShareActionModal extends Modal {
  private done = false;

  constructor(
    app: App,
    private readonly heading: string,
    private readonly description: string,
    private readonly cancelLabel: string,
    private readonly confirmLabel: string,
    private readonly title: string,
    private readonly sourcePath: string,
    private readonly resolve: (confirmed: boolean) => void,
    private readonly extraLines: string[] = []
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    renderDocferryHeader(contentEl, this.heading, this.description);
    contentEl.createEl("p", {
      text: this.title,
      cls: "setting-item-description"
    });
    if (this.sourcePath) {
      contentEl.createEl("p", {
        text: this.sourcePath,
        cls: "setting-item-description"
      });
    }
    for (const line of this.extraLines) {
      contentEl.createEl("p", {
        text: line,
        cls: "setting-item-description"
      });
    }

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: this.cancelLabel }).addEventListener("click", () => {
      this.finish(false);
    });
    buttons.createEl("button", { text: this.confirmLabel, cls: "mod-warning" }).addEventListener("click", () => {
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
