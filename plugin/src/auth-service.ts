import { Notice } from "obsidian";
import { ShareApiError } from "./api-client";
import type { ShareApiClient } from "./api-client";
import type { AuthExchangeResponse } from "./types";

export interface LoginContext {
  clientInstanceId: string;
  pluginVersion: string;
  platform: string;
  instanceType: string;
}

export class AuthService {
  constructor(
    private readonly api: ShareApiClient,
    private readonly onAccessToken: (token: string, response: AuthExchangeResponse) => Promise<void>,
    private readonly getLoginContext: () => LoginContext
  ) {}

  async startLogin(): Promise<void> {
    try {
      const config = await this.api.getAuthConfig();
      if (config.provider !== "synapsehub" || !config.login_url) {
        new Notice("Fuyonder account login is not configured on this server yet.");
        return;
      }
      window.open(withLoginContext(config.login_url, this.getLoginContext()));
      new Notice("Opened Fuyonder login in your browser.");
    } catch {
      new Notice("Fuyonder login is not available on this server.");
    }
  }

  async handleProtocolCallback(data: Record<string, string>): Promise<void> {
    if (data.code) {
      try {
        const redirectUri = data.redirect_uri || "obsidian://docferry-auth";
        const tokens = await this.api.exchangeAuthCode(data.code, redirectUri, data.state);
        await this.onAccessToken(tokens.access_token, tokens);
        const displayName = tokens.display_user?.name || tokens.display_user?.email;
        new Notice(displayName ? `Fuyonder account connected: ${displayName}` : "Fuyonder account connected.");
      } catch (error) {
        if (error instanceof ShareApiError && error.code === "sso_not_configured") {
          new Notice("Fuyonder login is not configured on this server yet.");
          return;
        }
        new Notice("Fuyonder login token exchange failed.");
      }
      return;
    }
    new Notice("Unsupported login callback.");
  }
}

function withLoginContext(loginUrl: string, context: LoginContext): string {
  const url = new URL(loginUrl);
  url.searchParams.set("client_instance_id", context.clientInstanceId);
  url.searchParams.set("plugin_version", context.pluginVersion);
  url.searchParams.set("platform", context.platform);
  url.searchParams.set("instance_type", context.instanceType);
  url.searchParams.set("prompt", "login");
  return url.toString();
}
