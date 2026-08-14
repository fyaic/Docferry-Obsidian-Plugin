export function initialExpirySelection(
  existingExpiresAt: string | null | undefined,
  configuredDefault: string
): string {
  return existingExpiresAt ? "keep" : configuredDefault;
}

export function resolveExpirySelection(
  selection: string,
  existingExpiresAt: string | null | undefined,
  now: Date = new Date()
): string | null {
  if (selection === "keep") return existingExpiresAt ?? null;
  if (selection === "never") return null;
  const days = Number(selection);
  if (!Number.isFinite(days) || days <= 0) return null;
  const expires = new Date(now);
  expires.setDate(expires.getDate() + days);
  return expires.toISOString();
}

export function initialThemeStyling(
  canUseThemeStyling: boolean,
  existingThemeMode: "reader" | "full" | null | undefined,
  isUpdate: boolean
): boolean {
  if (!canUseThemeStyling) return false;
  return isUpdate ? existingThemeMode === "full" : true;
}
