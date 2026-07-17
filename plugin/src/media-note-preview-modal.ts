import { App, Modal } from "obsidian";
import { renderDocferryHeader } from "./brand";
import { mediaNoteSummary, mediaNoteTitle } from "./media-note";
import type { MediaNoteJobResponse } from "./types";

export function confirmMediaNoteImport(app: App, job: MediaNoteJobResponse): Promise<boolean> {
  return new Promise((resolve) => {
    new MediaNotePreviewModal(app, job, resolve).open();
  });
}

class MediaNotePreviewModal extends Modal {
  private done = false;

  constructor(
    app: App,
    private readonly job: MediaNoteJobResponse,
    private readonly resolve: (confirmed: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("docferry-media-note-preview");
    renderDocferryHeader(contentEl, "Save this note?", "DocFerry prepared a detailed note for your vault.");
    contentEl.createDiv({ text: mediaNoteTitle(this.job), cls: "docferry-media-note-preview-title" });
    const summary = mediaNoteSummary(this.job);
    if (summary) contentEl.createEl("p", { text: summary, cls: "docferry-media-note-preview-summary" });

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Not now" }).addEventListener("click", () => this.finish(false));
    buttons.createEl("button", { text: "Save note", cls: "mod-cta" }).addEventListener("click", () => {
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
