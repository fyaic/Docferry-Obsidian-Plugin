import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

function methodBody(startMarker: string, endMarker: string): string {
  const start = mainSource.indexOf(startMarker);
  const end = mainSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start > -1 && end > start, `${startMarker} .. ${endMarker} must exist in order`);
  return mainSource.slice(start, end);
}

test("deleting share history clears the source note's df_* reference in the same operation", () => {
  const body = methodBody("async deleteShareHistory", "async deleteFolderShareHistory");
  const deleteIndex = body.indexOf("await this.api.deleteShareRecord(share.share_id);");
  const clearIndex = body.indexOf("await this.clearLocalShareMetaForId(share.share_id);");
  assert.ok(deleteIndex > -1 && clearIndex > deleteIndex, "local meta cleanup must follow the record deletion");
});

test("local share meta is located by share id across the vault, not by remembered path", () => {
  const finder = methodBody("private findSharedFileByShareId", "private async clearLocalShareMetaForId");
  assert.match(finder, /this\.app\.vault\.getMarkdownFiles\(\)/);
  assert.match(finder, /this\.currentShareMeta\(file\)\.id === shareId/);
  const clearer = methodBody("private async clearLocalShareMetaForId", "private currentShareMeta");
  assert.match(clearer, /await clearShareMeta\(this\.app, file\)/);
});

test("stop from the dashboard clears local meta even when the note was moved", () => {
  const body = methodBody("async stopShareFromList", "private async loadMembership");
  const stopIndex = body.indexOf("await this.api.deleteShare(share.share_id);");
  const clearIndex = body.indexOf("await this.clearLocalShareMetaForId(share.share_id);");
  assert.ok(stopIndex > -1 && clearIndex > stopIndex, "cleanup must follow the remote stop");
  assert.doesNotMatch(body, /markdownFileByPath/);
});

test("update from the dashboard resolves by share id first and never retargets another share's note", () => {
  const body = methodBody("async updateShareFromList", "async updateFolderShareFromList");
  const byIdIndex = body.indexOf("this.findSharedFileByShareId(share.share_id)");
  const byPathIndex = body.indexOf("this.markdownFileByPath(share.source_path)");
  assert.ok(byIdIndex > -1 && byPathIndex > byIdIndex, "share id lookup must precede the remembered path fallback");
  assert.match(body, /linked to a different share/);
  assert.doesNotMatch(body, /markdownFileByPath\(share\.source_path\) \?\?/);
});

test("copy verifies lifecycle state and never copies a known-dead link", () => {
  const body = methodBody("private async copyShareLink", "private async verifyShareLinkState");
  const verifyIndex = body.indexOf("await this.verifyShareLinkState(meta.id)");
  const copyIndex = body.indexOf("await navigator.clipboard.writeText(meta.url)");
  assert.ok(verifyIndex > -1 && copyIndex > verifyIndex, "verification must precede copying");
  assert.match(body, /linkState === "inactive"/);
  assert.match(body, /await clearShareMeta\(this\.app, file\)/);
  assert.match(body, /dead link was not copied/);

  // A 404 is ambiguous (deleted vs. owned by another account): the local
  // reference must be kept and nothing copied.
  const missingIndex = body.indexOf('linkState === "missing"');
  const inactiveIndex = body.indexOf('linkState === "inactive"');
  assert.ok(missingIndex > -1 && inactiveIndex > missingIndex, "the missing branch must precede the inactive branch");
  const missingBranch = body.slice(missingIndex, inactiveIndex);
  assert.match(missingBranch, /isn't visible to the current account/);
  assert.match(missingBranch, /The local reference was kept/);
  assert.ok(!missingBranch.includes("clearShareMeta"), "a missing share must not clear local metadata");
  assert.ok(!missingBranch.includes("clipboard.writeText"), "a missing share must not be copied");

  const verifyBody = methodBody("private async verifyShareLinkState", "private async updateOrCreateShare");
  assert.match(verifyBody, /await this\.api\.getShareStatus\(shareId\)/);
  assert.match(verifyBody, /hasActiveShareLink\(status\.status\) \? "live" : "inactive"/);
  assert.match(verifyBody, /if \(isStoppedShareError\(error\)\) return "inactive"/);
  assert.match(verifyBody, /if \(isMissingShareError\(error\)\) return "missing"/);
});

test("publish confirms before republishing over an unreachable share and preserves the old reference", () => {
  const body = methodBody("private async publishFileCore", "private async publishFolder");
  assert.match(body, /existingShare = await this\.api\.getShareStatus\(existingMetaId\)/);
  assert.match(body, /if \(!hasActiveShareLink\(existingShare\.status\)\)/);
  assert.match(body, /if \(isMissingShareError\(error\)\)/);
  // Stopped/expired shares still republish silently; only a 404 requires an
  // explicit one-way confirmation that preserves the reference as df_legacy_*.
  assert.match(body, /await confirmUnreachableShareRepublish\(/);
  assert.match(body, /if \(!confirmed\) return;/);
  assert.match(body, /unreachableShareMeta = \{ id: unreachableShareId, url: existing\.url \?\? "" \}/);
  assert.match(body, /existingMetaId = undefined/);
  const preserveIndex = body.indexOf("await preserveLegacyShareMeta(this.app, file, unreachableShareMeta)");
  const writeIndex = body.indexOf("await writeShareMeta(");
  assert.ok(preserveIndex > -1 && writeIndex > preserveIndex, "the unreachable reference must be preserved before df_* is overwritten");
  assert.match(body, /const existingShareId = existingShare\?\.share_id \?\? existingMetaId/);
  assert.match(body, /"share_id" \| "status" \| "password_enabled" \| "expires_at" \| "theme_mode"/);
  // A dashboard update must never retarget a note linked to a different share.
  assert.match(body, /ownShareId && ownShareId !== selectedShare\.share_id/);
});

test("update falls back to a fresh link on both 404 share_not_found and 410 share_stopped", () => {
  const body = methodBody("private async updateOrCreateShare", "private async stopSharing");
  assert.match(body, /!isMissingShareError\(error\) && !isStoppedShareError\(error\)/);
  assert.match(body, /no longer available\. Publishing a new link/);
  assert.match(body, /return this\.api\.createShare\(/);
});

test("legacy migration gating in publishFile is preserved", () => {
  const body = methodBody("private async publishFile", "private async publishFolder");
  assert.match(body, /legacyShareMetaForService\(readShareMeta\(this\.app, file\), this\.docferrySettings\.serverUrl\)/);
  assert.match(body, /await confirmLegacyShareMigration\(/);
  const preserveIndex = body.indexOf("await preserveLegacyShareMeta(this.app, file, legacyMeta)");
  const writeIndex = body.indexOf("await writeShareMeta(");
  assert.ok(preserveIndex > -1 && writeIndex > preserveIndex);
});

test("concurrent publishes of the same path are serialized by an in-flight guard", () => {
  assert.match(mainSource, /private publishInFlight = new Set<string>\(\)/);
  for (const [wrapper, core] of [
    ["private async publishFile(file: TFile", "private async publishFileCore"],
    ["private async publishFolder(folder: TFolder", "private async publishFolderCore"]
  ] as const) {
    const body = methodBody(wrapper, core);
    assert.match(body, /this\.publishInFlight\.has\(/, `${wrapper} must bail out while a publish is in flight`);
    assert.match(body, /already being published/);
    const addIndex = body.indexOf("this.publishInFlight.add(");
    const finallyIndex = body.indexOf("} finally {");
    const deleteIndex = body.indexOf("this.publishInFlight.delete(");
    assert.ok(addIndex > -1 && finallyIndex > addIndex && deleteIndex > finallyIndex, `${wrapper} must release the guard in finally`);
  }
});
