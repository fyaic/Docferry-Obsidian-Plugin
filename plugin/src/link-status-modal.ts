import { App, Modal, Notice, Setting } from "obsidian";
import { renderDocferryHeader } from "./brand";
import type { ShareLinksResponse, ShareLinkStatusResponse } from "./types";

export class LinkStatusModal extends Modal {
  constructor(
    app: App,
    private readonly title: string,
    private readonly response: ShareLinksResponse
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    renderDocferryHeader(contentEl, "Linked note status", "Check whether linked Obsidian notes have DocFerry URLs.");
    contentEl.createEl("p", {
      text: this.title,
      cls: "setting-item-description"
    });

    if (!this.response.links.length) {
      contentEl.createEl("p", {
        text: "No Obsidian internal links were indexed for this share.",
        cls: "setting-item-description"
      });
    }

    for (const link of this.response.links) {
      const setting = new Setting(contentEl)
        .setName(`${statusLabel(link.status)} ${link.label || link.raw_target}`)
        .setDesc(statusDescription(link));

      const targetUrl = link.target_url;
      if (targetUrl) {
        setting
          .addButton((button) => {
            button.setButtonText("Copy").onClick(() => {
              void copyTargetLink(targetUrl);
            });
          })
          .addButton((button) => {
            button.setButtonText("Open").onClick(() => {
              window.open(targetUrl);
            });
          });
      }
    }

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Done", cls: "mod-cta" }).addEventListener("click", () => {
      this.close();
    });
  }
}

async function copyTargetLink(targetUrl: string): Promise<void> {
  await navigator.clipboard.writeText(targetUrl);
  new Notice("Target link copied");
}

function statusLabel(status: ShareLinkStatusResponse["status"]): string {
  switch (status) {
    case "resolved":
      return "Resolved";
    case "ambiguous":
      return "Ambiguous";
    case "unsupported":
      return "Unsupported";
    case "unpublished":
      return "Unpublished";
  }
}

function statusDescription(link: ShareLinkStatusResponse): string {
  const target = link.target_path || link.raw_target;
  switch (link.status) {
    case "resolved":
      return `${target} is published and will open as a DocFerry share.`;
    case "ambiguous":
      return `${target} matches more than one published document. Publish with clearer paths or update the source link.`;
    case "unsupported":
      return `${target} cannot be resolved by DocFerry yet.`;
    case "unpublished":
      return `${target} has not been published with DocFerry yet.`;
  }
}
