import { App, Modal, Notice, Setting } from "obsidian";
import { renderDocferryHeader } from "./brand";
import type { Translate } from "./i18n";
import type { ShareLinksResponse, ShareLinkStatusResponse } from "./types";

export class LinkStatusModal extends Modal {
  constructor(
    app: App,
    private readonly title: string,
    private readonly response: ShareLinksResponse,
    private readonly t: Translate
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    renderDocferryHeader(contentEl, this.t("modal.links.title"), this.t("modal.links.description"));
    contentEl.createEl("p", {
      text: this.title,
      cls: "setting-item-description"
    });

    if (!this.response.links.length) {
      contentEl.createEl("p", {
        text: this.t("modal.links.empty"),
        cls: "setting-item-description"
      });
    }

    for (const link of this.response.links) {
      const setting = new Setting(contentEl)
        .setName(`${statusLabel(link.status, this.t)} ${link.label || link.raw_target}`)
        .setDesc(statusDescription(link, this.t));

      if (link.target_url) {
        setting
          .addButton((button) => {
            button.setButtonText(this.t("modal.links.copy")).onClick(async () => {
              await navigator.clipboard.writeText(link.target_url || "");
              new Notice(this.t("modal.links.targetCopied"));
            });
          })
          .addButton((button) => {
            button.setButtonText(this.t("modal.links.open")).onClick(() => {
              window.open(link.target_url || "");
            });
          });
      }
    }

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: this.t("modal.links.done"), cls: "mod-cta" }).addEventListener("click", () => {
      this.close();
    });
  }
}

function statusLabel(status: ShareLinkStatusResponse["status"], t: Translate): string {
  switch (status) {
    case "resolved":
      return t("modal.links.statusResolved");
    case "ambiguous":
      return t("modal.links.statusAmbiguous");
    case "unsupported":
      return t("modal.links.statusUnsupported");
    case "unpublished":
      return t("modal.links.statusUnpublished");
  }
}

function statusDescription(link: ShareLinkStatusResponse, t: Translate): string {
  const target = link.target_path || link.raw_target;
  switch (link.status) {
    case "resolved":
      return t("modal.links.descriptionResolved", { target });
    case "ambiguous":
      return t("modal.links.descriptionAmbiguous", { target });
    case "unsupported":
      return t("modal.links.descriptionUnsupported", { target });
    case "unpublished":
      return t("modal.links.descriptionUnpublished", { target });
  }
}
