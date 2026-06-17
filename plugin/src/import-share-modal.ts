import { App, Modal, Notice, Setting } from "obsidian";
import { renderDocferryHeader } from "./brand";

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

  constructor(app: App, initialUrl = "") {
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
    renderDocferryHeader(contentEl, "Import share URL", "Import one DocFerry document into this vault.");

    new Setting(contentEl)
      .setName("Share URL")
      .setDesc("Import one DocFerry share into this vault.")
      .addText((text) => {
        text
          .setPlaceholder("https://docferry.example/s/abc123")
          .setValue(this.url)
          .onChange((value) => {
            this.url = value.trim();
          });
        text.inputEl.addClass("docferry-url-input");
      });

    new Setting(contentEl)
      .setName("Password")
      .setDesc("Optional. Required only when the share is password protected.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("Optional password").onChange((value) => {
          this.password = value;
        });
      });

    new Setting(contentEl)
      .setName("Output folder")
      .setDesc("The imported note and explicitly referenced assets are written under this vault folder.")
      .addText((text) =>
        text.setValue(this.outputFolder).onChange((value) => {
          this.outputFolder = value.trim();
        })
      );

    new Setting(contentEl)
      .setName("Overwrite existing files")
      .setDesc("When disabled, import stops if the note or an asset already exists.")
      .addToggle((toggle) =>
        toggle.setValue(this.overwrite).onChange((value) => {
          this.overwrite = value;
        })
      );

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => {
      this.finish(null);
    });
    buttons.createEl("button", { text: "Import", cls: "mod-cta" }).addEventListener("click", () => {
      if (!isValidShareUrl(this.url)) {
        new Notice("Enter a valid DocFerry share URL.");
        return;
      }
      const outputFolder = normalizeVaultFolder(this.outputFolder);
      if (!outputFolder) {
        new Notice("Output folder is required.");
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
