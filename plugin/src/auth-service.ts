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

export class AuthService {
  constructor(
    private readonly api: ShareApiClient,
    private readonly onAccessToken: (token: string, response: AuthExchangeResponse) => Promise<void>,
    private readonly getLoginContext: () => LoginContext
  ) {}

  async startLogin(options: LoginOptions = {}): Promise<boolean> {
    try {
      const config = await this.api.getAuthConfig();
      const loginUrl = options.signup ? config.signup_url || signupUrlFromLoginUrl(config.login_url) : config.login_url;
      if (config.provider !== "synapsehub" || !loginUrl) {
        new Notice("Bondie account login is not configured on this server yet.");
        return false;
      }
      openExternalUrl(withLoginContext(loginUrl, this.getLoginContext(), options));
      new Notice(
        options.signup
          ? "Opened Bondie account creation in your browser."
          : options.promptLogin
          ? "Opened Bondie login. Choose the account with your DocFerry access."
          : "Opened Bondie login in your browser."
      );
      return true;
    } catch {
      new Notice("Bondie login is not available on this server.");
      return false;
    }
  }

  async handleProtocolCallback(data: Record<string, string>): Promise<void> {
    if (data.code) {
      try {
        const redirectUri = data.redirect_uri || "obsidian://docferry-auth";
        const tokens = await this.api.exchangeAuthCode(data.code, redirectUri, data.state);
        await this.onAccessToken(tokens.access_token, tokens);
        const displayName = tokens.display_user?.name || tokens.display_user?.email;
        new Notice(displayName ? `Bondie account connected: ${displayName}` : "Bondie account connected.");
      } catch (error) {
        if (error instanceof ShareApiError && error.code === "sso_not_configured") {
          new Notice("Bondie login is not configured on this server yet.");
          return;
        }
        if (error instanceof ShareApiError && error.code === "auth_code_consumed") {
          new Notice("This login link has already been used. Start a new login if DocFerry is not connected.");
          return;
        }
        new Notice("Bondie login token exchange failed.");
      }
      return;
    }
    new Notice("Unsupported login callback.");
  }
}

function withLoginContext(loginUrl: string, context: LoginContext, options: LoginOptions): string {
  const url = new URL(loginUrl);
  url.searchParams.set("client_instance_id", context.clientInstanceId);
  url.searchParams.set("plugin_version", context.pluginVersion);
  url.searchParams.set("platform", context.platform);
  url.searchParams.set("instance_type", context.instanceType);
  if (options.promptLogin) url.searchParams.set("prompt", "login");
  return url.toString();
}

function signupUrlFromLoginUrl(loginUrl: string): string {
  const url = new URL(loginUrl);
  url.pathname = url.pathname.replace(/\/login\/?$/, "/signup");
  return url.toString();
}
