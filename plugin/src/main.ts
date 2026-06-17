import { MarkdownRenderer, MarkdownView, Notice, Plugin, TFile, normalizePath } from "obsidian";
import { ShareApiClient, ShareApiError } from "./api-client";
import { clearShareMeta, readShareMeta, writeShareMeta } from "./frontmatter";
import { ImportShareModal, type ImportShareOptions } from "./import-share-modal";
import { LinkStatusModal } from "./link-status-modal";
import {
  DEFAULT_SETTINGS,
  DocferrySettingTab,
  isCloudEndpointConfigured,
  normalizeSettings,
  type DocferrySettings,
  type ImageUploadQuality
} from "./settings";
import { ResultModal } from "./result-modal";
import { ShareModal } from "./share-modal";
import type { PublishOptions, ShareImportAsset, SharePayload, ShareResponse } from "./types";

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
  qualityMode: ImageUploadQuality;
}

interface UploadedCssAsset {
  assetId: string;
}

interface HtmlSnapshotResult {
  html: string;
  css: string | null;
}

interface OutboundLink {
  raw_target: string;
  target_path?: string | null;
  target_doc_identity?: string | null;
  target_subpath?: string | null;
  label?: string | null;
  link_kind: "wiki" | "markdown_relative" | "embed";
}

const THEME_CSS_FILENAME = "docferry-obsidian-theme-snapshot.css";
const MAX_THEME_CSS_BYTES = 256 * 1024;
const ASSET_UPLOAD_CONCURRENCY = 3;
const IMAGE_OPTIMIZATION_ENABLED = false;
const IMAGE_QUALITY_PRESETS: Record<ImageUploadQuality, { maxDimension: number | null; quality: number | null }> = {
  original: { maxDimension: null, quality: null },
  high: { maxDimension: 2560, quality: 0.92 },
  standard: { maxDimension: 1600, quality: 0.82 }
};

export default class DocferryPlugin extends Plugin {
  settings!: DocferrySettings;
  private api!: ShareApiClient;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.api = new ShareApiClient(() => this.settings, this.manifest.version);

    this.addSettingTab(new DocferrySettingTab(this.app, this));
    this.registerObsidianProtocolHandler("docferry", async (data) => {
      const params = data as Record<string, string>;
      if (params.action === "import" && params.url) {
        await this.importShareUrl(params.url);
        return;
      }
      new Notice("Unsupported DocFerry callback.");
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
        const meta = readShareMeta(this.app, file);
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
        const meta = readShareMeta(this.app, file);
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

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        const meta = readShareMeta(this.app, file);
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
              .setIcon("trash-2")
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
  }

  async loadSettings(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async testConnection(): Promise<void> {
    if (this.settings.serviceMode === "cloud" && !isCloudEndpointConfigured()) {
      new Notice("DocFerry Cloud is unavailable in this build. Switch to Custom server for now.");
      return;
    }

    try {
      const health = await this.api.health();
      if (!this.settings.apiToken) {
        const tokenName = this.settings.serviceMode === "cloud" ? "Cloud token" : "server token";
        new Notice(`Connected to ${health.service} ${health.version}, but ${tokenName} is not configured.`);
        return;
      }
      if (this.settings.serviceMode === "cloud") {
        const account = await this.api.getAccount();
        const remaining = account.account.remaining_active_shares;
        const quota =
          remaining === null || remaining === undefined
            ? `${account.account.active_shares}/${account.account.active_share_limit}`
            : `${account.account.active_shares}/${account.account.active_share_limit} (${remaining} remaining)`;
        new Notice(`Connected to ${health.service} ${health.version}. Active shares: ${quota}.`);
        return;
      }

      try {
        const account = await this.api.getAccount();
        new Notice(`Connected to ${health.service} ${health.version}. Active shares: ${account.account.active_shares}.`);
      } catch (error) {
        if (error instanceof ShareApiError && error.status === 404) {
          await this.api.validateAuthToken();
          new Notice(`Connected to ${health.service} ${health.version}. Server token is valid.`);
          return;
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof ShareApiError && error.status === 401) {
        const tokenName = this.settings.serviceMode === "cloud" ? "Cloud token" : "server token";
        new Notice(`Server is reachable, but the ${tokenName} is invalid.`);
        return;
      }
      new Notice(this.formatError(error, "Connection failed"));
    }
  }

  private getActiveMarkdownFile(): TFile | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view?.file instanceof TFile && view.file.extension === "md") return view.file;
    const file = this.app.workspace.getActiveFile();
    return file instanceof TFile && file.extension === "md" ? file : null;
  }

  private async publishFile(file: TFile): Promise<void> {
    if (this.settings.serviceMode === "cloud" && !isCloudEndpointConfigured()) {
      new Notice("DocFerry Cloud is unavailable in this build. Switch to Custom server for now.");
      return;
    }

    if (this.settings.serviceMode === "custom" && !this.settings.serverUrl) {
      new Notice("Configure a custom server URL first.");
      return;
    }

    if (!this.settings.apiToken) {
      const tokenName = this.settings.serviceMode === "cloud" ? "DocFerry Cloud token" : "custom server token";
      new Notice(`Configure your ${tokenName} first.`);
      return;
    }

    const existing = readShareMeta(this.app, file);
    const title = this.resolveTitle(file);
    const modal = new ShareModal(this.app, {
      title,
      passwordEnabled: existing.passwordEnabled ?? this.settings.defaultPasswordEnabled,
      expiresInDays: this.settings.defaultExpiresInDays,
      isUpdate: !!existing.id
    });
    const options = await modal.openAndGetResult();
    if (!options) return;

    const notice = new Notice(existing.id ? "Updating share link..." : "Publishing share link...", 0);
    try {
      const payload = await this.buildPayload(file, options.title, options, !!existing.id, (message) => {
        notice.setMessage(message);
      });
      notice.setMessage(existing.id ? "Updating share link..." : "Publishing share link...");
      const response = existing.id
        ? await this.updateOrCreateShare(existing.id, payload, notice)
        : await this.api.createShare(payload);

      await writeShareMeta(this.app, file, response, {
        passwordEnabled: options.passwordEnabled,
        expiresAt: options.expiresAt
      });
      await navigator.clipboard.writeText(response.url);
      notice.hide();
      new Notice("Share link copied");
      new ResultModal(this.app, options.title, response.url, response.updated_at).open();
      this.debug("publish response", response);
    } catch (error) {
      notice.hide();
      new Notice(this.formatError(error, "Publish failed"));
      this.debug("publish error", error);
    }
  }

  private async copyShareLink(file: TFile): Promise<void> {
    const meta = readShareMeta(this.app, file);
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
    const meta = readShareMeta(this.app, file);
    if (!meta.id) {
      new Notice("This note has not been shared.");
      return;
    }
    try {
      await this.api.deleteShare(meta.id);
      await clearShareMeta(this.app, file);
      new Notice("Sharing stopped");
    } catch (error) {
      new Notice(this.formatError(error, "Stop sharing failed"));
    }
  }

  private async showLinkStatus(file: TFile): Promise<void> {
    const meta = readShareMeta(this.app, file);
    if (!meta.id) {
      new Notice("This note has not been shared.");
      return;
    }
    try {
      const response = await this.api.getShareLinks(meta.id);
      new LinkStatusModal(this.app, file.basename, response).open();
    } catch (error) {
      new Notice(this.formatError(error, "Link status failed"));
    }
  }

  private async importShareUrl(initialUrl = ""): Promise<void> {
    const options = await new ImportShareModal(this.app, initialUrl).openAndGetResult();
    if (!options) return;

    const notice = new Notice("Importing share...", 0);
    try {
      const session = await this.api.getShareImportPayload(options.url, options.password);
      const notePath = await this.writeImportedMarkdown(session.payload.title, session.payload.markdown, options);
      const importedAssets = await this.importShareAssets(
        session.payload.assets,
        options.outputFolder,
        options.overwrite,
        notePath,
        session.cookieHeader
      );
      notice.hide();
      new Notice(`Imported ${session.payload.title}${importedAssets ? ` with ${importedAssets} assets` : ""}`);
      const file = this.app.vault.getAbstractFileByPath(notePath);
      if (file instanceof TFile) {
        await this.app.workspace.getLeaf(true).openFile(file);
      }
    } catch (error) {
      notice.hide();
      new Notice(this.formatError(error, "Import failed"));
    }
  }

  private async writeImportedMarkdown(
    title: string,
    markdown: string,
    options: ImportShareOptions
  ): Promise<string> {
    const notePath = normalizePath(`${options.outputFolder}/${safeVaultSegment(title)}.md`);
    await this.ensureParentFolder(notePath);
    const existing = this.app.vault.getAbstractFileByPath(notePath);
    if (existing instanceof TFile) {
      if (!options.overwrite) throw new Error(`File already exists: ${notePath}`);
      await this.app.vault.modify(existing, markdown);
      return notePath;
    }
    if (await this.app.vault.adapter.exists(notePath)) {
      if (!options.overwrite) throw new Error(`File already exists: ${notePath}`);
      await this.app.vault.adapter.write(notePath, markdown);
      return notePath;
    }
    await this.app.vault.create(notePath, markdown);
    return notePath;
  }

  private async importShareAssets(
    assets: ShareImportAsset[],
    outputFolder: string,
    overwrite: boolean,
    notePath: string,
    cookieHeader?: string
  ): Promise<number> {
    let imported = 0;
    for (const asset of assets) {
      let assetPath = normalizePath(`${outputFolder}/${assetOutputRelativePath(asset)}`);
      if (assetPath === notePath) {
        assetPath = normalizePath(`${outputFolder}/attachments/${safeVaultSegment(asset.filename || asset.asset_id)}`);
      }
      if ((await this.app.vault.adapter.exists(assetPath)) && !overwrite) {
        throw new Error(`Asset already exists: ${assetPath}`);
      }
      const body = await this.api.downloadImportAsset(asset.url, cookieHeader);
      await this.ensureParentFolder(assetPath);
      await this.app.vault.adapter.writeBinary(assetPath, body);
      imported += 1;
    }
    return imported;
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
    const snapshot = await this.renderHtmlSnapshot(file, markdown, localAssets);
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
      css_asset_id: cssAsset?.assetId ?? null,
      assets: linkedAssets,
      outbound_links: outboundLinks,
      password: options.password,
      password_mode: isUpdate ? this.resolvePasswordMode(options) : undefined,
      expires_at: options.expiresAt ?? null,
      client: {
        plugin_id: this.manifest.id,
        plugin_version: this.manifest.version,
        obsidian_version: getObsidianVersion(this.app)
      }
    };
  }

  private async renderHtmlSnapshot(
    file: TFile,
    markdown: string,
    localAssets: UploadedLocalAssets
  ): Promise<HtmlSnapshotResult | null> {
    const container = document.createElement("div");
    container.className = "markdown-preview-view markdown-rendered docferry-snapshot-source";
    container.style.position = "fixed";
    container.style.left = "-10000px";
    container.style.top = "0";
    container.style.width = "860px";
    container.style.pointerEvents = "none";
    container.style.visibility = "hidden";
    document.body.appendChild(container);

    try {
      await MarkdownRenderer.render(this.app, markdown, container, file.path, this);
      await sleep(150);
      this.applyLocalImageAssetPlaceholders(container, localAssets.imageAssets);
      this.applyLocalAttachmentPlaceholders(container, localAssets.linkedAssets);
      container.querySelectorAll("script").forEach((element) => element.remove());
      const css = this.captureThemeCss(container);
      return {
        html: container.innerHTML,
        css
      };
    } catch (error) {
      this.debug("html snapshot failed", error);
      return null;
    } finally {
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
    const prepared = await this.prepareAssetUpload(asset.target, buffer, asset.contentType, asset.role);
    const contentHash = `sha256:${await sha256Bytes(prepared.data)}`;
    const response = await this.api.uploadAsset(prepared.data, prepared.filename, prepared.contentType, contentHash);
    this.debug("asset uploaded", {
      path: asset.target.path,
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

  private async prepareAssetUpload(
    target: TFile,
    buffer: ArrayBuffer,
    contentType: string,
    role: UploadedLocalAsset["role"]
  ): Promise<PreparedAssetUpload> {
    const qualityMode = IMAGE_OPTIMIZATION_ENABLED
      ? this.settings.imageUploadQuality ?? DEFAULT_SETTINGS.imageUploadQuality
      : "original";
    if (role !== "image" || qualityMode === "original" || contentType === "image/gif") {
      return { data: buffer, filename: target.name, contentType, qualityMode: "original" };
    }

    try {
      const optimized = await optimizeImageAsset(buffer, contentType, qualityMode);
      if (!optimized || optimized.byteLength >= buffer.byteLength) {
        return { data: buffer, filename: target.name, contentType, qualityMode: "original" };
      }
      return { data: optimized, filename: target.name, contentType, qualityMode };
    } catch (error) {
      this.debug("image optimization failed; uploading original", { path: target.path, error });
      return { data: buffer, filename: target.name, contentType, qualityMode: "original" };
    }
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

  private captureThemeCss(container: HTMLElement): string | null {
    const chunks: string[] = [];
    const push = (cssText: string): boolean => {
      const sanitized = sanitizeCssRule(cssText);
      if (!sanitized) return false;
      const currentBytes = new TextEncoder().encode(chunks.join("\n")).byteLength;
      const nextBytes = new TextEncoder().encode(sanitized).byteLength;
      if (currentBytes + nextBytes > MAX_THEME_CSS_BYTES) return false;
      chunks.push(sanitized);
      return true;
    };

    const variables = collectThemeVariables();
    if (variables) push(variables);

    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch (_error) {
        continue;
      }
      collectMatchingRules(rules, container, push);
    }

    return chunks.length ? chunks.join("\n\n") : null;
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
    if (error instanceof ShareApiError && error.code === "share_quota_exceeded") {
      return `${fallback}: You have reached the 10 active shares included with DocFerry Cloud. Stop an existing share or switch to a custom server.`;
    }
    if (error instanceof ShareApiError) return `${fallback}: ${error.message}`;
    if (error instanceof Error) return `${fallback}: ${error.message}`;
    return fallback;
  }

  private debug(message: string, value: unknown): void {
    if (!this.settings.debug) return;
    console.debug(`[docferry] ${message}`, value);
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
  const originalPath = (asset.original_path || "").split("#", 1)[0].split("?", 1)[0].replace(/\\/g, "/").trim();
  const parts = originalPath
    ? originalPath
        .split("/")
        .filter((part) => part && part !== "." && part !== "..")
        .map((part) => safeVaultSegment(part))
    : [];
  if (parts.length) return parts.join("/");
  return `attachments/${safeVaultSegment(asset.filename || asset.asset_id || "attachment")}`;
}

function safeVaultSegment(value: string): string {
  const name = value.replace(/[\\/:*?"<>|]+/g, "-").trim().replace(/^\.+|\.+$/g, "");
  const clipped = name.slice(0, 120).trim();
  return clipped || `docferry-import-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
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

function collectThemeVariables(): string | null {
  const rootVars = customPropertiesFor(document.documentElement);
  const bodyVars = customPropertiesFor(document.body);
  const rootBlock = rootVars.length ? `:root {\n${rootVars.join("\n")}\n}` : "";
  const bodyBlock = bodyVars.length ? `.reader-page {\n${bodyVars.join("\n")}\n}` : "";
  return [rootBlock, bodyBlock].filter(Boolean).join("\n\n") || null;
}

function customPropertiesFor(element: Element): string[] {
  const style = getComputedStyle(element);
  const properties: string[] = [];
  for (let index = 0; index < style.length; index += 1) {
    const name = style.item(index);
    if (!name.startsWith("--")) continue;
    const value = style.getPropertyValue(name).trim();
    if (!value || /url\(/i.test(value)) continue;
    properties.push(`  ${name}: ${value};`);
  }
  return properties.sort();
}

function collectMatchingRules(
  rules: CSSRuleList,
  container: HTMLElement,
  push: (cssText: string) => boolean
): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      if (selectorMatchesContainer(rule.selectorText, container)) push(rule.cssText);
      continue;
    }
    if (rule instanceof CSSMediaRule) {
      const nested: string[] = [];
      collectMatchingRules(rule.cssRules, container, (cssText) => {
        nested.push(cssText);
        return true;
      });
      if (nested.length) push(`@media ${rule.conditionText} {\n${nested.join("\n")}\n}`);
    }
  }
}

function selectorMatchesContainer(selectorText: string, container: HTMLElement): boolean {
  return selectorText
    .split(",")
    .map((selector) => sanitizeSelectorForMatch(selector))
    .filter((selector): selector is string => Boolean(selector))
    .some((selector) => {
      try {
        return container.matches(selector) || Boolean(container.querySelector(selector));
      } catch (_error) {
        return false;
      }
    });
}

function sanitizeSelectorForMatch(selector: string): string | null {
  const sanitized = selector
    .replace(/::[a-zA-Z-]+(\([^)]*\))?/g, "")
    .replace(/:(hover|active|focus|focus-visible|focus-within|visited|link|target)/g, "")
    .trim();
  return sanitized || null;
}

function sanitizeCssRule(cssText: string): string | null {
  if (!cssText.trim() || /url\(/i.test(cssText)) return null;
  return cssText;
}

function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.startsWith("data:");
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

async function optimizeImageAsset(
  buffer: ArrayBuffer,
  contentType: string,
  qualityMode: ImageUploadQuality
): Promise<ArrayBuffer | null> {
  const preset = IMAGE_QUALITY_PRESETS[qualityMode];
  if (!preset.maxDimension || !preset.quality) return null;
  if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) return null;
  if (typeof createImageBitmap !== "function") return null;

  const bitmap = await createImageBitmap(new Blob([buffer], { type: contentType }));
  try {
    const scale = Math.min(1, preset.maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = qualityMode === "high" ? "high" : "medium";
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, contentType, contentType === "image/png" ? undefined : preset.quality);
    return await blob.arrayBuffer();
  } finally {
    bitmap.close();
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, contentType: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Canvas image export failed."));
          return;
        }
        resolve(blob);
      },
      contentType,
      quality
    );
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
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
  return results;
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
