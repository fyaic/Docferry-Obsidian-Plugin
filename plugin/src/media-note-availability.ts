import type { ExternalLinkProvider } from "./external-import";

export interface MediaNoteRuntimeAvailability {
  enabled: boolean;
  supportedProviders: string[];
}

export function canUseMediaNote(
  hasEntitlement: boolean,
  runtime: MediaNoteRuntimeAvailability
): boolean {
  return hasEntitlement && runtime.enabled && runtime.supportedProviders.length > 0;
}

export function supportsDetailedNoteProvider(
  provider: ExternalLinkProvider,
  runtime: MediaNoteRuntimeAvailability
): boolean {
  return runtime.enabled && runtime.supportedProviders.includes(provider);
}
