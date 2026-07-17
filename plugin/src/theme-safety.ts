export function sanitizeSelectorForMatch(selector: string): string | null {
  const sanitized = selector
    .replace(/::[a-zA-Z-]+(\([^)]*\))?/g, "")
    .replace(/:(hover|active|focus|focus-visible|focus-within|visited|link|target)/g, "")
    .trim();
  return sanitized || null;
}

export function sanitizeCssRule(cssText: string): string | null {
  const trimmed = cssText.trim();
  if (!trimmed || /url\s*\(/i.test(trimmed) || /@import\b/i.test(trimmed)) return null;
  if (/expression\s*\(|-moz-binding\s*:/i.test(trimmed)) return null;
  return cssText;
}

export function isRemoteUrl(value: string): boolean {
  return /^(?:https?:)?\/\//i.test(value) || /^(?:data|blob):/i.test(value);
}
