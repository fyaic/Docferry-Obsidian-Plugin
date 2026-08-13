export const DOCFERRY_PRODUCTION_SERVICE_URL = "https://docferry.fuyonder.tech";
export const DOCFERRY_LEGACY_BONDIE_SERVICE_URL = "https://docferry.bondie.io";

export interface ServiceUrlSettings {
  serverUrl: string;
  sessionToken?: string | null;
  connectedAccount?: object | null;
}

export function shouldMigrateLegacyBondieServiceUrl(settings: ServiceUrlSettings): boolean {
  return (
    settings.serverUrl.replace(/\/+$/, "") === DOCFERRY_LEGACY_BONDIE_SERVICE_URL &&
    !settings.sessionToken &&
    !settings.connectedAccount
  );
}
