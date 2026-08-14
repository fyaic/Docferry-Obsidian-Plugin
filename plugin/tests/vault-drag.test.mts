import assert from "node:assert/strict";
import test from "node:test";

import { normalizeVaultPathCandidate, resolveVaultDragPath } from "../src/vault-drag.ts";

const knownPaths = new Set(["Projects/Launch.md", "Projects/Folder"]);
const exists = (path: string) => knownPaths.has(path);

test("prefers the active Obsidian vault drag path", () => {
  assert.equal(resolveVaultDragPath("Projects/Launch.md", "https://example.com", exists), "Projects/Launch.md");
});

test("accepts plain paths and Obsidian open URIs", () => {
  assert.equal(resolveVaultDragPath(null, "/Projects/Folder", exists), "Projects/Folder");
  assert.equal(
    resolveVaultDragPath(null, "obsidian://open?vault=Test&file=Projects%2FLaunch.md", exists),
    "Projects/Launch.md"
  );
});

test("rejects external URLs, traversal, control characters, and missing paths", () => {
  assert.equal(normalizeVaultPathCandidate("https://example.com/note.md"), null);
  assert.equal(normalizeVaultPathCandidate("../Private.md"), null);
  assert.equal(normalizeVaultPathCandidate("Projects/Bad\nName.md"), null);
  assert.equal(resolveVaultDragPath(null, "Projects/Missing.md", exists), null);
});
