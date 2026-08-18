import { Notice } from "obsidian";
import { ShareApiError } from "./api-client";
import type { ShareApiClient } from "./api-client";
import { openExternalUrl } from "./external-links";
import type { AuthExchangeResponse } from "./types";

export interface LoginContext {
  clientInstanceId: string;
  pluginVersion: string;
  platform: string;
  instanceType: string;
}

export interface LoginOptions {
  promptLogin?: boolean;
  signup?: boolean;
}

export interface PendingLogin {
  state: string;
  startedAt: string;
  verifier: string;
}

export class AuthCompletionError extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
    this.name = "AuthCompletionError";
  }
}

const TERMINAL_EXCHANGE_CODES = new Set([
  "pkce_required",
  "code_verifier_required",
  "invalid_code_verifier",
  "invalid_client_state"
]);

/** Mirrors the loadSettings wording for a local SecretStorage failure. */
const SECURE_STORAGE_UNAVAILABLE_MESSAGE =
  "DocFerry could not access secure credential storage. Update Obsidian, then sign in again.";

export class AuthService {
  private loginAttempt = 0;
  private disposed = false;

  constructor(
    private readonly api: ShareApiClient,
    private readonly onAccessToken: (token: string, response: AuthExchangeResponse) => Promise<void>,
    private readonly getLoginContext: () => LoginContext,
    private readonly getPendingLogin: () => PendingLogin,
    private readonly savePendingLogin: (state: string, startedAt: string, verifier: string) => Promise<void>
  ) {}

  async startLogin(options: LoginOptions = {}): Promise<boolean> {
    try {
      const config = await this.api.getAuthConfig();
      const loginUrl = options.signup ? config.signup_url || signupUrlFromLoginUrl(config.login_url) : config.login_url;
      if (config.provider !== "synapsehub" || !loginUrl) {
        new Notice("Bondie account login is not configured on this server yet.");
        return false;
      }
      const clientState = createClientState();
      const codeVerifier = createCodeVerifier();
      const codeChallenge = await createCodeChallenge(codeVerifier);
      const attempt = ++this.loginAttempt;
      try {
        await this.savePendingLogin(clientState, new Date().toISOString(), codeVerifier);
      } catch {
        // A local secure-storage failure is not a server problem: fail closed
        // with an accurate notice instead of starting a login whose verifier
        // was never persisted.
        new Notice(SECURE_STORAGE_UNAVAILABLE_MESSAGE, 8000);
        return false;
      }
      const opened = await openExternalUrl(withLoginContext(loginUrl, this.getLoginContext(), options, clientState, codeChallenge));
      if (!opened) {
        // The browser never opened: drop the pending handoff and report
        // failure so callers keep the current session intact.
        await this.clearPendingLogin(clientState);
        return false;
      }
      new Notice(
        options.signup
          ? "Create your Bondie account in the browser, confirm the account, then return to Obsidian."
          : options.promptLogin
          ? "Choose another Bondie account in the browser, confirm it, then return to Obsidian."
          : "Finish signing in in your browser, confirm the account, then return to Obsidian."
      );
      void this.pollPendingLogin(clientState, codeVerifier, attempt);
      return true;
    } catch {
      new Notice("Bondie login is not available on this server.");
      return false;
    }
  }

  /** Stops any in-flight login polling; called when the plugin unloads. */
  dispose(): void {
    this.disposed = true;
    this.loginAttempt++;
  }

  /**
   * Invalidates any in-flight login poll and clears the pending handshake, so
   * a disconnect cannot be silently undone by a browser confirmation that
   * completes later. Safe to call while a new login is not yet started.
   */
  async cancelPendingLogin(): Promise<void> {
    this.loginAttempt++;
    if (this.getPendingLogin().state) await this.savePendingLogin("", "", "");
  }

  private async pollPendingLogin(clientState: string, codeVerifier: string, attempt: number): Promise<void> {
    const deadline = Date.now() + 10 * 60 * 1000;
    let transientFailures = 0;
    while (!this.disposed && attempt === this.loginAttempt && Date.now() < deadline) {
      await delay(1500);
      if (this.disposed || attempt !== this.loginAttempt) return;
      try {
        const result = await this.api.exchangePendingAuth(clientState, codeVerifier);
        // The exchange may resolve after dispose(): never adopt a session or
        // clear the pending handshake for a dead attempt.
        if (this.disposed || attempt !== this.loginAttempt) return;
        if (!("access_token" in result)) continue;
        const tokens = result;
        await this.onAccessToken(tokens.access_token, tokens);
        if (this.disposed || attempt !== this.loginAttempt) return;
        await this.clearPendingLoginSafely(clientState);
        if (attempt !== this.loginAttempt) return;
        const displayName = tokens.display_user?.name || tokens.display_user?.email;
        new Notice(displayName ? `Bondie account connected: ${displayName}` : "Bondie account connected.");
        return;
      } catch (error) {
        if (error instanceof AuthCompletionError) {
          new Notice(error.userMessage, 8000);
          return;
        }
        if (error instanceof ShareApiError && error.code === "auth_code_expired") {
          new Notice("Bondie login expired. Start login again.", 8000);
          return;
        }
        if (error instanceof ShareApiError && error.code && TERMINAL_EXCHANGE_CODES.has(error.code)) {
          await this.clearPendingLoginSafely(clientState);
          new Notice(
            error.code === "pkce_required"
              ? "This server requires a newer DocFerry login. Update the plugin, then start login again."
              : "Bondie login could not be completed. Start login again.",
            8000
          );
          return;
        }
        transientFailures += 1;
        if (transientFailures < 3) continue;
        new Notice("DocFerry could not finish login. Check your connection and try again.", 8000);
        return;
      }
    }
    if (!this.disposed && attempt === this.loginAttempt) {
      await this.clearPendingLoginSafely(clientState);
      new Notice("Bondie login expired. Start login again.", 8000);
    }
  }

  async resumePendingLogin(showNotice = false): Promise<void> {
    let pending: PendingLogin;
    try {
      pending = this.getPendingLogin();
    } catch {
      // The handshake cannot even be read: fail closed with an accurate
      // notice instead of an unhandled rejection from the load path.
      new Notice(SECURE_STORAGE_UNAVAILABLE_MESSAGE, 8000);
      return;
    }
    if (!pending.state) return;
    const startedAt = Date.parse(pending.startedAt);
    if (!Number.isFinite(startedAt) || Date.now() - startedAt >= 10 * 60 * 1000 || !pending.verifier) {
      await this.clearPendingLoginSafely(pending.state);
      if (showNotice) new Notice("Bondie login expired. Start login again.", 8000);
      return;
    }
    const attempt = ++this.loginAttempt;
    if (showNotice) new Notice("Finishing Bondie login...");
    void this.pollPendingLogin(pending.state, pending.verifier, attempt);
  }

  private async clearPendingLoginSafely(state: string): Promise<void> {
    try {
      await this.clearPendingLogin(state);
    } catch {
      // Secure storage is unavailable: the stale handshake stays unreadable
      // for new exchanges because every read path fails closed the same way.
      new Notice(SECURE_STORAGE_UNAVAILABLE_MESSAGE, 8000);
    }
  }

  private async clearPendingLogin(state: string): Promise<void> {
    if (this.getPendingLogin().state !== state) return;
    await this.savePendingLogin("", "", "");
  }
}

function withLoginContext(
  loginUrl: string,
  context: LoginContext,
  options: LoginOptions,
  clientState: string,
  codeChallenge: string
): string {
  const url = new URL(loginUrl);
  url.searchParams.set("client_instance_id", context.clientInstanceId);
  url.searchParams.set("plugin_version", context.pluginVersion);
  url.searchParams.set("platform", context.platform);
  url.searchParams.set("instance_type", "obsidian_plugin");
  url.searchParams.set("client_state", clientState);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (options.promptLogin) url.searchParams.set("prompt", "login");
  return url.toString();
}

function signupUrlFromLoginUrl(loginUrl: string): string {
  const url = new URL(loginUrl);
  url.pathname = url.pathname.replace(/\/login\/?$/, "/signup");
  return url.toString();
}

function createClientState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function createCodeVerifier(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
