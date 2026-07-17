export function safeVaultSegment(value: unknown, now = new Date()): string {
  const source = replaceControlCharacters(scalarText(value));
  const name = source
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "");
  const clipped = name.slice(0, 120).trim();
  return clipped || `docferry-import-${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function replaceControlCharacters(value: string): string {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("");
}

function scalarText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return "";
}
