import { App, ItemView, Menu, Notice, TFile, TFolder, WorkspaceLeaf, setIcon } from "obsidian";
import { ShareApiError } from "./api-client";
import { appendDocferryLogo, DOCFERRY_PRODUCT_NAME } from "./brand";
import { externalLinkProvider, validatedExternalImportUrl } from "./external-import";
import { openExternalUrl } from "./external-links";
import { ImportPasswordModal } from "./import-password-modal";
import { mediaNoteProgressMessage, type MediaNoteProgress } from "./media-note";
import { shouldPrepareDetailedNote } from "./media-note-availability";
import { hasActiveShareLink, shareListSummary } from "./share-actions";
import type { DocferrySettings } from "./settings";
import { parseDocferryShareUrl } from "./share-url";
import {
  expiryLabel,
  formatBytes,
  formatDateTime,
  membershipUnavailableMessage,
  membershipUsageLabel,
  renderAccountAvatar,
  statusClass,
  statusLabel,
  vaultLabel
} from "./settings";
import type { FolderShareResponse, ShareListItemResponse } from "./types";

export const DOCFERRY_DASHBOARD_VIEW_TYPE = "docferry-dashboard";

type WorkspacePage = "home" | "shares" | "account";

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
  openDashboardHome(): Promise<void>;
  requestAccessUpgrade(source: "plugin_settings" | "plugin_dashboard"): Promise<void>;
  listShares(): Promise<ShareListItemResponse[]>;
  listFolderShares(): Promise<FolderShareResponse[]>;
  importShareFromDashboard(url: string, password?: string): Promise<DashboardImportResult>;
  importExternalLink(
    url: string,
    onProgress?: (progress: MediaNoteProgress) => void
  ): Promise<DashboardImportResult | null>;
  cancelActiveMediaImport(): Promise<void>;
  resumeActiveMediaImport(): Promise<void>;
  openSettingsTab(): void;
  openShareLinks(share: ShareListItemResponse): Promise<void>;
  updateShareFromList(share: ShareListItemResponse): Promise<void>;
  updateFolderShareFromList(folderShare: FolderShareResponse): Promise<void>;
  stopShareFromList(share: ShareListItemResponse): Promise<void>;
  stopFolderShareFromList(folderShare: FolderShareResponse): Promise<void>;
  deleteShareHistory(share: ShareListItemResponse): Promise<void>;
  deleteFolderShareHistory(folderShare: FolderShareResponse): Promise<void>;
  vaultPathFromDrag(event: DragEvent): string | null;
  publishVaultPath(path: string): Promise<void>;
  disconnectAccount(): Promise<void>;
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
  private importProgress: MediaNoteProgress | "" = "";
  private importCancelRequested = false;
  private importError = "";
  private importSuccess = "";
  private dragDepth = 0;
  private activeDragPath = "";

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

  showHomePage(): void {
    this.openHomePage();
  }

  showSharesPage(): void {
    this.openSharesPage();
  }

  showAccountPage(): void {
    this.activePage = "account";
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("docferry-dashboard-view");

    const isHome = this.activePage === "home";
    const hasExpandedHomeState = Boolean(
      this.importLoading
      || this.importProgress
      || this.importError
      || this.importSuccess
      || this.host.docferrySettings.pendingMediaNoteImport
    );
    contentEl.toggleClass("is-home-page", isHome);
    contentEl.toggleClass("has-expanded-home-state", isHome && hasExpandedHomeState);
    const shell = contentEl.createDiv({
      cls: [
        "docferry-workspace-shell",
        isHome ? "is-home-page" : "",
        isHome && hasExpandedHomeState ? "has-expanded-home-state" : ""
      ].filter(Boolean).join(" ")
    });
    this.renderTopbar(shell);
    const body = shell.createDiv({ cls: "docferry-workspace-content" });
    if (this.activePage === "home") this.renderHome(body);
    if (this.activePage === "shares") this.renderSharesPage(body);
    if (this.activePage === "account") this.renderAccountPage(body);
  }

  private renderTopbar(containerEl: HTMLElement): void {
    const topbar = containerEl.createDiv({ cls: "docferry-workspace-topbar" });
    const brand = topbar.createDiv({
      cls: "docferry-workspace-brand",
      attr: {
        role: "button",
        tabindex: "0",
        "aria-label": "Open DocFerry dashboard",
        title: "Open DocFerry dashboard"
      }
    });
    appendDocferryLogo(brand, "docferry-workspace-brand-mark");
    const brandCopy = brand.createSpan({ cls: "docferry-workspace-brand-copy" });
    brandCopy.createSpan({ text: "DocFerry", cls: "docferry-workspace-brand-title" });
    brandCopy.createSpan({ text: "Save and share", cls: "docferry-workspace-brand-subtitle" });
    brand.addEventListener("click", () => void this.host.openDashboardHome());
    brand.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      void this.host.openDashboardHome();
    });
  }

  private renderHome(containerEl: HTMLElement): void {
    const canUseDetailedNote = this.host.docferrySettings.membership?.canUseMediaNote === true;
    const home = containerEl.createDiv({ cls: "docferry-import-home docferry-share-drop-surface" });
    const panel = home.createDiv({ cls: "docferry-import-panel" });
    const dropOverlay = panel.createDiv({
      cls: "docferry-share-drop-overlay",
      attr: { role: "status", "aria-live": "polite", "aria-atomic": "true" }
    });
    const dropCue = dropOverlay.createDiv({ cls: "docferry-share-drop-cue" });
    const dropIcon = dropCue.createSpan({
      cls: "docferry-share-drop-overlay-icon",
      attr: { "aria-hidden": "true" }
    });
    setIcon(dropIcon, "upload-cloud");
    dropCue.createEl("h3", {
      text: "Share from this vault",
      cls: "docferry-heading docferry-heading-3 docferry-share-drop-title"
    });
    dropCue.createEl("p", {
      text: "Release a note or folder to review sharing options.",
      cls: "docferry-share-drop-detail"
    });
    const dropGuard = dropCue.createDiv({ cls: "docferry-share-drop-guard" });
    const guardIcon = dropGuard.createSpan({ attr: { "aria-hidden": "true" } });
    setIcon(guardIcon, "shield-check");
    dropGuard.createSpan({ text: "Nothing is published until you confirm." });
    this.registerShareDropSurface(home);
    const intro = panel.createDiv({ cls: "docferry-import-intro" });
    appendDocferryLogo(intro, "docferry-import-mark docferry-import-logo").setAttr("aria-hidden", "true");
    const introCopy = intro.createDiv({ cls: "docferry-import-intro-copy" });
    introCopy.createEl("h2", { text: "Save to Obsidian", cls: "docferry-heading docferry-heading-2" });
    introCopy.createEl("p", { text: "Paste one public link. DocFerry chooses the best way to save it." });

    const scope = panel.createDiv({ cls: "docferry-import-scope", attr: { "aria-label": "Supported link types" } });
    this.renderImportScope(scope, "files", "DocFerry shares");
    this.renderImportScope(scope, "globe-2", "Web pages");
    this.renderImportScope(scope, "video", "Video");
    this.renderImportScope(scope, "audio-lines", "Audio");

    const fieldId = "docferry-dashboard-import-url";
    const field = panel.createDiv({ cls: "docferry-import-field" });
    field.createEl("label", { text: "Paste a link", attr: { for: fieldId } });
    const row = field.createDiv({ cls: "docferry-import-row" });
    const input = row.createEl("input", {
      type: "text",
      placeholder: "Paste any public link",
      cls: "docferry-import-url-input",
      attr: { id: fieldId, autocomplete: "off" }
    });
    input.value = this.importUrl;
    input.disabled = this.importLoading;
    input.addEventListener("input", () => {
      this.importUrl = input.value;
      this.importError = "";
      this.importSuccess = "";
      importButton.disabled = this.importLoading || !isValidWebUrl(this.importUrl);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") void this.handleImport();
    });

    const importButton = row.createEl("button", { cls: "mod-cta", attr: { type: "button" } });
    appendButtonLabel(importButton, "download", this.importLoading ? "Saving" : "Save");
    importButton.disabled = this.importLoading || !isValidWebUrl(this.importUrl);
    importButton.addEventListener("click", () => {
      void this.handleImport();
    });

    const guidance = field.createDiv({ cls: "docferry-import-guidance" });
    const guidanceIcon = guidance.createSpan({ attr: { "aria-hidden": "true" } });
    setIcon(guidanceIcon, canUseDetailedNote ? "sparkles" : "link");
    guidance.createSpan({
      text: canUseDetailedNote
        ? "Saving creates a note in your vault. Shared notes save instantly; web and media links may take a few minutes."
        : "Saving creates a note in your vault. Shared notes import directly; other public links become simple notes."
    });

    if (this.importLoading) {
      const status = panel.createDiv({
        cls: "docferry-import-progress",
        attr: { role: "status", "aria-live": "polite" }
      });
      const statusIcon = status.createSpan({
        cls: "docferry-import-progress-icon",
        attr: { "aria-hidden": "true" }
      });
      setIcon(statusIcon, "loader-circle");
      const statusCopy = status.createSpan({ cls: "docferry-import-progress-copy" });
      statusCopy.createSpan({
        text: this.importProgress ? "Preparing your note" : "Saving to Obsidian",
        cls: "docferry-import-progress-title"
      });
      statusCopy.createSpan({
        text: this.importProgress ? mediaNoteProgressMessage(this.importProgress) : "This should only take a moment."
      });
      if (this.importProgress) {
        statusCopy.createSpan({ text: "You can keep working. A preview will open when the note is ready." });
        const cancelButton = status.createEl("button", {
          cls: "docferry-import-cancel",
          attr: { type: "button" }
        });
        appendButtonLabel(cancelButton, "x", this.importCancelRequested ? "Cancelling" : "Cancel");
        cancelButton.disabled = this.importCancelRequested;
        cancelButton.addEventListener("click", () => void this.cancelImport());
      }
    } else if (this.host.docferrySettings.pendingMediaNoteImport) {
      const recovery = panel.createDiv({
        cls: "docferry-import-progress docferry-import-recovery",
        attr: { role: "status", "aria-live": "polite" }
      });
      const recoveryIcon = recovery.createSpan({ attr: { "aria-hidden": "true" } });
      setIcon(recoveryIcon, "history");
      const recoveryCopy = recovery.createSpan({ cls: "docferry-import-progress-copy" });
      recoveryCopy.createSpan({ text: "Detailed note pending review", cls: "docferry-import-progress-title" });
      recoveryCopy.createSpan({ text: "Resume the review or cancel it. Starting another will not duplicate the work." });
      const recoveryActions = recovery.createDiv({ cls: "docferry-import-recovery-actions" });
      const resumeButton = recoveryActions.createEl("button", { cls: "mod-cta", attr: { type: "button" } });
      appendButtonLabel(resumeButton, "play", "Resume");
      resumeButton.addEventListener("click", () => void this.resumeImport());
      const cancelButton = recoveryActions.createEl("button", { attr: { type: "button" } });
      appendButtonLabel(cancelButton, "x", "Cancel");
      cancelButton.addEventListener("click", () => void this.cancelPendingImport());
    }

    if (this.importError) panel.createDiv({ text: this.importError, cls: "docferry-dashboard-inline-error" });
    if (this.importSuccess) this.renderImportSuccess(panel, input);

    const shortcuts = home.createDiv({ cls: "docferry-import-shortcuts", attr: { "aria-label": "DocFerry pages" } });
    this.renderShortcut(shortcuts, "files", "Shares", "Published content", () => this.openSharesPage());
    if (this.host.docferrySettings.sessionToken) {
      this.renderShortcut(shortcuts, "layout-dashboard", "Dashboard", "Membership and billing", () => {
        void this.host.openDashboardHome();
      });
    } else {
      this.renderShortcut(shortcuts, "log-in", "Sign in", "Connect your Bondie account", () => {
        void this.host.startLogin();
      });
    }
    this.renderShortcut(shortcuts, "settings", "Preferences", "Plugin defaults", () => this.host.openSettingsTab());

    if (!this.importLoading) window.setTimeout(() => input.focus(), 50);
  }

  private renderImportSuccess(containerEl: HTMLElement, input: HTMLInputElement): void {
    const message = containerEl.createDiv({
      cls: "docferry-dashboard-inline-success",
      attr: { role: "status", "aria-live": "polite" }
    });
    const statusIcon = message.createSpan({
      cls: "docferry-dashboard-inline-message-icon",
      attr: { "aria-hidden": "true" }
    });
    setIcon(statusIcon, "circle-check");
    message.createSpan({ text: this.importSuccess, cls: "docferry-dashboard-inline-message-copy" });
    const dismissButton = message.createEl("button", {
      cls: "docferry-dashboard-inline-message-dismiss",
      attr: { type: "button", "aria-label": "Dismiss saved message", title: "Dismiss" }
    });
    setIcon(dismissButton, "x");
    dismissButton.addEventListener("click", () => {
      this.importSuccess = "";
      message.remove();
      input.focus();
    });
  }

  private renderImportScope(containerEl: HTMLElement, icon: string, label: string): void {
    const item = containerEl.createSpan({ cls: "docferry-import-scope-item" });
    const iconEl = item.createSpan({ attr: { "aria-hidden": "true" } });
    setIcon(iconEl, icon);
    item.createSpan({ text: label });
  }

  private registerShareDropSurface(surface: HTMLElement): void {
    const pathFrom = (event: DragEvent): string | null => this.host.vaultPathFromDrag(event);
    const positionCue = (event: DragEvent): void => {
      const bounds = surface.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      surface.style.setProperty("--df-drop-x", `${Math.max(0, Math.min(bounds.width, event.clientX - bounds.left))}px`);
      surface.style.setProperty("--df-drop-y", `${Math.max(0, Math.min(bounds.height, event.clientY - bounds.top))}px`);
    };
    const activate = (path: string, event: DragEvent): void => {
      if (path !== this.activeDragPath) {
        this.activeDragPath = path;
        this.updateShareDropCue(surface, path);
      }
      positionCue(event);
      surface.addClass("is-drag-active");
    };
    const clear = (): void => {
      this.dragDepth = 0;
      this.activeDragPath = "";
      surface.style.removeProperty("--df-drop-x");
      surface.style.removeProperty("--df-drop-y");
      surface.removeClass("is-drag-active");
    };
    surface.addEventListener("dragenter", (event) => {
      const path = pathFrom(event);
      if (!path) return;
      event.preventDefault();
      this.dragDepth += 1;
      activate(path, event);
    });
    surface.addEventListener("dragover", (event) => {
      const path = pathFrom(event);
      if (!path) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      activate(path, event);
    });
    surface.addEventListener("dragleave", () => {
      this.dragDepth = Math.max(0, this.dragDepth - 1);
      if (!this.dragDepth) clear();
    });
    surface.addEventListener("drop", (event) => {
      const path = pathFrom(event);
      clear();
      if (!path) return;
      event.preventDefault();
      event.stopPropagation();
      void this.host.publishVaultPath(path);
    });
  }

  private updateShareDropCue(surface: HTMLElement, path: string): void {
    const item = this.host.app.vault.getAbstractFileByPath(path);
    const isFolder = item instanceof TFolder;
    const displayName = item instanceof TFile ? item.basename : item?.name || path.split("/").pop() || path;
    const icon = surface.querySelector<HTMLElement>(".docferry-share-drop-overlay-icon");
    const title = surface.querySelector<HTMLElement>(".docferry-share-drop-title");
    const detail = surface.querySelector<HTMLElement>(".docferry-share-drop-detail");
    if (icon) setIcon(icon, isFolder ? "folder-up" : "file-up");
    if (title) title.textContent = isFolder ? "Share this folder" : "Share this note";
    if (detail) detail.textContent = `Release to review "${displayName}".`;
  }

  private renderSharesPage(containerEl: HTMLElement): void {
    const page = containerEl.createDiv({ cls: "docferry-workspace-page" });
    this.renderPageHeader(
      page,
      "Shares",
      this.sharesLoaded
        ? shareListSummary([...this.shares, ...this.folderShares].map((share) => share.status))
        : "Shared notes and folders from this account.",
      "Refresh",
      "refresh-cw",
      () => void this.refreshShares()
    );

    const currentKey = this.currentShareListKey();
    if (this.sharesKey && this.sharesKey !== currentKey) this.resetShares();

    if (!this.hasAuthForShares()) {
      this.renderEmpty(page, "Log in to view shares", "Connect your Bondie account to manage published notes and folders.", false, {
        label: "Log in",
        icon: "log-in",
        action: () => void this.host.startLogin()
      });
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
      page.createEl("h3", { text: "Folders", cls: "docferry-heading docferry-heading-4 docferry-share-group-title" });
      const folderList = page.createDiv({ cls: "docferry-share-list docferry-workspace-share-list" });
      for (const folderShare of this.folderShares) this.renderFolderShareRow(folderList, folderShare);
    }
    if (this.shares.length) {
      page.createEl("h3", { text: "Notes", cls: "docferry-heading docferry-heading-4 docferry-share-group-title" });
    }
    if (this.shares.length) {
      const list = page.createDiv({ cls: "docferry-share-list docferry-workspace-share-list" });
      for (const share of this.shares) {
        const row = list.createDiv({ cls: "docferry-share-row docferry-workspace-share-row docferry-share-row--compact" });
        const main = row.createDiv({ cls: "docferry-share-main" });
        main.createEl("h4", { text: share.title || share.source_path, cls: "docferry-heading docferry-heading-4" });
        main.createEl("p", { text: share.source_path });
        const meta = main.createDiv({ cls: "docferry-share-meta" });
        meta.createSpan({ text: vaultLabel(share) });
        meta.createSpan({ text: `Updated ${formatDateTime(share.updated_at)}` });
        if (share.expires_at && share.status !== "stopped") {
          meta.createSpan({ text: expiryLabel(share) });
        }

        const badges = row.createDiv({ cls: "docferry-share-badges" });
        badges.createSpan({ text: statusLabel(share.status), cls: `docferry-pill ${statusClass(share.status)}` });
        if (share.password_enabled) badges.createSpan({ text: "Password", cls: "docferry-pill is-locked" });

        const actions = row.createDiv({ cls: "docferry-share-actions" });
        if (hasActiveShareLink(share.status)) {
          const copyButton = actions.createEl("button", { attr: { type: "button", "aria-label": "Copy share URL" } });
          appendButtonLabel(copyButton, "copy", "Copy");
          addAsyncClickListener(copyButton, async () => {
            await navigator.clipboard.writeText(share.url);
            new Notice("Share link copied");
          });
          const openButton = actions.createEl("button", { attr: { type: "button", "aria-label": "Open share URL" } });
          appendButtonLabel(openButton, "external-link", "Open");
          openButton.addEventListener("click", () => {
            void openExternalUrl(share.url);
          });
          const linksButton = actions.createEl("button", { attr: { type: "button", "aria-label": "Show linked note status" } });
          appendButtonLabel(linksButton, "list-checks", "Links");
          addAsyncClickListener(linksButton, async () => {
            await this.host.openShareLinks(share);
          });
          const updateButton = actions.createEl("button", { attr: { type: "button", "aria-label": "Update share" } });
          appendButtonLabel(updateButton, "upload-cloud", "Update");
          addAsyncClickListener(updateButton, async () => {
            await this.host.updateShareFromList(share);
          });
        }
        if (hasActiveShareLink(share.status)) {
          const moreButton = actions.createEl("button", {
            cls: "docferry-icon-button",
            attr: {
              type: "button",
              "aria-label": `More actions for ${share.title || share.source_path}`,
              title: "More actions"
            }
          });
          appendIconOnly(moreButton, "more-horizontal");
          moreButton.addEventListener("click", () => this.showShareMenu(moreButton, share));
        } else {
          const deleteButton = actions.createEl("button", {
            cls: "docferry-delete-history-button",
            attr: { type: "button", "aria-label": `Delete history for ${share.title || share.source_path}` }
          });
          appendButtonLabel(deleteButton, "trash-2", "Delete");
          addAsyncClickListener(deleteButton, async () => {
            await this.host.deleteShareHistory(share);
            await this.refreshShares();
          });
        }
      }
    }
  }

  private renderFolderShareRow(containerEl: HTMLElement, folderShare: FolderShareResponse): void {
    const row = containerEl.createDiv({ cls: "docferry-share-row docferry-workspace-share-row docferry-share-row--compact" });
    const main = row.createDiv({ cls: "docferry-share-main" });
    main.createEl("h4", { text: folderShare.title, cls: "docferry-heading docferry-heading-4" });
    main.createEl("p", { text: folderShare.source_folder });
    const meta = main.createDiv({ cls: "docferry-share-meta" });
    meta.createSpan({ text: `${folderShare.document_count} notes` });
    meta.createSpan({ text: `Updated ${formatDateTime(folderShare.updated_at)}` });
    meta.createSpan({ text: folderShare.theme_mode === "full" ? "Theme styling" : "Reader style" });

    const badges = row.createDiv({ cls: "docferry-share-badges" });
    badges.createSpan({ text: statusLabel(folderShare.status), cls: `docferry-pill ${statusClass(folderShare.status)}` });
    if (folderShare.password_enabled) badges.createSpan({ text: "Password", cls: "docferry-pill is-locked" });

    const actions = row.createDiv({ cls: "docferry-share-actions" });
    if (hasActiveShareLink(folderShare.status)) {
      const copyButton = actions.createEl("button", { attr: { type: "button", "aria-label": "Copy folder share URL" } });
      appendButtonLabel(copyButton, "copy", "Copy");
      addAsyncClickListener(copyButton, async () => {
        await navigator.clipboard.writeText(folderShare.url);
        new Notice("Folder share link copied");
      });
      const openButton = actions.createEl("button", { attr: { type: "button", "aria-label": "Open folder share" } });
      appendButtonLabel(openButton, "external-link", "Open");
      openButton.addEventListener("click", () => openExternalUrl(folderShare.url));
      const updateButton = actions.createEl("button", { attr: { type: "button", "aria-label": "Update folder share" } });
      appendButtonLabel(updateButton, "upload-cloud", "Update");
      addAsyncClickListener(updateButton, async () => {
        await this.host.updateFolderShareFromList(folderShare);
      });
    }
    if (hasActiveShareLink(folderShare.status)) {
      const moreButton = actions.createEl("button", {
        cls: "docferry-icon-button",
        attr: { type: "button", "aria-label": `More actions for ${folderShare.title}`, title: "More actions" }
      });
      appendIconOnly(moreButton, "more-horizontal");
      moreButton.addEventListener("click", () => this.showFolderShareMenu(moreButton, folderShare));
    } else {
      const deleteButton = actions.createEl("button", {
        cls: "docferry-delete-history-button",
        attr: { type: "button", "aria-label": `Delete history for ${folderShare.title}` }
      });
      appendButtonLabel(deleteButton, "trash-2", "Delete");
      addAsyncClickListener(deleteButton, async () => {
        await this.host.deleteFolderShareHistory(folderShare);
        await this.refreshShares();
      });
    }
  }

  private renderAccountPage(containerEl: HTMLElement): void {
    const page = containerEl.createDiv({ cls: "docferry-workspace-page docferry-account-page" });
    this.renderPageHeader(page, "Account", "Your DocFerry plan and signed-in Bondie account.");

    const account = this.host.docferrySettings.connectedAccount;
    const connected = Boolean(this.host.docferrySettings.sessionToken);
    const displayName = account?.displayUser?.name || account?.displayUser?.email || "Not connected";

    const card = page.createDiv({ cls: "docferry-account-card docferry-workspace-account-card" });
    if (connected) {
      renderAccountAvatar(card, account?.displayUser, "docferry-account-avatar");
    } else {
      const placeholder = card.createDiv({ cls: "docferry-account-avatar is-placeholder", attr: { "aria-hidden": "true" } });
      setIcon(placeholder, "user");
    }
    const details = card.createDiv({ cls: "docferry-account-details" });
    details.createEl("h3", { text: displayName, cls: "docferry-heading docferry-heading-4" });
    details.createEl("p", {
      text: connected
        ? "Signed in with Bondie"
        : "Connect once to publish, import shares, and use account features."
    });
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
    membershipCopy.createEl("h3", { text: "Plan and usage", cls: "docferry-heading docferry-heading-4" });
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
    renderMembershipStat(
      membershipStats,
      "Shares",
      membership ? membershipUsageLabel(membership.activeShareCount, membership.activeShareLimit) : "-"
    );
    renderMembershipStat(
      membershipStats,
      "Folders",
      membership ? membershipUsageLabel(membership.activeFolderShareCount, membership.activeFolderShareLimit) : "-"
    );
    renderMembershipStat(membershipStats, "File size", membership ? formatBytes(membership.maxSingleFileSizeBytes) : "-");
    renderMembershipStat(
      membershipStats,
      "Advanced imports",
      membership
        ? membership.mediaNoteMonthlyJobLimit === null
          ? `${membership.mediaNoteMonthlyJobsUsed} this month`
          : membershipUsageLabel(membership.mediaNoteMonthlyJobsUsed, membership.mediaNoteMonthlyJobLimit)
        : "-"
    );
    if (membership?.hasMediaNoteEntitlement) {
      membershipCard.createDiv({
        text: `Detailed web, audio, and video notes plus Obsidian-inspired theme styling. Usage resets ${formatCalendarDate(membership.mediaNoteResetsAt)}.`,
        cls: "docferry-membership-benefit-note"
      });
    } else if (membership) {
      membershipCard.createDiv({
        text: "Pro adds detailed web, audio, and video notes, folder sharing, and Obsidian-inspired theme styling.",
        cls: "docferry-membership-benefit-note"
      });
    }
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
    const dashboardButton = actions.createEl("button", { cls: "mod-cta", attr: { type: "button" } });
    appendButtonLabel(dashboardButton, "layout-dashboard", "Open dashboard");
    addAsyncClickListener(dashboardButton, async () => this.host.openDashboardHome());
    const moreButton = actions.createEl("button", {
      cls: "docferry-icon-button",
      attr: { type: "button", "aria-label": "More account actions", title: "More account actions" }
    });
    appendIconOnly(moreButton, "more-horizontal");
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
    const backButton = header.createEl("button", {
      cls: "docferry-workspace-back docferry-icon-button",
      attr: { type: "button", "aria-label": "Back to DocFerry home", title: "Home" }
    });
    appendIconOnly(backButton, "arrow-left");
    backButton.addEventListener("click", () => {
      this.openHomePage();
    });

    const copy = header.createDiv({ cls: "docferry-workspace-page-copy" });
    copy.createEl("h1", { text: title, cls: "docferry-heading docferry-heading-2" });
    copy.createEl("p", { text: description });

    if (actionLabel && actionIcon && action) {
      const actionButton = header.createEl("button", {
        cls: "docferry-icon-button",
        attr: { type: "button", "aria-label": actionLabel, title: actionLabel }
      });
      appendIconOnly(actionButton, actionIcon);
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

  private openHomePage(): void {
    this.activePage = "home";
    this.render();
  }

  private openSharesPage(): void {
    this.activePage = "shares";
    this.render();
    if (this.hasAuthForShares() && !this.sharesLoaded && !this.sharesLoading) void this.refreshShares();
  }

  private async handleImport(): Promise<void> {
    const url = this.importUrl.trim();
    if (!isValidWebUrl(url)) {
      this.importError = "Enter a valid web URL.";
      this.importSuccess = "";
      this.render();
      return;
    }
    if (!parseDocferryShareUrl(url, this.host.docferrySettings.serverUrl)) {
      this.importLoading = true;
      this.importCancelRequested = false;
      this.importProgress = this.shouldPrepareDetailedNote(url) ? "starting" : "";
      this.importError = "";
      this.importSuccess = "";
      this.render();
      try {
        const result = await this.host.importExternalLink(
          url,
          (progress) => {
            this.importProgress = progress;
            this.render();
          }
        );
        if (!result) {
          this.importSuccess = "Nothing was saved.";
          return;
        }
        this.importUrl = "";
        this.importSuccess = `Saved ${result.title} to ${result.notePath}.`;
      } catch (error) {
        if (this.importCancelRequested) {
          this.importSuccess = "Import cancelled. Nothing was saved.";
        } else {
          this.importError = formatError(error, "Import failed");
        }
      } finally {
        this.importLoading = false;
        this.importProgress = "";
        this.importCancelRequested = false;
        this.render();
      }
      return;
    }
    await this.runImport(url);
  }

  private async cancelImport(): Promise<void> {
    if (!this.importLoading || !this.importProgress || this.importCancelRequested) return;
    this.importCancelRequested = true;
    this.render();
    try {
      await this.host.cancelActiveMediaImport();
    } catch (error) {
      this.importCancelRequested = false;
      this.importError = formatError(error, "Could not cancel import");
      this.render();
    }
  }

  private async resumeImport(): Promise<void> {
    this.importLoading = true;
    this.importProgress = "reading";
    this.importError = "";
    this.importSuccess = "";
    this.render();
    try {
      await this.host.resumeActiveMediaImport();
    } finally {
      this.importLoading = false;
      this.importProgress = "";
      this.render();
    }
  }

  private async cancelPendingImport(): Promise<void> {
    try {
      await this.host.cancelActiveMediaImport();
      this.importSuccess = "Import cancelled. Nothing was saved.";
      this.importError = "";
    } catch (error) {
      this.importError = formatError(error, "Could not cancel import");
    }
    this.render();
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
    if (hasActiveShareLink(share.status)) {
      menu.addItem((item) =>
        item.setTitle("Stop sharing").setIcon("unlink").onClick(async () => {
          await this.host.stopShareFromList(share);
          await this.refreshShares();
        })
      );
    } else {
      menu.addItem((item) =>
        item.setTitle("Delete history").setIcon("trash-2").onClick(async () => {
          await this.host.deleteShareHistory(share);
          await this.refreshShares();
        })
      );
    }
    showMenuBelowButton(menu, button);
  }

  private showFolderShareMenu(button: HTMLElement, folderShare: FolderShareResponse): void {
    const menu = new Menu();
    if (folderShare.status !== "stopped" && folderShare.status !== "expired") {
      menu.addItem((item) =>
        item.setTitle("Stop sharing").setIcon("unlink").onClick(async () => {
          await this.host.stopFolderShareFromList(folderShare);
          await this.refreshShares();
        })
      );
    } else {
      menu.addItem((item) =>
        item.setTitle("Delete history").setIcon("trash-2").onClick(async () => {
          await this.host.deleteFolderShareHistory(folderShare);
          await this.refreshShares();
        })
      );
    }
    showMenuBelowButton(menu, button);
  }

  private showAccountMenu(button: HTMLElement): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("Manage plan").setIcon("credit-card").onClick(() => void this.host.openMembershipCenter()));
    menu.addItem((item) => item.setTitle("Switch account").setIcon("log-in").onClick(() => void this.host.reconnectAccount()));
    menu.addItem((item) => item.setTitle("Support").setIcon("life-buoy").onClick(() => void this.host.requestAccessUpgrade("plugin_dashboard")));
    menu.addItem((item) => item.setTitle("Plugin preferences").setIcon("settings").onClick(() => this.host.openSettingsTab()));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Disconnect").setIcon("log-out").onClick(async () => {
      await this.host.disconnectAccount();
      this.resetShares();
      this.render();
    }));
    showMenuBelowButton(menu, button);
  }

  private shouldPrepareDetailedNote(value: string): boolean {
    const membership = this.host.docferrySettings.membership;
    if (!membership?.hasMediaNoteEntitlement || !membership.canUseMediaNote) return false;
    try {
      const provider = externalLinkProvider(validatedExternalImportUrl(value));
      return shouldPrepareDetailedNote(membership.hasMediaNoteEntitlement, provider, {
        enabled: membership.canUseMediaNote,
        supportedProviders: membership.mediaNoteProviders
      });
    } catch {
      return false;
    }
  }

  private renderShareSkeleton(containerEl: HTMLElement): void {
    const list = containerEl.createDiv({
      cls: "docferry-share-list docferry-workspace-share-list",
      attr: { "aria-busy": "true", "aria-label": "Loading shares" }
    });
    for (let index = 0; index < 4; index += 1) {
      const row = list.createDiv({
        cls: "docferry-share-row docferry-workspace-share-row docferry-share-row--compact is-loading"
      });
      const main = row.createDiv({ cls: "docferry-share-main" });
      main.createDiv({ cls: "docferry-skeleton-line is-title" });
      main.createDiv({ cls: "docferry-skeleton-line" });
    }
  }

  private renderEmpty(
    containerEl: HTMLElement,
    title: string,
    message: string,
    isError = false,
    action?: { label: string; icon: string; action: () => void }
  ): void {
    const empty = containerEl.createDiv({ cls: `docferry-settings-empty ${isError ? "is-error" : ""}` });
    empty.createEl("h3", { text: title, cls: "docferry-heading docferry-heading-4" });
    empty.createEl("p", { text: message });
    if (action) {
      const button = empty.createEl("button", { cls: "mod-cta", attr: { type: "button" } });
      appendButtonLabel(button, action.icon, action.label);
      button.addEventListener("click", action.action);
    }
  }
}

function appendButtonLabel(button: HTMLButtonElement, icon: string, text: string): void {
  const iconEl = button.createSpan({ cls: "docferry-button-icon", attr: { "aria-hidden": "true" } });
  setIcon(iconEl, icon);
  button.createSpan({ text, cls: "docferry-button-label" });
}

function appendIconOnly(button: HTMLElement, iconName: string): void {
  button.createSpan({
    cls: "docferry-icon-button-glyph",
    attr: { "aria-hidden": "true", "data-docferry-icon": iconName }
  });
}

function formatCalendarDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "next month";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function addAsyncClickListener(button: HTMLElement, handler: () => Promise<void>): void {
  button.addEventListener("click", () => {
    void handler().catch(() => {
      new Notice("That action could not be completed. Check your connection and try again.");
    });
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
