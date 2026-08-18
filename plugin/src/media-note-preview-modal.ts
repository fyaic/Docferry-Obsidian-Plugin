import { App, Component, MarkdownRenderer, Modal } from "obsidian";
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
  private readonly renderContext = new Component();

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
    this.modalEl.addClass("docferry-media-note-preview-modal");
    contentEl.addClass("docferry-media-note-preview");
    renderDocferryHeader(contentEl, "Review your note", "Check the result before saving it to your vault.");
    this.renderContext.load();
    const preview = contentEl.createDiv({ cls: "docferry-media-note-preview-document" });
    const markdown = typeof this.job.markdown === "string" ? this.job.markdown.trim() : "";
    if (markdown) {
      void MarkdownRenderer.render(this.app, markdown, preview, "", this.renderContext);
    } else {
      preview.createDiv({ text: mediaNoteTitle(this.job), cls: "docferry-media-note-preview-title" });
      const summary = mediaNoteSummary(this.job);
      if (summary) preview.createEl("p", { text: summary, cls: "docferry-media-note-preview-summary" });
    }

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Review later" }).addEventListener("click", () => this.finish(false));
    buttons.createEl("button", { text: "Save note", cls: "mod-cta" }).addEventListener("click", () => {
      this.finish(true);
    });
  }

  onClose(): void {
    this.renderContext.unload();
    if (!this.done) {
      this.done = true;
      this.resolve(false);
    }
  }

  private finish(confirmed: boolean): void {
    if (this.done) return;
    this.done = true;
    this.resolve(confirmed);
    this.close();
  }
}
