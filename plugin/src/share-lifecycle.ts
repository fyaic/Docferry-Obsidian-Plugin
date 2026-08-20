/**
 * Share lifecycle error classification for recovery flows. Duck-typed on the
 * ShareApiError shape (`status` + `code`) so this module stays importable by
 * tests without the obsidian-dependent API client.
 */

export function isMissingShareError(error: unknown): boolean {
  return hasStatusAndCode(error, 404, "share_not_found");
}

export function isStoppedShareError(error: unknown): boolean {
  return hasStatusAndCode(error, 410, "share_stopped");
}

export function isExpiredShareError(error: unknown): boolean {
  return hasStatusAndCode(error, 410, "share_expired");
}

export function isInactiveShareError(error: unknown): boolean {
  return isStoppedShareError(error) || isExpiredShareError(error);
}

function hasStatusAndCode(error: unknown, status: number, code: string): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { status?: unknown; code?: unknown };
  return record.status === status && record.code === code;
}
