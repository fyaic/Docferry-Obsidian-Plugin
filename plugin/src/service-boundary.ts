export interface ProductServiceSettings {
  serverUrl: string;
  sessionToken: string;
  connectedAccount: unknown;
  membership: unknown;
  pendingMediaNoteImport: unknown;
  pendingMediaNoteSubmission: unknown;
  pendingSharePublish: unknown;
  pendingServiceBoundaryReset: boolean;
  serviceBoundaryRevision: number;
}

export const CURRENT_SERVICE_BOUNDARY_REVISION = 1;

export function enforceProductionServiceBoundary(
  settings: ProductServiceSettings,
  productionServiceUrl: string
): boolean {
  if (
    settings.serverUrl !== productionServiceUrl ||
    settings.serviceBoundaryRevision !== CURRENT_SERVICE_BOUNDARY_REVISION
  ) {
    settings.serverUrl = productionServiceUrl;
    settings.sessionToken = "";
    settings.connectedAccount = null;
    settings.membership = null;
    settings.pendingMediaNoteImport = null;
    settings.pendingMediaNoteSubmission = null;
    settings.pendingSharePublish = null;
    settings.pendingServiceBoundaryReset = true;
    settings.serviceBoundaryRevision = CURRENT_SERVICE_BOUNDARY_REVISION;
  }
  // The pending login handshake lives in SecretStorage; the caller clears
  // that custody on a boundary reset (loadSettings).
  return settings.pendingServiceBoundaryReset;
}
