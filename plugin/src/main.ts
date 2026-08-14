import { App, Component, MarkdownRenderer, MarkdownView, Notice, Plugin, TFile, TFolder, normalizePath } from "obsidian";
import { ShareApiClient, ShareApiError } from "./api-client";
import { isInvalidProductSessionError } from "./session-errors";
import { AuthCompletionError, AuthService } from "./auth-service";
import { confirmDeleteShareHistory, confirmStopShare } from "./confirm-stop-modal";
import {
  DOCFERRY_DASHBOARD_VIEW_TYPE,
  DocferryDashboardView,
  type DashboardImportResult
} from "./dashboard-view";
import { clearShareMeta, readShareMeta, writeShareMeta } from "./frontmatter";
import { buildExternalLinkNote, externalLinkProviderLabel } from "./external-import";
import { openExternalUrl } from "./external-links";
import { folderShareAccess } from "./folder-share-access";
import { FolderShareModal } from "./folder-share-modal";
import { classifyProtocolCallback } from "./protocol-callback";
import { ImportShareModal, type ImportShareOptions } from "./import-share-modal";
import { commitAtomicImport, type ImportFileSystem } from "./import-transaction";
import { LinkStatusModal } from "./link-status-modal";
import {
  MEDIA_NOTE_READY_STATUSES,
  MEDIA_NOTE_MAX_POLL_ATTEMPTS,
  MEDIA_NOTE_POLL_INTERVAL_MS,
  MEDIA_NOTE_TERMINAL_STATUSES,
  type MediaNoteProgress,
  mediaNoteFailureMessage,
  mediaNoteMarkdownForObsidian,
  mediaNoteTitle
} from "./media-note";
import { confirmMediaNoteImport } from "./media-note-preview-modal";
import {
  hasMediaNoteJobCapacity,
  requiresDetailedNoteProvider,
  shouldPrepareDetailedNote
} from "./media-note-availability";
import {
  DEFAULT_SETTINGS,
  DocferrySettingTab,
  formatBytes,
  membershipLimitLabel,
  membershipFromResponse,
  normalizeVaultFolder,
  type DocferrySettings,
  type PendingMediaNoteImport
} from "./settings";
import { enforceProductionServiceBoundary } from "./service-boundary";
import { shareMetaBelongsToService } from "./share-url";
import { ResultModal } from "./result-modal";
import { ShareModal } from "./share-modal";
import { initialExpirySelection, initialThemeStyling } from "./publish-state";
import { isRemoteUrl } from "./theme-safety";
import type {
  FolderShareDocumentPayload,
  FolderShareResponse,
  MediaNoteJobResponse,
  PublishOptions,
  ShareImportAsset,
  ShareListItemResponse,
  SharePayload,
  ShareResponse
} from "./types";
import { confirmDocferryUploadNotice } from "./upload-consent-modal";
import { resolveVaultDragPath } from "./vault-drag";
import { safeVaultSegment } from "./vault-filename";

interface UploadedImageAsset {
  assetId: string;
  originalPath: string;
}

interface UploadedLocalAsset {
  assetId: string;
  originalPath: string;
  role: "image" | "attachment" | "video" | "font";
}

interface UploadedLocalAssets {
  linkedAssets: UploadedLocalAsset[];
  imageAssets: Array<UploadedImageAsset | null>;
}

interface PendingLocalAsset {
  target: TFile;
  originalPath: string;
  role: UploadedLocalAsset["role"];
  contentType: string;
}

interface PreparedAssetUpload {
  data: ArrayBuffer;
  filename: string;
  contentType: string;
  qualityMode: "original";
}

interface UploadedCssAsset {
  assetId: string;
}

interface HtmlSnapshotResult {
  html: string;
  css: string | null;
  themeMode: "reader" | "full";
}

function mediaNoteIdempotencyKey(): string {
  const uuid = window.crypto?.randomUUID?.();
  return `plugin-${uuid || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

interface OutboundLink {
  raw_target: string;
  target_path?: string | null;
  target_doc_identity?: string | null;
  target_subpath?: string | null;
  label?: string | null;
  link_kind: "wiki" | "markdown_relative" | "embed";
}

type AppWithSetting = App & {
  setting?: {
    open(): void;
    openTabById(id: string): void;
    close?(): void;
  };
};

const THEME_CSS_FILENAME = "docferry-obsidian-theme-snapshot.css";
const ASSET_UPLOAD_CONCURRENCY = 3;
const UPLOAD_CONSENT_NOTICE_ID = "docferry-privacy-security-disclosure-v7";
const PROTOCOL_ACTIONS = ["docferry"];
const BILLING_RETURN_REFRESH_WINDOW_MS = 15 * 60 * 1000;
const BILLING_RETURN_REFRESH_DELAYS_MS = [2000, 5000, 10000, 20000, 30000, 60000, 90000, 120000];

export default class DocferryPlugin extends Plugin {
  docferrySettings!: DocferrySettings;
  private api!: ShareApiClient;
  private auth!: AuthService;
  private settingTab: DocferrySettingTab | null = null;
  private uploadNoticeOpen = false;
  private billingReturnRefreshGeneration = 0;
  private pendingBillingReturnRefreshUntil = 0;
  private billingReturnRefreshInFlight = false;
  private billingSessionRecoveryUntil = 0;
  private activeVaultDragPath = "";
  private lastActiveMarkdownPath = "";
  private mediaNoteRecoveryInFlight = false;
  private shareImportCommitQueue: Promise<void> = Promise.resolve();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.api = new ShareApiClient(
      () => this.docferrySettings,
      this.manifest.version,
      (error) => this.handleInvalidProductSession(error)
    );
    this.auth = new AuthService(
      this.api,
      async (token, response) => {
        this.billingSessionRecoveryUntil = 0;
        const pending = this.docferrySettings.pendingMediaNoteImport;
        if (
          pending &&
          response.product_subject_id &&
          pending.ownerProductSubjectId !== response.product_subject_id
        ) {
          const previousSessionToken = this.docferrySettings.sessionToken;
          const previousAccount = this.docferrySettings.connectedAccount;
          const previousMembership = this.docferrySettings.membership;
          this.docferrySettings.sessionToken = token;
          try {
            await this.api.logout();
          } catch (error) {
            this.debug("logout mismatched account session failed", error);
          } finally {
            this.docferrySettings.sessionToken = previousSessionToken;
            this.docferrySettings.connectedAccount = previousAccount;
            this.docferrySettings.membership = previousMembership;
            await this.saveSettings();
          }
          throw new AuthCompletionError(
            "This detailed note belongs to another Bondie account. Sign in with the account that started it, then resume or cancel it."
          );
        }
        this.docferrySettings.sessionToken = token;
        this.docferrySettings.connectedAccount = response.product_subject_id
          ? {
              productSubjectId: response.product_subject_id,
              productKey: response.product_key ?? null,
              productInstanceId: response.product_instance_id ?? null,
              displayUser: response.display_user ?? null,
              connectedAt: new Date().toISOString()
            }
          : null;
        await this.saveSettings();
        this.settingTab?.refreshForAuthChange();
        this.refreshDashboardAuth();
        try {
          await this.loadMembership(true);
        } catch (error) {
          this.debug("membership refresh after login failed", error);
        }
      },
      () => ({
        clientInstanceId: this.docferrySettings.clientInstanceId,
        pluginVersion: this.manifest.version,
        platform: "obsidian",
        instanceType: "obsidian_plugin"
      }),
      () => ({
        state: this.docferrySettings.pendingAuthState,
        startedAt: this.docferrySettings.pendingAuthStartedAt
      }),
      async (state, startedAt) => {
        this.docferrySettings.pendingAuthState = state;
        this.docferrySettings.pendingAuthStartedAt = startedAt;
        await this.saveSettings();
      }
    );
    void this.auth.resumePendingLogin();

    this.settingTab = new DocferrySettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.registerView(DOCFERRY_DASHBOARD_VIEW_TYPE, (leaf) => new DocferryDashboardView(leaf, this));
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (file instanceof TFolder) {
        menu.addItem((item) => item
          .setTitle("Publish folder with DocFerry")
          .setIcon("folder-up")
          .onClick(() => void this.publishFolder(file)));
      }
    }));
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        const view = leaf?.view;
        if (view instanceof MarkdownView && view.file instanceof TFile && view.file.extension === "md") {
          this.lastActiveMarkdownPath = view.file.path;
        }
      })
    );
    this.addRibbonIcon("ship", "Open dashboard", () => {
      void this.activateDashboardView().then((dashboard) => dashboard?.showHomePage());
    });
    for (const action of PROTOCOL_ACTIONS) {
      this.registerObsidianProtocolHandler(action, async (data) => {
        const params = data as Record<string, string>;
        const callback = classifyProtocolCallback(params);
        if (callback.kind === "billing-return") {
          await this.handleBillingReturn(callback.status);
          return;
        }
        if (callback.kind === "import") {
          await this.importShareUrl(callback.url);
          return;
        }
        new Notice("This DocFerry link is not supported.");
      });
    }
    this.registerDomEvent(window, "focus", () => {
      void this.refreshAfterPendingBillingReturn();
    });
    this.registerDomEvent(activeDocument, "visibilitychange", () => {
      if (activeDocument.visibilityState === "visible") void this.refreshAfterPendingBillingReturn();
    });
    this.registerDomEvent(activeDocument, "dragstart", (event: DragEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-path]") : null;
      const path = target?.dataset.path || "";
      this.activeVaultDragPath = this.app.vault.getAbstractFileByPath(path) ? path : "";
    }, true);
    this.registerDomEvent(activeDocument, "dragend", () => {
      window.setTimeout(() => {
        this.activeVaultDragPath = "";
      }, 0);
    }, true);

    this.addCommand({
      id: "open-dashboard",
      name: "Open dashboard",
      callback: () => {
        void this.activateDashboardView().then((dashboard) => dashboard?.showHomePage());
      }
    });

    this.addCommand({
      id: "open-shares",
      name: "Open shared links",
      callback: () => {
        void this.activateDashboardView().then((dashboard) => dashboard?.showSharesPage());
      }
    });

    this.addCommand({
      id: "open-account",
      name: "Open account",
      callback: () => {
        void this.activateDashboardView().then((dashboard) => dashboard?.showAccountPage());
      }
    });

    this.addCommand({
      id: "publish-current-note",
      name: "Publish current note",
      checkCallback: (checking) => {
        const file = this.getActiveMarkdownFile();
        if (!file) return false;
        if (!checking) void this.publishFile(file);
        return true;
      }
    });

    this.addCommand({
      id: "publish-current-folder",
      name: "Publish current note folder",
      checkCallback: (checking) => {
        const folder = this.getActiveMarkdownFile()?.parent;
        if (!(folder instanceof TFolder)) return false;
        if (!checking) void this.publishFolder(folder);
        return true;
      }
    });

    this.addCommand({
      id: "copy-share-link",
      name: "Copy share link",
      checkCallback: (checking) => {
        const file = this.getActiveMarkdownFile();
        if (!file) return false;
        if (!checking) void this.copyShareLink(file);
        return true;
      }
    });

    this.addCommand({
      id: "stop-sharing-current-note",
      name: "Stop sharing current note",
      checkCallback: (checking) => {
        const file = this.getActiveMarkdownFile();
        if (!file) return false;
        const meta = this.currentShareMeta(file);
        if (!meta.id) return false;
        if (!checking) void this.stopSharing(file);
        return true;
      }
    });

    this.addCommand({
      id: "show-linked-note-status",
      name: "Show linked note status",
      checkCallback: (checking) => {
        const file = this.getActiveMarkdownFile();
        if (!file) return false;
        const meta = this.currentShareMeta(file);
        if (!meta.id) return false;
        if (!checking) void this.showLinkStatus(file);
        return true;
      }
    });

    this.addCommand({
      id: "import-share-url",
      name: "Import share URL",
      callback: () => {
        void this.importShareUrl();
      }
    });

    this.addCommand({
      id: "import-web-link",
      name: "Import web or media link",
      callback: () => {
        void this.activateDashboardView().then((dashboard) => dashboard?.showHomePage());
      }
    });

    this.addCommand({
      id: "connect-account",
      name: "Connect account",
      callback: () => {
        void this.startLogin();
      }
    });

    this.addCommand({
      id: "create-account",
      name: "Create Bondie account",
      callback: () => {
        void this.startSignup();
      }
    });

    this.addCommand({
      id: "reconnect-account",
      name: "Reconnect account",
      callback: () => {
        void this.reconnectAccount();
      }
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        const meta = this.currentShareMeta(file);
        if (meta.id) {
          menu.addItem((item) => {
            item.setTitle("Update share link")
              .setIcon("upload-cloud")
              .onClick(() => void this.publishFile(file));
          });
          menu.addItem((item) => {
            item.setTitle("Copy share link")
              .setIcon("copy")
              .onClick(() => void this.copyShareLink(file));
          });
          menu.addItem((item) => {
            item.setTitle("Show linked note status")
              .setIcon("list-checks")
              .onClick(() => void this.showLinkStatus(file));
          });
          menu.addItem((item) => {
            item.setTitle("Stop sharing")
              .setIcon("unlink")
              .onClick(() => void this.stopSharing(file));
          });
        } else {
          menu.addItem((item) => {
            item.setTitle("Publish share link")
              .setIcon("share")
              .onClick(() => void this.publishFile(file));
          });
        }
      })
    );
    this.app.workspace.onLayoutReady(() => {
      if (this.docferrySettings.sessionToken) this.refreshMembershipForDashboardOpen();
      if (this.docferrySettings.sessionToken && this.docferrySettings.pendingMediaNoteImport) {
        window.setTimeout(() => void this.resumeActiveMediaImport(), 900);
      }
      window.setTimeout(() => {
        void this.showUploadNoticeIfNeeded(false);
      }, 600);
    });
  }

  async loadSettings(): Promise<void> {
    const loadedSettings = (await this.loadData()) as Record<string, unknown> | null;
    const allowedKeys = new Set(Object.keys(DEFAULT_SETTINGS));
    const settingsRecord = { ...DEFAULT_SETTINGS } as DocferrySettings & Record<string, unknown>;
    for (const key of allowedKeys) {
      if (loadedSettings && Object.prototype.hasOwnProperty.call(loadedSettings, key)) {
        settingsRecord[key] = loadedSettings[key];
      }
    }
    this.docferrySettings = settingsRecord;
    let changed = Boolean(loadedSettings && Object.keys(loadedSettings).some((key) => !allowedKeys.has(key)));
    changed = enforceProductionServiceBoundary(this.docferrySettings, DEFAULT_SETTINGS.serverUrl) || changed;
    if (!this.docferrySettings.clientInstanceId) {
      this.docferrySettings.clientInstanceId = `obs_${crypto.randomUUID()}`;
      changed = true;
    }
    const normalizedImportFolder =
      normalizeVaultFolder(this.docferrySettings.defaultImportFolder) || DEFAULT_SETTINGS.defaultImportFolder;
    if (this.docferrySettings.defaultImportFolder !== normalizedImportFolder) {
      this.docferrySettings.defaultImportFolder = normalizedImportFolder;
      changed = true;
    }
    const pendingImport = this.docferrySettings.pendingMediaNoteImport;
    if (
      pendingImport &&
      (!pendingImport.jobId || !pendingImport.ownerProductSubjectId || !pendingImport.sourceUrl)
    ) {
      this.docferrySettings.pendingMediaNoteImport = null;
      changed = true;
    }
    if (changed) await this.saveSettings();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.docferrySettings);
  }

  async testConnection(): Promise<void> {
    try {
      await this.api.health();
      if (!this.docferrySettings.sessionToken) {
        new Notice("DocFerry server is reachable, but no Bondie account is connected.");
        return;
      }
      const account = await this.api.whoami();
      if (account.product_subject_id) {
        this.docferrySettings.connectedAccount = {
          productSubjectId: account.product_subject_id,
          productKey: account.product_key ?? null,
          productInstanceId: account.product_instance_id ?? null,
          displayUser: account.display_user ?? this.docferrySettings.connectedAccount?.displayUser ?? null,
          connectedAt: this.docferrySettings.connectedAccount?.connectedAt ?? new Date().toISOString()
        };
        await this.saveSettings();
        this.settingTab?.refreshForAuthChange();
        this.refreshDashboardAuth();
        try {
          await this.loadMembership(true);
        } catch (membershipError) {
          this.debug("membership refresh after connection test failed", membershipError);
        }
      }
      const displayName =
        this.docferrySettings.connectedAccount?.displayUser?.name ||
        this.docferrySettings.connectedAccount?.displayUser?.email ||
        this.docferrySettings.connectedAccount?.productSubjectId.slice(-8) ||
        "Bondie account";
      if (account.billing_session_ready === false) {
        new Notice(`DocFerry server is reachable. Signed in as ${displayName}; reconnect before managing billing.`);
        return;
      }
      new Notice(`DocFerry server is reachable. Signed in as ${displayName}.`);
    } catch (error) {
      if (isInvalidProductSessionError(error)) return;
      new Notice(this.formatError(error, "Connection failed"));
    }
  }

  async startLogin(): Promise<void> {
    await this.auth.startLogin();
  }

  async startSignup(): Promise<void> {
    if (!(await this.finishPendingImportBeforeAccountChange())) return;
    if (!(await this.logoutBeforeAccountChange())) return;
    this.clearLocalBondieAccount();
    await this.saveSettings();
    this.settingTab?.refreshForAuthChange();
    this.refreshDashboardAuth();
    await this.auth.startLogin({ signup: true });
  }

  async reconnectAccount(): Promise<void> {
    if (!(await this.finishPendingImportBeforeAccountChange())) return;
    if (!(await this.logoutBeforeAccountChange())) return;
    this.clearLocalBondieAccount();
    await this.saveSettings();
    this.settingTab?.refreshForAuthChange();
    this.refreshDashboardAuth();
    await this.auth.startLogin({ promptLogin: true });
  }

  private async logoutBeforeAccountChange(): Promise<boolean> {
    if (!this.docferrySettings.sessionToken) return true;
    try {
      await this.api.logout();
      return true;
    } catch (error) {
      if (isInvalidProductSessionError(error)) return true;
      new Notice(this.formatError(error, "Could not switch accounts"));
      return false;
    }
  }

  async disconnectAccount(): Promise<void> {
    if (!(await this.finishPendingImportBeforeAccountChange())) return;
    if (this.docferrySettings.sessionToken) {
      try {
        await this.api.logout();
      } catch (error) {
        if (!isInvalidProductSessionError(error)) {
          new Notice(this.formatError(error, "Could not disconnect"));
          return;
        }
      }
    }
    this.clearLocalBondieAccount();
    await this.saveSettings();
    this.settingTab?.refreshForAuthChange();
    this.refreshDashboardAuth();
    new Notice("Bondie account disconnected.");
  }

  private async finishPendingImportBeforeAccountChange(): Promise<boolean> {
    if (!this.docferrySettings.pendingMediaNoteImport) return true;
    try {
      await this.cancelActiveMediaImport();
    } catch (error) {
      new Notice(this.formatError(error, "Could not cancel the current detailed note"), 8000);
      return false;
    }
    if (!this.docferrySettings.pendingMediaNoteImport) return true;
    new Notice("Finish or cancel the current detailed note before changing Bondie accounts.", 8000);
    return false;
  }

  private clearLocalBondieAccount(preservePendingImport = false): void {
    this.billingReturnRefreshGeneration++;
    this.clearPendingBillingReturnRefresh();
    this.docferrySettings.sessionToken = "";
    this.docferrySettings.connectedAccount = null;
    this.docferrySettings.membership = null;
    if (!preservePendingImport) this.docferrySettings.pendingMediaNoteImport = null;
  }

  private handleInvalidProductSession(error: unknown): void {
    if (!isInvalidProductSessionError(error)) return;
    if (!this.docferrySettings.sessionToken && !this.docferrySettings.connectedAccount && !this.docferrySettings.membership) return;
    this.clearLocalBondieAccount(true);
    this.settingTab?.refreshForAuthChange();
    this.refreshDashboardAuth();
    void this.saveSettings().catch((saveError) => this.debug("invalid session cleanup failed", saveError));
    new Notice("Your Bondie session ended. Log in again.");
  }

  async listShares(): Promise<ShareListItemResponse[]> {
    try {
      const response = await this.api.listShares();
      return response.shares;
    } catch (error) {
      if (isInvalidProductSessionError(error)) return [];
      throw error;
    }
  }

  async listFolderShares(): Promise<FolderShareResponse[]> {
    if (!this.docferrySettings.sessionToken) return [];
    const response = await this.api.listFolderShares();
    return response.folder_shares;
  }

  async stopFolderShareFromList(folderShare: FolderShareResponse): Promise<void> {
    const confirmed = await confirmStopShare(this.app, folderShare.title, folderShare.source_folder);
    if (!confirmed) return;
    await this.api.deleteFolderShare(folderShare.folder_share_id);
    new Notice("Folder share stopped.");
    this.refreshDashboardShare();
  }

  async deleteShareHistory(share: ShareListItemResponse): Promise<void> {
    const confirmed = await confirmDeleteShareHistory(this.app, share.title || share.source_path, share.source_path);
    if (!confirmed) return;
    await this.api.deleteShareRecord(share.share_id);
    new Notice("Share history deleted.");
    this.refreshDashboardShare();
  }

  async deleteFolderShareHistory(folderShare: FolderShareResponse): Promise<void> {
    const confirmed = await confirmDeleteShareHistory(this.app, folderShare.title, folderShare.source_folder);
    if (!confirmed) return;
    await this.api.deleteFolderShareRecord(folderShare.folder_share_id);
    new Notice("Folder share history deleted.");
    this.refreshDashboardShare();
  }

  async refreshMembership(force = false): Promise<void> {
    if (!this.docferrySettings.sessionToken) {
      const opened = await this.auth.startLogin();
      if (opened) new Notice("Finish signing in in your browser, then return to share this note.");
      return;
    }
    try {
      await this.loadMembership(force);
      new Notice("Access refreshed.");
    } catch (error) {
      if (this.isBillingSessionRequired(error)) {
        await this.recoverBillingSession(true);
        return;
      }
      if (isInvalidProductSessionError(error)) return;
      new Notice(this.formatError(error, "Access refresh failed"));
    }
  }

  async openMembershipCenter(): Promise<void> {
    if (!this.docferrySettings.serverUrl) {
      new Notice("Configure server URL first.");
      return;
    }
    if (!this.docferrySettings.sessionToken) {
      const opened = await this.auth.startLogin();
      if (opened) new Notice("Finish signing in in your browser, then return to share this folder.");
      return;
    }
    const fallbackUrl = `${this.docferrySettings.serverUrl.replace(/\/+$/, "")}/dashboard/plans?refresh_membership=1`;
    this.markPendingBillingReturnRefresh();
    if (this.docferrySettings.sessionToken) {
      try {
        const link = await this.api.createDashboardLink("/dashboard/plans?refresh_membership=1");
        openExternalUrl(link.dashboard_url);
        new Notice("DocFerry access page opened in your browser.");
        return;
      } catch (error) {
        if (!isInvalidProductSessionError(error)) {
          new Notice(this.formatError(error, "Access page needs reconnect"));
        }
      }
    }
    openExternalUrl(fallbackUrl);
  }

  async openDashboardHome(): Promise<void> {
    if (!this.docferrySettings.serverUrl) {
      new Notice("Configure server URL first.");
      return;
    }
    const fallbackUrl = `${this.docferrySettings.serverUrl.replace(/\/+$/, "")}/dashboard`;
    if (this.docferrySettings.sessionToken) {
      try {
        const link = await this.api.createDashboardLink("/dashboard");
        openExternalUrl(link.dashboard_url);
        return;
      } catch (error) {
        this.debug("dashboard link failed", error);
      }
    }
    openExternalUrl(fallbackUrl);
  }

  async requestAccessUpgrade(source: "plugin_settings" | "plugin_dashboard"): Promise<void> {
    if (!this.docferrySettings.sessionToken) {
      new Notice("Connect your Bondie account before sending feedback.");
      return;
    }
    try {
      const target = "/dashboard/support#feedback";
      const link = await this.api.createDashboardLink(target);
      openExternalUrl(link.dashboard_url);
      new Notice("Feedback page opened in your browser.");
    } catch (error) {
      if (isInvalidProductSessionError(error)) return;
      new Notice(this.formatError(error, "Feedback page needs reconnect"));
    }
  }

  async activateDashboardView(refreshMembership = true): Promise<DocferryDashboardView | null> {
    this.rememberActiveMarkdownFile();
    const existingLeaf = this.app.workspace.getLeavesOfType(DOCFERRY_DASHBOARD_VIEW_TYPE)[0];
    if (existingLeaf) {
      await this.app.workspace.revealLeaf(existingLeaf);
      const view = existingLeaf.view instanceof DocferryDashboardView ? existingLeaf.view : null;
      if (refreshMembership) this.refreshMembershipForDashboardOpen();
      return view;
    }

    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: DOCFERRY_DASHBOARD_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
    const view = leaf.view instanceof DocferryDashboardView ? leaf.view : null;
    if (refreshMembership) this.refreshMembershipForDashboardOpen();
    return view;
  }

  openSettingsTab(): void {
    const app = this.app as AppWithSetting;
    if (!app.setting) {
      new Notice("Open Settings, then Community plugins, then DocFerry.");
      return;
    }
    app.setting.open();
    app.setting.openTabById(this.manifest.id);
  }

  async openSharesPage(): Promise<void> {
    const app = this.app as AppWithSetting;
    app.setting?.close?.();
    const dashboard = await this.activateDashboardView();
    dashboard?.showSharesPage();
  }

  getActiveNoteLabel(): string | null {
    return this.getActiveMarkdownFile()?.basename ?? null;
  }

  async publishActiveNote(): Promise<void> {
    const file = this.getActiveMarkdownFile();
    if (!file) {
      new Notice("Open a Markdown note before sharing.");
      return;
    }
    await this.publishFile(file);
  }

  async openShareLinks(share: ShareListItemResponse): Promise<void> {
    try {
      const response = await this.api.getShareLinks(share.share_id);
      new LinkStatusModal(this.app, share.title || share.source_path, response).open();
    } catch (error) {
      if (isInvalidProductSessionError(error)) return;
      new Notice(this.formatError(error, "Link status failed"));
    }
  }

  async updateShareFromList(share: ShareListItemResponse): Promise<void> {
    const vaultId = await this.resolveVaultId();
    if (!share.vault_id || share.vault_id !== vaultId) {
      new Notice("Open the source vault to update that share.");
      return;
    }
    const file = this.markdownFileByPath(share.source_path);
    if (!file) {
      new Notice("Open the source note in this vault to update that share.");
      return;
    }
    await this.publishFile(file, share);
  }

  async updateFolderShareFromList(folderShare: FolderShareResponse): Promise<void> {
    const vaultId = await this.resolveVaultId();
    if (folderShare.vault_id !== vaultId) {
      new Notice("Open the source vault to update that folder share.");
      return;
    }
    const folder = this.app.vault.getAbstractFileByPath(folderShare.source_folder);
    if (!(folder instanceof TFolder)) {
      new Notice("Open the source folder in this vault to update that share.");
      return;
    }
    await this.publishFolder(folder);
  }

  async stopShareFromList(share: ShareListItemResponse): Promise<void> {
    const confirmed = await confirmStopShare(this.app, share.title || share.source_path, share.source_path);
    if (!confirmed) return;
    const notice = new Notice("Stopping share...", 0);
    try {
      await this.api.deleteShare(share.share_id);
      const file = this.markdownFileByPath(share.source_path);
      if (file) {
        const meta = this.currentShareMeta(file);
        if (meta.id === share.share_id) await clearShareMeta(this.app, file);
      }
      this.refreshDashboardShare();
      notice.hide();
      new Notice("Share stopped. The link is no longer available.");
    } catch (error) {
      notice.hide();
      if (isInvalidProductSessionError(error)) return;
      new Notice(this.formatError(error, "Stop sharing failed"));
    }
  }

  private async loadMembership(force: boolean): Promise<void> {
    const response = await this.api.getMembership(force);
    if (response.product_subject_id) {
      const current = this.docferrySettings.connectedAccount;
      if (!current || current.productSubjectId !== response.product_subject_id) {
        this.docferrySettings.connectedAccount = {
          productSubjectId: response.product_subject_id,
          productKey: response.product_key,
          productInstanceId: current?.productInstanceId ?? null,
          displayUser: current?.productSubjectId === response.product_subject_id ? current.displayUser ?? null : null,
          connectedAt: current?.connectedAt ?? new Date().toISOString()
        };
      }
    }
    this.docferrySettings.membership = membershipFromResponse(response);
    await this.saveSettings();
    this.settingTab?.refreshForAuthChange();
    this.refreshDashboardAuth();
    if (response.unavailable_reason === "synapsehub_user_session_required") {
      throw new ShareApiError(
        "Reconnect your Bondie account before refreshing paid access.",
        401,
        response.unavailable_reason
      );
    }
  }

  refreshMembershipForDashboardOpen(): void {
    if (!this.docferrySettings.sessionToken) return;
    void this.loadMembership(true).catch(async (error) => {
      if (this.isBillingSessionRequired(error)) {
        await this.recoverBillingSession();
        return;
      }
      if (isInvalidProductSessionError(error)) return;
      this.debug("dashboard membership refresh failed", error);
    });
  }

  private async handleBillingReturn(status?: string): Promise<void> {
    const dashboard = await this.activateDashboardView(false);
    dashboard?.showAccountPage();
    if (status === "cancel") {
      this.clearPendingBillingReturnRefresh();
      new Notice("Checkout cancelled. Access was not changed.");
      try {
        await this.loadMembership(true);
      } catch (error) {
        if (this.isBillingSessionRequired(error)) {
          await this.recoverBillingSession();
          return;
        }
        if (isInvalidProductSessionError(error)) return;
        new Notice(this.formatError(error, "Access refresh failed"));
      }
      dashboard?.showAccountPage();
      return;
    }
    this.clearPendingBillingReturnRefresh();
    new Notice("Payment returned. Refreshing access...");
    try {
      await this.loadMembership(true);
      dashboard?.showAccountPage();
      const membership = this.docferrySettings.membership;
      if (membership && membership.planKey !== "free") {
        new Notice(`Access active: ${membership.planDisplayName}.`);
      } else {
        new Notice("Access still shows Free. DocFerry will keep refreshing while the account update completes.", 8000);
        this.scheduleMembershipRefreshes();
      }
    } catch (error) {
      if (this.isBillingSessionRequired(error)) {
        await this.recoverBillingSession();
        return;
      }
      if (isInvalidProductSessionError(error)) return;
      new Notice(this.formatError(error, "Access refresh failed"));
      this.scheduleMembershipRefreshes();
    }
  }

  private async refreshAfterPendingBillingReturn(): Promise<void> {
    if (!this.pendingBillingReturnRefreshUntil || Date.now() > this.pendingBillingReturnRefreshUntil) {
      this.clearPendingBillingReturnRefresh();
      return;
    }
    if (this.billingReturnRefreshInFlight) return;
    if (!this.docferrySettings.sessionToken) return;
    this.clearPendingBillingReturnRefresh();
    this.billingReturnRefreshInFlight = true;
    try {
      const dashboard = await this.activateDashboardView(false);
      dashboard?.showAccountPage();
      await this.loadMembership(true);
      const membership = this.docferrySettings.membership;
      if (membership && membership.planKey !== "free") {
        new Notice(`Access active: ${membership.planDisplayName}.`);
      } else {
        new Notice("Refreshing access after billing. DocFerry will check again while the account update completes.", 8000);
        this.scheduleMembershipRefreshes();
      }
    } catch (error) {
      if (this.isBillingSessionRequired(error)) {
        await this.recoverBillingSession();
        return;
      }
      if (isInvalidProductSessionError(error)) return;
      this.debug("billing return focus refresh failed", error);
      this.scheduleMembershipRefreshes();
    } finally {
      this.billingReturnRefreshInFlight = false;
    }
  }

  private markPendingBillingReturnRefresh(): void {
    if (!this.docferrySettings.sessionToken) return;
    this.pendingBillingReturnRefreshUntil = Date.now() + BILLING_RETURN_REFRESH_WINDOW_MS;
  }

  private clearPendingBillingReturnRefresh(): void {
    this.pendingBillingReturnRefreshUntil = 0;
  }

  private scheduleMembershipRefreshes(): void {
    if (!this.docferrySettings.sessionToken) return;
    const generation = ++this.billingReturnRefreshGeneration;
    for (const delayMs of BILLING_RETURN_REFRESH_DELAYS_MS) {
      window.setTimeout(async () => {
        if (generation !== this.billingReturnRefreshGeneration) return;
        try {
          await this.loadMembership(true);
          const membership = this.docferrySettings.membership;
          if (membership && membership.planKey !== "free") {
            this.billingReturnRefreshGeneration++;
            new Notice(`Access active: ${membership.planDisplayName}.`);
          }
        } catch (error) {
          if (this.isBillingSessionRequired(error)) {
            await this.recoverBillingSession();
            return;
          }
          if (isInvalidProductSessionError(error)) return;
          this.debug("scheduled membership refresh failed", error);
        }
      }, delayMs);
    }
  }

  private isBillingSessionRequired(error: unknown): boolean {
    if (error instanceof ShareApiError) return error.code === "synapsehub_user_session_required";
    if (!error || typeof error !== "object") return false;
    return "code" in error && error.code === "synapsehub_user_session_required";
  }

  private async recoverBillingSession(force = false): Promise<void> {
    if (!force && Date.now() < this.billingSessionRecoveryUntil) {
      new Notice("Finishing the secure account refresh in your browser.");
      return;
    }
    this.billingSessionRecoveryUntil = Date.now() + 60_000;
    this.markPendingBillingReturnRefresh();
    new Notice("Refreshing your Bondie account securely...");
    const opened = await this.auth.startLogin();
    if (!opened) this.billingSessionRecoveryUntil = 0;
  }

  private getActiveMarkdownFile(): TFile | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view?.file instanceof TFile && view.file.extension === "md") {
      this.lastActiveMarkdownPath = view.file.path;
      return view.file;
    }
    if (this.lastActiveMarkdownPath) {
      const remembered = this.app.vault.getAbstractFileByPath(this.lastActiveMarkdownPath);
      if (remembered instanceof TFile && remembered.extension === "md") return remembered;
      this.lastActiveMarkdownPath = "";
    }
    const file = this.app.workspace.getActiveFile();
    if (file instanceof TFile && file.extension === "md") {
      this.lastActiveMarkdownPath = file.path;
      return file;
    }
    for (const recentPath of this.app.workspace.getLastOpenFiles()) {
      const recent = this.app.vault.getAbstractFileByPath(recentPath);
      if (recent instanceof TFile && recent.extension === "md") {
        this.lastActiveMarkdownPath = recent.path;
        return recent;
      }
    }
    return null;
  }

  private rememberActiveMarkdownFile(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file instanceof TFile ? view.file : this.app.workspace.getActiveFile();
    if (file instanceof TFile && file.extension === "md") this.lastActiveMarkdownPath = file.path;
  }

  private async publishFile(file: TFile, selectedShare?: ShareListItemResponse): Promise<void> {
    if (!this.docferrySettings.serverUrl) {
      new Notice("Configure server URL first.");
      return;
    }

    if (!this.docferrySettings.sessionToken) {
      new Notice("Connect your Bondie account first.");
      return;
    }
    const uploadNoticeAccepted = await this.showUploadNoticeIfNeeded(true);
    if (!uploadNoticeAccepted) return;

    try {
      await this.loadMembership(true);
    } catch (error) {
      if (this.isBillingSessionRequired(error)) {
        await this.recoverBillingSession(true);
        return;
      }
      new Notice(this.formatError(error, "Access check failed"));
      return;
    }

    const existing = this.currentShareMeta(file);
    let existingShare: Pick<
      ShareListItemResponse,
      "share_id" | "password_enabled" | "expires_at" | "theme_mode"
    > | null = selectedShare ?? null;
    if (!existingShare && existing.id) {
      try {
        existingShare = await this.api.getShareStatus(existing.id);
      } catch (error) {
        if (isInvalidProductSessionError(error)) return;
        new Notice(this.formatError(error, "Could not load the current share settings"));
        return;
      }
    }
    const existingShareId = existingShare?.share_id ?? existing.id;
    const existingExpiresAt = existingShare?.expires_at ?? existing.expires ?? null;
    const title = this.resolveTitle(file);
    const canUseThemeStyling = Boolean(this.docferrySettings.membership?.canUseFullTheme);
    const modal = new ShareModal(this.app, {
      title,
      passwordEnabled:
        existingShare?.password_enabled ?? existing.passwordEnabled ?? this.docferrySettings.defaultPasswordEnabled,
      passwordAlreadySet: Boolean(existingShare?.password_enabled ?? existing.passwordEnabled),
      expiresInDays: initialExpirySelection(existingExpiresAt, this.docferrySettings.defaultExpiresInDays),
      existingExpiresAt,
      isUpdate: Boolean(existingShareId),
      canUseThemeStyling,
      useThemeStyling: initialThemeStyling(
        canUseThemeStyling,
        existingShare?.theme_mode,
        Boolean(existingShareId)
      )
    });
    const options = await modal.openAndGetResult();
    if (!options) return;

    const notice = new Notice(existingShareId ? "Updating share link..." : "Publishing share link...", 0);
    try {
      notice.setMessage("Checking access limits...");
      await this.ensureCanPublishBeforeUpload(file, Boolean(existingShareId));
      const payload = await this.buildPayload(file, options.title, options, Boolean(existingShareId), (message) => {
        notice.setMessage(message);
      });
      notice.setMessage(existingShareId ? "Updating share link..." : "Publishing share link...");
      const response = existingShareId
        ? await this.updateOrCreateShare(existingShareId, payload, notice)
        : await this.api.createShare(payload);

      await writeShareMeta(this.app, file, response, {
        passwordEnabled: options.passwordEnabled,
        expiresAt: options.expiresAt
      });
      notice.hide();
      try {
        await navigator.clipboard.writeText(response.url);
        new Notice("Share link copied");
      } catch {
        new Notice("Share updated, but the link could not be copied. Copy it from the result window.");
      }
      new ResultModal(this.app, options.title, response.url, response.updated_at).open();
      this.refreshDashboardShare();
      this.debug("publish response", response.status);
    } catch (error) {
      notice.hide();
      if (isInvalidProductSessionError(error)) return;
      new Notice(this.formatError(error, "Publish failed"));
      this.debug("publish error", error);
    }
  }

  private async publishFolder(folder: TFolder): Promise<void> {
    if (!folder.path || folder.path === "/") {
      new Notice("Choose a folder inside the vault instead of the entire vault.");
      return;
    }
    if (!this.docferrySettings.serverUrl) {
      new Notice("Configure server URL first.");
      return;
    }
    if (!this.docferrySettings.sessionToken) {
      new Notice("Connect your Bondie account first.");
      return;
    }
    const files = this.markdownFilesInFolder(folder);
    if (!files.length) {
      new Notice("This folder has no Markdown notes to publish.");
      return;
    }
    const uploadNoticeAccepted = await this.showUploadNoticeIfNeeded(true);
    if (!uploadNoticeAccepted) return;
    try {
      await this.loadMembership(true);
    } catch (error) {
      if (!this.isBillingSessionRequired(error)) {
        new Notice(this.formatError(error, "Access check failed"));
        return;
      }
      await this.recoverBillingSession(true);
      return;
    }
    const membership = this.docferrySettings.membership;
    if (folderShareAccess(membership, false) === "upgrade_required") {
      new Notice("Folder sharing is available with DocFerry Pro.");
      return;
    }
    if (!membership) return;
    if (files.length > membership.maxFolderDocumentCount) {
      new Notice(`This folder has ${files.length} notes. Your plan allows ${membership.maxFolderDocumentCount}.`);
      return;
    }
    const vaultId = await this.resolveVaultId();
    const existingFolder = (await this.api.listFolderShares()).folder_shares.find((item) =>
      item.vault_id === vaultId &&
      item.source_folder === folder.path &&
      item.status !== "stopped" &&
      item.status !== "expired"
    );
    if (folderShareAccess(membership, Boolean(existingFolder)) === "limit_reached") {
      new Notice(
        `Your plan allows ${membershipLimitLabel(membership.activeFolderShareLimit)} active folder shares. Stop one before publishing another.`
      );
      return;
    }

    const options = await new FolderShareModal(this.app, {
      title: existingFolder?.title || folder.name || this.app.vault.getName(),
      passwordEnabled: existingFolder?.password_enabled ?? this.docferrySettings.defaultPasswordEnabled,
      passwordAlreadySet: Boolean(existingFolder?.password_enabled),
      expiresInDays: initialExpirySelection(existingFolder?.expires_at, this.docferrySettings.defaultExpiresInDays),
      existingExpiresAt: existingFolder?.expires_at ?? null,
      documentCount: files.length,
      isUpdate: Boolean(existingFolder),
      canUseThemeStyling: membership.canUseFullTheme,
      useThemeStyling: membership.canUseFullTheme && (existingFolder?.theme_mode ?? "full") === "full"
    }).openAndGetResult();
    if (!options) return;

    const notice = new Notice("Preparing folder share...", 0);
    try {
      const draft = await this.api.createFolderShareDraft({
        folder_share_id: existingFolder?.folder_share_id ?? null,
        vault_id: vaultId,
        source_folder: folder.path,
        title: options.title,
        expected_document_count: files.length,
        theme_mode: options.useThemeStyling && membership.canUseFullTheme ? "full" : "reader",
        css_asset_id: null,
        client: {
          plugin_id: this.manifest.id,
          plugin_version: this.manifest.version,
          obsidian_version: getObsidianVersion(this.app),
          vault_name: this.app.vault.getName()
        }
      });
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        notice.setMessage(`Publishing ${index + 1} of ${files.length}: ${file.basename}`);
        const documentPayload = await this.buildFolderDocumentPayload(
          folder,
          file,
          index,
          options.useThemeStyling && membership.canUseFullTheme
        );
        await this.api.putFolderShareDocument(draft.revision_id, documentPayload.route_key, documentPayload);
      }
      notice.setMessage("Opening folder share...");
      const response = await this.api.commitFolderShareDraft(draft.revision_id, {
        password: options.password,
        password_mode: !options.passwordEnabled
          ? "clear"
          : options.password
            ? "set"
            : "keep",
        expires_at: options.expiresAt
      });
      notice.hide();
      try {
        await navigator.clipboard.writeText(response.url);
        new Notice("Folder share link copied");
      } catch {
        new Notice("Folder share updated, but the link could not be copied. Copy it from the result window.");
      }
      new ResultModal(this.app, options.title, response.url, response.updated_at, "folder").open();
      this.refreshDashboardShare();
    } catch (error) {
      notice.hide();
      new Notice(this.formatError(error, "Folder publish failed"));
      this.debug("folder publish error", error);
    }
  }

  vaultPathFromDrag(event: DragEvent): string | null {
    const raw = event.dataTransfer?.getData("text/plain")?.trim() || "";
    const path = resolveVaultDragPath(
      this.activeVaultDragPath,
      raw,
      (path) => Boolean(this.app.vault.getAbstractFileByPath(path))
    );
    if (!path) return null;
    const item = this.app.vault.getAbstractFileByPath(path);
    if (item instanceof TFolder) return path;
    return item instanceof TFile && item.extension === "md" ? path : null;
  }

  async publishVaultPath(path: string): Promise<void> {
    const item = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (item instanceof TFolder) {
      await this.publishFolder(item);
      return;
    }
    if (item instanceof TFile && item.extension === "md") {
      await this.publishFile(item);
      return;
    }
    new Notice("Choose a Markdown note or folder to share.");
  }

  private async buildFolderDocumentPayload(
    folder: TFolder,
    file: TFile,
    navigationOrder: number,
    useFullTheme: boolean
  ): Promise<FolderShareDocumentPayload> {
    const markdown = await this.app.vault.read(file);
    const localAssets = await this.uploadLocalAssets(markdown, file);
    const snapshot = await this.renderHtmlSnapshot(file, markdown, localAssets, useFullTheme);
    if (useFullTheme && snapshot?.themeMode !== "full") {
      throw new Error(`Theme styling for ${file.path} could not be prepared safely. The folder was not published.`);
    }
    let cssAsset: UploadedCssAsset | null = null;
    if (snapshot?.css) cssAsset = await this.uploadCssSnapshot(snapshot.css);
    const relativePath = folder.path
      ? file.path.slice(folder.path.length).replace(/^\/+/, "")
      : file.path;
    const routeKey = (await sha256(relativePath.toLowerCase())).slice(0, 20);
    return {
      route_key: routeKey,
      relative_path: relativePath,
      source_hash: `sha256:${await sha256(markdown)}`,
      title: file.basename,
      markdown,
      html_snapshot: snapshot?.html ?? null,
      css_asset_id: cssAsset?.assetId ?? null,
      assets: localAssets.linkedAssets.map((asset) => ({
        asset_id: asset.assetId,
        role: asset.role,
        original_path: asset.originalPath
      })),
      navigation_order: navigationOrder
    };
  }

  private markdownFilesInFolder(folder: TFolder): TFile[] {
    const files: TFile[] = [];
    const visit = (current: TFolder): void => {
      for (const child of current.children) {
        if (child.name.startsWith(".")) continue;
        if (child instanceof TFolder) {
          visit(child);
        } else if (child instanceof TFile && child.extension === "md") {
          files.push(child);
        }
      }
    };
    visit(folder);
    return files.sort((left, right) => left.path.localeCompare(right.path));
  }

  private async copyShareLink(file: TFile): Promise<void> {
    const meta = this.currentShareMeta(file);
    if (!meta.url) {
      await this.publishFile(file);
      return;
    }
    await navigator.clipboard.writeText(meta.url);
    new Notice("Share link copied");
  }

  private async updateOrCreateShare(
    shareId: string,
    payload: SharePayload,
    notice: Notice
  ): Promise<ShareResponse> {
    try {
      return await this.api.updateShare(shareId, payload);
    } catch (error) {
      if (!(error instanceof ShareApiError) || error.status !== 404 || error.code !== "share_not_found") {
        throw error;
      }
      notice.setMessage("Existing share was not found. Publishing a new link...");
      return this.api.createShare({
        ...payload,
        password_mode: undefined
      });
    }
  }

  private async stopSharing(file: TFile): Promise<void> {
    const meta = this.currentShareMeta(file);
    if (!meta.id) {
      new Notice("This note has not been shared.");
      return;
    }
    const confirmed = await confirmStopShare(this.app, file.basename, file.path);
    if (!confirmed) return;
    const notice = new Notice("Stopping share...", 0);
    try {
      await this.api.deleteShare(meta.id);
      await clearShareMeta(this.app, file);
      this.refreshDashboardShare();
      notice.hide();
      new Notice("Share stopped. The link is no longer available.");
    } catch (error) {
      notice.hide();
      if (isInvalidProductSessionError(error)) return;
      new Notice(this.formatError(error, "Stop sharing failed"));
    }
  }

  private async ensureCanPublishBeforeUpload(file: TFile, isUpdate: boolean): Promise<void> {
    if (!this.docferrySettings.sessionToken) return;
    try {
      await this.loadMembership(true);
    } catch (error) {
      if (!this.isBillingSessionRequired(error)) throw error;
      await this.recoverBillingSession(true);
    }
    const membership = this.docferrySettings.membership;
    if (!membership) return;
    if (!isUpdate && !membership.canCreateShare) {
      throw new ShareApiError(
        `Your current access allows ${membershipLimitLabel(membership.activeShareLimit)} active shares. Stop a share or request more access from Account before publishing.`,
        403,
        "membership_share_limit_exceeded",
        undefined,
        {
          active_share_count: membership.activeShareCount,
          active_share_limit: membership.activeShareLimit
        }
      );
    }
    const markdown = await this.app.vault.read(file);
    const markdownBytes = new TextEncoder().encode(markdown).byteLength;
    if (markdownBytes > membership.maxSingleFileSizeBytes) {
      throw new ShareApiError(
        `This note is ${formatBytes(markdownBytes)}. Your current access allows ${formatBytes(membership.maxSingleFileSizeBytes)} per file. Open Plans to change membership or Support to send feedback.`,
        413,
        "membership_file_size_exceeded",
        undefined,
        {
          max_single_file_size_bytes: membership.maxSingleFileSizeBytes,
          byte_length: markdownBytes
        }
      );
    }
  }

  private markdownFileByPath(path: string): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile && file.extension === "md" ? file : null;
  }

  private currentShareMeta(file: TFile): ReturnType<typeof readShareMeta> {
    const meta = readShareMeta(this.app, file);
    return shareMetaBelongsToService(meta, this.docferrySettings.serverUrl) ? meta : {};
  }

  private async showLinkStatus(file: TFile): Promise<void> {
    const meta = this.currentShareMeta(file);
    if (!meta.id) {
      new Notice("This note has not been shared.");
      return;
    }
    try {
      const response = await this.api.getShareLinks(meta.id);
      new LinkStatusModal(this.app, file.basename, response).open();
    } catch (error) {
      if (isInvalidProductSessionError(error)) return;
      new Notice(this.formatError(error, "Link status failed"));
    }
  }

  async importShareUrl(initialUrl: unknown = ""): Promise<void> {
    const options = await new ImportShareModal(
      this.app,
      textValue(initialUrl),
      this.docferrySettings.defaultImportFolder || DEFAULT_SETTINGS.defaultImportFolder,
      this.docferrySettings.serverUrl
    ).openAndGetResult();
    if (!options) return;

    const notice = new Notice("Importing share...", 0);
    try {
      const result = await this.importShareWithOptions(options);
      notice.hide();
      new Notice(`Imported ${result.title}${result.importedAssets ? ` with ${result.importedAssets} assets` : ""}`);
    } catch (error) {
      notice.hide();
      new Notice(this.formatError(error, "Import failed"));
    }
  }

  async importShareFromDashboard(url: string, password?: string): Promise<DashboardImportResult> {
    return this.importShareWithOptions({
      url,
      password,
      outputFolder: this.docferrySettings.defaultImportFolder || DEFAULT_SETTINGS.defaultImportFolder,
      overwrite: false
    });
  }

  async importExternalLink(
    value: string,
    onProgress?: (progress: MediaNoteProgress) => void
  ): Promise<DashboardImportResult | null> {
    const linkNote = buildExternalLinkNote(value);
    await this.refreshMembershipForExternalImport();
    const membership = this.docferrySettings.membership;
    const runtimeCanPrepareDetailedNote = Boolean(
      membership &&
      shouldPrepareDetailedNote(membership.hasMediaNoteEntitlement, linkNote.provider, {
        enabled: membership.canUseMediaNote,
        supportedProviders: membership.mediaNoteProviders
      })
    );
    const hasDetailedNoteCapacity = Boolean(
      membership && hasMediaNoteJobCapacity(membership.mediaNoteMonthlyJobsUsed, membership.mediaNoteMonthlyJobLimit)
    );
    const prepareDetailedNote = runtimeCanPrepareDetailedNote && hasDetailedNoteCapacity;
    if (!prepareDetailedNote) {
      if (membership?.hasMediaNoteEntitlement && requiresDetailedNoteProvider(linkNote.provider)) {
        throw new Error(
          hasDetailedNoteCapacity
            ? `${externalLinkProviderLabel(linkNote.provider)} Advanced Import is temporarily unavailable. Nothing was saved.`
            : `${externalLinkProviderLabel(linkNote.provider)} Advanced Import has reached this month's limit. Nothing was saved.`
        );
      }
      return this.writeExternalImport(linkNote.title, linkNote.markdown);
    }
    if (!(await this.showUploadNoticeIfNeeded(true, "detailed_note"))) return null;

    if (this.docferrySettings.pendingMediaNoteImport) {
      throw new Error("A detailed note is already being prepared. Resume or cancel it before starting another.");
    }
    const ownerProductSubjectId = this.docferrySettings.connectedAccount?.productSubjectId;
    if (!ownerProductSubjectId) {
      throw new Error("Reconnect your Bondie account before starting a detailed note.");
    }

    onProgress?.("starting");
    const created = await this.api.createMediaNoteJob(linkNote.url.href, mediaNoteIdempotencyKey());
    await this.setPendingMediaNoteImport({
      jobId: created.job_id,
      ownerProductSubjectId,
      sourceUrl: linkNote.url.href,
      createdAt: new Date().toISOString()
    });
    onProgress?.("reading");
    const completed = await this.waitForMediaNote(created, onProgress);
    if (!MEDIA_NOTE_READY_STATUSES.has(completed.status) || !completed.markdown) {
      await this.clearPendingMediaNoteImport(completed.job_id);
      throw new Error(mediaNoteFailureMessage(completed));
    }
    return this.finishMediaNoteImport(completed, onProgress);
  }

  async cancelActiveMediaImport(): Promise<void> {
    const pending = this.docferrySettings.pendingMediaNoteImport;
    if (!pending) return;
    this.requirePendingImportOwner(pending);
    const job = await this.api.cancelMediaNoteJob(pending.jobId);
    if (MEDIA_NOTE_TERMINAL_STATUSES.has(job.status)) {
      await this.clearPendingMediaNoteImport(pending.jobId);
      return;
    }
    throw new Error("The detailed note is still processing. Try cancelling again before changing accounts.");
  }

  private async refreshMembershipForExternalImport(): Promise<void> {
    if (!this.docferrySettings.sessionToken) return;
    const cachedMembership = this.docferrySettings.membership;
    try {
      await this.loadMembership(true);
    } catch (error) {
      if (isInvalidProductSessionError(error)) return;
      if (cachedMembership && !cachedMembership.hasMediaNoteEntitlement) {
        this.debug("membership refresh before link import failed; using cached free access", error);
        return;
      }
      throw error;
    }
  }

  private async writeExternalImport(
    title: string,
    markdown: string,
    targetPath?: string
  ): Promise<DashboardImportResult> {
    const folder = this.docferrySettings.defaultImportFolder || DEFAULT_SETTINGS.defaultImportFolder;
    const notePath = targetPath || await this.uniqueImportPath(folder, safeVaultSegment(title));
    await this.ensureParentFolder(notePath);
    const existing = this.app.vault.getAbstractFileByPath(notePath);
    let file: TFile;
    if (existing instanceof TFile) {
      const existingMarkdown = await this.app.vault.read(existing);
      if (existingMarkdown !== markdown) {
        throw new Error("The saved note path changed while this import was recovering. Nothing was overwritten.");
      }
      file = existing;
    } else {
      file = await this.app.vault.create(notePath, markdown);
    }
    await this.app.workspace.getLeaf(true).openFile(file);
    return { title, notePath, importedAssets: 0 };
  }

  private async waitForMediaNote(
    initial: MediaNoteJobResponse,
    onProgress?: (progress: MediaNoteProgress) => void
  ): Promise<MediaNoteJobResponse> {
    let job = initial;
    for (let attempt = 0; attempt < MEDIA_NOTE_MAX_POLL_ATTEMPTS; attempt += 1) {
      if (MEDIA_NOTE_TERMINAL_STATUSES.has(job.status)) return job;
      if (this.docferrySettings.pendingMediaNoteImport?.jobId !== job.job_id) {
        throw new Error("Import cancelled. Nothing was saved.");
      }
      if (attempt === 4) onProgress?.("writing");
      await sleep(MEDIA_NOTE_POLL_INTERVAL_MS);
      job = await this.api.getMediaNoteJob(job.job_id);
    }
    try {
      const cancelled = await this.api.cancelMediaNoteJob(job.job_id);
      if (cancelled.status === "cancelled") await this.clearPendingMediaNoteImport(job.job_id);
    } catch (error) {
      this.debug("media note timeout cancellation raced with completion", error);
    }
    throw new Error("This import took too long. Nothing was saved.");
  }

  private async finishMediaNoteImport(
    completed: MediaNoteJobResponse,
    onProgress?: (progress: MediaNoteProgress) => void
  ): Promise<DashboardImportResult | null> {
    if (!completed.markdown) {
      await this.clearPendingMediaNoteImport(completed.job_id);
      throw new Error(mediaNoteFailureMessage(completed));
    }
    onProgress?.("reviewing");
    if (!(await confirmMediaNoteImport(this.app, completed))) {
      await this.clearPendingMediaNoteImport(completed.job_id);
      return null;
    }
    const pending = this.docferrySettings.pendingMediaNoteImport;
    let targetPath = pending?.jobId === completed.job_id ? pending.targetPath : undefined;
    if (!targetPath) {
      const folder = this.docferrySettings.defaultImportFolder || DEFAULT_SETTINGS.defaultImportFolder;
      targetPath = await this.uniqueImportPath(folder, safeVaultSegment(mediaNoteTitle(completed)));
      await this.setPendingMediaNoteImport({
        jobId: completed.job_id,
        ownerProductSubjectId: pending?.ownerProductSubjectId || this.requireConnectedProductSubject(),
        sourceUrl: completed.source_url || pending?.sourceUrl || "",
        createdAt: pending?.createdAt || completed.created_at,
        targetPath
      });
    }
    const result = await this.writeExternalImport(
      mediaNoteTitle(completed),
      mediaNoteMarkdownForObsidian(completed.markdown),
      targetPath
    );
    await this.clearPendingMediaNoteImport(completed.job_id);
    return result;
  }

  private async setPendingMediaNoteImport(pending: PendingMediaNoteImport): Promise<void> {
    this.docferrySettings.pendingMediaNoteImport = pending;
    await this.saveSettings();
  }

  private async clearPendingMediaNoteImport(jobId: string): Promise<void> {
    if (this.docferrySettings.pendingMediaNoteImport?.jobId !== jobId) return;
    this.docferrySettings.pendingMediaNoteImport = null;
    await this.saveSettings();
  }

  async resumeActiveMediaImport(): Promise<void> {
    const pending = this.docferrySettings.pendingMediaNoteImport;
    if (!pending || this.mediaNoteRecoveryInFlight) return;
    try {
      this.requirePendingImportOwner(pending);
    } catch (error) {
      new Notice(this.formatError(error, "Could not resume detailed note"), 8000);
      return;
    }
    this.mediaNoteRecoveryInFlight = true;
    const notice = new Notice("Resuming your detailed note in the background...", 0);
    try {
      const current = await this.api.getMediaNoteJob(pending.jobId);
      const completed = await this.waitForMediaNote(current);
      if (!MEDIA_NOTE_READY_STATUSES.has(completed.status) || !completed.markdown) {
        await this.clearPendingMediaNoteImport(completed.job_id);
        throw new Error(mediaNoteFailureMessage(completed));
      }
      const result = await this.finishMediaNoteImport(completed);
      if (result) new Notice(`Saved ${result.title} to ${result.notePath}.`);
    } catch (error) {
      new Notice(this.formatError(error, "Could not resume detailed note"), 8000);
    } finally {
      notice.hide();
      this.mediaNoteRecoveryInFlight = false;
    }
  }

  private requireConnectedProductSubject(): string {
    const productSubjectId = this.docferrySettings.connectedAccount?.productSubjectId;
    if (!productSubjectId) throw new Error("Reconnect your Bondie account to continue this detailed note.");
    return productSubjectId;
  }

  private requirePendingImportOwner(pending: PendingMediaNoteImport): void {
    if (this.requireConnectedProductSubject() !== pending.ownerProductSubjectId) {
      throw new Error(
        "This detailed note belongs to another Bondie account. Sign in with the account that started it."
      );
    }
  }

  private async uniqueImportPath(folder: string, baseName: string): Promise<string> {
    for (let index = 0; index < 1000; index += 1) {
      const suffix = index ? ` ${index + 1}` : "";
      const path = normalizePath(`${folder}/${baseName}${suffix}.md`);
      if (!(await this.app.vault.adapter.exists(path))) return path;
    }
    throw new Error("Could not allocate a filename for this imported link.");
  }

  private async importShareWithOptions(options: ImportShareOptions): Promise<DashboardImportResult> {
    const session = await this.api.getShareImportPayload(options.url, options.password);
    const title = textValue(session.payload.title, "Untitled DocFerry share");
    const markdown = textValue(session.payload.markdown, "");
    const notePath = normalizePath(`${options.outputFolder}/${safeVaultSegment(title)}.md`);
    const assets = (Array.isArray(session.payload.assets) ? session.payload.assets : []).map((asset) => {
      let path = normalizePath(`${options.outputFolder}/${assetOutputRelativePath(asset)}`);
      if (path === notePath) {
        path = normalizePath(
          `${options.outputFolder}/attachments/${safeVaultSegment(textValue(asset.filename) || textValue(asset.asset_id) || "attachment")}`
        );
      }
      const url = textValue(asset.url);
      if (!url) throw new Error(`Imported asset is missing a download URL: ${path}`);
      return { path, url };
    });
    const importedAssets = await this.withShareImportCommitLock(() =>
      commitAtomicImport(this.importFileSystem(), {
        notePath,
        markdown,
        assets,
        overwrite: options.overwrite,
        download: (url) => this.api.downloadImportAsset(url, session.cookieHeader)
      })
    );
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(true).openFile(file);
    }
    return {
      title,
      notePath,
      importedAssets
    };
  }

  private importFileSystem(): ImportFileSystem {
    const adapter = this.app.vault.adapter;
    return {
      exists: (path) => adapter.exists(path),
      readText: (path) => adapter.read(path),
      readBinary: (path) => adapter.readBinary(path),
      writeText: async (path, body) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          await this.app.vault.process(file, () => body);
        } else {
          await adapter.write(path, body);
        }
      },
      writeBinary: async (path, body) => {
        await adapter.writeBinary(path, body);
      },
      remove: (path) => adapter.remove(path),
      directoryExists: (path) => adapter.exists(path),
      createDirectory: (path) => adapter.mkdir(path),
      removeDirectoryIfEmpty: async (path) => {
        const listing = await adapter.list(path);
        if (listing.files.length || listing.folders.length) return;
        await adapter.rmdir(path, false);
      }
    };
  }

  private async withShareImportCommitLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.shareImportCommitQueue;
    let release!: () => void;
    this.shareImportCommitQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async ensureParentFolder(path: string): Promise<void> {
    const parts = normalizePath(path).split("/");
    parts.pop();
    await this.ensureFolder(parts.join("/"));
  }

  private async ensureFolder(folder: string): Promise<void> {
    const normalized = normalizePath(folder).replace(/^\/+|\/+$/g, "");
    if (!normalized) return;
    let current = "";
    for (const part of normalized.split("/")) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }

  private async buildPayload(
    file: TFile,
    title: string,
    options: PublishOptions,
    isUpdate: boolean,
    report?: (message: string) => void
  ): Promise<SharePayload> {
    const startedAt = performance.now();
    report?.("Reading note...");
    const markdown = await this.app.vault.read(file);
    const outboundLinks = this.extractOutboundLinks(markdown, file);
    report?.("Uploading local assets...");
    const localAssets = await this.uploadLocalAssets(markdown, file);
    report?.("Rendering Obsidian preview...");
    const useFullTheme = Boolean(
      options.useThemeStyling && this.docferrySettings.membership?.canUseFullTheme
    );
    const snapshot = await this.renderHtmlSnapshot(file, markdown, localAssets, useFullTheme);
    let cssAsset: UploadedCssAsset | null = null;
    if (snapshot?.css) {
      report?.("Uploading reading style...");
      try {
        cssAsset = await this.uploadCssSnapshot(snapshot.css);
      } catch (error) {
        this.debug("css snapshot upload failed", error);
      }
    }
    const linkedAssets = [
      ...localAssets.linkedAssets
        .map((asset) => ({
          asset_id: asset.assetId,
          role: asset.role,
          original_path: asset.originalPath
        })),
      ...(cssAsset
        ? [
            {
              asset_id: cssAsset.assetId,
              role: "css",
              original_path: THEME_CSS_FILENAME
            }
          ]
        : [])
    ];
    this.debug("payload built", {
      markdownChars: markdown.length,
      htmlSnapshotChars: snapshot?.html.length ?? 0,
      cssSnapshotChars: snapshot?.css?.length ?? 0,
      localAssets: localAssets.linkedAssets.length,
      imageAssets: localAssets.imageAssets.filter(Boolean).length,
      cssAsset: Boolean(cssAsset),
      elapsedMs: Math.round(performance.now() - startedAt)
    });
    return {
      vault_id: await this.resolveVaultId(),
      source_path: file.path,
      source_path_normalized: normalizeSharePath(file.path),
      doc_identity: null,
      source_hash: `sha256:${await sha256(markdown)}`,
      title,
      markdown,
      html_snapshot: snapshot?.html ?? null,
      theme_mode: snapshot?.themeMode ?? "reader",
      css_asset_id: cssAsset?.assetId ?? null,
      assets: linkedAssets,
      outbound_links: outboundLinks,
      password: options.password,
      password_mode: isUpdate ? this.resolvePasswordMode(options) : undefined,
      expires_at: options.expiresAt ?? null,
      client: {
        plugin_id: this.manifest.id,
        plugin_version: this.manifest.version,
        obsidian_version: getObsidianVersion(this.app),
        vault_name: this.app.vault.getName()
      }
    };
  }

  private async showUploadNoticeIfNeeded(
    required: boolean,
    action: "publish" | "detailed_note" = "publish"
  ): Promise<boolean> {
    if (
      this.docferrySettings.uploadConsentAcceptedAt &&
      this.docferrySettings.uploadConsentNoticeId === UPLOAD_CONSENT_NOTICE_ID
    ) {
      return true;
    }
    if (this.uploadNoticeOpen) return !required;
    this.uploadNoticeOpen = true;
    try {
      const accepted = await confirmDocferryUploadNotice(this.app, required ? action : "startup");
      if (accepted) {
        this.docferrySettings.uploadConsentAcceptedAt = new Date().toISOString();
        this.docferrySettings.uploadConsentNoticeId = UPLOAD_CONSENT_NOTICE_ID;
        await this.saveSettings();
        return true;
      }
      return !required;
    } finally {
      this.uploadNoticeOpen = false;
    }
  }

  private async renderHtmlSnapshot(
    file: TFile,
    markdown: string,
    localAssets: UploadedLocalAssets,
    useFullTheme: boolean
  ): Promise<HtmlSnapshotResult | null> {
    const doc = currentDocument();
    const container = doc.createElement("div");
    container.className = "markdown-preview-view markdown-rendered docferry-snapshot-source docferry-snapshot-hidden-host";
    doc.body.appendChild(container);
    const renderContext = new Component();
    renderContext.load();

    try {
      await MarkdownRenderer.render(this.app, markdown, container, file.path, renderContext);
      await sleep(150);
      this.applyLocalImageAssetPlaceholders(container, localAssets.imageAssets);
      this.applyLocalAttachmentPlaceholders(container, localAssets.linkedAssets);
      for (const element of Array.from(container.querySelectorAll("script"))) element.remove();
      let themeMode: "reader" | "full" = "reader";
      let css: string | null;
      if (useFullTheme) {
        try {
          css = captureComputedThemeCss(container);
          themeMode = "full";
        } catch (error) {
          this.debug("theme styling could not be captured; using reader theme", error);
          css = null;
        }
      } else {
        css = null;
      }
      return {
        html: container.innerHTML,
        css,
        themeMode
      };
    } catch (error) {
      this.debug("html snapshot failed", error);
      return null;
    } finally {
      renderContext.unload();
      container.remove();
    }
  }

  private async uploadLocalAssets(markdown: string, sourceFile: TFile): Promise<UploadedLocalAssets> {
    const refs = this.extractLocalAssetRefs(markdown);
    const pendingByPath = new Map<string, PendingLocalAsset>();
    const imageAssets: Array<UploadedImageAsset | null> = [];
    const imageAssetPaths: Array<{ targetPath: string; originalPath: string } | null> = [];

    for (const ref of refs) {
      const target = this.resolveLinkedFile(ref.path, sourceFile);
      const contentType = target ? contentTypeForExtension(target.extension) : null;
      const role = target ? assetRoleForExtension(target.extension) : null;
      if (!target || target.extension.toLowerCase() === "md" || !contentType || !role) {
        if (ref.isImage && target && assetRoleForExtension(target.extension) === "image") imageAssetPaths.push(null);
        continue;
      }

      if (!pendingByPath.has(target.path)) {
        pendingByPath.set(target.path, {
          target,
          originalPath: ref.path,
          role,
          contentType
        });
      }

      if (ref.isImage && role === "image") {
        imageAssetPaths.push({
          targetPath: target.path,
          originalPath: ref.path
        });
      }
    }

    const pendingAssets = Array.from(pendingByPath.values());
    const linkedAssets = await mapWithConcurrency(pendingAssets, ASSET_UPLOAD_CONCURRENCY, (asset) =>
      this.uploadLocalAsset(asset)
    );
    const uploadedByPath = new Map<string, UploadedLocalAsset>();
    pendingAssets.forEach((asset, index) => {
      uploadedByPath.set(asset.target.path, linkedAssets[index]);
    });

    for (const ref of imageAssetPaths) {
      if (!ref) {
        imageAssets.push(null);
        continue;
      }
      const uploaded = uploadedByPath.get(ref.targetPath);
      imageAssets.push(uploaded ? { assetId: uploaded.assetId, originalPath: ref.originalPath } : null);
    }

    return { linkedAssets, imageAssets };
  }

  private async uploadLocalAsset(asset: PendingLocalAsset): Promise<UploadedLocalAsset> {
    const buffer = await this.app.vault.readBinary(asset.target);
    const prepared = this.prepareAssetUpload(asset.target, buffer, asset.contentType);
    const contentHash = `sha256:${await sha256Bytes(prepared.data)}`;
    const response = await this.api.uploadAsset(prepared.data, prepared.filename, prepared.contentType, contentHash);
    this.debug("asset uploaded", {
      assetType: asset.contentType,
      role: asset.role,
      originalBytes: buffer.byteLength,
      uploadedBytes: prepared.data.byteLength,
      qualityMode: prepared.qualityMode
    });
    return {
      assetId: response.asset_id,
      originalPath: asset.originalPath,
      role: asset.role
    };
  }

  private prepareAssetUpload(
    target: TFile,
    buffer: ArrayBuffer,
    contentType: string
  ): PreparedAssetUpload {
    return { data: buffer, filename: target.name, contentType, qualityMode: "original" };
  }

  private async uploadCssSnapshot(css: string): Promise<UploadedCssAsset | null> {
    const bytes = new TextEncoder().encode(css);
    if (!bytes.byteLength) return null;
    const uploaded = await this.api.uploadAsset(
      bytes.buffer,
      THEME_CSS_FILENAME,
      "text/css",
      `sha256:${await sha256Bytes(bytes.buffer)}`
    );
    return { assetId: uploaded.asset_id };
  }

  private applyLocalImageAssetPlaceholders(
    container: HTMLElement,
    imageAssets: Array<UploadedImageAsset | null>
  ): void {
    if (!imageAssets.length) return;
    const images = Array.from(container.querySelectorAll("img"));
    let assetIndex = 0;
    for (const image of images) {
      const currentSrc = image.getAttribute("src") || "";
      if (currentSrc.startsWith("http://") || currentSrc.startsWith("https://") || currentSrc.startsWith("data:")) {
        continue;
      }
      const asset = imageAssets[assetIndex];
      assetIndex += 1;
      if (!asset) continue;
      image.setAttribute("src", `docferry-asset://${asset.assetId}`);
      image.setAttribute("loading", "lazy");
      image.setAttribute("decoding", "async");
    }
  }

  private applyLocalAttachmentPlaceholders(container: HTMLElement, assets: UploadedLocalAsset[]): void {
    const attachmentAssets = assets.filter((asset) => asset.role !== "image");
    if (!attachmentAssets.length) return;
    const anchors = Array.from(container.querySelectorAll("a"));
    for (const anchor of anchors) {
      const href = anchor.getAttribute("href") || "";
      if (!href || isRemoteUrl(href) || href.startsWith("docferry-asset://")) continue;
      const decodedHref = safeDecodeURIComponent(href);
      const match = attachmentAssets.find((asset) => {
        const original = asset.originalPath;
        return decodedHref === original || decodedHref.endsWith(`/${original}`) || href === original;
      });
      if (!match) continue;
      anchor.setAttribute("href", `docferry-asset://${match.assetId}`);
      anchor.removeAttribute("target");
      anchor.removeAttribute("rel");
    }
  }

  private extractLocalAssetRefs(markdown: string): Array<{ path: string; isImage: boolean }> {
    const refs: Array<{ path: string; isImage: boolean }> = [];
    const wikiImagePattern = /!\[\[([^\]\n]+)\]\]/g;
    for (const match of markdown.matchAll(wikiImagePattern)) {
      const linkpath = match[1].split("|")[0]?.trim();
      if (linkpath && !isRemoteUrl(linkpath)) refs.push({ path: linkpath, isImage: true });
    }

    const markdownImagePattern = /!\[[^\]\n]*\]\(([^)\n]+)\)/g;
    for (const match of markdown.matchAll(markdownImagePattern)) {
      const linkpath = match[1].split(/\s+["']/)[0]?.trim().replace(/^<|>$/g, "");
      if (linkpath && !isRemoteUrl(linkpath)) refs.push({ path: linkpath, isImage: true });
    }

    const markdownLinkPattern = /(?<!!)\[[^\]\n]+\]\(([^)\n]+)\)/g;
    for (const match of markdown.matchAll(markdownLinkPattern)) {
      const linkpath = match[1].split(/\s+["']/)[0]?.trim().replace(/^<|>$/g, "");
      if (linkpath && !isRemoteUrl(linkpath)) refs.push({ path: linkpath, isImage: false });
    }

    return refs;
  }

  private extractOutboundLinks(markdown: string, sourceFile: TFile): OutboundLink[] {
    const links: OutboundLink[] = [];
    const seen = new Set<string>();
    const addLink = (
      rawTarget: string,
      label: string | null,
      linkKind: "wiki" | "markdown_relative" | "embed"
    ): void => {
      const parsed = parseObsidianTarget(rawTarget);
      if (!parsed.path || isRemoteUrl(parsed.path) || parsed.path.toLowerCase().startsWith("obsidian://")) return;
      const target = this.resolveLinkedFile(parsed.path, sourceFile);
      const key = `${linkKind}|${parsed.path}|${parsed.subpath || ""}|${target?.path || ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      links.push({
        raw_target: rawTarget.trim(),
        target_path: target?.path ?? null,
        target_doc_identity: null,
        target_subpath: parsed.subpath,
        label,
        link_kind: linkKind
      });
    };

    const wikiPattern = /(!?)\[\[([^\]\n]+)\]\]/g;
    for (const match of markdown.matchAll(wikiPattern)) {
      const isEmbed = match[1] === "!";
      const [targetPart, labelPart] = splitLinkLabel(match[2]);
      addLink(targetPart, labelPart, isEmbed ? "embed" : "wiki");
    }

    const markdownLinkPattern = /\[([^\]\n]+)\]\(([^)\n]+)\)/g;
    for (const match of markdown.matchAll(markdownLinkPattern)) {
      if (match.index && markdown.charAt(match.index - 1) === "!") continue;
      const rawTarget = match[2].split(/\s+["']/)[0]?.trim().replace(/^<|>$/g, "");
      if (rawTarget) addLink(rawTarget, match[1].trim() || null, "markdown_relative");
    }

    return links;
  }

  private resolveLinkedFile(linkpath: string, sourceFile: TFile): TFile | null {
    const decoded = safeDecodeURIComponent(linkpath);
    const byMetadata = this.app.metadataCache.getFirstLinkpathDest(decoded, sourceFile.path);
    if (byMetadata instanceof TFile) return byMetadata;

    const direct = this.app.vault.getAbstractFileByPath(normalizePath(decoded));
    if (direct instanceof TFile) return direct;

    const parentPath = sourceFile.parent?.path || "";
    const relativePath = parentPath ? normalizePath(`${parentPath}/${decoded}`) : normalizePath(decoded);
    const relative = this.app.vault.getAbstractFileByPath(relativePath);
    return relative instanceof TFile ? relative : null;
  }

  private async resolveVaultId(): Promise<string> {
    const adapter = this.app.vault.adapter as { basePath?: unknown };
    const basePath = typeof adapter.basePath === "string" ? adapter.basePath : "";
    const source = `${this.app.vault.getName()}|${basePath}`;
    return `vlt_${(await sha256(source)).slice(0, 24)}`;
  }

  private resolvePasswordMode(options: PublishOptions): "keep" | "set" | "clear" {
    if (options.passwordEnabled && options.password) return "set";
    if (!options.passwordEnabled) return "clear";
    return "keep";
  }

  private resolveTitle(file: TFile): string {
    return file.basename;
  }

  private formatError(error: unknown, fallback: string): string {
    if (error instanceof ShareApiError) return `${fallback}: ${error.message}`;
    if (error instanceof Error) return `${fallback}: ${error.message}`;
    return fallback;
  }

  private refreshDashboardAuth(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(DOCFERRY_DASHBOARD_VIEW_TYPE)) {
      if (leaf.view instanceof DocferryDashboardView) leaf.view.refreshForAuthChange();
    }
  }

  private refreshDashboardShare(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(DOCFERRY_DASHBOARD_VIEW_TYPE)) {
      if (leaf.view instanceof DocferryDashboardView) leaf.view.refreshForShareChange();
    }
  }

  private debug(message: string, value: unknown): void {
    if (!this.docferrySettings.debug) return;
    void value;
    console.debug(`[docferry] ${message}`);
  }
}

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  return sha256Bytes(bytes);
}

async function sha256Bytes(input: BufferSource): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", input);
  return hashBufferToHex(hashBuffer);
}

function hashBufferToHex(hashBuffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getObsidianVersion(app: unknown): string {
  const maybeApp = app as { version?: unknown };
  return typeof maybeApp.version === "string" ? maybeApp.version : "unknown";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizeSharePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/").trim().toLowerCase();
}

function assetOutputRelativePath(asset: ShareImportAsset): string {
  const originalPath = textValue(asset.original_path).split("#", 1)[0].split("?", 1)[0].replace(/\\/g, "/").trim();
  const parts = originalPath
    ? originalPath
        .split("/")
        .filter((part) => part && part !== "." && part !== "..")
        .map((part) => safeVaultSegment(part))
    : [];
  if (parts.length) return parts.join("/");
  return `attachments/${safeVaultSegment(textValue(asset.filename) || textValue(asset.asset_id) || "attachment")}`;
}

function textValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return fallback;
}

function splitLinkLabel(value: string): [string, string | null] {
  const [target, label] = value.split("|", 2);
  return [target.trim(), label?.trim() || null];
}

function parseObsidianTarget(rawTarget: string): { path: string; subpath: string | null } {
  const target = rawTarget.split("|", 1)[0].trim();
  const headingIndex = target.search(/[#^]/);
  if (headingIndex < 0) return { path: target, subpath: null };
  return {
    path: target.slice(0, headingIndex).trim(),
    subpath: target.slice(headingIndex + 1).trim() || null
  };
}

function captureComputedThemeCss(container: HTMLElement): string | null {
  const doc = container.ownerDocument;
  const styleFor = (selector: string): CSSStyleDeclaration | null => {
    const element = container.querySelector(selector);
    if (!element) return null;
    return element.ownerDocument.defaultView?.getComputedStyle(element) ?? getComputedStyle(element);
  };
  const containerStyle = doc.defaultView?.getComputedStyle(container) ?? getComputedStyle(container);
  const linkStyle = styleFor("a");
  const borderStyle = styleFor(".callout, blockquote, table");
  const codeStyle = styleFor("pre, code");
  const codeTextStyle = styleFor("pre code, code");
  const radiusStyle = styleFor(".callout, pre, table");
  const declarations = new Map<string, string>();
  const add = (name: string, ...values: Array<string | null | undefined>): void => {
    const value = values.map(safeThemeToken).find((candidate): candidate is string => Boolean(candidate));
    if (value) declarations.set(name, value);
  };

  add(
    "--docferry-theme-accent",
    readThemeCustomProperty(doc, "--interactive-accent", "--text-accent", "--color-accent", "--link-color"),
    linkStyle?.color
  );
  add(
    "--docferry-theme-border",
    readThemeCustomProperty(doc, "--background-modifier-border", "--divider-color", "--table-border-color"),
    borderStyle?.borderLeftColor,
    borderStyle?.borderTopColor
  );
  add("--docferry-theme-radius", radiusStyle?.borderRadius);
  add("--docferry-theme-font", containerStyle.fontFamily);
  add(
    "--docferry-theme-code-font",
    readThemeCustomProperty(doc, "--font-monospace", "--code-font-family"),
    codeTextStyle?.fontFamily
  );
  add("--docferry-theme-code-bg", codeStyle?.backgroundColor);
  add("--docferry-theme-code-ink", codeTextStyle?.color);

  if (!declarations.size) return null;
  const body = Array.from(declarations, ([name, value]) => `  ${name}: ${value};`).join("\n");
  return `/* DocFerry semantic theme tokens: visual identity without layout capture. */\n.reader-page.theme-fidelity-full {\n${body}\n}`;
}

function currentDocument(): Document {
  return activeDocument;
}

function readThemeCustomProperty(doc: Document, ...names: string[]): string | null {
  const view = doc.defaultView;
  const styles = [
    view?.getComputedStyle(doc.body),
    view?.getComputedStyle(doc.documentElement)
  ].filter((style): style is CSSStyleDeclaration => Boolean(style));
  for (const name of names) {
    for (const style of styles) {
      const value = safeThemeToken(style.getPropertyValue(name));
      if (value) return value;
    }
  }
  return null;
}

function safeThemeToken(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized || /^(?:none|normal|transparent)$/i.test(normalized)) return null;
  if (/rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/i.test(normalized)) return null;
  if (/^rgba?\([^)]*\/\s*0(?:\.0+)?\s*\)$/i.test(normalized)) return null;
  if (/url\s*\(|[;{}]/i.test(normalized)) return null;
  return normalized;
}

function contentTypeForExtension(extension: string): string | null {
  switch (extension.toLowerCase()) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "pdf":
      return "application/pdf";
    case "txt":
      return "text/plain";
    case "csv":
      return "text/csv";
    case "json":
      return "application/json";
    case "zip":
      return "application/zip";
    case "doc":
      return "application/msword";
    case "xls":
      return "application/vnd.ms-excel";
    case "ppt":
      return "application/vnd.ms-powerpoint";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "mp3":
      return "audio/mpeg";
    case "m4a":
      return "audio/mp4";
    case "ogg":
      return "audio/ogg";
    case "wav":
      return "audio/wav";
    case "mp4":
      return "video/mp4";
    case "mov":
      return "video/quicktime";
    case "webm":
      return "video/webm";
    case "otf":
      return "font/otf";
    case "ttf":
      return "font/ttf";
    case "woff":
      return "font/woff";
    case "woff2":
      return "font/woff2";
    default:
      return null;
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: Array<R | undefined> = new Array<R | undefined>(items.length).fill(undefined);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    })
  );
  return results.map((result): R => {
    if (result === undefined) throw new Error("Concurrent task did not produce a result.");
    return result;
  });
}

function assetRoleForExtension(extension: string): UploadedLocalAsset["role"] | null {
  const normalized = extension.toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(normalized)) return "image";
  if (["mp4", "mov", "webm"].includes(normalized)) return "video";
  if (["otf", "ttf", "woff", "woff2"].includes(normalized)) return "font";
  if (contentTypeForExtension(normalized)) return "attachment";
  return null;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
