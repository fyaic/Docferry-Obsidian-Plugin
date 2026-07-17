import assert from "node:assert/strict";
import test from "node:test";

import { safeVaultSegment } from "../src/vault-filename.ts";

test("normalizes imported note names without control characters or path separators", () => {
  assert.equal(safeVaultSegment("Folder/Line\nBreak: Note"), "Folder-Line Break- Note");
  assert.equal(safeVaultSegment("...Launch..."), "Launch");
  assert.equal(safeVaultSegment("a".repeat(140)).length, 120);
});

test("uses a deterministic timestamp fallback for empty names", () => {
  assert.equal(
    safeVaultSegment("..", new Date("2026-07-14T01:02:03.000Z")),
    "docferry-import-20260714010203"
  );
});
