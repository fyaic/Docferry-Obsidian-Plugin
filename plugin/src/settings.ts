import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { DOCFERRY_PRODUCT_DESCRIPTION, DOCFERRY_PRODUCT_NAME, renderDocferryHeader } from "./brand";

export type ImageUploadQuality = "original" | "high" | "standard";
export type DocferryServiceMode = "cloud" | "custom";

export const DOCFERRY_CLOUD_BASE_URL = "https://docferry.fuyonder.tech";
export const DOCFERRY_PRIVACY_URL = "https://github.com/fyaic/Docferry-Obsidian-Plugin/blob/main/PRIVACY.md";

export interface DocferrySettings {
  serviceMode: DocferryServiceMode;
  serverUrl: string;
  apiToken: string;
  defaultPasswordEnabled: boolean;
  defaultExpiresInDays: string;
  imageUploadQuality: ImageUploadQuality;
  debug: boolean;
}

export const DEFAULT_SETTINGS: DocferrySettings = {
  serviceMode: "cloud",
  serverUrl: "http://127.0.0.1:8787",
  apiToken: "",
  defaultPasswordEnabled: false,
  defaultExpiresInDays: "never",
  imageUploadQuality: "original",
  debug: false
};

export function normalizeSettings(saved: unknown): DocferrySettings {
  const data = isRecord(saved) ? saved : {};
  const serverUrl = typeof data.serverUrl === "string" ? data.serverUrl.trim() : DEFAULT_SETTINGS.serverUrl;
  const savedMode = data.serviceMode === "cloud" || data.serviceMode === "custom" ? data.serviceMode : null;
  const serviceMode = savedMode ?? inferServiceMode(serverUrl);

  return {
    serviceMode,
    serverUrl: serverUrl || DEFAULT_SETTINGS.serverUrl,
    apiToken: typeof data.apiToken === "string" ? data.apiToken : DEFAULT_SETTINGS.apiToken,
    defaultPasswordEnabled:
      typeof data.defaultPasswordEnabled === "boolean"
        ? data.defaultPasswordEnabled
        : DEFAULT_SETTINGS.defaultPasswordEnabled,
    defaultExpiresInDays:
      typeof data.defaultExpiresInDays === "string"
        ? data.defaultExpiresInDays
        : DEFAULT_SETTINGS.defaultExpiresInDays,
    imageUploadQuality: isImageUploadQuality(data.imageUploadQuality)
      ? data.imageUploadQuality
      : DEFAULT_SETTINGS.imageUploadQuality,
    debug: typeof data.debug === "boolean" ? data.debug : DEFAULT_SETTINGS.debug
  };
}

export function resolveServiceBaseUrl(settings: DocferrySettings): string {
  return settings.serviceMode === "cloud" ? DOCFERRY_CLOUD_BASE_URL : settings.serverUrl;
}

export function isCloudEndpointConfigured(): boolean {
  return DOCFERRY_CLOUD_BASE_URL.startsWith("https://") && DOCFERRY_CLOUD_BASE_URL.length > "https://".length;
}

function inferServiceMode(serverUrl: string): DocferryServiceMode {
  const normalized = serverUrl.replace(/\/+$/, "").toLowerCase();
  if (!normalized || normalized === "http://127.0.0.1:8787" || normalized === "http://localhost:8787") {
    return "cloud";
  }
  return "custom";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isImageUploadQuality(value: unknown): value is ImageUploadQuality {
  return value === "original" || value === "high" || value === "standard";
}

export interface SettingsHost {
  settings: DocferrySettings;
  saveSettings(): Promise<void>;
  testConnection(): Promise<void>;
}

export class DocferrySettingTab extends PluginSettingTab {
  constructor(app: App, private readonly host: SettingsHost & Plugin) {
    super(app, host);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("docferry-settings-tab");

    renderDocferryHeader(containerEl, DOCFERRY_PRODUCT_NAME, DOCFERRY_PRODUCT_DESCRIPTION);
    containerEl.createEl("p", {
      text: `Loaded plugin version: ${this.host.manifest.version}`,
      cls: "setting-item-description"
    });

    new Setting(containerEl)
      .setName("Service mode")
      .setDesc("Use DocFerry Cloud by default, or connect to a custom self-hosted server.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("cloud", "DocFerry Cloud")
          .addOption("custom", "Custom self-hosted server")
          .setValue(this.host.settings.serviceMode)
          .onChange(async (value) => {
            this.host.settings.serviceMode = value as DocferryServiceMode;
            await this.host.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName("Privacy")
      .setDesc("Review what DocFerry sends, stores, encrypts, and deletes.")
      .addButton((button) =>
        button
          .setButtonText("Open privacy policy")
          .onClick(() => {
            window.open(DOCFERRY_PRIVACY_URL);
          })
      );

    if (this.host.settings.serviceMode === "cloud") {
      new Setting(containerEl)
      .setName("DocFerry Cloud endpoint")
      .setDesc(
        isCloudEndpointConfigured()
          ? "Configured for DocFerry Cloud."
          : "DocFerry Cloud is unavailable in this build."
      );
    } else {
      new Setting(containerEl)
        .setName("Server URL")
        .setDesc("Custom DocFerry-compatible server URL.")
        .addText((text) =>
          text
            .setPlaceholder("http://127.0.0.1:8787")
            .setValue(this.host.settings.serverUrl)
            .onChange(async (value) => {
              this.host.settings.serverUrl = value.trim();
              await this.host.saveSettings();
            })
        );
    }

    new Setting(containerEl)
      .setName(this.host.settings.serviceMode === "cloud" ? "Cloud token" : "Server token")
      .setDesc(
        this.host.settings.serviceMode === "cloud"
          ? "Token for DocFerry Cloud. It is stored locally in this vault's plugin data."
          : "Token for your configured DocFerry server. It is stored locally in this vault's plugin data."
      )
      .addText((text) =>
      {
        text.inputEl.type = "password";
        text
          .setPlaceholder(this.host.settings.serviceMode === "cloud" ? "Paste Cloud token" : "Paste server token")
          .setValue(this.host.settings.apiToken)
          .onChange(async (value) => {
            this.host.settings.apiToken = value.trim();
            await this.host.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Test connection")
      .setDesc("Checks the selected DocFerry service and validates the token when supported.")
      .addButton((button) =>
        button
          .setButtonText("Test")
          .onClick(async () => {
            await this.host.testConnection();
          })
      );

    new Setting(containerEl)
      .setName("Password by default")
      .setDesc("Preselect password protection in the publish dialog.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.host.settings.defaultPasswordEnabled)
          .onChange(async (value) => {
            this.host.settings.defaultPasswordEnabled = value;
            await this.host.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default expiration")
      .setDesc("Used as the initial value in the publish dialog.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("never", "Never")
          .addOption("30", "30 days")
          .setValue(this.host.settings.defaultExpiresInDays)
          .onChange(async (value) => {
            this.host.settings.defaultExpiresInDays = value;
            await this.host.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Image quality")
      .setDesc("This free version uploads original image bytes. Image optimization is reserved for a future release.");

    new Setting(containerEl)
      .setName("Debug logging")
      .setDesc("Logs publish details to the developer console.")
      .addToggle((toggle) =>
        toggle.setValue(this.host.settings.debug).onChange(async (value) => {
          this.host.settings.debug = value;
          await this.host.saveSettings();
          new Notice(value ? "Debug logging enabled" : "Debug logging disabled");
        })
      );
  }
}
