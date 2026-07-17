import assert from "node:assert/strict";
import test from "node:test";

import { folderShareAccess } from "../src/folder-share-access.ts";
import type { MembershipSnapshot } from "../src/settings.ts";


function membership(overrides: Partial<MembershipSnapshot> = {}): MembershipSnapshot {
  return {
    productKey: "docferry",
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
