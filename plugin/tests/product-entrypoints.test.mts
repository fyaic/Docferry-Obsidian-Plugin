import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboardSource = readFileSync(new URL("../src/dashboard-view.ts", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../src/settings.ts", import.meta.url), "utf8");
const serviceBoundarySource = readFileSync(new URL("../src/service-boundary.ts", import.meta.url), "utf8");
const shareModalSource = readFileSync(new URL("../src/share-modal.ts", import.meta.url), "utf8");
const folderShareModalSource = readFileSync(new URL("../src/folder-share-modal.ts", import.meta.url), "utf8");
const pluginStyles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("keeps link saving as one product-facing import entrypoint", () => {
  assert.match(dashboardSource, /Save to Obsidian/);
  assert.match(dashboardSource, /DocFerry chooses the best way to save it/);
  assert.match(dashboardSource, /Paste a link/);
  assert.doesNotMatch(dashboardSource, /docferry-import-modes/);
  assert.doesNotMatch(dashboardSource, /Save link/);
  assert.doesNotMatch(dashboardSource, /Create a detailed note/);
  assert.match(dashboardSource, /Saving creates a note in your vault/);
  assert.match(dashboardSource, /importButton\.disabled = this\.importLoading \|\| !isValidWebUrl\(this\.importUrl\)/);
});

test("gives disconnected users a visible path into browser login", () => {
  assert.match(dashboardSource, /"log-in", "Sign in", "Connect your Bondie account"/);
  assert.match(dashboardSource, /Log in to view shares/);
  assert.match(dashboardSource, /action: \(\) => void this\.host\.startLogin\(\)/);
  assert.match(mainSource, /Finish signing in in your browser, then return to share this note/);
  assert.match(mainSource, /Finish signing in in your browser, then return to share this folder/);
});

test("binds dashboard updates to the selected share and source vault", () => {
  assert.match(mainSource, /resolveShareUpdateVaultGate\(share\.vault_id, vaultId\) === "wrong-vault"/);
  assert.match(mainSource, /await this\.publishFile\(file, share\)/);
  assert.match(mainSource, /const existingShareId = existingShare\?\.share_id \?\? existingMetaId/);
  assert.match(mainSource, /this\.updateOrCreateShare\([\s\S]*?existingShareId,[\s\S]*?file\.path,[\s\S]*?payload,[\s\S]*?resolveFreshExpiryAfterUpdateFallback\(/);
});

test("preserves protected-share and publish presentation state during updates", () => {
  assert.match(shareModalSource, /passwordAlreadySet: boolean/);
  assert.match(shareModalSource, /!this\.defaults\.passwordAlreadySet/);
  assert.match(mainSource, /initialExpirySelection\(existingExpiresAt/);
  assert.match(mainSource, /initialThemeStyling\(/);
  assert.match(mainSource, /existingFolder\?\.expires_at/);
});

test("forces the only supported production service URL and removes inert image controls", () => {
  assert.match(mainSource, /enforceProductionServiceBoundary\(this\.docferrySettings, DEFAULT_SETTINGS\.serverUrl\)/);
  assert.match(serviceBoundarySource, /settings\.sessionToken = ""/);
  assert.match(serviceBoundarySource, /settings\.pendingMediaNoteImport = null/);
  assert.doesNotMatch(settingsSource, /Image quality/);
  assert.doesNotMatch(settingsSource, /imageUploadQuality/);
});

test("keeps the current account until replacement login succeeds", () => {
  // Opening the browser is not proof that another account authenticated. Keep
  // the current product session usable until the token-adoption callback has
  // a confirmed replacement, then revoke the old server session there.
  for (const start of ["async startSignup", "async reconnectAccount"]) {
    const startIndex = mainSource.indexOf(start);
    assert.ok(startIndex > -1, `${start} must exist`);
    const body = mainSource.slice(startIndex, startIndex + 600);
    assert.match(body, /await this\.auth\.startLogin\(/);
    assert.doesNotMatch(body, /clearLocalBondieAccount|logoutBeforeAccountChange|sessionRevoked/);
  }
  assert.match(mainSource, /const previousToken = this\.docferrySettings\.sessionToken/);
  assert.match(mainSource, /if \(previousToken && previousToken !== token\)/);
  assert.match(mainSource, /await this\.replaceSessionToken\(previousToken, token\)/);
  assert.match(mainSource, /await this\.api\.logoutToken\(previousToken\)/);
  assert.match(
    mainSource,
    /if \(!isInvalidProductSessionError\(error\)\) \{\s*new Notice\(this\.formatError\(error, "Could not disconnect"\)\);\s*return;\s*\}/
  );
});

test("does not emit share identifiers, vault paths, or raw errors in debug logs", () => {
  assert.doesNotMatch(mainSource, /debug\("publish response", \{ shareId:/);
  assert.match(mainSource, /debug\("asset uploaded", \{\s*assetType:/);
  assert.doesNotMatch(mainSource, /path: asset\.target\.path/);
  assert.match(mainSource, /console\.debug\(`\[docferry\] \$\{message\}`\)/);
  assert.doesNotMatch(mainSource, /console\.debug\(`\[docferry\] \$\{message\}`, value\)/);
});

test("reports asynchronous share action and clipboard failures", () => {
  assert.match(dashboardSource, /handler\(\)\.catch\(\(\) => \{/);
  assert.match(dashboardSource, /That action could not be completed/);
});

test("opens plugin preferences on the account overview", () => {
  assert.match(settingsSource, /display\(\): void \{\s*this\.activePage = "account";\s*this\.render\(\);/);
});

test("keeps shared content discoverable from plugin settings", () => {
  assert.match(settingsSource, /openSharesPage\(\): Promise<void>/);
  assert.match(settingsSource, /text: "Published content"/);
  assert.match(settingsSource, /"files", "Open shares"/);
  assert.match(settingsSource, /this\.host\.openSharesPage\(\)/);
  assert.match(mainSource, /async openSharesPage\(\): Promise<void>/);
  assert.match(mainSource, /app\.setting\?\.close\?\.\(\)/);
  assert.match(mainSource, /dashboard\?\.showSharesPage\(\)/);
});

test("isolates icon-only controls from host theme button styles", () => {
  assert.match(dashboardSource, /appendIconOnly\(backButton, "arrow-left"\)/);
  assert.match(dashboardSource, /appendIconOnly\(actionButton, actionIcon\)/);
  assert.match(dashboardSource, /appendIconOnly\(moreButton, "more-horizontal"\)/);
  assert.doesNotMatch(dashboardSource, /setIcon\(moreButton, "more-horizontal"\)/);
  assert.match(dashboardSource, /cls: "docferry-icon-button-glyph"/);
  assert.match(dashboardSource, /"data-docferry-icon": iconName/);
  assert.match(pluginStyles, /\.docferry-icon-button-glyph::before \{[\s\S]*?-webkit-mask-image: var\(--docferry-icon-mask\)/);
  assert.match(pluginStyles, /data-docferry-icon="arrow-left"/);
  assert.match(pluginStyles, /data-docferry-icon="refresh-cw"/);
});

test("lets users dismiss saved import feedback without resetting the page", () => {
  assert.match(dashboardSource, /renderImportSuccess\(panel, input\)/);
  assert.match(dashboardSource, /aria-label": "Dismiss saved message"/);
  assert.match(dashboardSource, /setIcon\(dismissButton, "x"\)/);
  assert.match(
    dashboardSource,
    /dismissButton\.addEventListener\("click", \(\) => \{[\s\S]*?this\.importSuccess = "";[\s\S]*?message\.remove\(\);/
  );
});

test("routes plugin account actions through the DocFerry dashboard", () => {
  assert.match(dashboardSource, /aria-label": "Open DocFerry dashboard"/);
  assert.match(dashboardSource, /"layout-dashboard", "Dashboard", "Membership and billing"/);
  assert.match(dashboardSource, /Open dashboard/);
  assert.match(dashboardSource, /openDashboardHome/);
  assert.doesNotMatch(dashboardSource, /"user", "Account", "Plan and dashboard"/);
  assert.doesNotMatch(dashboardSource, /Account Center/);
  assert.doesNotMatch(dashboardSource, /Devices and sessions/);
  assert.match(settingsSource, /Open dashboard/);
  assert.match(settingsSource, /text: "Bondie account"/);
  assert.match(settingsSource, /label: "Account"/);
  assert.match(settingsSource, /label: "Sharing"/);
  assert.match(settingsSource, /label: "Imports"/);
  assert.match(settingsSource, /label: "Advanced"/);
  assert.doesNotMatch(settingsSource, /renderMembershipCard/);
  assert.doesNotMatch(settingsSource, /Account Center/);
});

test("keeps stopped share deletion visible without hiding it in a menu", () => {
  assert.match(dashboardSource, /docferry-delete-history-button/);
  assert.match(dashboardSource, /"trash-2", "Delete"/);
  assert.match(dashboardSource, /await this\.host\.deleteShareHistory\(share\)/);
  assert.match(dashboardSource, /await this\.host\.deleteFolderShareHistory\(folderShare\)/);
});

test("keeps mature active share management actions visible", () => {
  assert.match(dashboardSource, /"copy", "Copy"/);
  assert.match(dashboardSource, /"external-link", "Open"/);
  assert.match(dashboardSource, /"list-checks", "Links"/);
  assert.match(dashboardSource, /"upload-cloud", "Update"/);
  assert.match(dashboardSource, /item\.setTitle\("Stop sharing"\)/);
});

test("offers semantic theme styling only to entitled publishers", () => {
  for (const source of [shareModalSource, folderShareModalSource]) {
    assert.match(source, /if \(this\.defaults\.canUseThemeStyling\)/);
    assert.match(source, /Use my Obsidian theme/);
    assert.match(source, /colors, borders, callouts, and code styling/);
    assert.match(source, /useThemeStyling: this\.defaults\.canUseThemeStyling && this\.useThemeStyling/);
  }
  assert.match(mainSource, /semantic theme tokens: visual identity without layout capture/);
  assert.match(mainSource, /options\.useThemeStyling && this\.docferrySettings\.membership\?\.canUseFullTheme/);
  assert.doesNotMatch(mainSource, /data-docferry-style-id/);
  assert.doesNotMatch(mainSource, /captureThemeCss/);
});

test("refreshes current product access before routing external links", () => {
  assert.match(
    mainSource,
    /onLayoutReady\(\(\) => \{[\s\S]*?refreshMembershipForDashboardOpen\(\)/
  );
  assert.match(
    mainSource,
    /async importExternalLink\([\s\S]*?await this\.refreshMembershipForExternalImport\(\);[\s\S]*?shouldPrepareDetailedNote/
  );
  assert.match(
    mainSource,
    /private async refreshMembershipForExternalImport\(\): Promise<void> \{[\s\S]*?await this\.loadMembership\(true\)/
  );
  assert.match(mainSource, /hasMediaNoteJobCapacity\(membership\.mediaNoteMonthlyJobsUsed, membership\.mediaNoteMonthlyJobLimit\)/);
  assert.match(mainSource, /requiresDetailedNoteProvider\(linkNote\.provider\)/);
});
