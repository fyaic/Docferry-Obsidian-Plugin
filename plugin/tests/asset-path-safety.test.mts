import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isUnsafeAssetPath } from "../src/asset-path-safety.ts";

const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

test("hidden dotfile segments are unsafe", () => {
  assert.equal(isUnsafeAssetPath(".obsidian/workspace"), true);
  assert.equal(isUnsafeAssetPath(".obsidian/plugins/docferry/data.json"), true);
  assert.equal(isUnsafeAssetPath("a/.hidden/b.png"), true);
  assert.equal(isUnsafeAssetPath(".trash/note.png"), true);
});

test("path traversal segments are unsafe", () => {
  assert.equal(isUnsafeAssetPath("../outside.png"), true);
  assert.equal(isUnsafeAssetPath("a/../../outside.png"), true);
  assert.equal(isUnsafeAssetPath("..\\outside.png"), true);
});

test("URL-encoded hidden and traversal variants are decoded before the check", () => {
  assert.equal(isUnsafeAssetPath("%2eobsidian/workspace"), true);
  assert.equal(isUnsafeAssetPath("..%2foutside.png"), true);
  assert.equal(isUnsafeAssetPath("%252e%252e%252foutside.png"), true);
  assert.equal(isUnsafeAssetPath("a/%2Ehidden/b.png"), true);
});

test("legit vault-relative paths pass", () => {
  assert.equal(isUnsafeAssetPath("assets/chart.png"), false);
  assert.equal(isUnsafeAssetPath("./assets/chart.png"), false);
  assert.equal(isUnsafeAssetPath("folder/My File 2026.png"), false);
  assert.equal(isUnsafeAssetPath("folder/My%20File.png"), false);
  assert.equal(isUnsafeAssetPath(""), false);
});

test("publish uploads filter hidden and traversal references on raw and resolved paths", () => {
  const uploadBody = mainSource.slice(
    mainSource.indexOf("private async uploadLocalAssets"),
    mainSource.indexOf("private async uploadLocalAsset(")
  );
  const rawFilter = uploadBody.indexOf("isUnsafeAssetPath(ref.path)");
  const resolve = uploadBody.indexOf("this.resolveLinkedFile(ref.path, sourceFile)");
  const resolvedFilter = uploadBody.indexOf("isUnsafeAssetPath(target.path)");
  assert.ok(rawFilter > -1 && rawFilter < resolve, "raw reference must be filtered before vault resolution");
  assert.ok(resolvedFilter > resolve, "resolved target path must be filtered before upload");
  assert.match(uploadBody, /skippedUnsafeRefs/);
  assert.match(uploadBody, /new Notice\(/);
  assert.match(uploadBody, /never uploaded/);
});

test("the HTML snapshot rewriting cannot resurrect a skipped asset", () => {
  // Placeholder rewriting only matches refs against actually-uploaded assets,
  // so a filtered reference can never receive a docferry-asset:// URL.
  const placeholderBody = mainSource.slice(
    mainSource.indexOf("private applyLocalAttachmentPlaceholders"),
    mainSource.indexOf("private extractLocalAssetRefs")
  );
  assert.match(placeholderBody, /attachmentAssets\.find/);
  assert.doesNotMatch(placeholderBody, /isUnsafeAssetPath/);
  assert.match(mainSource, /import \{ isUnsafeAssetPath \} from "\.\/asset-path-safety";/);
});
