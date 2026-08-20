export interface ProductServiceSettings {
  serverUrl: string;
  sessionToken: string;
  connectedAccount: unknown;
  membership: unknown;
  pendingMediaNoteImport: unknown;
  pendingMediaNoteSubmission: unknown;
  pendingSharePublish: unknown;
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
  settings.pendingMediaNoteSubmission = null;
  settings.pendingSharePublish = null;
  // The pending login handshake lives in SecretStorage; the caller clears
  // that custody on a boundary reset (loadSettings).
  return true;
}
