import { App, Notice, Plugin, PluginSettingTab, Setting, setIcon } from "obsidian";
import { DOCFERRY_PRODUCT_DESCRIPTION, DOCFERRY_PRODUCT_NAME, renderDocferryHeader } from "./brand";
import { canUseMediaNote } from "./media-note-availability";
import type { PendingMediaNoteSubmission } from "./media-note-submission";
import type {
  DisplayUser,
  MembershipResponse,
  ShareListItemResponse
} from "./types";

export interface ConnectedAccount {
  productSubjectId: string;
  productKey?: string | null;
  productInstanceId?: string | null;
  displayUser?: DisplayUser | null;
  connectedAt: string;
}

export interface MembershipSnapshot {
  productKey: string;
  accessRole: "member";
  planKey: string;
  planDisplayName: string;
  entitlementKey?: string | null;
  activeShareCount: number;
  activeShareLimit: number | null;
  activeFolderShareCount: number;
  activeFolderShareLimit: number | null;
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
  mediaNoteActiveJobs: number;
  mediaNoteActiveJobLimit: number | null;
  mediaNoteMonthlyJobsUsed: number;
  mediaNoteMonthlyJobLimit: number | null;
  mediaNoteResetsAt: string;
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

export interface PendingMediaNoteImport {
  jobId: string;
  ownerProductSubjectId: string;
  sourceUrl: string;
  createdAt: string;
  targetPath?: string;
}

export interface DocferrySettings {
  serverUrl: string;
  sessionToken: string;
  connectedAccount: ConnectedAccount | null;
  membership: MembershipSnapshot | null;
  pendingMediaNoteImport: PendingMediaNoteImport | null;
  pendingMediaNoteSubmission: PendingMediaNoteSubmission | null;
  // The pending login handshake (state, startedAt, PKCE verifier) lives in
  // SecretStorage, never in persisted settings; see session-token-custody.ts.
  clientInstanceId: string;
  defaultPasswordEnabled: boolean;
  defaultExpiresInDays: string;
  defaultImportFolder: string;
  uploadConsentAcceptedAt: string;
  uploadConsentNoticeId: string;
  debug: boolean;
}

export const DEFAULT_SETTINGS: DocferrySettings = {
  serverUrl: "https://docferry.bondie.io",
  sessionToken: "",
  connectedAccount: null,
  membership: null,
  pendingMediaNoteImport: null,
  pendingMediaNoteSubmission: null,
  clientInstanceId: "",
  defaultPasswordEnabled: false,
  defaultExpiresInDays: "never",
  defaultImportFolder: "Docferry Imports",
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
  openDashboardHome(): Promise<void>;
  openSharesPage(): Promise<void>;
}

type SettingsPage = "account" | "sharing" | "imports" | "advanced";

const SETTINGS_PAGES: Array<{
  id: SettingsPage;
  label: string;
  icon: string;
}> = [
  { id: "account", label: "Account", icon: "user-round" },
  { id: "sharing", label: "Sharing", icon: "share-2" },
  { id: "imports", label: "Imports", icon: "folder-down" },
  { id: "advanced", label: "Advanced", icon: "wrench" }
];

export class DocferrySettingTab extends PluginSettingTab {
  private activePage: SettingsPage = "account";

  constructor(app: App, private readonly host: SettingsHost & Plugin) {
    super(app, host);
  }

  display(): void {
    this.activePage = "account";
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
    if (this.activePage === "account") this.renderConnectionSection(body);
    if (this.activePage === "sharing") this.renderSharingSection(body);
    if (this.activePage === "imports") this.renderImportsSection(body);
    if (this.activePage === "advanced") this.renderAdvancedSection(body);
  }

  refreshForAuthChange(): void {
    this.render();
  }

  private renderNavigation(containerEl: HTMLElement): void {
    const navigation = containerEl.createDiv({
      cls: "docferry-settings-nav",
      attr: { role: "navigation", "aria-label": "DocFerry settings" }
    });
    for (const page of SETTINGS_PAGES) {
      const button = navigation.createEl("button", {
        cls: `docferry-settings-nav-button ${page.id === this.activePage ? "is-active" : ""}`,
        attr: {
          type: "button",
          "aria-current": page.id === this.activePage ? "page" : "false"
        }
      });
      const icon = button.createSpan({ cls: "docferry-settings-nav-icon", attr: { "aria-hidden": "true" } });
      setIcon(icon, page.icon);
      button.createSpan({ text: page.label, cls: "docferry-settings-nav-label" });
      button.addEventListener("click", () => {
        this.activePage = page.id;
        this.render();
      });
    }
  }

  private renderPageIntro(containerEl: HTMLElement, title: string, description: string): void {
    const intro = containerEl.createDiv({ cls: "docferry-settings-page-intro" });
    intro.createDiv({
      text: title,
      cls: "docferry-heading docferry-heading-2",
      attr: { role: "heading", "aria-level": "2" }
    });
    intro.createEl("p", { text: description });
  }

  private renderConnectionSection(containerEl: HTMLElement): void {
    const account = this.host.docferrySettings.connectedAccount;
    const connected = Boolean(this.host.docferrySettings.sessionToken);
    const displayName = account?.displayUser?.name || account?.displayUser?.email || "Not connected";
    this.renderPageIntro(containerEl, "Account", "Your DocFerry membership and this connected device.");
    const panel = containerEl.createDiv({ cls: "docferry-settings-panel docferry-connection-panel" });
    const header = panel.createDiv({ cls: "docferry-panel-header" });
    const copy = header.createDiv();
    copy.createDiv({
      text: "Bondie account",
      cls: "docferry-heading docferry-heading-3",
      attr: { role: "heading", "aria-level": "3" }
    });
    copy.createEl("p", {
      text: connected
        ? "This Obsidian device is connected to DocFerry. Membership and personal details live on the web dashboard."
        : "Connect once to publish, save links, and use your DocFerry membership."
    });

    const status = header.createDiv({
      text: connected ? "Connected" : "Not connected",
      cls: connected ? "docferry-status-badge is-ok" : "docferry-status-badge"
    });

    const card = panel.createDiv({ cls: "docferry-settings-account-identity" });
    renderAccountAvatar(card, account?.displayUser, "docferry-account-avatar");
    const details = card.createDiv({ cls: "docferry-account-details" });
    details.createDiv({
      text: displayName,
      cls: "docferry-heading docferry-heading-4",
      attr: { role: "heading", "aria-level": "4" }
    });
    if (account?.displayUser?.email && account.displayUser.email !== displayName) {
      details.createEl("p", { text: account.displayUser.email });
    }
    details.createEl("p", { text: connected ? "Signed in with Bondie" : "Use an existing account or create a new one." });

    if (connected) {
      const membership = this.host.docferrySettings.membership;
      const facts = panel.createDiv({ cls: "docferry-settings-account-grid" });
      renderSettingsFact(facts, "Plan", membership?.planDisplayName || "Refresh required");
      renderSettingsFact(
        facts,
        "Shares",
        membership ? membershipUsageLabel(membership.activeShareCount, membership.activeShareLimit) : "-"
      );
      renderSettingsFact(
        facts,
        "Advanced imports",
        membership
          ? membershipUsageLabel(membership.mediaNoteMonthlyJobsUsed, membership.mediaNoteMonthlyJobLimit)
          : "-"
      );
      renderSettingsFact(facts, "Last refreshed", membership ? formatDateTime(membership.refreshedAt) : "Never");
    }

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
    const dashboardButton = actions.createEl("button", { cls: "mod-cta", attr: { type: "button" } });
    appendButtonLabel(dashboardButton, "layout-dashboard", "Open dashboard");
    addAsyncClickListener(dashboardButton, async () => this.host.openDashboardHome());
    const refreshButton = actions.createEl("button", { attr: { type: "button" } });
    appendButtonLabel(refreshButton, "refresh-cw", "Refresh access");
    addAsyncClickListener(refreshButton, async () => {
      await this.host.refreshMembership(true);
      this.render();
    });
  }

  private renderSharingSection(containerEl: HTMLElement): void {
    this.renderPageIntro(containerEl, "Sharing", "Defaults used when you publish a note or folder.");
    const sharesPanel = containerEl.createDiv({
      cls: "docferry-settings-panel docferry-settings-share-entry"
    });
    const sharesHeader = sharesPanel.createDiv({ cls: "docferry-panel-header" });
    const sharesCopy = sharesHeader.createDiv();
    sharesCopy.createDiv({
      text: "Published content",
      cls: "docferry-heading docferry-heading-3",
      attr: { role: "heading", "aria-level": "3" }
    });
    sharesCopy.createEl("p", { text: "Review active and past note or folder shares." });
    const sharesButton = sharesHeader.createEl("button", { cls: "mod-cta", attr: { type: "button" } });
    appendButtonLabel(sharesButton, "files", "Open shares");
    addAsyncClickListener(sharesButton, async () => this.host.openSharesPage());

    const defaultsPanel = containerEl.createDiv({ cls: "docferry-settings-panel" });
    const defaultsHeader = defaultsPanel.createDiv({ cls: "docferry-panel-header" });
    const defaultsCopy = defaultsHeader.createDiv();
    defaultsCopy.createDiv({
      text: "Publish defaults",
      cls: "docferry-heading docferry-heading-3",
      attr: { role: "heading", "aria-level": "3" }
    });
    defaultsCopy.createEl("p", { text: "You can still change these options before each share." });

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

  }

  private renderImportsSection(containerEl: HTMLElement): void {
    this.renderPageIntro(containerEl, "Imports", "Choose where saved links and generated notes are written.");
    const panel = containerEl.createDiv({ cls: "docferry-settings-panel" });
    const header = panel.createDiv({ cls: "docferry-panel-header" });
    const copy = header.createDiv();
    copy.createDiv({
      text: "Save location",
      cls: "docferry-heading docferry-heading-3",
      attr: { role: "heading", "aria-level": "3" }
    });
    copy.createEl("p", { text: "Applied to DocFerry shares, web pages, audio, and video." });
    new Setting(panel)
      .setName("Default import folder")
      .setDesc("Vault folder used by the DocFerry home page and import dialogs.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.defaultImportFolder)
          .setValue(this.host.docferrySettings.defaultImportFolder || DEFAULT_SETTINGS.defaultImportFolder)
          .onChange(async (value) => {
            this.host.docferrySettings.defaultImportFolder = normalizeVaultFolder(value) || DEFAULT_SETTINGS.defaultImportFolder;
            await this.host.saveSettings();
          })
      );
  }

  private renderAdvancedSection(containerEl: HTMLElement): void {
    this.renderPageIntro(containerEl, "Advanced", "Connection diagnostics and local plugin controls.");
    const advancedBody = containerEl.createDiv({ cls: "docferry-settings-panel docferry-settings-advanced-body" });
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

function renderSettingsFact(containerEl: HTMLElement, label: string, value: string): void {
  const fact = containerEl.createDiv({ cls: "docferry-settings-account-fact" });
  fact.createSpan({ text: label });
  fact.createEl("strong", { text: value });
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
    accessRole: response.access_role,
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
    mediaNoteActiveJobs: response.media_note_usage.active_jobs,
    mediaNoteActiveJobLimit: response.media_note_usage.active_job_limit,
    mediaNoteMonthlyJobsUsed: response.media_note_usage.monthly_jobs_used,
    mediaNoteMonthlyJobLimit: response.media_note_usage.monthly_job_limit,
    mediaNoteResetsAt: response.media_note_usage.resets_at,
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

export function membershipUsageLabel(count: number, limit: number | null): string {
  return `${count}/${membershipLimitLabel(limit)}`;
}

export function membershipLimitLabel(limit: number | null): string {
  return limit === null ? "Unlimited" : String(limit);
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
