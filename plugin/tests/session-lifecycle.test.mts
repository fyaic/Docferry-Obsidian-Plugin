import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const authSource = readFileSync(new URL("../src/auth-service.ts", import.meta.url), "utf8");
const externalLinksSource = readFileSync(new URL("../src/external-links.ts", import.meta.url), "utf8");

function methodBody(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start > -1 && end > start, `${startMarker} .. ${endMarker} must exist in order`);
  return source.slice(start, end);
}

test("session token never persists to data.json and resolves through SecretStorage at load", () => {
  assert.match(mainSource, /const snapshot = \{ \.\.\.this\.docferrySettings, sessionToken: "" \}/);
  assert.match(mainSource, /this\.settingsSaveQueue\.then\(\(\) => this\.saveData\(snapshot\)\)/);
  assert.match(mainSource, /resolveSessionTokenOnLoad\(\s*this\.app\.secretStorage,/);
  assert.match(mainSource, /could not access secure credential storage\. Update Obsidian/);
  assert.match(mainSource, /import \{[^}]*persistSessionToken[^}]*resolveSessionTokenOnLoad[^}]*\} from "\.\/session-token-custody"/);
});

test("logout, disconnect, and invalid-session cleanup clear the SecretStorage token", () => {
  const clearBody = methodBody(mainSource, "private clearLocalBondieAccount", "private handleInvalidProductSession");
  assert.match(clearBody, /this\.clearSessionTokenCustody\(\)/);
  assert.match(mainSource, /persistSessionToken\(this\.app\.secretStorage, ""\)/);
});

test("connect-while-connected durably queues the old token before committing the replacement", () => {
  const replaceCall = mainSource.indexOf("await this.replaceSessionToken(previousToken, token);");
  const revokeGuard = mainSource.indexOf("previousToken && previousToken !== token");
  assert.ok(revokeGuard > -1, "previous-session revoke guard must exist");
  assert.ok(replaceCall > revokeGuard, "replacement transaction must run after the account-change guard");
  const helper = methodBody(mainSource, "private async replaceSessionToken", "private async revokeUnadoptedToken");
  const stageIndex = helper.indexOf("stageSessionToken(this.app.secretStorage, previousToken)");
  const commitIndex = helper.indexOf("persistSessionToken(this.app.secretStorage, replacementToken)");
  const adoptIndex = helper.indexOf("this.docferrySettings.sessionToken = replacementToken");
  const revokeIndex = helper.indexOf("await this.api.logoutToken(previousToken)");
  assert.ok(stageIndex > -1 && commitIndex > stageIndex && adoptIndex > commitIndex && revokeIndex > adoptIndex);
  assert.match(helper, /clearStagedSessionToken\(this\.app\.secretStorage\)/);
  assert.match(helper, /this\.stagedSessionTokenToRevoke = ""/);
  assert.match(helper, /await this\.revokeUnadoptedToken\(replacementToken\)/);
  assert.match(mainSource, /await this\.reconcileStagedSessionToken\(\)/);
  assert.match(mainSource, /if \(!\(await this\.reconcileStagedSessionToken\(\)\)\) return;/);
  assert.match(mainSource, /could not store your sign-in securely\. Update Obsidian/);
});

test("switch account keeps the current session until the replacement login completes", () => {
  for (const [start, end] of [
    ["async reconnectAccount", "async disconnectAccount"],
    ["async startSignup", "async reconnectAccount"]
  ] as const) {
    const body = methodBody(mainSource, start, end);
    assert.match(body, /await this\.auth\.startLogin\(/);
    assert.doesNotMatch(body, /logoutBeforeAccountChange|clearLocalBondieAccount/);
  }
  const adoption = methodBody(mainSource, "this.auth = new AuthService", "this.addSettingTab");
  assert.match(adoption, /await this\.replaceSessionToken\(previousToken, token\)/);
  const replacement = methodBody(mainSource, "private async replaceSessionToken", "private async revokeUnadoptedToken");
  assert.match(replacement, /await this\.api\.logoutToken\(previousToken\)/);
});

test("auth service only starts polling after the browser accepts the handoff", () => {
  const startBody = methodBody(authSource, "async startLogin", "private async pollPendingLogin");
  assert.match(startBody, /await openExternalUrl\(/);
  assert.match(startBody, /if \(!opened\) \{/);
  const openedIndex = startBody.indexOf("await openExternalUrl(");
  const pollIndex = startBody.indexOf("void this.pollPendingLogin(");
  assert.ok(openedIndex > -1 && pollIndex > openedIndex, "polling starts only after a proven browser handoff");
  const failureBranch = startBody.slice(startBody.indexOf("if (!opened)"), pollIndex);
  assert.match(failureBranch, /await this\.clearPendingLogin\(clientState\)/);
});

test("browser cancellation and rejection terminate private polling immediately", () => {
  assert.match(authSource, /"auth_login_cancelled"/);
  assert.match(authSource, /"auth_login_failed"/);
  const pollBody = methodBody(authSource, "private async pollPendingLogin", "async resumePendingLogin");
  assert.match(pollBody, /await this\.clearPendingLoginSafely\(clientState\)/);
  assert.match(pollBody, /Bondie sign-in was cancelled/);
});

test("business rejection and expired exchange clear persisted PKCE state", () => {
  const pollBody = methodBody(authSource, "private async pollPendingLogin", "async resumePendingLogin");
  const completionBranch = pollBody.slice(
    pollBody.indexOf("if (error instanceof AuthCompletionError)"),
    pollBody.indexOf('if (error instanceof ShareApiError && error.code === "auth_code_expired")')
  );
  assert.match(completionBranch, /await this\.clearPendingLoginSafely\(clientState\)/);
  const expiredBranch = pollBody.slice(
    pollBody.indexOf('if (error instanceof ShareApiError && error.code === "auth_code_expired")'),
    pollBody.indexOf("TERMINAL_EXCHANGE_CODES.has")
  );
  assert.match(expiredBranch, /await this\.clearPendingLoginSafely\(clientState\)/);
});

test("browser handoff reports success or failure instead of fire-and-forget", () => {
  assert.match(externalLinksSource, /Promise<boolean>/);
  assert.match(externalLinksSource, /await shell\.openExternal/);
  assert.match(externalLinksSource, /return false;/);
});

test("polling and deferred timers are canceled on plugin unload", () => {
  assert.match(mainSource, /onunload\(\): void \{/);
  const unloadBody = methodBody(mainSource, "onunload(): void {", "private scheduleTimeout");
  assert.match(unloadBody, /window\.clearTimeout\(handle\)/);
  assert.match(unloadBody, /this\.auth\?\.dispose\(\)/);

  assert.match(authSource, /dispose\(\): void \{/);
  assert.match(authSource, /while \(!this\.disposed && attempt === this\.loginAttempt/);
  assert.match(authSource, /if \(this\.disposed \|\| attempt !== this\.loginAttempt\) return;/);

  assert.match(mainSource, /this\.scheduleTimeout\(\(\) => void this\.resumeActiveMediaImport\(\), 900\)/);
  assert.match(mainSource, /this\.scheduleTimeout\(\(\) => void this\.recoverPendingMediaNoteSubmission\(\), 900\)/);
  assert.match(mainSource, /this\.scheduleTimeout\(\(\) => void this\.runScheduledMembershipRefresh\(generation\), delayMs\)/);

  const watchBody = methodBody(mainSource, "private async waitForMediaNote", "private async finishMediaNoteImport");
  assert.match(watchBody, /if \(this\.unloaded\)/);
});

test("no leftover untracked long-delay timers in the plugin host", () => {
  const forbidden = [
    /window\.setTimeout\(\(\) => void this\.resumeActiveMediaImport/,
    /window\.setTimeout\(async \(\) => \{\s*if \(generation/
  ];
  for (const pattern of forbidden) assert.doesNotMatch(mainSource, pattern);
});

test("an exchange resolved after dispose or a newer attempt never adopts a session", () => {
  const pollBody = methodBody(authSource, "private async pollPendingLogin", "async resumePendingLogin");
  const exchangeIndex = pollBody.indexOf("await this.api.exchangePendingAuth(clientState, codeVerifier)");
  const postExchangeRecheck = pollBody.indexOf("if (this.disposed || attempt !== this.loginAttempt) return;", exchangeIndex);
  assert.ok(exchangeIndex > -1 && postExchangeRecheck > exchangeIndex, "the attempt must be re-checked after the exchange resolves");
  const adoptIndex = pollBody.indexOf("await this.onAccessToken(");
  const postAdoptRecheck = pollBody.indexOf("if (this.disposed || attempt !== this.loginAttempt) return;", adoptIndex);
  assert.ok(adoptIndex > -1 && postAdoptRecheck > adoptIndex, "the attempt must be re-checked after token adoption");
});

test("post-unload callbacks adopt nothing and schedule nothing", () => {
  const adoptIndex = mainSource.indexOf("this.adoptSessionToken(token);");
  const unloadGuard = mainSource.lastIndexOf("if (this.unloaded) return;", adoptIndex);
  assert.ok(adoptIndex > -1 && unloadGuard > -1, "the token adoption callback must bail out after unload");
  assert.match(mainSource, /private async runScheduledMembershipRefresh\(generation: number\): Promise<void> \{\s*if \(this\.unloaded\) return;/);
  assert.match(mainSource, /private async recoverBillingSession\(force = false\): Promise<void> \{\s*if \(this\.unloaded\) return;/);
});

test("disconnect cancels any in-flight login poll before revoking the session", () => {
  const disconnectBody = methodBody(mainSource, "async disconnectAccount", "private clearLocalBondieAccount");
  const cancelIndex = disconnectBody.indexOf("await this.auth.cancelPendingLogin()");
  const logoutIndex = disconnectBody.indexOf("await this.api.logout()");
  assert.ok(cancelIndex > -1 && logoutIndex > cancelIndex, "cancelPendingLogin must run before logout");

  const cancelBody = methodBody(authSource, "async cancelPendingLogin", "private async pollPendingLogin");
  const bumpIndex = cancelBody.indexOf("this.loginAttempt++");
  const clearIndex = cancelBody.indexOf('await this.savePendingLogin("", "", "")');
  assert.ok(bumpIndex > -1 && clearIndex > bumpIndex, "cancelling must invalidate the attempt and clear the handshake");

  // The cancellation lives in disconnectAccount, not clearLocalBondieAccount:
  // startSignup/reconnectAccount open a new login poll before clearing local
  // state, so cancelling there would kill the fresh login.
  const clearLocalBody = methodBody(mainSource, "private clearLocalBondieAccount", "private handleInvalidProductSession");
  assert.doesNotMatch(clearLocalBody, /cancelPendingLogin/);
});

test("secure-storage failures during login fail closed with an accurate notice", () => {
  // startLogin must not mislabel a local SecretStorage failure as a server
  // problem, and must not start a login whose verifier was never persisted.
  const startBody = methodBody(authSource, "async startLogin", "/** Stops any in-flight login polling");
  const saveIndex = startBody.indexOf("await this.savePendingLogin(clientState, new Date().toISOString(), codeVerifier)");
  assert.ok(saveIndex > -1, "the pending handshake must be persisted before the browser handoff");
  const storageCatch = startBody.indexOf("new Notice(SECURE_STORAGE_UNAVAILABLE_MESSAGE, 8000);");
  assert.ok(storageCatch > saveIndex, "a storage failure must get the secure-storage notice, not the server wording");
  const unavailableNotice = startBody.indexOf("Bondie login is not available on this server.");
  assert.ok(unavailableNotice > storageCatch, "the storage-specific catch must precede the generic server catch");
  const catchBlock = startBody.slice(startBody.lastIndexOf("} catch {", unavailableNotice));
  assert.doesNotMatch(catchBlock, /SECURE_STORAGE_UNAVAILABLE_MESSAGE/, "the generic catch must keep the server wording only");
  assert.match(authSource, /const SECURE_STORAGE_UNAVAILABLE_MESSAGE =\s*"DocFerry could not access secure credential storage\. Update Obsidian, then sign in again\."/);

  // Polling-side clears and the resume read path never throw into unhandled
  // rejections.
  const pollBody = methodBody(authSource, "private async pollPendingLogin", "async resumePendingLogin");
  assert.doesNotMatch(pollBody, /await this\.clearPendingLogin\(/);
  assert.match(pollBody, /await this\.clearPendingLoginSafely\(clientState\)/);
  const resumeBody = methodBody(authSource, "async resumePendingLogin", "private async clearPendingLoginSafely");
  assert.match(resumeBody, /try \{\s*pending = this\.getPendingLogin\(\);\s*\} catch/);
  assert.match(authSource, /private async clearPendingLoginSafely\(state: string\)/);
  assert.match(mainSource, /void this\.auth\.resumePendingLogin\(\)\.catch\(/);
});

test("account changes resolve an uncertain media note submission before clearing local state", () => {
  const guardBody = methodBody(mainSource, "private async finishPendingImportBeforeAccountChange", "private clearLocalBondieAccount");
  const submissionIndex = guardBody.indexOf("this.docferrySettings.pendingMediaNoteSubmission");
  const resolveIndex = guardBody.indexOf("await resolvePendingMediaNoteSubmission(this.mediaNoteSubmissionDeps(), submission)");
  const pendingImportIndex = guardBody.indexOf("if (!this.docferrySettings.pendingMediaNoteImport) return true;");
  assert.ok(submissionIndex > -1 && resolveIndex > submissionIndex, "an unresolved submission must be replayed first");
  assert.ok(pendingImportIndex > resolveIndex, "a recovered submission falls through to the existing import guard");
  assert.match(guardBody, /Could not confirm the state of your previous detailed note/);
  // The wipe of the submission record stays behind the guard.
  const clearBody = methodBody(mainSource, "private clearLocalBondieAccount", "private handleInvalidProductSession");
  assert.match(clearBody, /this\.docferrySettings\.pendingMediaNoteSubmission = null/);
});

test("login with a different account recovers or protects a bare media note submission before switching", () => {
  const adoptBody = methodBody(mainSource, "async (token, response) => {", "() => ({");
  // The submission guard runs before the pending-import mismatch guard: a
  // committed (charged) job is replayed with the same operation key and
  // becomes a tracked pending import instead of being orphaned.
  const submissionIndex = adoptBody.indexOf("this.docferrySettings.pendingMediaNoteSubmission");
  const resolveIndex = adoptBody.indexOf("await resolvePendingMediaNoteSubmission(this.mediaNoteSubmissionDeps(), pendingSubmission)");
  const importIndex = adoptBody.indexOf("this.docferrySettings.pendingMediaNoteImport;");
  assert.ok(submissionIndex > -1 && resolveIndex > submissionIndex, "a bare submission must be replayed before the import mismatch check");
  assert.ok(importIndex > resolveIndex, "a recovered submission falls through to the import mismatch guard");
  // An uncertain recovery refuses the account switch and keeps the record.
  assert.match(adoptBody, /pendingSubmission\.ownerProductSubjectId !== response\.product_subject_id/);
  assert.match(adoptBody, /Could not confirm the state of your previous detailed note\. Check your connection, then sign in again\./);
  // Share, bare-submission, and tracked-import mismatches all revoke the
  // unadopted replacement token through the same helper.
  assert.equal(adoptBody.match(/await this\.rejectMismatchedLoginToken\(token\)/g)?.length, 3);
  assert.match(adoptBody, /An unfinished share belongs to another Bondie account/);
  assert.match(adoptBody, /This detailed note belongs to another Bondie account/);

  const helperBody = methodBody(mainSource, "private async rejectMismatchedLoginToken", "private async finishPendingImportBeforeAccountChange");
  assert.match(helperBody, /await this\.revokeUnadoptedToken\(token\)/);
  const revokeBody = methodBody(mainSource, "private async revokeUnadoptedToken", "private clearSessionTokenCustody");
  assert.match(revokeBody, /await this\.api\.logoutToken\(token\)/);
  assert.doesNotMatch(revokeBody, /this\.docferrySettings\.sessionToken = token/);
});
