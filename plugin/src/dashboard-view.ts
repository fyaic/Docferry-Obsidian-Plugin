import { App, ItemView, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import { ShareApiError } from "./api-client";
import { appendDocferryLogo, DOCFERRY_PRODUCT_NAME } from "./brand";
import { ImportPasswordModal } from "./import-password-modal";
import type { DocferrySettings } from "./settings";
import {
  expiryLabel,
  formatBytes,
  formatDateTime,
  membershipAccessLabel,
  membershipUnavailableMessage,
  renderAccountAvatar,
  statusClass,
  statusLabel,
  vaultLabel
} from "./settings";
import type { ShareListItemResponse } from "./types";

export const DOCFERRY_DASHBOARD_VIEW_TYPE = "docferry-dashboard";

type WorkspacePage = "import" | "shares" | "account";

export interface DashboardImportResult {
  title: string;
  notePath: string;
  importedAssets: number;
}

export interface DashboardHost {
  app: App;
  manifest: { version: string };
  settings: DocferrySettings;
  startLogin(): Promise<void>;
  testConnection(): Promise<void>;
  refreshMembership(force?: boolean): Promise<void>;
  refreshMembershipForDashboardOpen(): void;
  openDashboardHome(): Promise<void>;
  openMembershipCenter(): Promise<void>;
  requestAccessUpgrade(source: "plugin_settings" | "plugin_dashboard"): Promise<void>;
  listShares(): Promise<ShareListItemResponse[]>;
  importShareFromDashboard(url: string, password?: string): Promise<DashboardImportResult>;
  openSettingsTab(): void;
  openShareLinks(share: ShareListItemResponse): Promise<void>;
  updateShareFromList(share: ShareListItemResponse): Promise<void>;
  stopShareFromList(share: ShareListItemResponse): Promise<void>;
}

export class DocferryDashboardView extends ItemView {
  private activePage: WorkspacePage = "import";
  private shares: ShareListItemResponse[] = [];
  private sharesLoaded = false;
  private sharesLoading = false;
  private sharesError = "";
  private sharesKey = "";
  private importUrl = "";
  private importLoading = false;
  private importError = "";
  private importSuccess = "";

  constructor(leaf: WorkspaceLeaf, private readonly host: DashboardHost) {
    super(leaf);
  }

  getViewType(): string {
    return DOCFERRY_DASHBOARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return DOCFERRY_PRODUCT_NAME;
  }

  getIcon(): string {
    return "ship";
  }

  async onOpen(): Promise<void> {
    this.render();
    this.host.refreshMembershipForDashboardOpen();
  }

  refreshForAuthChange(): void {
    this.resetShares();
    this.render();
    if (this.activePage === "shares" && this.hasAuthForShares()) void this.refreshShares();
  }

  refreshForShareChange(): void {
    this.resetShares();
    this.render();
    if (this.activePage === "shares" && this.hasAuthForShares()) void this.refreshShares();
  }

  showAccountPage(): void {
    this.activePage = "account";
    this.render();
    this.host.refreshMembershipForDashboardOpen();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("docferry-dashboard-view");

    const shell = contentEl.createDiv({ cls: "docferry-workspace-shell" });
    this.renderTopbar(shell);
    const body = shell.createDiv({ cls: "docferry-workspace-content" });
    if (this.activePage === "import") this.renderImportHome(body);
    if (this.activePage === "shares") this.renderSharesPage(body);
    if (this.activePage === "account") this.renderAccountPage(body);
  }

  private renderTopbar(containerEl: HTMLElement): void {
    const topbar = containerEl.createDiv({ cls: "docferry-workspace-topbar" });
    const brandButton = topbar.createEl("button", { cls: "docferry-workspace-brand", attr: { type: "button" } });
    appendDocferryLogo(brandButton, "docferry-workspace-brand-mark");
    const brandCopy = brandButton.createSpan({ cls: "docferry-workspace-brand-copy" });
    brandCopy.createSpan({ text: "DocFerry", cls: "docferry-workspace-brand-title" });
    brandCopy.createSpan({ text: "Share Obsidian notes on the web", cls: "docferry-workspace-brand-subtitle" });
    brandButton.addEventListener("click", () => {
      void this.host.openDashboardHome();
    });
  }

  private renderImportHome(containerEl: HTMLElement): void {
    const home = containerEl.createDiv({ cls: "docferry-import-home" });
    const panel = home.createDiv({ cls: "docferry-import-panel" });
    appendDocferryLogo(panel, "docferry-import-mark docferry-import-logo").setAttr("aria-hidden", "true");
    panel.createDiv({ text: "Import a DocFerry link", cls: "docferry-heading docferry-heading-2" });
    panel.createEl("p", {
      text: "Paste a DocFerry URL. The note opens in Obsidian."
    });

    const fieldId = "docferry-dashboard-import-url";
    const field = panel.createDiv({ cls: "docferry-import-field" });
    field.createEl("label", { text: "Share URL", attr: { for: fieldId } });
    const row = field.createDiv({ cls: "docferry-import-row" });
    const input = row.createEl("input", {
      type: "text",
      placeholder: "https://docferry.fuyonder.tech/s/...",
      cls: "docferry-import-url-input",
      attr: { id: fieldId, "aria-describedby": "docferry-import-help" }
    });
    input.value = this.importUrl;
    input.addEventListener("input", () => {
      this.importUrl = input.value;
      this.importError = "";
      this.importSuccess = "";
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") void this.handleImport();
    });

    const importButton = row.createEl("button", { cls: "mod-cta", attr: { type: "button" } });
    appendButtonLabel(importButton, "download", this.importLoading ? "Importing" : "Import");
    importButton.disabled = this.importLoading;
    importButton.addEventListener("click", () => {
      void this.handleImport();
    });

    field.createEl("p", {
      text: "Password prompt appears when needed.",
      cls: "docferry-import-help",
      attr: { id: "docferry-import-help" }
    });

    if (this.importError) panel.createDiv({ text: this.importError, cls: "docferry-dashboard-inline-error" });
    if (this.importSuccess) panel.createDiv({ text: this.importSuccess, cls: "docferry-dashboard-inline-success" });

    const shortcuts = panel.createDiv({ cls: "docferry-import-shortcuts" });
    this.renderShortcut(shortcuts, "files", "View shares", "Published links.", () => this.openSharesPage());
    this.renderShortcut(shortcuts, "user", "Account", "Access and profile.", () => this.openAccountPage());
    this.renderShortcut(shortcuts, "settings", "Config", "Plugin settings.", () => this.host.openSettingsTab());

    if (!this.importLoading) {
      window.setTimeout(() => input.focus(), 50);
    }
  }

  private renderSharesPage(containerEl: HTMLElement): void {
    const page = containerEl.createDiv({ cls: "docferry-workspace-page" });
    this.renderPageHeader(
      page,
      "Shared documents",
      "Owner-scoped documents across your vaults.",
      "Refresh",
      "refresh-cw",
      () => void this.refreshShares()
    );

    const currentKey = this.currentShareListKey();
    if (this.sharesKey && this.sharesKey !== currentKey) this.resetShares();

    if (!this.hasAuthForShares()) {
      this.renderEmpty(page, "Connect required", "Connect your Fuyonder account first.");
      return;
    }

    if (this.sharesLoading) {
      this.renderShareSkeleton(page);
      return;
    }

    if (this.sharesError) {
      this.renderEmpty(page, "Share list unavailable", this.sharesError, true);
      return;
    }

    if (!this.sharesLoaded) {
      this.renderEmpty(page, "Shares not loaded", "Click Refresh to load your published documents.");
      return;
    }

    if (!this.shares.length) {
      this.renderEmpty(page, "No shares yet", "Publish a note from the file menu or command palette.");
      return;
    }

    const list = page.createDiv({ cls: "docferry-share-list docferry-workspace-share-list" });
    for (const share of this.shares) {
      const row = list.createDiv({ cls: "docferry-share-row docferry-workspace-share-row" });
      const main = row.createDiv({ cls: "docferry-share-main" });
      main.createDiv({ text: share.title || share.source_path, cls: "docferry-heading docferry-heading-4" });
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
      const copyButton = actions.createEl("button", { attr: { type: "button", "aria-label": "Copy share URL" } });
      appendButtonLabel(copyButton, "copy", "Copy");
      copyButton.addEventListener("click", async () => {
        await navigator.clipboard.writeText(share.url);
        new Notice("Share link copied");
      });
      const openButton = actions.createEl("button", { attr: { type: "button", "aria-label": "Open share URL" } });
      appendButtonLabel(openButton, "external-link", "Open");
      openButton.addEventListener("click", () => {
        window.open(share.url);
      });
      const linksButton = actions.createEl("button", { attr: { type: "button", "aria-label": "Show linked note status" } });
      appendButtonLabel(linksButton, "list-checks", "Links");
      linksButton.addEventListener("click", async () => {
        await this.host.openShareLinks(share);
      });
      const updateButton = actions.createEl("button", { attr: { type: "button", "aria-label": "Update share" } });
      appendButtonLabel(updateButton, "upload-cloud", "Update");
      updateButton.disabled = share.status === "stopped";
      updateButton.addEventListener("click", async () => {
        await this.host.updateShareFromList(share);
      });
      if (share.status === "stopped" || share.status === "expired") {
        actions.createSpan({ text: statusLabel(share.status), cls: "docferry-action-state" });
      } else {
        const stopButton = actions.createEl("button", {
          cls: "docferry-stop-share-button",
          attr: { type: "button", "aria-label": "Stop sharing" }
        });
        appendButtonLabel(stopButton, "unlink", "Stop sharing");
        stopButton.addEventListener("click", async () => {
          await this.host.stopShareFromList(share);
          await this.refreshShares();
        });
      }
    }
  }

  private renderAccountPage(containerEl: HTMLElement): void {
    const page = containerEl.createDiv({ cls: "docferry-workspace-page docferry-account-page" });
    this.renderPageHeader(page, "Account", "Connection state for publishing and imports.");

    const account = this.host.settings.connectedAccount;
    const hasManualToken = Boolean(this.host.settings.manualApiToken || this.host.settings.apiToken);
    const connected = this.host.settings.authMode === "company-sso" ? Boolean(account) : hasManualToken;
    const displayName =
      account?.displayUser?.name ||
      account?.displayUser?.email ||
      (this.host.settings.authMode === "manual-token" && hasManualToken ? "Internal token" : "Not connected");

    const card = page.createDiv({ cls: "docferry-account-card docferry-workspace-account-card" });
    renderAccountAvatar(card, account?.displayUser, "docferry-account-avatar");
    const details = card.createDiv({ cls: "docferry-account-details" });
    details.createDiv({ text: displayName, cls: "docferry-heading docferry-heading-4" });
    details.createEl("p", {
      text:
        this.host.settings.authMode === "company-sso"
          ? connected
            ? "Fuyonder account is connected."
            : "Connect your Fuyonder account."
          : "Internal token mode is active."
    });
    if (account?.displayUser?.email && account.displayUser.email !== displayName) {
      details.createEl("p", { text: account.displayUser.email });
    }
    if (account?.connectedAt) details.createEl("p", { text: `Connected ${formatDateTime(account.connectedAt)}` });

    const membership = this.host.settings.membership;
    const membershipCard = page.createDiv({ cls: "docferry-membership-card docferry-workspace-membership-card" });
    const membershipHeader = membershipCard.createDiv({ cls: "docferry-membership-header" });
    const membershipCopy = membershipHeader.createDiv();
    membershipCopy.createDiv({ text: "Access limits", cls: "docferry-heading docferry-heading-4" });
    membershipCopy.createEl("p", {
      text: membership
        ? `${membershipAccessLabel(membership)} limits refreshed ${formatDateTime(membership.refreshedAt)}.`
        : "Access limits have not been refreshed."
    });
    membershipHeader.createSpan({
      text: membership?.planDisplayName || "Unknown",
      cls: `docferry-status-badge ${membership && membership.planKey !== "free" ? "is-ok" : ""}`
    });
    const membershipStats = membershipCard.createDiv({ cls: "docferry-membership-stats" });
    renderMembershipStat(membershipStats, "Active shares", membership ? `${membership.activeShareCount}/${membership.activeShareLimit}` : "-");
    renderMembershipStat(membershipStats, "Single file", membership ? formatBytes(membership.maxSingleFileSizeBytes) : "-");
    renderMembershipStat(membershipStats, "Access", membership ? membershipAccessLabel(membership) : "-");
    if (membership?.unavailableReason) {
      membershipCard.createDiv({
        text: membershipUnavailableMessage(membership.unavailableReason),
        cls: "docferry-membership-note"
      });
    }

    if (membership?.billingEnabled) {
      const center = membershipCard.createDiv({ cls: "docferry-membership-center" });
      const centerCopy = center.createDiv({ cls: "docferry-membership-center-copy" });
      centerCopy.createDiv({ text: "Billing", cls: "docferry-heading docferry-heading-5" });
      centerCopy.createEl("p", { text: "Manage paid access on the DocFerry web dashboard." });
      const centerButton = center.createEl("button", { cls: "mod-cta", attr: { type: "button" } });
      appendButtonLabel(centerButton, "external-link", "Open billing");
      centerButton.disabled = !this.host.settings.serverUrl || !connected;
      centerButton.addEventListener("click", async () => {
        await this.host.openMembershipCenter();
      });
    }

    const requestPanel = page.createDiv({ cls: "docferry-account-request-panel" });
    const requestCopy = requestPanel.createDiv({ cls: "docferry-account-request-copy" });
    requestCopy.createDiv({ text: "Need more capacity?", cls: "docferry-heading docferry-heading-4" });
    requestCopy.createEl("p", {
      text: connected
        ? "Tell us what you want to publish. DocFerry staff review early requests and can upgrade approved accounts to Plus."
        : "Connect your Fuyonder account before requesting Plus access."
    });
    const requestButton = requestPanel.createEl("button", { cls: "mod-cta", attr: { type: "button" } });
    appendButtonLabel(requestButton, "send", "Request access");
    requestButton.disabled = !connected || this.host.settings.authMode !== "company-sso";
    requestButton.addEventListener("click", async () => {
      await this.host.requestAccessUpgrade("plugin_dashboard");
      this.render();
    });

    const actions = page.createDiv({ cls: "docferry-workspace-page-actions docferry-account-primary-actions" });
    if (this.host.settings.authMode === "company-sso") {
      const refreshButton = actions.createEl("button", { cls: "mod-cta", attr: { type: "button" } });
      appendButtonLabel(refreshButton, connected ? "refresh-cw" : "log-in", connected ? "Refresh account" : "Connect");
      refreshButton.addEventListener("click", async () => {
        if (connected) {
          await this.host.refreshMembership(true);
        } else {
          await this.host.startLogin();
        }
        this.render();
      });
    }
    const settingsButton = actions.createEl("button", { attr: { type: "button" } });
    appendButtonLabel(settingsButton, "settings", "Settings");
    settingsButton.addEventListener("click", () => {
      this.host.openSettingsTab();
    });
  }

  private renderPageHeader(
    containerEl: HTMLElement,
    title: string,
    description: string,
    actionLabel?: string,
    actionIcon?: string,
    action?: () => void
  ): void {
    const header = containerEl.createDiv({ cls: "docferry-workspace-page-header" });
    const backButton = header.createEl("button", { cls: "docferry-workspace-back", attr: { type: "button" } });
    appendButtonLabel(backButton, "arrow-left", "Import");
    backButton.addEventListener("click", () => {
      this.openImportPage();
    });

    const copy = header.createDiv({ cls: "docferry-workspace-page-copy" });
    copy.createDiv({ text: title, cls: "docferry-heading docferry-heading-2" });
    copy.createEl("p", { text: description });

    if (actionLabel && actionIcon && action) {
      const actionButton = header.createEl("button", { attr: { type: "button" } });
      appendButtonLabel(actionButton, actionIcon, actionLabel);
      actionButton.disabled = this.sharesLoading || !this.hasAuthForShares();
      actionButton.addEventListener("click", action);
    }
  }

  private renderShortcut(
    containerEl: HTMLElement,
    icon: string,
    title: string,
    description: string,
    action: () => void
  ): void {
    const button = containerEl.createEl("button", { cls: "docferry-import-shortcut", attr: { type: "button" } });
    const iconEl = button.createSpan({ cls: "docferry-import-shortcut-icon", attr: { "aria-hidden": "true" } });
    setIcon(iconEl, icon);
    const copy = button.createSpan({ cls: "docferry-import-shortcut-copy" });
    copy.createSpan({ text: title, cls: "docferry-import-shortcut-title" });
    copy.createSpan({ text: description, cls: "docferry-import-shortcut-description" });
    button.addEventListener("click", action);
  }

  private openImportPage(): void {
    this.activePage = "import";
    this.render();
  }

  private openSharesPage(): void {
    this.activePage = "shares";
    this.render();
    if (this.hasAuthForShares() && !this.sharesLoaded && !this.sharesLoading) void this.refreshShares();
  }

  private openAccountPage(): void {
    this.showAccountPage();
  }

  private async handleImport(): Promise<void> {
    const url = this.importUrl.trim();
    if (!isValidShareUrl(url)) {
      this.importError = "Enter a valid DocFerry share URL.";
      this.importSuccess = "";
      this.render();
      return;
    }
    await this.runImport(url);
  }

  private async runImport(url: string, password?: string): Promise<void> {
    this.importLoading = true;
    this.importError = "";
    this.importSuccess = "";
    this.render();
    try {
      const result = await this.host.importShareFromDashboard(url, password);
      this.importUrl = "";
      this.importSuccess = `Imported ${result.title} to ${result.notePath}.`;
      if (result.importedAssets) this.importSuccess += ` Assets: ${result.importedAssets}.`;
    } catch (error) {
      if (error instanceof ShareApiError && error.status === 401 && error.code === "password_required") {
        const nextPassword = await new ImportPasswordModal(this.host.app).openAndGetPassword();
        this.importLoading = false;
        if (!nextPassword) {
          this.importError = "Password is required for this share.";
          this.render();
          return;
        }
        await this.runImport(url, nextPassword);
        return;
      }
      this.importError = formatError(error, "Import failed");
    } finally {
      this.importLoading = false;
      this.render();
    }
  }

  private async refreshShares(): Promise<void> {
    if (!this.hasAuthForShares()) {
      this.resetShares();
      this.render();
      return;
    }
    this.sharesLoading = true;
    this.sharesError = "";
    this.sharesKey = this.currentShareListKey();
    this.render();
    try {
      this.shares = await this.host.listShares();
      this.sharesLoaded = true;
    } catch (error) {
      this.sharesError = error instanceof Error ? error.message : "Could not load shares.";
      this.shares = [];
    } finally {
      this.sharesLoading = false;
      this.render();
    }
  }

  private resetShares(): void {
    this.shares = [];
    this.sharesLoaded = false;
    this.sharesLoading = false;
    this.sharesError = "";
    this.sharesKey = "";
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

  private renderShareSkeleton(containerEl: HTMLElement): void {
    const list = containerEl.createDiv({ cls: "docferry-share-list docferry-workspace-share-list" });
    for (let index = 0; index < 4; index += 1) {
      const row = list.createDiv({ cls: "docferry-share-row docferry-workspace-share-row is-loading" });
      const main = row.createDiv({ cls: "docferry-share-main" });
      main.createDiv({ cls: "docferry-skeleton-line is-title" });
      main.createDiv({ cls: "docferry-skeleton-line" });
    }
  }

  private renderEmpty(containerEl: HTMLElement, title: string, message: string, isError = false): void {
    const empty = containerEl.createDiv({ cls: `docferry-settings-empty ${isError ? "is-error" : ""}` });
    empty.createDiv({ text: title, cls: "docferry-heading docferry-heading-4" });
    empty.createEl("p", { text: message });
  }
}

function appendButtonLabel(button: HTMLButtonElement, icon: string, text: string): void {
  const iconEl = button.createSpan({ cls: "docferry-button-icon", attr: { "aria-hidden": "true" } });
  setIcon(iconEl, icon);
  button.createSpan({ text, cls: "docferry-button-label" });
}

function renderMembershipStat(containerEl: HTMLElement, label: string, value: string): void {
  const item = containerEl.createDiv({ cls: "docferry-membership-stat" });
  item.createSpan({ text: label });
  item.createEl("strong", { text: value });
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

function formatError(error: unknown, fallback: string): string {
  if (error instanceof ShareApiError) return `${fallback}: ${error.message}`;
  if (error instanceof Error) return `${fallback}: ${error.message}`;
  return fallback;
}
