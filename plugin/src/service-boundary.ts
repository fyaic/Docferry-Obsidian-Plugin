export interface ProductServiceSettings {
  serverUrl: string;
  sessionToken: string;
  connectedAccount: unknown;
  membership: unknown;
  pendingMediaNoteImport: unknown;
  pendingAuthState: string;
  pendingAuthStartedAt: string;
}

export function enforceProductionServiceBoundary(
  settings: ProductServiceSettings,
  productionServiceUrl: string
): boolean {
  if (settings.serverUrl === productionServiceUrl) return false;

  settings.serverUrl = productionServiceUrl;
  settings.sessionToken = "";
  settings.connectedAccount = null;
  settings.membership = null;
  settings.pendingMediaNoteImport = null;
  settings.pendingAuthState = "";
  settings.pendingAuthStartedAt = "";
  return true;
}
