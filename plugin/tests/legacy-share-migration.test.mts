import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const frontmatterSource = readFileSync(new URL("../src/frontmatter.ts", import.meta.url), "utf8");
const confirmModalSource = readFileSync(new URL("../src/confirm-stop-modal.ts", import.meta.url), "utf8");

const publishFileBody = mainSource.slice(
  mainSource.indexOf("private async publishFile"),
  mainSource.indexOf("private async publishFolder")
);

test("publishFile reads raw share meta and gates on legacy migration before any membership work", () => {
  assert.match(publishFileBody, /legacyShareMetaForService\(readShareMeta\(this\.app, file\), this\.docferrySettings\.serverUrl\)/);
  assert.match(publishFileBody, /await confirmLegacyShareMigration\(/);
  assert.match(publishFileBody, /if \(!migrationConfirmed\) return;/);

  const detectIndex = publishFileBody.indexOf("legacyShareMetaForService(");
  const modalIndex = publishFileBody.indexOf("await confirmLegacyShareMigration(");
  assert.ok(detectIndex > -1 && modalIndex > detectIndex, "detection must precede the migration modal");
  for (const laterStep of ["showUploadNoticeIfNeeded(true)", "await this.loadMembership(true)", "createShare(payload)"]) {
    const stepIndex = publishFileBody.indexOf(laterStep);
    assert.ok(stepIndex > modalIndex, `${laterStep} must run only after the migration decision`);
  }
});

test("publishFile preserves the legacy reference before overwriting share meta", () => {
  const preserveIndex = publishFileBody.indexOf("await preserveLegacyShareMeta(this.app, file, legacyMeta)");
  const writeIndex = publishFileBody.indexOf("await writeShareMeta(");
  assert.ok(preserveIndex > -1, "legacy meta must be preserved on successful publish");
  assert.ok(writeIndex > preserveIndex, "preservation must happen before writeShareMeta overwrites df_id/df_url");
});

test("frontmatter preservation writes df_legacy fields through the pure field-mapping helper", () => {
  assert.match(frontmatterSource, /export async function preserveLegacyShareMeta\(/);
  assert.match(frontmatterSource, /legacyFrontmatterFields\(frontmatter, legacy\)/);
  assert.match(frontmatterSource, /processFrontMatter/);
});

test("migration modal presents an explicit one-way decision and shows the legacy link", () => {
  assert.match(confirmModalSource, /export function confirmLegacyShareMigration\(/);
  assert.match(confirmModalSource, /Republish from the legacy free service\?/);
  assert.match(confirmModalSource, /may still be live/);
  assert.match(confirmModalSource, /df_legacy_url/);
  assert.match(confirmModalSource, /"Publish new link"/);
});
