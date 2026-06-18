import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, setIcon } from "obsidian";
import { ConfirmModal } from "./confirm-modal";
import { DOCFERRY_PRODUCT_NAME, renderDocferryHeader } from "./brand";
import { clearShareMeta, readShareMeta } from "./frontmatter";
import {
  isDocferryLanguage,
  languageChangedKey,
  languageToggleKey,
  nextLanguage,
  translate,
  type DocferryLanguage,
  type TranslationKey,
  type TranslationValues
} from "./i18n";
import type { ShareListResponse, ShareMeta, ShareStatus, ShareStatusResponse } from "./types";

export type ImageUploadQuality = "original" | "high" | "standard";
export type DocferryServiceMode = "cloud" | "custom";

export const DOCFERRY_CLOUD_BASE_URL = "https://docferry.bondie.io";
export const DOCFERRY_CLOUD_HELP_URL = "https://bondie.io/research/docferry#cloud-token";
export const DOCFERRY_PRIVACY_URL = "https://github.com/fyaic/Docferry-Obsidian-Plugin/blob/main/PRIVACY.md";

export interface DocferrySettings {
  serviceMode: DocferryServiceMode;
  serverUrl: string;
  apiToken: string;
  anonymousInstallId: string;
  defaultPasswordEnabled: boolean;
  defaultExpiresInDays: string;
  imageUploadQuality: ImageUploadQuality;
  language: DocferryLanguage;
  debug: boolean;
}

export const DEFAULT_SETTINGS: DocferrySettings = {
  serviceMode: "cloud",
  serverUrl: "http://127.0.0.1:8787",
  apiToken: "",
  anonymousInstallId: "",
  defaultPasswordEnabled: false,
  defaultExpiresInDays: "never",
  imageUploadQuality: "original",
  language: "en",
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
    anonymousInstallId:
      typeof data.anonymousInstallId === "string" && data.anonymousInstallId.startsWith("dfi_")
        ? data.anonymousInstallId
        : DEFAULT_SETTINGS.anonymousInstallId,
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
    language: isDocferryLanguage(data.language) ? data.language : DEFAULT_SETTINGS.language,
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

function isDocferryServiceMode(value: unknown): value is DocferryServiceMode {
  return value === "cloud" || value === "custom";
}

function asServiceMode(value: string): DocferryServiceMode {
  return isDocferryServiceMode(value) ? value : "cloud";
}

export interface SettingsHost {
  settings: DocferrySettings;
  saveSettings(): Promise<void>;
  connectDocferryCloud(): Promise<boolean>;
  testConnection(): Promise<void>;
  listShares(): Promise<ShareListResponse>;
  refreshShareStatus(shareId: string): Promise<ShareStatusResponse>;
  stopShareById(shareId: string, file?: TFile): Promise<boolean>;
  stopShareForFile(file: TFile): Promise<boolean>;
  refreshLocalizedCommands?(): void;
}

interface ManagedShare {
  shareId?: string;
  file?: TFile;
  meta?: ShareMeta;
  status?: ShareStatusResponse;
  localTracked: boolean;
  missingFromServer: boolean;
}

interface CachedShareStatus {
  status?: ShareStatusResponse;
  error?: string;
}

export class DocferrySettingTab extends PluginSettingTab {
  private readonly shareStatusCache = new Map<string, CachedShareStatus>();

  constructor(app: App, private readonly host: SettingsHost & Plugin) {
    super(app, host);
  }

  private t(key: TranslationKey, values?: TranslationValues): string {
    return translate(this.host.settings.language, key, values);
  }

  display(): void {
    this.renderSettings();
  }

  private renderSettings(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("docferry-settings-tab");

    const headerEl = renderDocferryHeader(containerEl, DOCFERRY_PRODUCT_NAME, this.t("product.description"));
    this.renderLanguageToggle(headerEl);
    containerEl.createEl("p", {
      text: this.t("settings.loadedVersion", { version: this.host.manifest.version }),
      cls: "setting-item-description"
    });

    new Setting(containerEl)
      .setName(this.t("settings.serviceMode.name"))
      .setDesc(this.t("settings.serviceMode.desc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("cloud", this.t("settings.serviceMode.cloud"))
          .addOption("custom", this.t("settings.serviceMode.custom"))
          .setValue(this.host.settings.serviceMode)
          .onChange(async (value) => {
            this.host.settings.serviceMode = asServiceMode(value);
            await this.host.saveSettings();
            this.renderSettings();
          });
      });

    new Setting(containerEl)
      .setName(this.t("settings.privacy.name"))
      .setDesc(this.t("settings.privacy.desc"))
      .addButton((button) => {
        button
          .setButtonText(this.t("settings.privacy.button"))
          .onClick(() => {
            window.open(DOCFERRY_PRIVACY_URL);
          });
      });

    if (this.host.settings.serviceMode !== "cloud") {
      new Setting(containerEl)
        .setName(this.t("settings.serverUrl.name"))
        .setDesc(this.t("settings.serverUrl.desc"))
        .addText((text) => {
          text
            // eslint-disable-next-line obsidianmd/ui/sentence-case -- URL placeholder, not user-facing sentence
            .setPlaceholder("http://127.0.0.1:8787")
            .setValue(this.host.settings.serverUrl)
            .onChange(async (value) => {
              this.host.settings.serverUrl = value.trim();
              await this.host.saveSettings();
            });
        });
    }

    if (this.host.settings.serviceMode === "cloud") {
      new Setting(containerEl)
        .setName(this.t("settings.cloud.name"))
        .setDesc(
          this.host.settings.apiToken
            ? this.t("settings.cloud.connectedDesc")
            : this.t("settings.cloud.disconnectedDesc")
        )
        .addButton((button) => {
          button
            .setButtonText(this.host.settings.apiToken ? this.t("settings.cloud.reconnect") : this.t("settings.cloud.connect"))
            .setCta()
            .onClick(async () => {
              await this.host.connectDocferryCloud();
              this.renderSettings();
            });
        })
        .addButton((button) => {
          button.setButtonText(this.t("settings.cloud.learn")).onClick(() => {
            window.open(DOCFERRY_CLOUD_HELP_URL);
          });
        });

      const advancedEl = containerEl.createEl("details", { cls: "docferry-advanced-token" });
      advancedEl.createEl("summary", { text: this.t("settings.advancedToken.summary") });
      const tokenSetting = new Setting(advancedEl)
        .setName(this.t("settings.advancedToken.name"))
        .setDesc(this.t("settings.advancedToken.desc"));
      tokenSetting.settingEl.addClass("docferry-token-setting");
      tokenSetting.addText((text) => {
        text.inputEl.type = "password";
        text
          // eslint-disable-next-line obsidianmd/ui/sentence-case -- token prefix placeholder, not a sentence
          .setPlaceholder("dfc_...")
          .setValue(this.host.settings.apiToken)
          .onChange(async (value) => {
            this.host.settings.apiToken = value.trim();
            await this.host.saveSettings();
          });
      });
    } else {
      const tokenSetting = new Setting(containerEl)
        .setName(this.t("settings.serverToken.name"))
        .setDesc(this.t("settings.serverToken.desc"));
      tokenSetting.settingEl.addClass("docferry-token-setting");
      tokenSetting.addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder(this.t("settings.serverToken.placeholder"))
          .setValue(this.host.settings.apiToken)
          .onChange(async (value) => {
            this.host.settings.apiToken = value.trim();
            await this.host.saveSettings();
          });
      });
    }

    new Setting(containerEl)
      .setName(this.t("settings.testConnection.name"))
      .setDesc(this.t("settings.testConnection.desc"))
      .addButton((button) => {
        button
          .setButtonText(this.t("settings.testConnection.button"))
          .onClick(async () => {
            await this.host.testConnection();
          });
      });

    new Setting(containerEl)
      .setName(this.t("settings.passwordDefault.name"))
      .setDesc(this.t("settings.passwordDefault.desc"))
      .addToggle((toggle) => {
        toggle
          .setValue(this.host.settings.defaultPasswordEnabled)
          .onChange(async (value) => {
            this.host.settings.defaultPasswordEnabled = value;
            await this.host.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName(this.t("settings.defaultExpiration.name"))
      .setDesc(this.t("settings.defaultExpiration.desc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("never", this.t("settings.expiration.never"))
          .addOption("30", this.t("settings.expiration.thirtyDays"))
          .setValue(this.host.settings.defaultExpiresInDays)
          .onChange(async (value) => {
            this.host.settings.defaultExpiresInDays = value;
            await this.host.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName(this.t("settings.imageQuality.name"))
      .setDesc(this.t("settings.imageQuality.desc"));

    new Setting(containerEl)
      .setName(this.t("settings.debug.name"))
      .setDesc(this.t("settings.debug.desc"))
      .addToggle((toggle) => {
        toggle.setValue(this.host.settings.debug).onChange(async (value) => {
          this.host.settings.debug = value;
          await this.host.saveSettings();
          new Notice(value ? this.t("settings.debug.enabled") : this.t("settings.debug.disabled"));
        });
      });

    const shareManagementEl = containerEl.createDiv({ cls: "docferry-share-management" });
    void this.renderShareManagement(shareManagementEl);
  }

  private renderLanguageToggle(headerEl: HTMLElement): void {
    const language = this.host.settings.language;
    const button = headerEl.createEl("button", {
      cls: "docferry-language-toggle",
      attr: {
        type: "button",
        "aria-label": this.t(languageToggleKey(language)),
        title: this.t(languageToggleKey(language))
      }
    });
    setIcon(button, "globe-2");
    button.addEventListener("click", () => {
      void this.switchLanguage();
    });
  }

  private async switchLanguage(): Promise<void> {
    this.host.settings.language = nextLanguage(this.host.settings.language);
    await this.host.saveSettings();
    this.host.refreshLocalizedCommands?.();
    new Notice(this.t(languageChangedKey(this.host.settings.language)));
    this.renderSettings();
  }

  private async renderShareManagement(sectionEl: HTMLElement): Promise<void> {
    sectionEl.empty();
    this.renderShareManagementLoading(sectionEl);

    let serverShares: ShareStatusResponse[] = [];
    let listError: string | undefined;
    try {
      const response = await this.host.listShares();
      serverShares = response.shares;
      for (const share of serverShares) {
        this.shareStatusCache.set(share.share_id, { status: share });
      }
    } catch (error) {
      listError = this.errorMessage(error);
    }

    const shares = this.mergeManagedShares(serverShares);
    sectionEl.empty();

    const headerEl = sectionEl.createDiv({ cls: "docferry-share-management-header" });
    const copyEl = headerEl.createDiv({ cls: "docferry-share-management-copy" });
    new Setting(copyEl).setName(this.t("shares.title")).setHeading();
    const shareWord = shares.length === 1 ? this.t("shares.shareSingular") : this.t("shares.sharePlural");
    copyEl.createEl("p", {
      text: this.t("shares.accountCount", { count: shares.length, shareWord }),
      cls: "setting-item-description"
    });

    const actionsEl = headerEl.createDiv({ cls: "docferry-share-management-actions" });
    this.createActionButton(actionsEl, this.t("shares.refreshServer"), async () => {
      await this.renderShareManagement(sectionEl);
    });

    if (listError) {
      sectionEl.createDiv({
        text: this.t("shares.listUnavailable", { error: listError }),
        cls: "docferry-share-error"
      });
    }

    const listEl = sectionEl.createDiv({ cls: "docferry-share-list" });
    if (!shares.length) {
      listEl.createDiv({
        text: listError ? this.t("shares.emptyLocal") : this.t("shares.emptyAccount"),
        cls: "docferry-share-empty"
      });
      return;
    }

    for (const share of shares) {
      this.renderShareRow(listEl, sectionEl, share);
    }
  }

  private renderShareManagementLoading(sectionEl: HTMLElement): void {
    const headerEl = sectionEl.createDiv({ cls: "docferry-share-management-header" });
    const copyEl = headerEl.createDiv({ cls: "docferry-share-management-copy" });
    new Setting(copyEl).setName(this.t("shares.title")).setHeading();
    copyEl.createEl("p", {
      text: this.t("shares.loading"),
      cls: "setting-item-description"
    });
  }

  private mergeManagedShares(serverShares: ShareStatusResponse[]): ManagedShare[] {
    const merged: ManagedShare[] = serverShares.map((status) => {
      const file = this.resolveMarkdownFile(status.source_path);
      const meta = file ? readShareMeta(this.app, file) : undefined;
      return {
        shareId: status.share_id,
        file,
        meta,
        status,
        localTracked: Boolean(meta?.id === status.share_id || meta?.url === status.url),
        missingFromServer: false
      };
    });

    return merged.sort((left, right) => {
      const byUpdated = timestamp(right.status?.updated_at || right.meta?.updated) - timestamp(left.status?.updated_at || left.meta?.updated);
      const leftLabel = left.status?.source_path || left.file?.path || left.shareId || "";
      const rightLabel = right.status?.source_path || right.file?.path || right.shareId || "";
      return byUpdated || leftLabel.localeCompare(rightLabel);
    });
  }

  private resolveMarkdownFile(path: string | null | undefined): TFile | undefined {
    if (!path) return undefined;
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile && file.extension === "md" ? file : undefined;
  }

  private renderShareRow(listEl: HTMLElement, sectionEl: HTMLElement, share: ManagedShare): void {
    const cached = share.shareId ? this.shareStatusCache.get(share.shareId) : undefined;
    const status: DisplayShareStatus =
      share.missingFromServer ? "not_in_account" : share.status?.status ?? cached?.status?.status ?? "tracked";
    const title = share.status?.title || cached?.status?.title || share.file?.basename || share.meta?.url || share.shareId || this.t("shares.untitled");
    const sourcePath = share.file?.path || share.status?.source_path || cached?.status?.source_path || this.t("shares.notLinked");
    const shareUrl = share.status?.url || cached?.status?.url || share.meta?.url;

    const rowEl = listEl.createDiv({ cls: "docferry-share-row" });
    const mainEl = rowEl.createDiv({ cls: "docferry-share-row-main" });
    const titleLineEl = mainEl.createDiv({ cls: "docferry-share-title-line" });
    titleLineEl.createDiv({ text: title, cls: "docferry-share-title" });
    titleLineEl.createSpan({
      text: formatShareStatus(status, (key) => this.t(key)),
      cls: `docferry-share-status docferry-share-status-${status}`
    });

    mainEl.createDiv({ text: sourcePath, cls: "docferry-share-path" });

    const detailsEl = mainEl.createDiv({ cls: "docferry-share-details" });
    detailsEl.createSpan({
      text: this.t("shares.updated", {
        date: formatDate(share.status?.updated_at || cached?.status?.updated_at || share.meta?.updated, this.host.settings.language, (key) => this.t(key))
      })
    });
    const expires = share.status?.expires_at || cached?.status?.expires_at || share.meta?.expires;
    if (expires) {
      detailsEl.createSpan({
        text: this.t("shares.expires", {
          date: formatDate(expires, this.host.settings.language, (key) => this.t(key))
        })
      });
    }
    if (share.status?.password_enabled || cached?.status?.password_enabled || share.meta?.passwordEnabled) {
      detailsEl.createSpan({ text: this.t("shares.passwordProtected") });
    }
    detailsEl.createSpan({ text: share.localTracked ? this.t("shares.trackedInVault") : this.t("shares.serverOnly") });
    if (cached?.error) {
      detailsEl.createSpan({ text: this.t("shares.statusRefreshFailed", { error: cached.error }), cls: "docferry-share-error" });
    }

    const actionsEl = rowEl.createDiv({ cls: "docferry-share-row-actions" });
    const openNoteButton = this.createActionButton(actionsEl, this.t("shares.openNote"), async () => {
      if (share.file) await this.app.workspace.getLeaf(true).openFile(share.file);
    });
    openNoteButton.disabled = !share.file;

    const copyButton = this.createActionButton(actionsEl, this.t("shares.copyLink"), async () => {
      if (!shareUrl) return;
      await navigator.clipboard.writeText(shareUrl);
      new Notice(this.t("notice.shareLinkCopied"));
    });
    copyButton.disabled = !shareUrl;

    const openShareButton = this.createActionButton(actionsEl, this.t("shares.openShare"), () => {
      if (shareUrl) window.open(shareUrl);
    });
    openShareButton.disabled = !shareUrl;

    const refreshButton = this.createActionButton(actionsEl, this.t("shares.refresh"), async () => {
      if (!share.shareId) return;
      await this.refreshOneShareStatus(sectionEl, share.shareId);
    });
    refreshButton.disabled = !share.shareId;

    const stopButton = this.createActionButton(actionsEl, this.t("shares.stop"), async () => {
      if (!share.shareId) return;
      const confirmed = await new ConfirmModal(
        this.app,
        this.t("shares.confirmStop", { title }),
        (key, values) => this.t(key, values)
      ).openAndConfirm();
      if (!confirmed) return;
      const stopped = await this.host.stopShareById(share.shareId, share.file);
      if (stopped) {
        this.shareStatusCache.delete(share.shareId);
        await this.renderShareManagement(sectionEl);
      }
    });
    stopButton.disabled = !share.shareId || status === "stopped";

    if (share.file && share.localTracked) {
      this.createActionButton(actionsEl, this.t("shares.removeLocalRecord"), async () => {
        if (!share.file) return;
        const confirmed = await new ConfirmModal(
          this.app,
          this.t("shares.confirmRemoveLocal", { title: share.file.basename }),
          (key, values) => this.t(key, values)
        ).openAndConfirm();
        if (!confirmed) return;
        await clearShareMeta(this.app, share.file);
        if (share.shareId) this.shareStatusCache.delete(share.shareId);
        new Notice(this.t("shares.localRecordRemoved"));
        await this.renderShareManagement(sectionEl);
      });
    }
  }

  private async refreshOneShareStatus(sectionEl: HTMLElement, shareId: string): Promise<void> {
    await this.fetchShareStatus(shareId);
    await this.renderShareManagement(sectionEl);
  }

  private async fetchShareStatus(shareId: string): Promise<void> {
    try {
      const status = await this.host.refreshShareStatus(shareId);
      this.shareStatusCache.set(shareId, { status });
    } catch (error) {
      this.shareStatusCache.set(shareId, { error: this.errorMessage(error) });
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return this.t("error.unknown");
  }

  private createActionButton(
    containerEl: HTMLElement,
    label: string,
    onClick: () => void | Promise<void>
  ): HTMLButtonElement {
    const button = containerEl.createEl("button", { text: label });
    button.type = "button";
    button.addEventListener("click", () => {
      void onClick();
    });
    return button;
  }
}

type DisplayShareStatus = ShareStatus | "tracked" | "not_in_account";

function formatShareStatus(status: DisplayShareStatus, t: (key: TranslationKey) => string): string {
  switch (status) {
    case "published":
      return t("shareStatus.published");
    case "password_protected":
      return t("shareStatus.passwordProtected");
    case "expired":
      return t("shareStatus.expired");
    case "stopped":
      return t("shareStatus.stopped");
    case "tracked":
      return t("shareStatus.tracked");
    case "not_in_account":
      return t("shareStatus.notInAccount");
  }
}

function formatDate(
  value: string | null | undefined,
  language: DocferryLanguage,
  t: (key: TranslationKey) => string
): string {
  if (!value) return t("date.unknown");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(language === "zh-CN" ? "zh-CN" : "en");
}

function timestamp(value?: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
