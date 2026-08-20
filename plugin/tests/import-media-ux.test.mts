import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const previewModalSource = readFileSync(new URL("../src/media-note-preview-modal.ts", import.meta.url), "utf8");

function methodBody(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start > -1 && end > start, `${startMarker} .. ${endMarker} must exist in order`);
  return source.slice(start, end);
}

test("IMPORT-UX-01: Review later keeps the completed job resumable instead of discarding it", () => {
  const body = methodBody(mainSource, "private async finishMediaNoteImport", "private async setPendingMediaNoteImport");
  const confirmIndex = body.indexOf("await confirmMediaNoteImport(this.app, completed)");
  assert.ok(confirmIndex > -1, "preview confirmation must be awaited");
  const notConfirmedBranch = body.slice(confirmIndex, body.indexOf("const pending =", confirmIndex));
  assert.doesNotMatch(notConfirmedBranch, /clearPendingMediaNoteImport/);
  assert.match(notConfirmedBranch, /kept for later review/);
  assert.match(previewModalSource, /text: "Review later"/);
  assert.doesNotMatch(previewModalSource, /text: "Not now"/);
});

test("IMPORT-UX-01: resuming an expired kept job clears the record once", () => {
  const body = methodBody(mainSource, "async resumeActiveMediaImport", "private requireConnectedProductSubject");
  assert.match(body, /error instanceof ShareApiError && error\.code === "media_note_job_not_found"/);
  assert.match(body, /await this\.clearPendingMediaNoteImport\(pending\.jobId\)/);
});

test("UX-01: logged-out publish offers a login CTA and remembers the intent", () => {
  const publishBody = methodBody(mainSource, "private async publishFile", "private async publishFolder");
  const guardIndex = publishBody.indexOf("if (!this.docferrySettings.sessionToken)");
  const offerIndex = publishBody.indexOf('await this.offerLoginToPublish("note", file.basename, file.path)');
  assert.ok(guardIndex > -1 && offerIndex > guardIndex, "note publish must offer login when signed out");
  assert.doesNotMatch(publishBody.slice(guardIndex, offerIndex + 80), /new Notice\("Connect your Bondie account first\."\)/);

  const folderBody = methodBody(mainSource, "private async publishFolder", "vaultPathFromDrag");
  assert.match(folderBody, /await this\.offerLoginToPublish\("folder",/);

  const offerBody = methodBody(mainSource, "private async offerLoginToPublish", "/**\n   * Resumes a publish intent");
  assert.match(offerBody, /await confirmLoginToPublish\(this\.app, label, path\)/);
  assert.match(offerBody, /this\.pendingPublishIntent = \{ kind, path \}/);
  assert.match(offerBody, /await this\.auth\.startLogin\(\)/);
});

test("UX-01: a successful login resumes the intent through the confirm dialog only", () => {
  const resumeBody = methodBody(mainSource, "private async resumePendingPublishIntent", "private async publishFile");
  assert.match(resumeBody, /this\.pendingPublishIntent = null/);
  assert.match(resumeBody, /item instanceof TFile && item\.extension === "md"/);
  assert.match(resumeBody, /item instanceof TFolder/);
  assert.match(resumeBody, /await this\.publishFile\(item\)/);
  assert.match(resumeBody, /await this\.publishFolder\(item\)/);
  assert.match(resumeBody, /no longer available in this vault/);

  const onloadBody = methodBody(mainSource, "async onload(): Promise<void>", "async loadSettings");
  assert.match(onloadBody, /await this\.resumePendingPublishIntent\(\)/);
});

test("IMPORT-UX-01: cancelling an import whose job is gone clears the record instead of failing", () => {
  const body = methodBody(mainSource, "async cancelActiveMediaImport", "private async refreshMembershipForExternalImport");
  assert.match(body, /error instanceof ShareApiError &&/);
  assert.match(body, /error\.code === "media_note_job_not_found" \|\| error\.code === "media_note_job_finished"/);
  const notFoundIndex = body.indexOf('error.code === "media_note_job_not_found"');
  const clearIndex = body.indexOf("await this.clearPendingMediaNoteImport(pending.jobId)", notFoundIndex);
  assert.ok(notFoundIndex > -1 && clearIndex > notFoundIndex, "a 404 during cancel must terminally clear the pending record");
  assert.match(body, /MEDIA_NOTE_TERMINAL_STATUSES\.has\(job\.status\)/);
});

test("IMPORT-UX-01: a cancel that lands before or during review keeps the review closed", () => {
  // Race analysis: cancelActiveMediaImport always clears pendingMediaNoteImport
  // (cancelled, finished, or gone jobs all end in clearPendingMediaNoteImport),
  // and waitForMediaNote already aborts polling when the record disappears.
  // The remaining window is after the final poll returns a completed job:
  // finishMediaNoteImport must re-check the record both before opening the
  // review dialog and after the user confirms it, so the cancel wins.
  const body = methodBody(mainSource, "private async finishMediaNoteImport", "private async setPendingMediaNoteImport");
  const guard = 'if (this.docferrySettings.pendingMediaNoteImport?.jobId !== completed.job_id)';
  const firstGuard = body.indexOf(guard);
  const confirmIndex = body.indexOf("await confirmMediaNoteImport(this.app, completed)");
  const secondGuard = body.indexOf(guard, confirmIndex);
  const writeIndex = body.indexOf("await this.writeExternalImport(");
  assert.ok(firstGuard > -1 && firstGuard < confirmIndex, "the pending-record guard must precede the review dialog");
  assert.ok(secondGuard > confirmIndex, "the pending-record guard must run again after the review dialog resolves");
  assert.ok(writeIndex > secondGuard, "nothing is written once the cancel cleared the record");
});
