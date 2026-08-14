import type { ExternalLinkProvider } from "./external-import";

export interface MediaNoteRuntimeAvailability {
  enabled: boolean;
  supportedProviders: string[];
}

const REQUIRED_DETAILED_NOTE_PROVIDERS = new Set<ExternalLinkProvider>([
  "bilibili",
  "tiktok",
  "douyin"
]);

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

export function shouldPrepareDetailedNote(
  hasEntitlement: boolean,
  provider: ExternalLinkProvider,
  runtime: MediaNoteRuntimeAvailability
): boolean {
  return hasEntitlement && supportsDetailedNoteProvider(provider, runtime);
}

export function requiresDetailedNoteProvider(provider: ExternalLinkProvider): boolean {
  return REQUIRED_DETAILED_NOTE_PROVIDERS.has(provider);
}

export function hasMediaNoteJobCapacity(used: number, limit: number | null): boolean {
  return limit === null || used < limit;
}
