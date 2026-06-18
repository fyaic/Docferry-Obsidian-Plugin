import { App, Modal, Notice, Setting } from "obsidian";
import { renderDocferryHeader } from "./brand";
import type { Translate } from "./i18n";

export interface ImportShareOptions {
  url: string;
  password?: string;
  outputFolder: string;
  overwrite: boolean;
}

export class ImportShareModal extends Modal {
  private resolver!: (value: ImportShareOptions | null) => void;
  private done = false;
  private url: string;
  private password = "";
  private outputFolder = "Docferry Imports";
  private overwrite = false;

  constructor(
    app: App,
    initialUrl: string,
    private readonly t: Translate
  ) {
    super(app);
    this.url = initialUrl;
  }

  openAndGetResult(): Promise<ImportShareOptions | null> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      super.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    renderDocferryHeader(contentEl, this.t("modal.import.title"), this.t("modal.import.description"));

    new Setting(contentEl)
      .setName(this.t("modal.import.url"))
      .setDesc(this.t("modal.import.urlDesc"))
      .addText((text) => {
        text
          .setPlaceholder(this.t("modal.import.urlPlaceholder"))
          .setValue(this.url)
          .onChange((value) => {
            this.url = value.trim();
          });
        text.inputEl.addClass("docferry-url-input");
      });

    new Setting(contentEl)
      .setName(this.t("modal.import.password"))
      .setDesc(this.t("modal.import.passwordDesc"))
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder(this.t("modal.import.passwordPlaceholder")).onChange((value) => {
          this.password = value;
        });
      });

    new Setting(contentEl)
      .setName(this.t("modal.import.outputFolder"))
      .setDesc(this.t("modal.import.outputFolderDesc"))
      .addText((text) => {
        text.setValue(this.outputFolder).onChange((value) => {
          this.outputFolder = value.trim();
        });
      });

    new Setting(contentEl)
      .setName(this.t("modal.import.overwrite"))
      .setDesc(this.t("modal.import.overwriteDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.overwrite).onChange((value) => {
          this.overwrite = value;
        });
      });

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: this.t("modal.import.cancel") }).addEventListener("click", () => {
      this.finish(null);
    });
    buttons.createEl("button", { text: this.t("modal.import.import"), cls: "mod-cta" }).addEventListener("click", () => {
      if (!isValidShareUrl(this.url)) {
        new Notice(this.t("modal.import.invalidUrl"));
        return;
      }
      const outputFolder = normalizeVaultFolder(this.outputFolder);
      if (!outputFolder) {
        new Notice(this.t("modal.import.outputRequired"));
        return;
      }
      this.finish({
        url: this.url,
        password: this.password.trim() || undefined,
        outputFolder,
        overwrite: this.overwrite
      });
    });
  }

  onClose(): void {
    if (!this.done) this.finish(null);
  }

  private finish(value: ImportShareOptions | null): void {
    if (this.done) return;
    this.done = true;
    this.resolver(value);
    this.close();
  }
}

function isValidShareUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    const parts = parsed.pathname.split("/").filter(Boolean);
    return parsed.protocol.startsWith("http") && Boolean(parsed.host) && parts.length >= 2 && parts[0] === "s";
  } catch {
    return false;
  }
}

function normalizeVaultFolder(value: string): string {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => part.replace(/[\\/:*?"<>|]+/g, "-").trim().replace(/^\.+|\.+$/g, ""))
    .filter(Boolean)
    .join("/");
}
