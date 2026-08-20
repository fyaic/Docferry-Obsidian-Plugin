import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { canShowFolderShareEntry, folderShareAccess } from "../src/folder-share-access.ts";
import type { MembershipSnapshot } from "../src/settings.ts";

const dashboardSource = readFileSync(new URL("../src/dashboard-view.ts", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");


function membership(overrides: Partial<MembershipSnapshot> = {}): MembershipSnapshot {
  return {
    productKey: "docferry",
    accessRole: "member",
    planKey: "pro_monthly",
    planDisplayName: "DocFerry Pro Monthly",
    entitlementKey: "docferry.pro",
    activeShareCount: 0,
    activeShareLimit: 20,
    activeFolderShareCount: 0,
    activeFolderShareLimit: 5,
    maxFolderDocumentCount: 100,
    maxFolderTotalBytes: 50 * 1024 * 1024,
    maxSingleFileSizeBytes: 10 * 1024 * 1024,
    canCreateShare: true,
    canCreateFolderShare: true,
    canUseFullTheme: true,
    hasMediaNoteEntitlement: true,
    canUseMediaNote: false,
    mediaNoteProviders: [],
    mediaNoteSourceKinds: [],
    source: "synapsehub_entitlement_summary",
    cacheStatus: "fresh",
    refreshedAt: "2026-07-17T00:00:00Z",
    billingEnabled: true,
    billingPlans: [],
    ...overrides
  };
}

test("allows an existing folder share to update at the active-share limit", () => {
  const atLimit = membership({
    activeFolderShareCount: 5,
    canCreateFolderShare: false
  });

  assert.equal(folderShareAccess(atLimit, true), "allowed");
  assert.equal(folderShareAccess(atLimit, false), "limit_reached");
});

test("keeps folder sharing closed when the capability is unavailable", () => {
  assert.equal(
    folderShareAccess(
      membership({
        planKey: "free",
        activeFolderShareLimit: 0,
        canCreateFolderShare: false,
        canUseFullTheme: false
      }),
      true
    ),
    "upgrade_required"
  );
});

test("a server-unlimited projection treats null limits as available", () => {
  const admin = membership({
    accessRole: "member",
    planKey: "pro",
    planDisplayName: "Pro",
    activeShareCount: 250,
    activeShareLimit: null,
    activeFolderShareCount: 20,
    activeFolderShareLimit: null,
    canCreateFolderShare: true
  });

  assert.equal(folderShareAccess(admin, false), "allowed");
});

test("hides folder share entry points only for plans without folder sharing", () => {
  const free = membership({
    planKey: "free",
    activeFolderShareLimit: 0,
    canCreateFolderShare: false,
    canUseFullTheme: false
  });

  assert.equal(canShowFolderShareEntry(free), false);
  assert.equal(canShowFolderShareEntry(membership()), true);
  // At the active-share limit the entry stays visible so existing shares can
  // be updated; the publish flow explains the limit.
  assert.equal(
    canShowFolderShareEntry(membership({ activeFolderShareCount: 5, canCreateFolderShare: false })),
    true
  );
  // Unknown membership keeps entries visible; the publish flow re-checks.
  assert.equal(canShowFolderShareEntry(null), true);
  assert.equal(canShowFolderShareEntry(undefined), true);
});

test("gates the file menu, command palette, and dashboard drop cue on folder share access", () => {
  assert.match(
    mainSource,
    /if \(file instanceof TFolder\) \{[\s\S]{0,200}?if \(!canShowFolderShareEntry\(this\.docferrySettings\.membership\)\) return;/
  );
  assert.match(
    mainSource,
    /id: "publish-current-folder"[\s\S]*?if \(!canShowFolderShareEntry\(this\.docferrySettings\.membership\)\) return false;/
  );
  assert.match(
    dashboardSource,
    /canShowFolderShareEntry\(this\.host\.docferrySettings\.membership\)[\s\S]*?"Release a note or folder to review sharing options\."/
  );
  assert.match(dashboardSource, /folderUpgradeRequired[\s\S]*?"Folder sharing is a Pro feature"/);
});
