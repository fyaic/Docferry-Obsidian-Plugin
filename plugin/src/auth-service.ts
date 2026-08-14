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

export class AuthCompletionError extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
    this.name = "AuthCompletionError";
  }
}

export class AuthService {
  private loginAttempt = 0;

  constructor(
    private readonly api: ShareApiClient,
    private readonly onAccessToken: (token: string, response: AuthExchangeResponse) => Promise<void>,
    private readonly getLoginContext: () => LoginContext,
    private readonly getPendingLogin: () => { state: string; startedAt: string },
    private readonly savePendingLogin: (state: string, startedAt: string) => Promise<void>
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
      const attempt = ++this.loginAttempt;
      await this.savePendingLogin(clientState, new Date().toISOString());
      openExternalUrl(withLoginContext(loginUrl, this.getLoginContext(), options, clientState));
      new Notice(
        options.signup
          ? "Create your Bondie account in the browser, confirm the account, then return to Obsidian."
          : options.promptLogin
          ? "Choose another Bondie account in the browser, confirm it, then return to Obsidian."
          : "Finish signing in in your browser, confirm the account, then return to Obsidian."
      );
      void this.pollPendingLogin(clientState, attempt);
      return true;
    } catch {
      new Notice("Bondie login is not available on this server.");
      return false;
    }
  }

  private async pollPendingLogin(clientState: string, attempt: number): Promise<void> {
    const deadline = Date.now() + 10 * 60 * 1000;
    let transientFailures = 0;
    while (attempt === this.loginAttempt && Date.now() < deadline) {
      await delay(1500);
      if (attempt !== this.loginAttempt) return;
      try {
        const result = await this.api.exchangePendingAuth(clientState);
        if (!("access_token" in result)) continue;
        const tokens = result;
        await this.onAccessToken(tokens.access_token, tokens);
        await this.clearPendingLogin(clientState);
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
        transientFailures += 1;
        if (transientFailures < 3) continue;
        new Notice("DocFerry could not finish login. Check your connection and try again.", 8000);
        return;
      }
    }
    if (attempt === this.loginAttempt) {
      await this.clearPendingLogin(clientState);
      new Notice("Bondie login expired. Start login again.", 8000);
    }
  }

  async resumePendingLogin(showNotice = false): Promise<void> {
    const pending = this.getPendingLogin();
    if (!pending.state) return;
    const startedAt = Date.parse(pending.startedAt);
    if (!Number.isFinite(startedAt) || Date.now() - startedAt >= 10 * 60 * 1000) {
      await this.clearPendingLogin(pending.state);
      if (showNotice) new Notice("Bondie login expired. Start login again.", 8000);
      return;
    }
    const attempt = ++this.loginAttempt;
    if (showNotice) new Notice("Finishing Bondie login...");
    void this.pollPendingLogin(pending.state, attempt);
  }

  private async clearPendingLogin(state: string): Promise<void> {
    if (this.getPendingLogin().state !== state) return;
    await this.savePendingLogin("", "");
  }
}

function withLoginContext(
  loginUrl: string,
  context: LoginContext,
  options: LoginOptions,
  clientState: string
): string {
  const url = new URL(loginUrl);
  url.searchParams.set("client_instance_id", context.clientInstanceId);
  url.searchParams.set("plugin_version", context.pluginVersion);
  url.searchParams.set("platform", context.platform);
  url.searchParams.set("instance_type", "obsidian_plugin");
  url.searchParams.set("client_state", clientState);
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
