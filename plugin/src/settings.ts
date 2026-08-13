import { App, Notice, Plugin, PluginSettingTab, Setting, setIcon } from "obsidian";
import { DOCFERRY_PRODUCT_DESCRIPTION, DOCFERRY_PRODUCT_NAME, renderDocferryHeader } from "./brand";
import { canUseMediaNote } from "./media-note-availability";
import { DOCFERRY_PRODUCTION_SERVICE_URL } from "./service-url";
import type {
  AccountCenterTarget,
  DisplayUser,
  MembershipResponse,
  ShareListItemResponse
} from "./types";

export type ImageUploadQuality = "original" | "high" | "standard";

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
  activeFolderShareCount: number;
  activeFolderShareLimit: number;
  maxFolderDocumentCount: number;
  maxFolderTotalBytes: number;
  maxSingleFileSizeBytes: number;
  canCreateShare: boolean;
  canCreateFolderShare: boolean;
  canUseFullTheme: boolean;
  hasMediaNoteEntitlement: boolean;
  canUseMediaNote: boolean;
  mediaNoteProviders: string[];
  mediaNoteSourceKinds: string[];
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
  sessionToken: string;
  connectedAccount: ConnectedAccount | null;
  membership: MembershipSnapshot | null;
  clientInstanceId: string;
  defaultPasswordEnabled: boolean;
  defaultExpiresInDays: string;
  defaultImportFolder: string;
  imageUploadQuality: ImageUploadQuality;
  uploadConsentAcceptedAt: string;
  uploadConsentNoticeId: string;
  debug: boolean;
}

export const DEFAULT_SETTINGS: DocferrySettings = {
  serverUrl: DOCFERRY_PRODUCTION_SERVICE_URL,
  sessionToken: "",
  connectedAccount: null,
  membership: null,
  clientInstanceId: "",
  defaultPasswordEnabled: false,
  defaultExpiresInDays: "never",
  defaultImportFolder: "Docferry Imports",
  imageUploadQuality: "original",
  uploadConsentAcceptedAt: "",
  uploadConsentNoticeId: "",
  debug: false
};

export interface SettingsHost {
  docferrySettings: DocferrySettings;
  saveSettings(): Promise<void>;
  testConnection(): Promise<void>;
  startLogin(): Promise<void>;
  startSignup(): Promise<void>;
  disconnectAccount(): Promise<void>;
  refreshMembership(force?: boolean): Promise<void>;
  openMembershipCenter(): Promise<void>;
  openAccountCenterTarget(target: AccountCenterTarget): Promise<void>;
}

type SettingsSection = "account" | "preferences";

const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string; icon: string }> = [
  { id: "account", label: "Account", icon: "user" },
  { id: "preferences", label: "Preferences", icon: "settings" }
];

export class DocferrySettingTab extends PluginSettingTab {
  private activeSection: SettingsSection = "account";

  constructor(app: App, private readonly host: SettingsHost & Plugin) {
    super(app, host);
  }

  display(): void {
    this.render();
  }

  private render(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("docferry-settings-tab");

    renderDocferryHeader(containerEl, DOCFERRY_PRODUCT_NAME, DOCFERRY_PRODUCT_DESCRIPTION);

    const layout = containerEl.createDiv({ cls: "docferry-settings-layout" });
    this.renderNavigation(layout);
    const body = layout.createDiv({ cls: "docferry-settings-body" });
    if (this.activeSection === "account") this.renderAccountSection(body);
    if (this.activeSection === "preferences") this.renderPreferencesSection(body);
  }

  refreshForAuthChange(): void {
    this.activeSection = "account";
    this.render();
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
        this.render();
      });
    }
  }

  private renderAccountSection(containerEl: HTMLElement): void {
    const account = this.host.docferrySettings.connectedAccount;
    const connected = Boolean(this.host.docferrySettings.sessionToken);
    const displayName = account?.displayUser?.name || account?.displayUser?.email || "Not connected";
    const panel = containerEl.createDiv({ cls: "docferry-settings-panel docferry-account-panel" });
    const header = panel.createDiv({ cls: "docferry-panel-header" });
    const copy = header.createDiv();
    copy.createDiv({ text: "Account", cls: "docferry-heading docferry-heading-3" });
    copy.createEl("p", {
      text: connected ? "Your Bondie account and DocFerry plan." : "Connect to publish and manage shared notes."
    });

    const status = header.createDiv({
      text: connected ? "Connected" : "Not connected",
      cls: connected ? "docferry-status-badge is-ok" : "docferry-status-badge"
    });

    const card = panel.createDiv({ cls: "docferry-account-card" });
    renderAccountAvatar(card, account?.displayUser, "docferry-account-avatar");
    const details = card.createDiv({ cls: "docferry-account-details" });
    details.createDiv({ text: displayName, cls: "docferry-heading docferry-heading-4" });
    if (account?.displayUser?.email && account.displayUser.email !== displayName) {
      details.createEl("p", { text: account.displayUser.email });
    }
    details.createEl("p", { text: connected ? "Connected to Bondie" : "Use an existing account or create a new one." });

    if (connected) this.renderMembershipCard(panel);
    this.renderAccountActions(panel, connected);
    status.setAttr("aria-label", connected ? "Connected" : "Current account status");
  }

  private renderAccountActions(containerEl: HTMLElement, connected: boolean): void {
    const actions = containerEl.createDiv({ cls: "docferry-account-quick-actions" });
    if (!connected) {
      const loginButton = actions.createEl("button", { cls: "mod-cta", attr: { type: "button" } });
      appendButtonLabel(loginButton, "log-in", "Log in");
      addAsyncClickListener(loginButton, async () => this.host.startLogin());
      const signupButton = actions.createEl("button", { attr: { type: "button" } });
      appendButtonLabel(signupButton, "user-plus", "Create account");
      addAsyncClickListener(signupButton, async () => this.host.startSignup());
      return;
    }
    const refreshButton = actions.createEl("button", { attr: { type: "button" } });
    appendButtonLabel(refreshButton, "refresh-cw", "Refresh");
    addAsyncClickListener(refreshButton, async () => {
      await this.host.refreshMembership(true);
      this.render();
    });
    const billingButton = actions.createEl("button", { cls: "mod-cta", attr: { type: "button" } });
    appendButtonLabel(billingButton, "credit-card", "Manage plan");
    addAsyncClickListener(billingButton, async () => this.host.openMembershipCenter());
    const accountButton = actions.createEl("button", { attr: { type: "button", "aria-label": "Open Account Center" } });
    appendButtonLabel(accountButton, "user", "Account Center");
    addAsyncClickListener(accountButton, async () => this.host.openAccountCenterTarget("profile"));
  }

  private renderMembershipCard(containerEl: HTMLElement): void {
    const membership = this.host.docferrySettings.membership;
    const connected = Boolean(this.host.docferrySettings.sessionToken);
    const card = containerEl.createDiv({ cls: "docferry-membership-card" });
    const header = card.createDiv({ cls: "docferry-membership-header" });
    const copy = header.createDiv();
    copy.createDiv({ text: "Plan and usage", cls: "docferry-heading docferry-heading-4" });
    copy.createEl("p", {
      text: membership
        ? `Updated ${formatDateTime(membership.refreshedAt)}.`
        : connected
          ? "Refresh to load your current plan."
          : "Log in to view your plan."
    });
    header.createSpan({
      text: membership?.planDisplayName || (connected ? "Unknown" : "Not connected"),
      cls: `docferry-status-badge ${membership && membership.planKey !== "free" ? "is-ok" : ""}`
    });

    const stats = card.createDiv({ cls: "docferry-membership-stats" });
    this.renderMembershipStat(stats, "Shares", membership ? `${membership.activeShareCount}/${membership.activeShareLimit}` : "-");
    this.renderMembershipStat(stats, "File size", membership ? formatBytes(membership.maxSingleFileSizeBytes) : "-");
    if (membership?.unavailableReason) {
      card.createDiv({ text: membershipUnavailableMessage(membership.unavailableReason), cls: "docferry-membership-note" });
    }

  }

  private renderMembershipStat(containerEl: HTMLElement, label: string, value: string): void {
    const item = containerEl.createDiv({ cls: "docferry-membership-stat" });
    item.createSpan({ text: label });
    item.createEl("strong", { text: value });
  }

  private renderPreferencesSection(containerEl: HTMLElement): void {
    const defaultsPanel = containerEl.createDiv({ cls: "docferry-settings-panel" });
    const defaultsHeader = defaultsPanel.createDiv({ cls: "docferry-panel-header" });
    const defaultsCopy = defaultsHeader.createDiv();
    defaultsCopy.createDiv({ text: "Preferences", cls: "docferry-heading docferry-heading-3" });
    defaultsCopy.createEl("p", { text: "Defaults used when you share or import a note." });

    new Setting(defaultsPanel)
      .setName("Password by default")
      .setDesc("Preselect password protection in the publish dialog.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.host.docferrySettings.defaultPasswordEnabled)
          .onChange(async (value) => {
            this.host.docferrySettings.defaultPasswordEnabled = value;
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
          .setValue(this.host.docferrySettings.defaultExpiresInDays)
          .onChange(async (value) => {
            this.host.docferrySettings.defaultExpiresInDays = value;
            await this.host.saveSettings();
          })
      );

    new Setting(defaultsPanel)
      .setName("Default import folder")
      .setDesc("Used by the dashboard import flow and as the default value in the import dialog.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.defaultImportFolder)
          .setValue(this.host.docferrySettings.defaultImportFolder || DEFAULT_SETTINGS.defaultImportFolder)
          .onChange(async (value) => {
            this.host.docferrySettings.defaultImportFolder = normalizeVaultFolder(value) || DEFAULT_SETTINGS.defaultImportFolder;
            await this.host.saveSettings();
          })
      );

    const advanced = containerEl.createEl("details", { cls: "docferry-settings-advanced" });
    advanced.createEl("summary", { text: "Advanced" });
    const advancedBody = advanced.createDiv({ cls: "docferry-settings-advanced-body" });
    new Setting(advancedBody)
      .setName("Test connection")
      .setDesc("Check whether DocFerry can reach the service.")
      .addButton((button) => button.setButtonText("Test").onClick(() => void this.host.testConnection()));
    new Setting(advancedBody)
      .setName("Debug logging")
      .setDesc("Include extra details in the developer console for troubleshooting.")
      .addToggle((toggle) =>
        toggle.setValue(this.host.docferrySettings.debug).onChange(async (value) => {
          this.host.docferrySettings.debug = value;
          await this.host.saveSettings();
          new Notice(value ? "Debug logging enabled" : "Debug logging disabled");
        })
      );
    new Setting(advancedBody).setName("Plugin version").setDesc(this.host.manifest.version);
    new Setting(advancedBody)
      .setName("Disconnect account")
      .setDesc("Remove this Bondie account from this Obsidian device.")
      .addButton((button) => {
        button.setButtonText("Disconnect");
        button.setWarning();
        button.setDisabled(!this.host.docferrySettings.sessionToken && !this.host.docferrySettings.connectedAccount);
        button.onClick(async () => {
          await this.host.disconnectAccount();
          this.activeSection = "account";
          this.render();
        });
      });
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
    return "Refresh your account before changing plans.";
  }
  if (reason === "synapsehub_runtime_unreachable") {
    return "Plan refresh is temporarily unavailable.";
  }
  if (reason === "synapsehub_runtime_failed") {
    return "Plan refresh failed. Try again later.";
  }
  if (reason) {
    return "Plan refresh is temporarily unavailable.";
  }
  return "";
}

export function shareCountLabel(count: number): string {
  if (count === 1) return "1 shared note.";
  return `${count} shared notes.`;
}

export function membershipFromResponse(
  response: MembershipResponse,
  refreshedAt = new Date().toISOString()
): MembershipSnapshot {
  return {
    productKey: response.product_key,
    planKey: response.plan_key,
    planDisplayName: response.plan_display_name,
    entitlementKey: response.entitlement_key ?? null,
    activeShareCount: response.active_share_count,
    activeShareLimit: response.active_share_limit,
    activeFolderShareCount: response.active_folder_share_count,
    activeFolderShareLimit: response.active_folder_share_limit,
    maxFolderDocumentCount: response.max_folder_document_count,
    maxFolderTotalBytes: response.max_folder_total_bytes,
    maxSingleFileSizeBytes: response.max_single_file_size_bytes,
    canCreateShare: response.can_create_share,
    canCreateFolderShare: response.can_create_folder_share,
    canUseFullTheme: response.can_use_full_theme,
    hasMediaNoteEntitlement: response.feature_gates["docferry.ai.assist"] === true,
    canUseMediaNote: canUseMediaNote(
      response.feature_gates["docferry.ai.assist"] === true,
      {
        enabled: response.media_note.enabled,
        supportedProviders: response.media_note.supported_providers
      }
    ),
    mediaNoteProviders: [...response.media_note.supported_providers],
    mediaNoteSourceKinds: [...response.media_note.supported_source_kinds],
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

function addAsyncClickListener(button: HTMLElement, handler: () => Promise<void>): void {
  button.addEventListener("click", () => {
    void handler();
  });
}
