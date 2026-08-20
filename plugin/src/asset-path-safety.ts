/**
 * Publish-time path safety for local asset references.
 *
 * A note can reference hidden vault files (`.obsidian/plugins/...`) or escape
 * the vault with `..` segments; publishing must never upload those. Obsidian
 * resolves references after URL-decoding them, so the check runs on the
 * decoded form (bounded repeated decoding catches `%2e`/`%252e` variants).
 */

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * True when a vault-relative asset reference is hidden (any segment starting
 * with `.`, other than a plain `.` current-directory marker) or traverses
 * upward (a `..` segment). Backslashes are treated as separators because
 * Windows notes may contain them.
 */
export function isUnsafeAssetPath(rawPath: string): boolean {
  let decoded = rawPath.trim();
  for (let pass = 0; pass < 3; pass += 1) {
    const next = safeDecode(decoded);
    if (next === decoded) break;
    decoded = next;
  }
  const segments = decoded.replace(/\\/g, "/").split("/");
  return segments.some((segment) => segment === ".." || (segment.length > 1 && segment.startsWith(".")));
}
