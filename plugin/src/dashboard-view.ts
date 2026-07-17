import { App, ItemView, Menu, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import { ShareApiError } from "./api-client";
import { appendDocferryLogo, DOCFERRY_PRODUCT_NAME } from "./brand";
import { openExternalUrl } from "./external-links";
import { ImportPasswordModal } from "./import-password-modal";
import type { DocferrySettings } from "./settings";
import {
  expiryLabel,
  formatBytes,
  formatDateTime,
  membershipUnavailableMessage,
  renderAccountAvatar,
  shareCountLabel,
  statusClass,
  statusLabel,
  vaultLabel
} from "./settings";
import type { AccountCenterTarget, FolderShareResponse, ShareListItemResponse } from "./types";

export const DOCFERRY_DASHBOARD_VIEW_TYPE = "docferry-dashboard";

type WorkspacePage = "home" | "shares" | "account";
type ImportMode = "link" | "detailed";

export interface DashboardImportResult {
  title: string;
  notePath: string;
  importedAssets: number;
}

export interface DashboardHost {
  app: App;
  docferrySettings: DocferrySettings;
  startLogin(): Promise<void>;
  startSignup(): Promise<void>;
  reconnectAccount(): Promise<void>;
  refreshMembership(force?: boolean): Promise<void>;
  openMembershipCenter(): Promise<void>;
  openAccountCenterTarget(target: AccountCenterTarget): Promise<void>;
  requestAccessUpgrade(source: "plugin_settings" | "plugin_dashboard"): Promise<void>;
  listShares(): Promise<ShareListItemResponse[]>;
  listFolderShares(): Promise<FolderShareResponse[]>;
  importShareFromDashboard(url: string, password?: string): Promise<DashboardImportResult>;
  importExternalLink(url: string, detailed?: boolean): Promise<DashboardImportResult | null>;
  openSettingsTab(): void;
  openShareLinks(share: ShareListItemResponse): Promise<void>;
  updateShareFromList(share: ShareListItemResponse): Promise<void>;
  stopShareFromList(share: ShareListItemResponse): Promise<void>;
  stopFolderShareFromList(folderShare: FolderShareResponse): Promise<void>;
  vaultPathFromDrag(event: DragEvent): string | null;
  publishVaultPath(path: string): Promise<void>;
  disconnectAccount(): Promise<void>;
  getActiveNoteLabel(): string | null;
  publishActiveNote(): Promise<void>;
}

export class DocferryDashboardView extends ItemView {
  private activePage: WorkspacePage = "home";
  private shares: ShareListItemResponse[] = [];
  private folderShares: FolderShareResponse[] = [];
  private sharesLoaded = false;
  private sharesLoading = false;
  private sharesError = "";
  private sharesKey = "";
  private importUrl = "";
  private importLoading = false;
  private importError = "";
  private importSuccess = "";
  private importMode: ImportMode = "link";
  private dragDepth = 0;

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
    this.registerEvent(
      this.host.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf !== this.leaf || this.activePage !== "home") return;
        window.requestAnimationFrame(() => {
          if (this.activePage === "home") this.render();
        });
      })
    );
    this.render();
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

  refreshForActiveNote(): void {
    if (this.activePage === "home") this.render();
  }

  showAccountPage(): void {
    this.activePage = "account";
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("docferry-dashboard-view");

    const shell = contentEl.createDiv({ cls: "docferry-workspace-shell" });
    this.renderTopbar(shell);
    const body = shell.createDiv({ cls: "docferry-workspace-content" });
    if (this.activePage === "home") this.renderHome(body);
    if (this.activePage === "shares") this.renderSharesPage(body);
    if (this.activePage === "account") this.renderAccountPage(body);
  }

  private renderTopbar(containerEl: HTMLElement): void {
    const topbar = containerEl.createDiv({ cls: "docferry-workspace-topbar" });
    const brandButton = topbar.createEl("button", { cls: "docferry-workspace-brand", attr: { type: "button" } });
    appendDocferryLogo(brandButton, "docferry-workspace-brand-mark");
    const brandCopy = brandButton.createSpan({ cls: "docferry-workspace-brand-copy" });
    brandCopy.createSpan({ text: "DocFerry", cls: "docferry-workspace-brand-title" });
    brandCopy.createSpan({ text: "Share notes simply", cls: "docferry-workspace-brand-subtitle" });
    brandButton.addEventListener("click", () => {
      this.openHomePage();
    });
  }

  private renderHome(containerEl: HTMLElement): void {
    const canUseDetailedNote = this.host.docferrySettings.membership?.canUseMediaNote === true;
    if (!canUseDetailedNote) this.importMode = "link";
    const home = containerEl.createDiv({ cls: "docferry-home docferry-share-drop-surface" });
    const waveLayer = home.createDiv({ cls: "docferry-share-drop-waves", attr: { "aria-hidden": "true" } });
    for (let index = 0; index < 3; index += 1) {
      waveLayer.createSpan({ cls: `docferry-share-drop-wave is-wave-${index + 1}` });
    }
    this.registerShareDropSurface(home);
    const intro = home.createDiv({ cls: "docferry-home-intro" });
    appendDocferryLogo(intro, "docferry-import-mark docferry-home-logo").setAttr("aria-hidden", "true");
    const introCopy = intro.createDiv();
    introCopy.createDiv({ text: "Share a note. Send a link.", cls: "docferry-heading docferry-heading-2" });
    introCopy.createEl("p", { text: "Publish the note you are working on, or bring a shared note into this vault." });

    const sharePanel = home.createDiv({ cls: "docferry-home-task docferry-home-share-task" });
    const shareCopy = sharePanel.createDiv({ cls: "docferry-home-task-copy" });
    const activeNote = this.host.getActiveNoteLabel();
    shareCopy.createSpan({ text: "CURRENT NOTE", cls: "docferry-home-eyebrow" });
    shareCopy.createDiv({
      text: activeNote || "Open a Markdown note to share it",
      cls: "docferry-heading docferry-heading-3 docferry-home-note-title"
    });
    shareCopy.createEl("p", {
      text: activeNote ? "DocFerry creates a web link and copies it for you." : "Return here after opening a note."
    });
    const shareButton = sharePanel.createEl("button", {
      cls: "mod-cta docferry-home-primary-action",
      attr: { type: "button" }
    });
    const connected = Boolean(this.host.docferrySettings.sessionToken);
    appendButtonLabel(shareButton, connected ? "send" : "log-in", connected ? "Share note" : "Connect to share");
    shareButton.disabled = connected && !activeNote;
    addAsyncClickListener(shareButton, async () => {
      if (connected) await this.host.publishActiveNote();
      else {
        await this.host.startLogin();
        this.render();
      }
    });

    const panel = home.createDiv({ cls: "docferry-home-task docferry-import-panel" });
    const importHeading = panel.createDiv({ cls: "docferry-home-task-heading" });
    const importIcon = importHeading.createSpan({ cls: "docferry-home-task-icon", attr: { "aria-hidden": "true" } });
    setIcon(importIcon, "download");
    const importCopy = importHeading.createDiv();
    importCopy.createDiv({ text: "Import a note or web link", cls: "docferry-heading docferry-heading-4" });
    importCopy.createEl("p", { text: "Paste a DocFerry share or public web link." });

    if (canUseDetailedNote) {
      const modes = panel.createDiv({ cls: "docferry-import-modes", attr: { role: "group", "aria-label": "Import type" } });
      this.renderImportMode(modes, "link", "link", "Save link");
      this.renderImportMode(modes, "detailed", "sparkles", "Detailed note");
    }

    const fieldId = "docferry-dashboard-import-url";
    const field = panel.createDiv({ cls: "docferry-import-field" });
    field.createEl("label", { text: "URL", attr: { for: fieldId } });
    const row = field.createDiv({ cls: "docferry-import-row" });
    const input = row.createEl("input", {
      type: "text",
      placeholder: "Paste a DocFerry or web link",
      cls: "docferry-import-url-input",
      attr: { id: fieldId, autocomplete: "off" }
    });
    input.value = this.importUrl;
    input.disabled = this.importLoading;
    input.addEventListener("input", () => {
      this.importUrl = input.value;
      this.importError = "";
      this.importSuccess = "";
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") void this.handleImport();
    });

    const importButton = row.createEl("button", { cls: "mod-cta", attr: { type: "button" } });
    const importLabel = this.importMode === "detailed" ? "Create" : "Import";
    appendButtonLabel(importButton, "download", this.importLoading ? "Working" : importLabel);
    importButton.disabled = this.importLoading;
    importButton.addEventListener("click", () => {
      void this.handleImport();
    });

    if (this.importError) panel.createDiv({ text: this.importError, cls: "docferry-dashboard-inline-error" });
    if (this.importSuccess) panel.createDiv({ text: this.importSuccess, cls: "docferry-dashboard-inline-success" });

    const navigation = home.createDiv({ cls: "docferry-home-navigation" });
    this.renderShortcut(navigation, "files", "My shares", () => this.openSharesPage());
    this.renderShortcut(navigation, "user", "Account", () => this.openAccountPage());

  }

  private renderImportMode(containerEl: HTMLElement, mode: ImportMode, icon: string, label: string): void {
    const button = containerEl.createEl("button", {
      cls: this.importMode === mode ? "is-active" : "",
      attr: { type: "button", "aria-pressed": String(this.importMode === mode) }
    });
    appendButtonLabel(button, icon, label);
    button.addEventListener("click", () => {
      this.importMode = mode;
      this.importError = "";
      this.importSuccess = "";
      this.render();
    });
  }

  private registerShareDropSurface(surface: HTMLElement): void {
    const accepts = (event: DragEvent): boolean => Boolean(this.host.vaultPathFromDrag(event));
    surface.addEventListener("dragenter", (event) => {
      if (!accepts(event)) return;
      event.preventDefault();
      this.dragDepth += 1;
      surface.addClass("is-drag-active");
    });
    surface.addEventListener("dragover", (event) => {
      if (!accepts(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      surface.addClass("is-drag-active");
    });
    surface.addEventListener("dragleave", () => {
      this.dragDepth = Math.max(0, this.dragDepth - 1);
      if (!this.dragDepth) surface.removeClass("is-drag-active");
    });
    surface.addEventListener("drop", (event) => {
      const path = this.host.vaultPathFromDrag(event);
      this.dragDepth = 0;
      surface.removeClass("is-drag-active");
      if (!path) return;
      event.preventDefault();
      event.stopPropagation();
      void this.host.publishVaultPath(path);
    });
  }

  private renderSharesPage(containerEl: HTMLElement): void {
    const page = containerEl.createDiv({ cls: "docferry-workspace-page" });
    this.renderPageHeader(
      page,
      "Shares",
      this.sharesLoaded
        ? `${shareCountLabel(this.shares.length)} ${this.folderShares.length} shared ${this.folderShares.length === 1 ? "folder" : "folders"}.`
        : "Shared notes and folders from this account.",
      "Refresh",
      "refresh-cw",
      () => void this.refreshShares()
    );

    const currentKey = this.currentShareListKey();
    if (this.sharesKey && this.sharesKey !== currentKey) this.resetShares();

    if (!this.hasAuthForShares()) {
      this.renderEmpty(page, "Connect required", "Connect your Bondie account first.");
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
      this.renderEmpty(page, "Shares not loaded", "Refresh to load your shared notes.");
      return;
    }

    if (!this.shares.length && !this.folderShares.length) {
      this.renderEmpty(page, "No shares yet", "Publish a note when you are ready.");
      return;
    }

    if (this.folderShares.length) {
      page.createDiv({ text: "Folders", cls: "docferry-heading docferry-heading-4 docferry-share-group-title" });
      const folderList = page.createDiv({ cls: "docferry-share-list docferry-workspace-share-list" });
      for (const folderShare of this.folderShares) this.renderFolderShareRow(folderList, folderShare);
    }
    if (this.shares.length) {
      page.createDiv({ text: "Notes", cls: "docferry-heading docferry-heading-4 docferry-share-group-title" });
    }
    const list = page.createDiv({ cls: "docferry-share-list docferry-workspace-share-list" });
    for (const share of this.shares) {
      const row = list.createDiv({ cls: "docferry-share-row docferry-workspace-share-row docferry-share-row--compact" });
      const main = row.createDiv({ cls: "docferry-share-main" });
      main.createDiv({ text: share.title || share.source_path, cls: "docferry-heading docferry-heading-4" });
      main.createEl("p", { text: share.source_path });
      const meta = main.createDiv({ cls: "docferry-share-meta" });
      meta.createSpan({ text: vaultLabel(share) });
      meta.createSpan({ text: `Updated ${formatDateTime(share.updated_at)}` });
      if (share.expires_at || share.status === "stopped" || share.status === "expired") {
        meta.createSpan({ text: expiryLabel(share) });
      }

      const badges = row.createDiv({ cls: "docferry-share-badges" });
      badges.createSpan({ text: statusLabel(share.status), cls: `docferry-pill ${statusClass(share.status)}` });
      if (share.password_enabled) badges.createSpan({ text: "Password", cls: "docferry-pill is-locked" });

      const actions = row.createDiv({ cls: "docferry-share-actions" });
      const copyButton = actions.createEl("button", { attr: { type: "button", "aria-label": "Copy share URL" } });
      appendButtonLabel(copyButton, "copy", "Copy");
      addAsyncClickListener(copyButton, async () => {
        await navigator.clipboard.writeText(share.url);
        new Notice("Share link copied");
      });
      const openButton = actions.createEl("button", { attr: { type: "button", "aria-label": "Open share URL" } });
      appendButtonLabel(openButton, "external-link", "Open");
      openButton.addEventListener("click", () => {
        openExternalUrl(share.url);
      });
      const moreButton = actions.createEl("button", {
        cls: "docferry-icon-button",
        attr: { type: "button", "aria-label": `More actions for ${share.title || share.source_path}`, title: "More actions" }
      });
      setIcon(moreButton, "more-horizontal");
      moreButton.addEventListener("click", () => this.showShareMenu(moreButton, share));
    }
  }

  private renderFolderShareRow(containerEl: HTMLElement, folderShare: FolderShareResponse): void {
    const row = containerEl.createDiv({ cls: "docferry-share-row docferry-workspace-share-row docferry-share-row--compact" });
    const main = row.createDiv({ cls: "docferry-share-main" });
    main.createDiv({ text: folderShare.title, cls: "docferry-heading docferry-heading-4" });
    main.createEl("p", { text: folderShare.source_folder });
    const meta = main.createDiv({ cls: "docferry-share-meta" });
    meta.createSpan({ text: `${folderShare.document_count} notes` });
    meta.createSpan({ text: `Updated ${formatDateTime(folderShare.updated_at)}` });
    meta.createSpan({ text: folderShare.theme_mode === "full" ? "Full theme" : "Reader theme" });

    const badges = row.createDiv({ cls: "docferry-share-badges" });
    badges.createSpan({ text: statusLabel(folderShare.status), cls: `docferry-pill ${statusClass(folderShare.status)}` });
    badges.createSpan({ text: "Folder", cls: "docferry-pill" });

    const actions = row.createDiv({ cls: "docferry-share-actions" });
    const copyButton = actions.createEl("button", { attr: { type: "button", "aria-label": "Copy folder share URL" } });
    appendButtonLabel(copyButton, "copy", "Copy");
    addAsyncClickListener(copyButton, async () => {
      await navigator.clipboard.writeText(folderShare.url);
      new Notice("Folder share link copied");
    });
    const openButton = actions.createEl("button", { attr: { type: "button", "aria-label": "Open folder share" } });
    appendButtonLabel(openButton, "external-link", "Open");
    openButton.addEventListener("click", () => openExternalUrl(folderShare.url));
    if (folderShare.status !== "stopped" && folderShare.status !== "expired") {
      const stopButton = actions.createEl("button", {
        cls: "docferry-stop-share-button",
        attr: { type: "button", "aria-label": "Stop folder sharing" }
      });
      appendButtonLabel(stopButton, "unlink", "Stop sharing");
      addAsyncClickListener(stopButton, async () => {
        await this.host.stopFolderShareFromList(folderShare);
        await this.refreshShares();
      });
    }
  }

  private renderAccountPage(containerEl: HTMLElement): void {
    const page = containerEl.createDiv({ cls: "docferry-workspace-page docferry-account-page" });
    this.renderPageHeader(page, "Account", "Ready to publish and manage shared notes.");

    const account = this.host.docferrySettings.connectedAccount;
    const connected = Boolean(this.host.docferrySettings.sessionToken);
    const displayName = account?.displayUser?.name || account?.displayUser?.email || "Not connected";

    const card = page.createDiv({ cls: "docferry-account-card docferry-workspace-account-card" });
    renderAccountAvatar(card, account?.displayUser, "docferry-account-avatar");
    const details = card.createDiv({ cls: "docferry-account-details" });
    details.createDiv({ text: displayName, cls: "docferry-heading docferry-heading-4" });
    details.createEl("p", { text: connected ? "Connected to Bondie" : "Connect once to publish and manage your notes." });
    if (account?.displayUser?.email && account.displayUser.email !== displayName) {
      details.createEl("p", { text: account.displayUser.email });
    }
    if (!connected) {
      this.renderAccountQuickActions(page, false);
      return;
    }

    const membership = this.host.docferrySettings.membership;
    const membershipCard = page.createDiv({ cls: "docferry-membership-card docferry-workspace-membership-card" });
    const membershipHeader = membershipCard.createDiv({ cls: "docferry-membership-header" });
    const membershipCopy = membershipHeader.createDiv();
    membershipCopy.createDiv({ text: "Plan and usage", cls: "docferry-heading docferry-heading-4" });
    membershipCopy.createEl("p", {
      text: membership
        ? `Updated ${formatDateTime(membership.refreshedAt)}.`
        : "Refresh to load your current plan."
    });
    membershipHeader.createSpan({
      text: membership?.planDisplayName || "Unknown",
      cls: `docferry-status-badge ${membership && membership.planKey !== "free" ? "is-ok" : ""}`
    });
    const membershipStats = membershipCard.createDiv({ cls: "docferry-membership-stats" });
    renderMembershipStat(membershipStats, "Shares", membership ? `${membership.activeShareCount}/${membership.activeShareLimit}` : "-");
    renderMembershipStat(membershipStats, "File size", membership ? formatBytes(membership.maxSingleFileSizeBytes) : "-");
    if (membership?.unavailableReason) {
      membershipCard.createDiv({
        text: membershipUnavailableMessage(membership.unavailableReason),
        cls: "docferry-membership-note"
      });
    }

    this.renderAccountQuickActions(page, connected);
  }

  private renderAccountQuickActions(containerEl: HTMLElement, connected: boolean): void {
    const actions = containerEl.createDiv({
      cls: "docferry-workspace-page-actions docferry-account-primary-actions docferry-account-quick-actions"
    });
    const refreshButton = actions.createEl("button", { cls: connected ? "" : "mod-cta", attr: { type: "button" } });
    appendButtonLabel(refreshButton, connected ? "refresh-cw" : "log-in", connected ? "Refresh" : "Log in");
    addAsyncClickListener(refreshButton, async () => {
      if (connected) {
        await this.host.refreshMembership(true);
      } else {
        await this.host.startLogin();
      }
      this.render();
    });
    if (!connected) {
      const signupButton = actions.createEl("button", { attr: { type: "button" } });
      appendButtonLabel(signupButton, "user-plus", "Create account");
      addAsyncClickListener(signupButton, async () => {
        await this.host.startSignup();
        this.render();
      });
    }
    if (!connected) return;
    const billingButton = actions.createEl("button", { cls: "mod-cta", attr: { type: "button" } });
    appendButtonLabel(billingButton, "credit-card", "Manage plan");
    addAsyncClickListener(billingButton, async () => this.host.openMembershipCenter());
    const accountButton = actions.createEl("button", { attr: { type: "button" } });
    appendButtonLabel(accountButton, "user", "Account Center");
    addAsyncClickListener(accountButton, async () => this.host.openAccountCenterTarget("profile"));
    const moreButton = actions.createEl("button", {
      cls: "docferry-icon-button",
      attr: { type: "button", "aria-label": "More account actions", title: "More account actions" }
    });
    setIcon(moreButton, "more-horizontal");
    moreButton.addEventListener("click", () => this.showAccountMenu(moreButton));
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
    appendButtonLabel(backButton, "arrow-left", "Home");
    backButton.addEventListener("click", () => {
      this.openHomePage();
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
    action: () => void
  ): void {
    const button = containerEl.createEl("button", { cls: "docferry-import-shortcut", attr: { type: "button" } });
    const iconEl = button.createSpan({ cls: "docferry-import-shortcut-icon", attr: { "aria-hidden": "true" } });
    setIcon(iconEl, icon);
    button.createSpan({ text: title, cls: "docferry-import-shortcut-title" });
    button.addEventListener("click", action);
  }

  private openHomePage(): void {
    this.activePage = "home";
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
    if (!isValidWebUrl(url)) {
      this.importError = "Enter a valid web URL.";
      this.importSuccess = "";
      this.render();
      return;
    }
    if (!isValidShareUrl(url)) {
      this.importLoading = true;
      this.importError = "";
      this.importSuccess = "";
      this.render();
      try {
        const result = await this.host.importExternalLink(url, this.importMode === "detailed");
        if (!result) {
          this.importSuccess = "Nothing was saved.";
          return;
        }
        this.importUrl = "";
        this.importSuccess = `Saved ${result.title} to ${result.notePath}.`;
      } catch (error) {
        this.importError = formatError(error, "Import failed");
      } finally {
        this.importLoading = false;
        this.render();
      }
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
      this.importError = friendlyImportError(error);
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
      const [shares, folderShares] = await Promise.all([
        this.host.listShares(),
        this.host.listFolderShares()
      ]);
      this.shares = shares;
      this.folderShares = folderShares;
      this.sharesLoaded = true;
    } catch (error) {
      this.sharesError = friendlyShareListError(error);
      this.shares = [];
      this.folderShares = [];
    } finally {
      this.sharesLoading = false;
      this.render();
    }
  }

  private resetShares(): void {
    this.shares = [];
    this.folderShares = [];
    this.sharesLoaded = false;
    this.sharesLoading = false;
    this.sharesError = "";
    this.sharesKey = "";
  }

  private hasAuthForShares(): boolean {
    return Boolean(this.host.docferrySettings.sessionToken);
  }

  private currentShareListKey(): string {
    const settings = this.host.docferrySettings;
    const tokenTail = settings.sessionToken.slice(-8);
    const ownerHint = settings.connectedAccount?.productSubjectId || "pending";
    return `${settings.serverUrl}|${ownerHint}|${tokenTail}`;
  }

  private showShareMenu(button: HTMLElement, share: ShareListItemResponse): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("Linked notes").setIcon("list-checks").onClick(() => void this.host.openShareLinks(share)));
    menu.addItem((item) =>
      item
        .setTitle("Update share")
        .setIcon("upload-cloud")
        .setDisabled(share.status === "stopped")
        .onClick(() => void this.host.updateShareFromList(share))
    );
    if (share.status !== "stopped" && share.status !== "expired") {
      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle("Stop sharing").setIcon("unlink").onClick(async () => {
          await this.host.stopShareFromList(share);
          await this.refreshShares();
        })
      );
    }
    showMenuBelowButton(menu, button);
  }

  private showAccountMenu(button: HTMLElement): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("Switch account").setIcon("log-in").onClick(() => void this.host.reconnectAccount()));
    menu.addItem((item) =>
      item.setTitle("Devices and sessions").setIcon("monitor-smartphone").onClick(() => void this.host.openAccountCenterTarget("devices"))
    );
    menu.addItem((item) => item.setTitle("Support").setIcon("life-buoy").onClick(() => void this.host.requestAccessUpgrade("plugin_dashboard")));
    menu.addItem((item) => item.setTitle("Preferences").setIcon("settings").onClick(() => this.host.openSettingsTab()));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Disconnect").setIcon("log-out").onClick(async () => {
      await this.host.disconnectAccount();
      this.resetShares();
      this.render();
    }));
    showMenuBelowButton(menu, button);
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

function addAsyncClickListener(button: HTMLElement, handler: () => Promise<void>): void {
  button.addEventListener("click", () => {
    void handler();
  });
}

function showMenuBelowButton(menu: Menu, button: HTMLElement): void {
  const bounds = button.getBoundingClientRect();
  menu.setUseNativeMenu(false).showAtPosition({ x: bounds.right, y: bounds.bottom, left: true });
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

function isValidWebUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return ["http:", "https:"].includes(parsed.protocol) && Boolean(parsed.host) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function formatError(error: unknown, fallback: string): string {
  if (error instanceof ShareApiError) return `${fallback}: ${error.message}`;
  if (error instanceof Error) return `${fallback}: ${error.message}`;
  return fallback;
}

function friendlyImportError(error: unknown): string {
  if (error instanceof ShareApiError) {
    if (error.status === 404) return "This shared note could not be found.";
    if (error.status === 410) return "This share is no longer available.";
    if (error.status === 401) return "The password was not accepted. Try again.";
  }
  if (error instanceof TypeError || (error instanceof Error && /network|fetch|connect/i.test(error.message))) {
    return "DocFerry could not connect. Check your internet connection and try again.";
  }
  return "Import failed. Check the link and try again.";
}

function friendlyShareListError(error: unknown): string {
  if (error instanceof ShareApiError && error.status === 401) {
    return "Reconnect your Bondie account, then refresh.";
  }
  if (error instanceof TypeError || (error instanceof Error && /network|fetch|connect/i.test(error.message))) {
    return "DocFerry could not connect. Check your internet connection and refresh.";
  }
  return "Refresh to try loading your shares again.";
}
