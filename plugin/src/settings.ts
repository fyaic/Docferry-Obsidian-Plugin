import { App, Notice, Plugin, PluginSettingTab, Setting, setIcon } from "obsidian";
import { DOCFERRY_PRODUCT_DESCRIPTION, DOCFERRY_PRODUCT_NAME, renderDocferryHeader } from "./brand";
import type { BillingPlan, DisplayUser, ShareListItemResponse } from "./types";

export type AuthMode = "manual-token" | "company-sso";
export type ImageUploadQuality = "original" | "high" | "standard";
export const MANUAL_TOKEN_ENTRY_ENABLED = false;

export interface ConnectedAccount {
  productSubjectId: string;
  productKey?: string | null;
  productInstanceId?: string | null;
  displayUser?: DisplayUser | null;
  connectedAt: string;
}

export interface MembershipSnapshot {
  productKey: string;
  planKey: string;
  planDisplayName: string;
  entitlementKey?: string | null;
  activeShareCount: number;
  activeShareLimit: number;
  maxSingleFileSizeBytes: number;
  canCreateShare: boolean;
  source: string;
  cacheStatus: string;
  refreshedAt: string;
  unavailableReason?: string | null;
  billingEnabled: boolean;
  billingPlans: Array<{
    planKey: string;
    displayName: string;
    amountMinorUnits: number;
    currency: string;
    billingInterval: string;
    testOnly: boolean;
  }>;
}

export interface DocferrySettings {
  serverUrl: string;
  manualApiToken: string;
  sessionToken: string;
  connectedAccount: ConnectedAccount | null;
  membership: MembershipSnapshot | null;
  clientInstanceId: string;
  /** @deprecated migrated to manualApiToken/sessionToken */
  apiToken: string;
  authMode: AuthMode;
  defaultPasswordEnabled: boolean;
  defaultExpiresInDays: string;
  defaultImportFolder: string;
  imageUploadQuality: ImageUploadQuality;
  uploadConsentAcceptedAt: string;
  uploadConsentNoticeId: string;
  debug: boolean;
}

export const DEFAULT_SETTINGS: DocferrySettings = {
  serverUrl: "https://docferry.fuyonder.tech",
  manualApiToken: "",
  sessionToken: "",
  connectedAccount: null,
  membership: null,
  clientInstanceId: "",
  apiToken: "",
  authMode: "company-sso",
  defaultPasswordEnabled: false,
  defaultExpiresInDays: "never",
  defaultImportFolder: "Docferry Imports",
  imageUploadQuality: "original",
  uploadConsentAcceptedAt: "",
  uploadConsentNoticeId: "",
  debug: false
};

export interface SettingsHost {
  settings: DocferrySettings;
  saveSettings(): Promise<void>;
  testConnection(): Promise<void>;
  startLogin(): Promise<void>;
  disconnectAccount(): Promise<void>;
  refreshMembership(force?: boolean): Promise<void>;
  openMembershipCenter(): Promise<void>;
  requestAccessUpgrade(source: "plugin_settings" | "plugin_dashboard"): Promise<void>;
  listShares(): Promise<ShareListItemResponse[]>;
  updateShareFromList(share: ShareListItemResponse): Promise<void>;
  stopShareFromList(share: ShareListItemResponse): Promise<void>;
  importShareUrl(initialUrl?: unknown): Promise<void>;
}

type SettingsSection = "account" | "shares" | "import" | "config";

const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string; icon: string }> = [
  { id: "account", label: "Account", icon: "user" },
  { id: "shares", label: "Shares", icon: "files" },
  { id: "import", label: "Import", icon: "download" },
  { id: "config", label: "Config", icon: "settings" }
];

export class DocferrySettingTab extends PluginSettingTab {
  private activeSection: SettingsSection = "account";
  private shareError = "";
  private shareListLoaded = false;
  private shareListLoading = false;
  private shareListKey = "";
  private shares: ShareListItemResponse[] = [];

  constructor(app: App, private readonly host: SettingsHost & Plugin) {
    super(app, host);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("docferry-settings-tab");

    renderDocferryHeader(containerEl, DOCFERRY_PRODUCT_NAME, DOCFERRY_PRODUCT_DESCRIPTION);

    const layout = containerEl.createDiv({ cls: "docferry-settings-layout" });
    this.renderNavigation(layout);
    const body = layout.createDiv({ cls: "docferry-settings-body" });
    if (this.activeSection === "account") this.renderAccountSection(body);
    if (this.activeSection === "shares") this.renderSharesSection(body);
    if (this.activeSection === "import") this.renderImportSection(body);
    if (this.activeSection === "config") this.renderConfigSection(body);
  }

  refreshForAuthChange(): void {
    this.activeSection = "account";
    this.resetShareList();
    this.display();
  }

  refreshForShareChange(): void {
    this.resetShareList();
    if (this.activeSection === "shares") this.display();
  }

  private renderNavigation(containerEl: HTMLElement): void {
    const nav = containerEl.createDiv({ cls: "docferry-settings-nav", attr: { role: "tablist" } });
    for (const section of SETTINGS_SECTIONS) {
      const button = nav.createEl("button", {
        cls: "docferry-settings-nav-button",
        attr: {
          type: "button",
          role: "tab",
          "aria-selected": String(this.activeSection === section.id)
        }
      });
      const icon = button.createSpan({ cls: "docferry-settings-nav-icon", attr: { "aria-hidden": "true" } });
      setIcon(icon, section.icon);
      button.createSpan({ text: section.label, cls: "docferry-settings-nav-label" });
      if (this.activeSection === section.id) button.addClass("is-active");
      button.addEventListener("click", () => {
        this.activeSection = section.id;
        this.display();
      });
    }
  }

  private renderAccountSection(containerEl: HTMLElement): void {
    const account = this.host.settings.connectedAccount;
    const displayName = account?.displayUser?.name || account?.displayUser?.email || "Not connected";
    const panel = containerEl.createDiv({ cls: "docferry-settings-panel docferry-account-panel" });
    const header = panel.createDiv({ cls: "docferry-panel-header" });
    const copy = header.createDiv();
    copy.createEl("h3", { text: "Account" });
    copy.createEl("p", {
      text: account ? "Fuyonder account is connected." : "Connect a Fuyonder account."
    });

    const status = header.createDiv({
      text: account ? "Connected" : "Not connected",
      cls: account ? "docferry-status-badge is-ok" : "docferry-status-badge"
    });

    const card = panel.createDiv({ cls: "docferry-account-card" });
    renderAccountAvatar(card, account?.displayUser, "docferry-account-avatar");
    const details = card.createDiv({ cls: "docferry-account-details" });
    details.createEl("h4", { text: displayName });
    if (account?.displayUser?.email && account.displayUser.email !== displayName) {
      details.createEl("p", { text: account.displayUser.email });
    }
    if (account?.connectedAt) {
      details.createEl("p", { text: `Connected ${formatDateTime(account.connectedAt)}` });
    }
    if (!account) {
      details.createEl("p", { text: "Use Connect to start Auth0 login." });
    }

    this.renderMembershipCard(panel);
    this.renderAccessRequestPanel(panel);

    const actions = panel.createDiv({ cls: "docferry-settings-actions" });
    if (this.host.settings.authMode === "company-sso") {
      const connectButton = actions.createEl("button", {
        text: account ? "Refresh account" : "Connect",
        cls: "mod-cta",
        attr: { type: "button" }
      });
      connectButton.addEventListener("click", async () => {
        if (account) {
          await this.host.refreshMembership(true);
          this.display();
        } else {
          await this.host.startLogin();
        }
      });
    }
    const testButton = actions.createEl("button", { text: "Test connection", attr: { type: "button" } });
    testButton.addEventListener("click", async () => {
      await this.host.testConnection();
      this.display();
    });
    if (this.host.settings.authMode === "company-sso") {
      const disconnectButton = actions.createEl("button", { text: "Disconnect", attr: { type: "button" } });
      disconnectButton.disabled = !account && !this.host.settings.sessionToken;
      disconnectButton.addEventListener("click", async () => {
        await this.host.disconnectAccount();
        this.resetShareList();
        this.display();
      });
    }
    status.setAttr("aria-label", account ? "Connected" : "Current account status");
  }

  private renderMembershipCard(containerEl: HTMLElement): void {
    const membership = this.host.settings.membership;
    const connected = this.host.settings.authMode === "company-sso" && Boolean(this.host.settings.sessionToken);
    const card = containerEl.createDiv({ cls: "docferry-membership-card" });
    const header = card.createDiv({ cls: "docferry-membership-header" });
    const copy = header.createDiv();
    copy.createEl("h4", { text: "Access limits" });
    copy.createEl("p", {
      text: membership
        ? `${membershipAccessLabel(membership)} limits refreshed ${formatDateTime(membership.refreshedAt)}.`
        : connected
          ? "Access limits have not been refreshed."
          : "Connect an account to view access limits."
    });
    header.createSpan({
      text: membership?.planDisplayName || (connected ? "Unknown" : "Not connected"),
      cls: `docferry-status-badge ${membership && membership.planKey !== "free" ? "is-ok" : ""}`
    });

    const stats = card.createDiv({ cls: "docferry-membership-stats" });
    this.renderMembershipStat(stats, "Active shares", membership ? `${membership.activeShareCount}/${membership.activeShareLimit}` : "-");
    this.renderMembershipStat(stats, "Single file", membership ? formatBytes(membership.maxSingleFileSizeBytes) : "-");
    this.renderMembershipStat(stats, "Access", membership ? membershipAccessLabel(membership) : "-");
    if (membership?.unavailableReason) {
      card.createDiv({ text: membershipUnavailableMessage(membership.unavailableReason), cls: "docferry-membership-note" });
    }

    if (membership?.billingEnabled) {
      const center = card.createDiv({ cls: "docferry-membership-center" });
      const centerCopy = center.createDiv({ cls: "docferry-membership-center-copy" });
      centerCopy.createEl("h5", { text: "Billing" });
      centerCopy.createEl("p", { text: "Manage paid access on the DocFerry web dashboard." });
      const centerButton = center.createEl("button", {
        text: "Open billing",
        cls: "mod-cta",
        attr: { type: "button" }
      });
      centerButton.disabled = !this.host.settings.serverUrl || !connected;
      centerButton.addEventListener("click", async () => {
        await this.host.openMembershipCenter();
      });
    }

  }

  private renderAccessRequestPanel(containerEl: HTMLElement): void {
    const connected = this.host.settings.authMode === "company-sso" && Boolean(this.host.settings.sessionToken);
    const panel = containerEl.createDiv({ cls: "docferry-account-request-panel docferry-settings-request-panel" });
    const copy = panel.createDiv({ cls: "docferry-account-request-copy" });
    copy.createEl("h4", { text: "Request Plus access" });
    copy.createEl("p", {
      text: connected
        ? "Tell us what you want to publish. Staff can approve Plus for 10 active shares and 5 MiB per file."
        : "Connect your Fuyonder account before requesting Plus access."
    });
    const requestButton = panel.createEl("button", { text: "Request access", cls: "mod-cta", attr: { type: "button" } });
    requestButton.disabled = !connected;
    requestButton.addEventListener("click", async () => {
      await this.host.requestAccessUpgrade("plugin_settings");
      this.display();
    });
  }

  private renderMembershipStat(containerEl: HTMLElement, label: string, value: string): void {
    const item = containerEl.createDiv({ cls: "docferry-membership-stat" });
    item.createSpan({ text: label });
    item.createEl("strong", { text: value });
  }

  private renderSharesSection(containerEl: HTMLElement): void {
    const currentKey = this.currentShareListKey();
    if (this.shareListKey && this.shareListKey !== currentKey) this.resetShareList();
    const panel = containerEl.createDiv({ cls: "docferry-settings-panel" });
    const header = panel.createDiv({ cls: "docferry-panel-header" });
    const copy = header.createDiv();
    copy.createEl("h3", { text: "Shares" });
    copy.createEl("p", { text: `${this.shares.length} loaded from this account across vaults.` });
    const refreshButton = header.createEl("button", { text: "Refresh", attr: { type: "button" } });
    refreshButton.disabled = this.shareListLoading;
    refreshButton.addEventListener("click", () => {
      void this.refreshShares();
    });

    if (!this.hasAuthForShares()) {
      const empty = panel.createDiv({ cls: "docferry-settings-empty" });
      empty.createEl("h4", { text: "Not connected" });
      empty.createEl("p", { text: "Connect your Fuyonder account." });
      return;
    }

    if (!this.shareListLoaded && !this.shareListLoading) {
      void this.refreshShares();
    }

    if (this.shareListLoading) {
      this.renderShareSkeleton(panel);
      return;
    }

    if (this.shareError) {
      const error = panel.createDiv({ cls: "docferry-settings-empty is-error" });
      error.createEl("h4", { text: "Share list unavailable" });
      error.createEl("p", { text: this.shareError });
      return;
    }

    if (!this.shares.length) {
      const empty = panel.createDiv({ cls: "docferry-settings-empty" });
      empty.createEl("h4", { text: "No shares yet" });
      empty.createEl("p", { text: "Publish a note from the file menu." });
      return;
    }

    const list = panel.createDiv({ cls: "docferry-share-list" });
    for (const share of this.shares) {
      const row = list.createDiv({ cls: "docferry-share-row" });
      const main = row.createDiv({ cls: "docferry-share-main" });
      main.createEl("h4", { text: share.title || share.source_path });
      main.createEl("p", { text: share.source_path });
      const meta = main.createDiv({ cls: "docferry-share-meta" });
      meta.createSpan({ text: vaultLabel(share) });
      meta.createSpan({ text: `Updated ${formatDateTime(share.updated_at)}` });
      meta.createSpan({ text: expiryLabel(share) });

      const badges = row.createDiv({ cls: "docferry-share-badges" });
      badges.createSpan({ text: statusLabel(share.status), cls: `docferry-pill ${statusClass(share.status)}` });
      badges.createSpan({
        text: share.password_enabled ? "Password on" : "No password",
        cls: `docferry-pill ${share.password_enabled ? "is-locked" : ""}`
      });

      const actions = row.createDiv({ cls: "docferry-share-actions" });
      const copyButton = actions.createEl("button", { text: "Copy", attr: { type: "button" } });
      copyButton.addEventListener("click", async () => {
        await navigator.clipboard.writeText(share.url);
        new Notice("Share link copied");
      });
      const openButton = actions.createEl("button", { text: "Open", attr: { type: "button" } });
      openButton.addEventListener("click", () => {
        window.open(share.url);
      });
      const updateButton = actions.createEl("button", { text: "Update", attr: { type: "button" } });
      updateButton.disabled = share.status === "stopped";
      updateButton.addEventListener("click", async () => {
        await this.host.updateShareFromList(share);
      });
      if (share.status === "stopped" || share.status === "expired") {
        actions.createSpan({ text: statusLabel(share.status), cls: "docferry-action-state" });
      } else {
        const stopButton = actions.createEl("button", {
          cls: "docferry-stop-share-button",
          attr: { type: "button", "aria-label": `Stop sharing ${share.title || share.source_path}` }
        });
        appendButtonLabel(stopButton, "unlink", "Stop sharing");
        stopButton.addEventListener("click", async () => {
          await this.host.stopShareFromList(share);
          await this.refreshShares();
        });
      }
    }
  }

  private renderImportSection(containerEl: HTMLElement): void {
    let shareUrl = "";
    const panel = containerEl.createDiv({ cls: "docferry-settings-panel docferry-import-panel" });
    const header = panel.createDiv({ cls: "docferry-panel-header" });
    const copy = header.createDiv();
    copy.createEl("h3", { text: "Import" });
    copy.createEl("p", { text: "Import one DocFerry URL into this vault." });

    const form = panel.createDiv({ cls: "docferry-import-form" });
    const input = form.createEl("input", {
      type: "text",
      placeholder: "https://docferry.fuyonder.tech/s/...",
      cls: "docferry-import-input"
    });
    input.addEventListener("input", () => {
      shareUrl = input.value.trim();
    });

    const actions = form.createDiv({ cls: "docferry-import-actions" });
    const importButton = actions.createEl("button", { text: "Import URL", cls: "mod-cta", attr: { type: "button" } });
    importButton.addEventListener("click", async () => {
      await this.host.importShareUrl(shareUrl);
      input.value = "";
      shareUrl = "";
    });

    const dialogButton = actions.createEl("button", { text: "Open dialog", attr: { type: "button" } });
    dialogButton.addEventListener("click", async () => {
      await this.host.importShareUrl();
    });

    const details = panel.createDiv({ cls: "docferry-import-details" });
    details.createSpan({ text: `Default folder: ${this.host.settings.defaultImportFolder || DEFAULT_SETTINGS.defaultImportFolder}` });
    details.createSpan({ text: "Scope: single shared document" });
    details.createSpan({ text: "Assets: explicit references only" });
  }

  private renderShareSkeleton(containerEl: HTMLElement): void {
    const list = containerEl.createDiv({ cls: "docferry-share-list" });
    for (let index = 0; index < 3; index += 1) {
      const row = list.createDiv({ cls: "docferry-share-row is-loading" });
      const main = row.createDiv({ cls: "docferry-share-main" });
      main.createDiv({ cls: "docferry-skeleton-line is-title" });
      main.createDiv({ cls: "docferry-skeleton-line" });
    }
  }

  private async refreshShares(): Promise<void> {
    this.shareListLoading = true;
    this.shareError = "";
    this.shareListKey = this.currentShareListKey();
    this.display();
    try {
      this.shares = await this.host.listShares();
      this.shareListLoaded = true;
    } catch (error) {
      this.shareError = error instanceof Error ? error.message : "Could not load shares.";
      this.shares = [];
    } finally {
      this.shareListLoading = false;
      this.display();
    }
  }

  private resetShareList(): void {
    this.shareError = "";
    this.shareListLoaded = false;
    this.shareListLoading = false;
    this.shareListKey = "";
    this.shares = [];
  }

  private hasAuthForShares(): boolean {
    if (this.host.settings.authMode === "company-sso") return Boolean(this.host.settings.sessionToken);
    return Boolean(this.host.settings.manualApiToken || this.host.settings.apiToken);
  }

  private currentShareListKey(): string {
    const settings = this.host.settings;
    const tokenTail =
      settings.authMode === "company-sso"
        ? settings.sessionToken.slice(-8)
        : (settings.manualApiToken || settings.apiToken).slice(-8);
    const ownerHint =
      settings.authMode === "company-sso"
        ? settings.connectedAccount?.productSubjectId || "pending"
        : "manual";
    return `${settings.serverUrl}|${settings.authMode}|${ownerHint}|${tokenTail}`;
  }

  private renderConfigSection(containerEl: HTMLElement): void {
    const servicePanel = containerEl.createDiv({ cls: "docferry-settings-panel" });
    const serviceHeader = servicePanel.createDiv({ cls: "docferry-panel-header" });
    const serviceCopy = serviceHeader.createDiv();
    serviceCopy.createEl("h3", { text: "Config" });
    serviceCopy.createEl("p", { text: "Connection, defaults and diagnostics." });

    new Setting(servicePanel)
      .setName("Server URL")
      .setDesc("DocFerry service URL.")
      .addText((text) =>
        text
          .setPlaceholder("https://docferry.fuyonder.tech")
          .setValue(this.host.settings.serverUrl)
          .onChange(async (value) => {
            this.host.settings.serverUrl = value.trim();
            await this.host.saveSettings();
          })
      );

    if (MANUAL_TOKEN_ENTRY_ENABLED) {
      new Setting(servicePanel)
        .setName("Auth mode")
        .setDesc("Manual token or Fuyonder account.")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("manual-token", "Manual token")
            .addOption("company-sso", "Fuyonder account")
            .setValue(this.host.settings.authMode)
            .onChange(async (value) => {
              this.host.settings.authMode = value as AuthMode;
              await this.host.saveSettings();
              this.display();
            })
        );
    } else {
      new Setting(servicePanel)
        .setName("Sign-in method")
        .setDesc("DocFerry uses Fuyonder account login for this release.")
        .addButton((button) => {
          button.setButtonText("Connect");
          button.setCta();
          button.onClick(async () => {
            this.host.settings.authMode = "company-sso";
            await this.host.saveSettings();
            await this.host.startLogin();
          });
        });
    }

    if (MANUAL_TOKEN_ENTRY_ENABLED && this.host.settings.authMode === "manual-token") {
      new Setting(servicePanel)
        .setName("API token")
        .setDesc("Internal seed token for the DocFerry service.")
        .addText((text) => {
          text.inputEl.type = "password";
          text
            .setPlaceholder("Paste token")
            .setValue(this.host.settings.manualApiToken)
            .onChange(async (value) => {
              this.host.settings.manualApiToken = value.trim();
              this.host.settings.apiToken = this.host.settings.manualApiToken;
              await this.host.saveSettings();
            });
        });
    }

    const defaultsPanel = containerEl.createDiv({ cls: "docferry-settings-panel" });
    const defaultsHeader = defaultsPanel.createDiv({ cls: "docferry-panel-header" });
    const defaultsCopy = defaultsHeader.createDiv();
    defaultsCopy.createEl("h3", { text: "Defaults" });
    defaultsCopy.createEl("p", { text: "Initial values for publish and import." });

    new Setting(defaultsPanel)
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

    new Setting(defaultsPanel)
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

    new Setting(defaultsPanel)
      .setName("Default import folder")
      .setDesc("Used by the dashboard import flow and as the default value in the import dialog.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.defaultImportFolder)
          .setValue(this.host.settings.defaultImportFolder || DEFAULT_SETTINGS.defaultImportFolder)
          .onChange(async (value) => {
            this.host.settings.defaultImportFolder = normalizeVaultFolder(value) || DEFAULT_SETTINGS.defaultImportFolder;
            await this.host.saveSettings();
          })
      );

    new Setting(defaultsPanel)
      .setName("Image quality")
      .setDesc("Current alpha always uploads original image bytes. Optimized tiers are reserved for a later plan.");

    new Setting(defaultsPanel)
      .setName("Loaded plugin version")
      .setDesc(this.host.manifest.version);

    const diagnosticsPanel = containerEl.createDiv({ cls: "docferry-settings-panel" });
    const diagnosticsHeader = diagnosticsPanel.createDiv({ cls: "docferry-panel-header" });
    const diagnosticsCopy = diagnosticsHeader.createDiv();
    diagnosticsCopy.createEl("h3", { text: "Diagnostics" });
    diagnosticsCopy.createEl("p", { text: "Local troubleshooting controls." });

    new Setting(diagnosticsPanel)
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

export function normalizeVaultFolder(value: unknown): string {
  const raw = typeof value === "string" ? value : "";
  return raw
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => part.replace(/[\\/:*?"<>|]+/g, "-").trim().replace(/^\.+|\.+$/g, ""))
    .filter(Boolean)
    .join("/");
}

export function initialsFromDisplayUser(user?: DisplayUser | null): string {
  const value = user?.name || user?.email || "DF";
  const parts = value.split(/[\s@._-]+/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return initials || "DF";
}

export function renderAccountAvatar(containerEl: HTMLElement, user?: DisplayUser | null, className = "docferry-account-avatar"): HTMLElement {
  const avatar = containerEl.createDiv({ cls: className, attr: { "aria-hidden": "true" } });
  if (user?.picture) {
    const image = avatar.createEl("img", {
      attr: {
        alt: "",
        src: user.picture,
        decoding: "async",
        loading: "lazy",
        referrerpolicy: "no-referrer"
      }
    });
    image.addEventListener(
      "error",
      () => {
        image.remove();
        avatar.setText(initialsFromDisplayUser(user));
      },
      { once: true }
    );
    return avatar;
  }
  avatar.setText(initialsFromDisplayUser(user));
  return avatar;
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function expiryLabel(share: ShareListItemResponse): string {
  if (share.status === "stopped" && share.stopped_at) return `Stopped ${formatDateTime(share.stopped_at)}`;
  if (!share.expires_at) return "No expiration";
  if (share.status === "expired") return `Expired ${formatDateTime(share.expires_at)}`;
  return `Expires ${formatDateTime(share.expires_at)}`;
}

export function vaultLabel(share?: Pick<ShareListItemResponse, "vault_name" | "vault_id"> | string | null): string {
  if (typeof share === "object" && share !== null) {
    return share.vault_name || "Obsidian vault";
  }
  return "Obsidian vault";
}

export function statusLabel(status: ShareListItemResponse["status"]): string {
  if (status === "password_protected") return "Password";
  if (status === "expired") return "Expired";
  if (status === "stopped") return "Stopped";
  return "Published";
}

export function statusClass(status: ShareListItemResponse["status"]): string {
  if (status === "password_protected") return "is-locked";
  if (status === "expired") return "is-warning";
  if (status === "stopped") return "is-muted";
  return "is-ok";
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 bytes";
  if (value % (1024 * 1024) === 0) return `${value / (1024 * 1024)} MiB`;
  if (value % 1024 === 0) return `${value / 1024} KiB`;
  return `${value} bytes`;
}

export function membershipUnavailableMessage(reason?: string | null): string {
  if (reason === "synapsehub_user_session_required") {
    return "Reconnect your Fuyonder account before managing paid access. DocFerry is using Free limits until the session is refreshed.";
  }
  if (reason === "synapsehub_runtime_unreachable") {
    return "Access refresh is unavailable. DocFerry is using Free limits until it can refresh again.";
  }
  if (reason === "synapsehub_runtime_failed") {
    return "Access refresh failed. DocFerry is using Free limits until the next successful refresh.";
  }
  if (reason) {
    return "Access refresh is temporarily unavailable. DocFerry is using Free limits until refresh succeeds.";
  }
  return "";
}

export function membershipAccessLabel(membership: MembershipSnapshot): string {
  if (membership.planKey === "free") return "Free";
  if (membership.source === "staff_manual_grant") return "Plus";
  if (membership.planDisplayName) return membership.planDisplayName;
  return "Plus";
}

export function membershipFromResponse(
  response: {
    product_key: string;
    plan_key: string;
    plan_display_name: string;
    entitlement_key?: string | null;
    active_share_count: number;
    active_share_limit: number;
    max_single_file_size_bytes: number;
    can_create_share: boolean;
    limit_source: string;
    cache: { status: string };
    unavailable_reason?: string | null;
    billing: { enabled: boolean; plans: BillingPlan[] };
  },
  refreshedAt = new Date().toISOString()
): MembershipSnapshot {
  return {
    productKey: response.product_key,
    planKey: response.plan_key,
    planDisplayName: response.plan_display_name,
    entitlementKey: response.entitlement_key ?? null,
    activeShareCount: response.active_share_count,
    activeShareLimit: response.active_share_limit,
    maxSingleFileSizeBytes: response.max_single_file_size_bytes,
    canCreateShare: response.can_create_share,
    source: response.limit_source,
    cacheStatus: response.cache.status,
    refreshedAt,
    unavailableReason: response.unavailable_reason ?? null,
    billingEnabled: Boolean(response.billing.enabled),
    billingPlans: response.billing.plans.map((plan) => ({
      planKey: plan.plan_key,
      displayName: plan.display_name,
      amountMinorUnits: plan.amount_minor_units,
      currency: plan.currency,
      billingInterval: plan.billing_interval,
      testOnly: Boolean(plan.test_only)
    }))
  };
}

function appendButtonLabel(button: HTMLElement, iconName: string, label: string): void {
  const icon = button.createSpan({ cls: "docferry-button-icon", attr: { "aria-hidden": "true" } });
  setIcon(icon, iconName);
  button.createSpan({ text: label, cls: "docferry-button-label" });
}
