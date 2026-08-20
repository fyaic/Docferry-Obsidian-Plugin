import { App, Component, MarkdownRenderer, MarkdownView, Notice, Plugin, TFile, TFolder, normalizePath } from "obsidian";
import { ShareApiClient, ShareApiError } from "./api-client";
import { isInvalidProductSessionError } from "./session-errors";
import { hasActiveShareLink, resolveShareUpdateVaultGate, vaultRelativeShareSourcePath } from "./share-actions";
import { isInactiveShareError, isMissingShareError } from "./share-lifecycle";
import { AuthCompletionError, AuthService } from "./auth-service";
import {
  confirmDeleteShareHistory,
  confirmLegacyShareMigration,
  confirmRecoveredShareReassignment,
  confirmStopRecoveredShare,
  confirmStopRecoveredShareBeforeAccountChange,
  confirmStopShare,
  confirmUnreachableShareRepublish
} from "./confirm-stop-modal";
import {
  DOCFERRY_DASHBOARD_VIEW_TYPE,
  DocferryDashboardView,
  type DashboardImportResult
} from "./dashboard-view";
import { clearShareMeta, preserveLegacyShareMeta, readShareMeta, writeShareMeta } from "./frontmatter";
import { buildExternalLinkNote, externalLinkProviderLabel } from "./external-import";
import { openExternalUrl } from "./external-links";
import { canShowFolderShareEntry, folderShareAccess } from "./folder-share-access";
import { FolderShareModal } from "./folder-share-modal";
import { classifyProtocolCallback } from "./protocol-callback";
import { confirmLoginToPublish } from "./login-intent-modal";
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
  MEDIA_NOTE_LOW_QUOTA_NOTICE_THRESHOLD,
  hasMediaNoteJobCapacity,
  mediaNoteMonthlyJobsRemaining,
  requiresDetailedNoteProvider,
  shouldPrepareDetailedNote
} from "./media-note-availability";
import {
  resolvePendingMediaNoteSubmission,
  submitMediaNoteJob,
  type MediaNoteSubmissionDeps,
  type PendingMediaNoteSubmission
} from "./media-note-submission";
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
import {
  finalizeShareCreate,
  stableSharePayloadString,
  submitShareCreate,
  type PendingSharePublish,
  type SharePublishSubmissionDeps
} from "./share-publish-submission";
import {
  clearStagedSessionToken,
  clearPendingLoginCustody,
  migrateLegacyPendingLogin,
  persistPendingLogin,
  persistSessionToken,
  readPendingLogin,
  resolveSessionTokenOnLoad,
  stageSessionToken
} from "./session-token-custody";
import { legacyShareMetaForService, shareMetaBelongsToService, type LegacyShareMeta } from "./share-url";
import { ResultModal } from "./result-modal";
import { ShareModal } from "./share-modal";
import {
  initialExpirySelection,
  initialThemeStyling,
  resolveFreshExpiryAfterUpdateFallback
} from "./publish-state";
import { isRemoteUrl } from "./theme-safety";
import { isUnsafeAssetPath } from "./asset-path-safety";
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
const UPLOAD_CONSENT_NOTICE_ID = "docferry-privacy-security-disclosure-v8";
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
  private pendingPublishIntent: { kind: "note" | "folder"; path: string } | null = null;
  private shareImportCommitQueue: Promise<void> = Promise.resolve();
  private settingsSaveQueue: Promise<void> = Promise.resolve();
  private unloaded = false;
  private pendingTimeouts = new Set<number>();
  private stagedSessionTokenToRevoke = "";

  onunload(): void {
    this.unloaded = true;
    for (const handle of this.pendingTimeouts) window.clearTimeout(handle);
    this.pendingTimeouts.clear();
    this.auth?.dispose();
  }

  /** setTimeout that never fires after plugin unload. */
  private scheduleTimeout(callback: () => void, delayMs: number): void {
    if (this.unloaded) return;
    const handle = window.setTimeout(() => {
      this.pendingTimeouts.delete(handle);
      if (!this.unloaded) callback();
    }, delayMs);
    this.pendingTimeouts.add(handle);
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    this.api = new ShareApiClient(
      () => this.docferrySettings,
      this.manifest.version,
      (error) => this.handleInvalidProductSession(error)
    );
    await this.reconcileStagedSessionToken();
    await this.reconcileCommittedSharePublish();
    this.auth = new AuthService(
      this.api,
      async (token, response) => {
        // The exchange may complete after plugin unload: adopt nothing then.
        if (this.unloaded) return;
        this.billingSessionRecoveryUntil = 0;
        const pendingShare = this.docferrySettings.pendingSharePublish;
        if (
          pendingShare &&
          response.product_subject_id &&
          pendingShare.ownerProductSubjectId !== response.product_subject_id
        ) {
          await this.rejectMismatchedLoginToken(token);
          throw new AuthCompletionError(
            "An unfinished share belongs to another Bondie account. Sign in with that account and finish or stop the share first."
          );
        }
        const pendingSubmission = this.docferrySettings.pendingMediaNoteSubmission;
        if (
          pendingSubmission &&
          response.product_subject_id &&
          pendingSubmission.ownerProductSubjectId !== response.product_subject_id
        ) {
          // A bare submission record may already be a committed (charged) job
          // under the current account: replay it once with the same operation
          // key before the new account's session can orphan the record.
          try {
            await resolvePendingMediaNoteSubmission(this.mediaNoteSubmissionDeps(), pendingSubmission);
          } catch {
            // Uncertain (network) outcome: the job may exist, so refuse the
            // account switch. The owner-scoped record recovers on the next
            // login with the original account.
            await this.rejectMismatchedLoginToken(token);
            throw new AuthCompletionError(
              "Could not confirm the state of your previous detailed note. Check your connection, then sign in again."
            );
          }
          // A recovered job is now a tracked pending import and is handled by
          // the mismatch guard below; a definitive rejection cleared the
          // record and the login proceeds.
        }
        const pending = this.docferrySettings.pendingMediaNoteImport;
        if (
          pending &&
          response.product_subject_id &&
          pending.ownerProductSubjectId !== response.product_subject_id
        ) {
          await this.rejectMismatchedLoginToken(token);
          throw new AuthCompletionError(
            "This detailed note belongs to another Bondie account. Sign in with the account that started it, then resume or cancel it."
          );
        }
        const previousToken = this.docferrySettings.sessionToken;
        if (previousToken && previousToken !== token) {
          await this.replaceSessionToken(previousToken, token);
        } else {
          try {
            this.adoptSessionToken(token);
          } catch (error) {
            this.debug("secure session token adoption failed", error);
            await this.revokeUnadoptedToken(token);
            throw new AuthCompletionError(
              "DocFerry could not store your sign-in securely. Update Obsidian, then start login again."
            );
          }
        }
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
        await this.resumePendingPublishIntent();
      },
      () => ({
        clientInstanceId: this.docferrySettings.clientInstanceId,
        pluginVersion: this.manifest.version,
        platform: "obsidian",
        instanceType: "obsidian_plugin"
      }),
      () => readPendingLogin(this.app.secretStorage),
      async (state, startedAt, verifier) => {
        // The pending login handshake (including the PKCE verifier) lives in
        // SecretStorage, never in data.json. Storage failures propagate so the
        // login fails closed instead of persisting the verifier in plaintext.
        persistPendingLogin(this.app.secretStorage, { state, startedAt, verifier });
      }
    );
    void this.auth.resumePendingLogin().catch((error) => {
      // resumePendingLogin handles secure-storage failures itself; this catch
      // is the last-resort guard against an unhandled rejection at load.
      this.debug("pending login resume failed", error);
    });

    this.settingTab = new DocferrySettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.registerView(DOCFERRY_DASHBOARD_VIEW_TYPE, (leaf) => new DocferryDashboardView(leaf, this));
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (file instanceof TFolder) {
        // Free plans have no folder sharing: hide the entry instead of
        // leading to a dead-end upgrade notice.
        if (!canShowFolderShareEntry(this.docferrySettings.membership)) return;
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
      this.scheduleTimeout(() => {
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
        if (!canShowFolderShareEntry(this.docferrySettings.membership)) return false;
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
      void this.reconcileCommittedSharePublish().catch((error) => {
        this.debug("pending share journal reconciliation failed", error);
      });
      if (this.docferrySettings.sessionToken) this.refreshMembershipForDashboardOpen();
      if (this.docferrySettings.sessionToken && this.docferrySettings.pendingMediaNoteImport) {
        this.scheduleTimeout(() => void this.resumeActiveMediaImport(), 900);
      } else if (this.docferrySettings.sessionToken && this.docferrySettings.pendingMediaNoteSubmission) {
        this.scheduleTimeout(() => void this.recoverPendingMediaNoteSubmission(), 900);
      }
      this.scheduleTimeout(() => {
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
    const boundaryReset = enforceProductionServiceBoundary(this.docferrySettings, DEFAULT_SETTINGS.serverUrl);
    changed = boundaryReset || changed;
    try {
      const sessionToken = resolveSessionTokenOnLoad(
        this.app.secretStorage,
        this.docferrySettings.sessionToken,
        boundaryReset
      );
      this.docferrySettings.sessionToken = sessionToken.token;
      this.stagedSessionTokenToRevoke = sessionToken.stagedTokenToRevoke;
      if (sessionToken.scrubLegacy) changed = true;
      if (boundaryReset) {
        clearPendingLoginCustody(this.app.secretStorage);
      } else if (
        loadedSettings &&
        migrateLegacyPendingLogin(this.app.secretStorage, {
          state: loadedSettings.pendingAuthState,
          startedAt: loadedSettings.pendingAuthStartedAt,
          verifier: loadedSettings.pendingAuthVerifier
        })
      ) {
        // Legacy plaintext handshake fields are filtered out of allowed keys
        // above, so the next save scrubs them from data.json.
        changed = true;
      }
    } catch (error) {
      this.docferrySettings.sessionToken = "";
      changed = true;
      this.debug("secure session token storage unavailable", error);
      new Notice("DocFerry could not access secure credential storage. Update Obsidian, then sign in again.", 8000);
    }
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
    const pendingSubmission = this.docferrySettings.pendingMediaNoteSubmission;
    if (
      pendingSubmission &&
      (!pendingSubmission.key || !pendingSubmission.ownerProductSubjectId || !pendingSubmission.sourceUrl)
    ) {
      this.docferrySettings.pendingMediaNoteSubmission = null;
      changed = true;
    }
    if (changed) await this.saveSettings();
  }

  async saveSettings(): Promise<void> {
    // The session token lives only in Obsidian SecretStorage and in memory;
    // it is never persisted to data.json.
    const snapshot = { ...this.docferrySettings, sessionToken: "" };
    const save = this.settingsSaveQueue.then(() => this.saveData(snapshot));
    this.settingsSaveQueue = save.catch(() => undefined);
    await save;
  }

  /**
   * Adopts a session token into SecretStorage and memory. Fails closed: when
   * secure storage is unavailable the token is discarded instead of falling
   * back to plaintext persistence.
   */
  private adoptSessionToken(token: string): void {
    persistSessionToken(this.app.secretStorage, token);
    this.docferrySettings.sessionToken = token;
  }

  /**
   * Switches product sessions with separate active and pending-revocation
   * SecretStorage slots. The previous token is durably queued before the new
   * token becomes authoritative. A crash before commit keeps the previous
   * token; a crash after commit keeps the replacement and revokes the previous
   * token during startup reconciliation.
   */
  private async replaceSessionToken(previousToken: string, replacementToken: string): Promise<void> {
    try {
      stageSessionToken(this.app.secretStorage, previousToken);
      this.stagedSessionTokenToRevoke = previousToken;
    } catch (error) {
      this.debug("previous session cleanup staging failed", error);
      try {
        await this.revokeUnadoptedToken(replacementToken);
      } catch (revokeError) {
        this.debug("replacement session cleanup failed", revokeError);
      }
      throw new AuthCompletionError(
        "DocFerry could not store your sign-in securely. Your previous account remains connected."
      );
    }

    try {
      persistSessionToken(this.app.secretStorage, replacementToken);
    } catch (error) {
      this.debug("replacement session commit failed", error);
      this.stagedSessionTokenToRevoke = "";
      try {
        clearStagedSessionToken(this.app.secretStorage);
      } catch (cleanupError) {
        // On restart, equal active/staged old tokens are recognized as an
        // uncommitted switch and the duplicate staging slot is cleared.
        this.debug("uncommitted session staging cleanup deferred", cleanupError);
      }
      try {
        await this.revokeUnadoptedToken(replacementToken);
      } catch (revokeError) {
        this.debug("replacement session cleanup deferred", revokeError);
      }
      throw new AuthCompletionError(
        "DocFerry could not safely store the new sign-in. Your previous account remains connected."
      );
    }
    this.docferrySettings.sessionToken = replacementToken;

    try {
      await this.api.logoutToken(previousToken);
    } catch (error) {
      if (!isInvalidProductSessionError(error)) {
        // The replacement is already authoritative. Keep the old token in the
        // durable cleanup slot so an ambiguous response or crash cannot revoke
        // the newly connected account on restart.
        this.debug("previous session cleanup deferred", error);
        new Notice("Your new account is connected. DocFerry will finish closing the previous session when online.", 8000);
        return;
      }
    }

    this.stagedSessionTokenToRevoke = "";
    try {
      clearStagedSessionToken(this.app.secretStorage);
    } catch (error) {
      // The old token was revoked; an idempotent retry on restart is safe.
      this.debug("previous session staging cleanup deferred", error);
    }
  }

  private async revokeUnadoptedToken(token: string): Promise<void> {
    // Retain the cleanup target in memory even when SecretStorage itself is
    // temporarily unavailable. This process can still retry without falsely
    // claiming that durable cleanup was queued.
    this.stagedSessionTokenToRevoke = token;
    let durablyStaged = false;
    try {
      stageSessionToken(this.app.secretStorage, token);
      durablyStaged = true;
    } catch (error) {
      this.debug("unadopted session staging failed", error);
    }
    try {
      await this.api.logoutToken(token);
    } catch (error) {
      if (!isInvalidProductSessionError(error)) {
        this.debug("unadopted session token revoke failed", error);
        throw new AuthCompletionError(
          durablyStaged
            ? "DocFerry could not close the unused sign-in. It remains queued for secure cleanup; try again when connected."
            : "DocFerry could not close the unused sign-in or save a durable cleanup record. Keep Obsidian open and try again."
        );
      }
    }
    try {
      clearStagedSessionToken(this.app.secretStorage);
      this.stagedSessionTokenToRevoke = "";
    } catch (error) {
      this.debug("unadopted session staging cleanup deferred", error);
    }
  }

  private async reconcileStagedSessionToken(): Promise<boolean> {
    const token = this.stagedSessionTokenToRevoke;
    if (!token) return true;
    try {
      await this.revokeUnadoptedToken(token);
      return true;
    } catch (error) {
      this.debug("staged session cleanup failed", error);
      new Notice("DocFerry is still closing an unfinished sign-in. Your current account remains unchanged.", 8000);
      return false;
    }
  }

  private clearSessionTokenCustody(): void {
    this.docferrySettings.sessionToken = "";
    try {
      persistSessionToken(this.app.secretStorage, "");
    } catch (error) {
      this.debug("secure session token cleanup failed", error);
    }
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
    if (!(await this.reconcileStagedSessionToken())) return;
    await this.auth.startLogin();
  }

  async startSignup(): Promise<void> {
    if (!(await this.reconcileStagedSessionToken())) return;
    if (!(await this.finishPendingImportBeforeAccountChange())) return;
    // Keep the current account usable until the browser flow succeeds. The
    // token-adoption callback revokes the old session immediately before it
    // stores the confirmed replacement.
    await this.auth.startLogin({ signup: true });
  }

  async reconnectAccount(): Promise<void> {
    if (!(await this.reconcileStagedSessionToken())) return;
    if (!(await this.finishPendingImportBeforeAccountChange())) return;
    await this.auth.startLogin({ promptLogin: true });
  }

  async disconnectAccount(): Promise<void> {
    if (!(await this.finishPendingImportBeforeAccountChange())) return;
    // Invalidate any in-flight browser login first, so a handoff completed
    // later cannot silently reconnect the account being disconnected.
    try {
      await this.auth.cancelPendingLogin();
    } catch (error) {
      this.debug("pending login cleanup during disconnect failed", error);
    }
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

  /**
   * Logs out a just-exchanged token that must not be adopted because a
   * pending detailed note belongs to the current account, then restores the
   * previous local session state.
   */
  private async rejectMismatchedLoginToken(token: string): Promise<void> {
    await this.revokeUnadoptedToken(token);
  }

  private async finishPendingImportBeforeAccountChange(): Promise<boolean> {
    if (!(await this.finishPendingShareBeforeAccountChange())) return false;
    const submission = this.docferrySettings.pendingMediaNoteSubmission;
    if (submission) {
      // A persisted submission may already be a committed (charged) job:
      // replay it once with the same operation key before the account change
      // orphans the record.
      try {
        await resolvePendingMediaNoteSubmission(this.mediaNoteSubmissionDeps(), submission);
      } catch (error) {
        // Uncertain (network) outcome: the job may exist, so block the change.
        new Notice(this.formatError(error, "Could not confirm the state of your previous detailed note"), 8000);
        return false;
      }
      // Recovered jobs become a normal pending import (the guard below
      // cancels them); a definitive rejection cleared the record. Either
      // way, fall through.
    }
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

  private async finishPendingShareBeforeAccountChange(): Promise<boolean> {
    const pending = this.docferrySettings.pendingSharePublish;
    if (!pending) return true;
    const connectedOwner = this.docferrySettings.connectedAccount?.productSubjectId;
    if (!connectedOwner || pending.ownerProductSubjectId !== connectedOwner) {
      new Notice(
        "An unfinished share belongs to another Bondie account. Reconnect that account and finish the share before changing accounts.",
        8000
      );
      return false;
    }

    const deps = this.sharePublishSubmissionDeps();
    let response: ShareResponse;
    try {
      response = await this.api.resolveShareCreate(pending.key);
      await deps.store.save({ ...pending, response });
    } catch (error) {
      if (
        error instanceof ShareApiError &&
        (error.code === "share_idempotency_not_found" || error.code === "share_idempotency_inactive")
      ) {
        await finalizeShareCreate(deps.store, pending.key);
        return true;
      }
      new Notice(this.formatError(error, "Could not confirm the unfinished share"), 8000);
      return false;
    }

    let file = this.markdownFileByPath(pending.filePath);
    if (!file && pending.sourceHash) file = await this.findUniqueMarkdownFileBySourceHash(pending.sourceHash);
    if (file) {
      await writeShareMeta(this.app, file, response, {
        passwordEnabled: response.password_enabled,
        expiresAt: response.expires_at
      });
      await finalizeShareCreate(deps.store, pending.key);
      return true;
    }

    const confirmed = await confirmStopRecoveredShareBeforeAccountChange(
      this.app,
      response.title || "Recovered share",
      pending.filePath
    );
    if (!confirmed) return false;
    try {
      await this.api.deleteShare(response.share_id);
      await finalizeShareCreate(deps.store, pending.key);
      return true;
    } catch (error) {
      new Notice(this.formatError(error, "Could not stop the unfinished share"), 8000);
      return false;
    }
  }

  private clearLocalBondieAccount(preservePendingImport = false): void {
    this.billingReturnRefreshGeneration++;
    this.clearPendingBillingReturnRefresh();
    this.clearSessionTokenCustody();
    this.docferrySettings.connectedAccount = null;
    this.docferrySettings.membership = null;
    if (!preservePendingImport) this.docferrySettings.pendingMediaNoteImport = null;
    if (!preservePendingImport) this.docferrySettings.pendingMediaNoteSubmission = null;
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
    // Clear the source note's df_* reference wherever the note lives now, so
    // it is not stuck in an existing-share state after the record is gone.
    await this.clearLocalShareMetaForId(share.share_id);
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
        void openExternalUrl(link.dashboard_url);
        new Notice("DocFerry access page opened in your browser.");
        return;
      } catch (error) {
        if (!isInvalidProductSessionError(error)) {
          new Notice(this.formatError(error, "Access page needs reconnect"));
        }
      }
    }
    void openExternalUrl(fallbackUrl);
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
        void openExternalUrl(link.dashboard_url);
        return;
      } catch (error) {
        this.debug("dashboard link failed", error);
      }
    }
    void openExternalUrl(fallbackUrl);
  }

  async requestAccessUpgrade(source: "plugin_settings" | "plugin_dashboard"): Promise<void> {
    if (!this.docferrySettings.sessionToken) {
      new Notice("Connect your Bondie account before sending feedback.");
      return;
    }
    try {
      const target = "/dashboard/support#feedback";
      const link = await this.api.createDashboardLink(target);
      void openExternalUrl(link.dashboard_url);
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
    // A share without a recorded vault (CLI/agent-kit created) may be claimed
    // by this vault when the source note resolves here; only a recorded
    // mismatching vault id stays rejected.
    if (resolveShareUpdateVaultGate(share.vault_id, vaultId) === "wrong-vault") {
      new Notice("Open the source vault to update that share.");
      return;
    }
    // Resolve by stable identity first: the remembered path may now hold an
    // unrelated note after the source note was renamed or moved.
    let file = this.findSharedFileByShareId(share.share_id);
    if (!file) {
      // Legacy CLI shares remember an absolute path inside the source vault;
      // try the remembered path as-is, then with the vault prefix stripped.
      const adapter = this.app.vault.adapter as { basePath?: unknown };
      const basePath = typeof adapter.basePath === "string" ? adapter.basePath : "";
      let byPath = this.markdownFileByPath(share.source_path);
      if (!byPath) {
        byPath = this.markdownFileByPath(vaultRelativeShareSourcePath(share.source_path, basePath));
      }
      if (byPath) {
        if (!this.currentShareMeta(byPath).id) {
          // No recorded share on the path match: accept it as the source note
          // whose metadata was lost.
          file = byPath;
        } else {
          // A note linked to a different share must never be updated under
          // this share.
          new Notice("The note at the remembered path is linked to a different share. Open the moved source note to update that share.", 8000);
          return;
        }
      }
    }
    if (!file) {
      new Notice("Open the source note in this vault to update that share.");
      return;
    }
    await this.publishFile(file, share);
  }

  async updateFolderShareFromList(folderShare: FolderShareResponse): Promise<void> {
    const vaultId = await this.resolveVaultId();
    if (resolveShareUpdateVaultGate(folderShare.vault_id, vaultId) === "wrong-vault") {
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
      // Clear local meta by share id, not by remembered path: a moved note
      // still gets its stale df_* reference removed after a remote stop.
      await this.clearLocalShareMetaForId(share.share_id);
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
      this.scheduleTimeout(() => void this.runScheduledMembershipRefresh(generation), delayMs);
    }
  }

  private async runScheduledMembershipRefresh(generation: number): Promise<void> {
    if (this.unloaded) return;
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
  }

  private isBillingSessionRequired(error: unknown): boolean {
    if (error instanceof ShareApiError) return error.code === "synapsehub_user_session_required";
    if (!error || typeof error !== "object") return false;
    return "code" in error && error.code === "synapsehub_user_session_required";
  }

  private async recoverBillingSession(force = false): Promise<void> {
    if (this.unloaded) return;
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

  private async offerLoginToPublish(kind: "note" | "folder", label: string, path: string): Promise<void> {
    const confirmed = await confirmLoginToPublish(this.app, label, path);
    if (!confirmed) return;
    this.pendingPublishIntent = { kind, path };
    const opened = await this.auth.startLogin();
    if (!opened) this.pendingPublishIntent = null;
  }

  /**
   * Resumes a publish intent captured before login. Re-enters the normal
   * publish flow for the same vault item, so the user still confirms the
   * Share or Folder Share dialog; nothing publishes automatically.
   */
  private async resumePendingPublishIntent(): Promise<void> {
    const intent = this.pendingPublishIntent;
    if (!intent) return;
    this.pendingPublishIntent = null;
    const item = this.app.vault.getAbstractFileByPath(intent.path);
    if (intent.kind === "note" && item instanceof TFile && item.extension === "md") {
      new Notice("Signed in. Confirm the share dialog to publish your note.");
      await this.publishFile(item);
      return;
    }
    if (intent.kind === "folder" && item instanceof TFolder) {
      new Notice("Signed in. Confirm the share dialog to publish your folder.");
      await this.publishFolder(item);
      return;
    }
    new Notice("Signed in. The item you wanted to publish is no longer available in this vault.");
  }

  private publishInFlight = new Set<string>();
  private notePublishInFlight = false;

  private async publishFile(file: TFile, selectedShare?: ShareListItemResponse): Promise<void> {
    if (this.notePublishInFlight) {
      new Notice("Another note is already being published. Wait for it to finish before publishing this note.");
      return;
    }
    this.notePublishInFlight = true;
    this.publishInFlight.add(file.path);
    try {
      await this.publishFileCore(file, selectedShare);
    } finally {
      this.publishInFlight.delete(file.path);
      this.notePublishInFlight = false;
    }
  }

  private async publishFileCore(file: TFile, selectedShare?: ShareListItemResponse): Promise<void> {
    await this.reconcileCommittedSharePublish();
    if (!this.docferrySettings.serverUrl) {
      new Notice("Configure server URL first.");
      return;
    }

    if (!this.docferrySettings.sessionToken) {
      await this.offerLoginToPublish("note", file.basename, file.path);
      return;
    }

    if (selectedShare) {
      const ownShareId = this.currentShareMeta(file).id;
      if (ownShareId && ownShareId !== selectedShare.share_id) {
        // The note carries a different share reference: never let a dashboard
        // update retarget another share's note.
        new Notice("This note is linked to a different share. The update was not started.", 8000);
        return;
      }
    }

    const legacyMeta = legacyShareMetaForService(readShareMeta(this.app, file), this.docferrySettings.serverUrl);
    if (legacyMeta) {
      const migrationConfirmed = await confirmLegacyShareMigration(
        this.app,
        this.resolveTitle(file),
        file.path,
        legacyMeta.url
      );
      if (!migrationConfirmed) return;
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
      "share_id" | "status" | "password_enabled" | "expires_at" | "theme_mode"
    > | null = null;
    let existingMetaId = selectedShare?.share_id ?? existing.id;
    let unreachableShareMeta: LegacyShareMeta | null = null;
    if (existingMetaId) {
      // Captured for the catch branch, where the mutable binding can no
      // longer be narrowed after the reassignment inside try.
      const unreachableShareId = existingMetaId;
      try {
        existingShare = await this.api.getShareStatus(existingMetaId);
        if (!hasActiveShareLink(existingShare.status)) {
          // Stopped or expired outside this session: publish a fresh link
          // instead of failing against the dead one.
          existingShare = null;
          existingMetaId = undefined;
        }
      } catch (error) {
        if (isInvalidProductSessionError(error)) return;
        if (isMissingShareError(error)) {
          // A 404 is ambiguous: the share may have been deleted, or it may
          // belong to another account on this server with the link still
          // live. Require an explicit one-way decision and preserve the
          // reference as df_legacy_* before it is overwritten.
          const confirmed = await confirmUnreachableShareRepublish(
            this.app,
            this.resolveTitle(file),
            file.path,
            existing.url ?? ""
          );
          if (!confirmed) return;
          unreachableShareMeta = { id: unreachableShareId, url: existing.url ?? "" };
          existingMetaId = undefined;
        } else {
          new Notice(this.formatError(error, "Could not load the current share settings"));
          return;
        }
      }
    }
    const existingShareId = existingShare?.share_id ?? existingMetaId;
    // Once the server says the old link is stopped, expired, or missing, its
    // past expiry must not be copied into a fresh link.
    const existingExpiresAt = existingShareId
      ? existingShare?.expires_at ?? existing.expires ?? null
      : null;
    const previousPasswordEnabled = Boolean(existingShare?.password_enabled ?? existing.passwordEnabled);
    const title = this.resolveTitle(file);
    const canUseThemeStyling = Boolean(this.docferrySettings.membership?.canUseFullTheme);
    const modal = new ShareModal(this.app, {
      title,
      passwordEnabled:
        existingShare?.password_enabled ?? existing.passwordEnabled ?? this.docferrySettings.defaultPasswordEnabled,
      // A stopped, expired, or missing share has no reusable server-side
      // password even when old frontmatter says it used to be protected.
      passwordAlreadySet: Boolean(existingShareId && previousPasswordEnabled),
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
      const shareSubmissionDeps = this.sharePublishSubmissionDeps();
      const publishResult = existingShareId
        ? await this.updateOrCreateShare(
            existingShareId,
            file.path,
            payload,
            resolveFreshExpiryAfterUpdateFallback(
              options.expirySelection,
              options.expiresAt,
              this.docferrySettings.defaultExpiresInDays
            ),
            notice,
            shareSubmissionDeps
          )
        : await submitShareCreate(shareSubmissionDeps, {
            filePath: file.path,
            payload,
            payloadHash: await sha256(stableSharePayloadString(payload)),
            sourceHash: payload.source_hash,
            ownerProductSubjectId: this.docferrySettings.connectedAccount?.productSubjectId ?? ""
          });
      if (!publishResult) {
        notice.hide();
        return;
      }
      let response = publishResult.response;
      if ("filePathChanged" in publishResult && publishResult.filePathChanged) {
        const confirmed = await confirmRecoveredShareReassignment(
          this.app,
          publishResult.originalFilePath,
          options.title,
          file.path
        );
        if (!confirmed) {
          const stopRecovered = await confirmStopRecoveredShare(
            this.app,
            response.title || options.title,
            publishResult.originalFilePath
          );
          if (!stopRecovered) {
            notice.hide();
            return;
          }
          await this.api.deleteShare(response.share_id);
          if (publishResult.operationKey) {
            await finalizeShareCreate(shareSubmissionDeps.store, publishResult.operationKey);
          }
          notice.hide();
          new Notice("The recovered public link was stopped. Publish this note again to create a new link.", 8000);
          return;
        }
      }
      if ("payloadChanged" in publishResult && publishResult.payloadChanged) {
        notice.setMessage("Applying your current note and sharing options...");
        response = await this.api.updateShare(response.share_id, {
          ...payload,
          password_mode: options.passwordEnabled ? payload.password_mode : "clear"
        });
      }

      if (legacyMeta) {
        await preserveLegacyShareMeta(this.app, file, legacyMeta);
      }
      if (unreachableShareMeta?.url) {
        await preserveLegacyShareMeta(this.app, file, unreachableShareMeta);
      }
      if ("legacyMeta" in publishResult && publishResult.legacyMeta?.url) {
        await preserveLegacyShareMeta(this.app, file, publishResult.legacyMeta);
      }
      await writeShareMeta(this.app, file, response, {
        passwordEnabled: response.password_enabled,
        expiresAt: response.expires_at
      });
      if (publishResult.operationKey) {
        await finalizeShareCreate(shareSubmissionDeps.store, publishResult.operationKey);
      }
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
    if (this.publishInFlight.has(folder.path)) {
      new Notice("This folder is already being published. Wait for the current publish to finish.");
      return;
    }
    this.publishInFlight.add(folder.path);
    try {
      await this.publishFolderCore(folder);
    } finally {
      this.publishInFlight.delete(folder.path);
    }
  }

  private async publishFolderCore(folder: TFolder): Promise<void> {
    if (!folder.path || folder.path === "/") {
      new Notice("Choose a folder inside the vault instead of the entire vault.");
      return;
    }
    if (!this.docferrySettings.serverUrl) {
      new Notice("Configure server URL first.");
      return;
    }
    if (!this.docferrySettings.sessionToken) {
      await this.offerLoginToPublish("folder", folder.name || this.app.vault.getName(), folder.path);
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
    if (!meta.url || !meta.id) {
      await this.publishFile(file);
      return;
    }
    const linkState = await this.verifyShareLinkState(meta.id);
    if (linkState === "missing") {
      // A 404 is ambiguous: the share may have been deleted, or it may belong
      // to another account on this server with the link still live. Keep the
      // local reference and refuse to copy silently either way.
      new Notice(
        "This share isn't visible to the current account. It may belong to a different account or may have been deleted. The local reference was kept.",
        8000
      );
      return;
    }
    if (linkState === "inactive") {
      await clearShareMeta(this.app, file);
      this.refreshDashboardShare();
      new Notice("This share is no longer active. The dead link was not copied; publish again to create a new link.", 8000);
      return;
    }
    if (linkState === "unknown") {
      new Notice("Could not verify the share state. Copying the last known link.", 8000);
    }
    await navigator.clipboard.writeText(meta.url);
    new Notice("Share link copied");
  }

  private async verifyShareLinkState(shareId: string): Promise<"live" | "inactive" | "missing" | "unknown"> {
    try {
      const status = await this.api.getShareStatus(shareId);
      return hasActiveShareLink(status.status) ? "live" : "inactive";
    } catch (error) {
      if (isInactiveShareError(error)) return "inactive";
      if (isMissingShareError(error)) return "missing";
      return "unknown";
    }
  }

  private async updateOrCreateShare(
    shareId: string,
    filePath: string,
    payload: SharePayload,
    freshExpiresAt: string | null,
    notice: Notice,
    submissionDeps: SharePublishSubmissionDeps
  ): Promise<{ response: ShareResponse; operationKey?: string; legacyMeta?: LegacyShareMeta } | null> {
    try {
      return { response: await this.api.updateShare(shareId, payload) };
    } catch (error) {
      if (!(error instanceof ShareApiError) || (!isMissingShareError(error) && !isInactiveShareError(error))) {
        throw error;
      }
      let legacyMeta: LegacyShareMeta | undefined;
      if (isMissingShareError(error)) {
        const file = this.markdownFileByPath(filePath);
        const lastKnownUrl = file ? this.currentShareMeta(file).url ?? "" : "";
        const confirmed = await confirmUnreachableShareRepublish(
          this.app,
          payload.title,
          filePath,
          lastKnownUrl
        );
        if (!confirmed) return null;
        legacyMeta = { id: shareId, url: lastKnownUrl };
      }
      notice.setMessage("The existing share is no longer available. Publishing a new link...");
      if (payload.password_mode === "keep" && !payload.password) {
        throw new Error(
          "The old password cannot be copied to a new link. Publish again and enter a new password to keep this note protected."
        );
      }
      // The fallback create is a create like any other: it must ride the
      // idempotent submission channel so a lost response followed by a retry
      // resolves to the same share instead of minting a second public link.
      const createPayload = {
        ...payload,
        expires_at: freshExpiresAt,
        password_mode: undefined
      };
      const created = await submitShareCreate(submissionDeps, {
        filePath,
        payload: createPayload,
        payloadHash: await sha256(stableSharePayloadString(createPayload)),
        sourceHash: createPayload.source_hash,
        ownerProductSubjectId: this.docferrySettings.connectedAccount?.productSubjectId ?? ""
      });
      return { ...created, legacyMeta };
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

  private async findUniqueMarkdownFileBySourceHash(sourceHash: string): Promise<TFile | null> {
    const matches: TFile[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const markdown = await this.app.vault.cachedRead(file);
      if (`sha256:${await sha256(markdown)}` !== sourceHash) continue;
      matches.push(file);
      if (matches.length > 1) return null;
    }
    return matches[0] ?? null;
  }

  /** Locates the vault note whose current-service df_id matches the share, wherever it was moved to. */
  private findSharedFileByShareId(shareId: string): TFile | null {
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (this.currentShareMeta(file).id === shareId) return file;
    }
    return null;
  }

  /** Clears a journal entry only after its response is already in frontmatter. */
  private async reconcileCommittedSharePublish(): Promise<void> {
    const pending = this.docferrySettings.pendingSharePublish;
    const shareId = pending?.response?.share_id;
    if (!pending || !shareId || !this.findSharedFileByShareId(shareId)) return;
    await finalizeShareCreate(this.sharePublishSubmissionDeps().store, pending.key);
  }

  private async clearLocalShareMetaForId(shareId: string): Promise<void> {
    const file = this.findSharedFileByShareId(shareId);
    if (file) await clearShareMeta(this.app, file);
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
    const remainingMonthlyJobs = membership
      ? mediaNoteMonthlyJobsRemaining(membership.mediaNoteMonthlyJobsUsed, membership.mediaNoteMonthlyJobLimit)
      : null;
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

    if (remainingMonthlyJobs !== null && remainingMonthlyJobs <= MEDIA_NOTE_LOW_QUOTA_NOTICE_THRESHOLD) {
      // Warn before the job consumes one of the last monthly Advanced Import
      // credits so a low-balance spend is never a surprise.
      new Notice(
        remainingMonthlyJobs === 1
          ? "This will use your last Advanced Import this month."
          : `This will use 1 of your remaining ${remainingMonthlyJobs} Advanced Imports this month.`,
        8000
      );
    }

    onProgress?.("starting");
    const created = await submitMediaNoteJob(
      this.mediaNoteSubmissionDeps(),
      linkNote.url.href,
      ownerProductSubjectId
    );
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
    let job;
    try {
      job = await this.api.cancelMediaNoteJob(pending.jobId);
    } catch (error) {
      if (
        error instanceof ShareApiError &&
        (error.code === "media_note_job_not_found" || error.code === "media_note_job_finished")
      ) {
        // The job is gone server-side (including a terminal job past its
        // TTL-bounded review window) or already finished: there is nothing to
        // cancel, so clear the record instead of blocking.
        await this.clearPendingMediaNoteImport(pending.jobId);
        return;
      }
      throw error;
    }
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
      if (this.unloaded) {
        throw new Error("DocFerry was unloaded before the import finished. It will resume on the next start.");
      }
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
    if (this.docferrySettings.pendingMediaNoteImport?.jobId !== completed.job_id) {
      // The import was cancelled after the job completed: cancel already
      // cleared the pending record, so the review step must not run.
      return null;
    }
    if (!completed.markdown) {
      await this.clearPendingMediaNoteImport(completed.job_id);
      throw new Error(mediaNoteFailureMessage(completed));
    }
    onProgress?.("reviewing");
    if (!(await confirmMediaNoteImport(this.app, completed))) {
      // "Review later" keeps the pending record, so the completed job can be
      // reviewed from the dashboard recovery panel while it lives on the
      // server. Expired jobs are cleared on the next resume attempt.
      new Notice("The note is kept for later review. Resume it from the DocFerry dashboard.", 8000);
      return null;
    }
    if (this.docferrySettings.pendingMediaNoteImport?.jobId !== completed.job_id) {
      // Cancelled while the review dialog was open: the cancel wins over the
      // confirmation and nothing is saved.
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

  private sharePublishSubmissionDeps(): SharePublishSubmissionDeps {
    return {
      store: {
        read: () => this.docferrySettings.pendingSharePublish,
        save: async (record: PendingSharePublish | null) => {
          this.docferrySettings.pendingSharePublish = record;
          await this.saveSettings();
        }
      },
      createShare: (payload, key) => this.api.createShare(payload, key),
      resolveShare: (key) => this.api.resolveShareCreate(key),
      generateKey: () => mediaNoteIdempotencyKey(),
      now: () => new Date().toISOString()
    };
  }

  private mediaNoteSubmissionDeps(): MediaNoteSubmissionDeps {
    return {
      store: {
        read: () => this.docferrySettings.pendingMediaNoteSubmission,
        save: async (record: PendingMediaNoteSubmission | null) => {
          this.docferrySettings.pendingMediaNoteSubmission = record;
          await this.saveSettings();
        }
      },
      createJob: (sourceUrl, key) => this.api.createMediaNoteJob(sourceUrl, key),
      trackImport: async (job, record) => {
        await this.setPendingMediaNoteImport({
          jobId: job.job_id,
          ownerProductSubjectId: record.ownerProductSubjectId,
          sourceUrl: record.sourceUrl,
          createdAt: record.createdAt
        });
      },
      generateKey: () => mediaNoteIdempotencyKey(),
      now: () => new Date().toISOString()
    };
  }

  private async recoverPendingMediaNoteSubmission(): Promise<void> {
    const record = this.docferrySettings.pendingMediaNoteSubmission;
    if (!record || this.mediaNoteRecoveryInFlight || this.docferrySettings.pendingMediaNoteImport) return;
    const owner = this.docferrySettings.connectedAccount?.productSubjectId;
    if (!owner) return;
    if (record.ownerProductSubjectId !== owner) {
      this.docferrySettings.pendingMediaNoteSubmission = null;
      await this.saveSettings();
      return;
    }
    this.mediaNoteRecoveryInFlight = true;
    let recovered: MediaNoteJobResponse | null = null;
    try {
      recovered = await resolvePendingMediaNoteSubmission(this.mediaNoteSubmissionDeps(), record);
    } catch (error) {
      new Notice(this.formatError(error, "Could not resume detailed note"), 8000);
    } finally {
      this.mediaNoteRecoveryInFlight = false;
    }
    if (recovered) await this.resumeActiveMediaImport();
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
      if (error instanceof ShareApiError && error.code === "media_note_job_not_found") {
        // A kept-for-review job expired on the server: clear the record instead
        // of nagging about it on every start.
        await this.clearPendingMediaNoteImport(pending.jobId);
        new Notice("That detailed note expired on the server and was removed from the review queue.", 8000);
      } else {
        new Notice(this.formatError(error, "Could not resume detailed note"), 8000);
      }
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
    const skippedUnsafeRefs: string[] = [];

    for (const ref of refs) {
      // Never upload hidden dotfiles (`.obsidian/...`) or traversal paths, no
      // matter whether the reference resolves inside or outside the vault.
      if (isUnsafeAssetPath(ref.path)) {
        skippedUnsafeRefs.push(ref.path);
        continue;
      }
      const target = this.resolveLinkedFile(ref.path, sourceFile);
      if (target && isUnsafeAssetPath(target.path)) {
        skippedUnsafeRefs.push(ref.path);
        continue;
      }
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

    if (skippedUnsafeRefs.length) {
      const listed = skippedUnsafeRefs.slice(0, 3).join(", ");
      const extra = skippedUnsafeRefs.length > 3 ? ` and ${skippedUnsafeRefs.length - 3} more` : "";
      new Notice(
        `DocFerry skipped ${skippedUnsafeRefs.length} hidden or unsafe asset reference${
          skippedUnsafeRefs.length === 1 ? "" : "s"
        } (never uploaded): ${listed}${extra}.`,
        8000
      );
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
