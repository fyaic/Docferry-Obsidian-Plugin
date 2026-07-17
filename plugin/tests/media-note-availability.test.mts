import assert from "node:assert/strict";
import test from "node:test";

import {
  canUseMediaNote,
  supportsDetailedNoteProvider
} from "../src/media-note-availability.ts";

test("requires paid entitlement and an enabled DocFerry runtime", () => {
  const ready = { enabled: true, supportedProviders: ["web", "wechat", "youtube"] };

  assert.equal(canUseMediaNote(true, ready), true);
  assert.equal(canUseMediaNote(false, ready), false);
  assert.equal(canUseMediaNote(true, { ...ready, enabled: false }), false);
  assert.equal(canUseMediaNote(true, { enabled: true, supportedProviders: [] }), false);
});

test("keeps unsupported media providers link-only before creating a server job", () => {
  const runtime = { enabled: true, supportedProviders: ["web", "wechat", "youtube"] };

  assert.equal(supportsDetailedNoteProvider("web", runtime), true);
  assert.equal(supportsDetailedNoteProvider("wechat", runtime), true);
  assert.equal(supportsDetailedNoteProvider("youtube", runtime), true);
  assert.equal(supportsDetailedNoteProvider("bilibili", runtime), false);
  assert.equal(supportsDetailedNoteProvider("tiktok", runtime), false);
  assert.equal(supportsDetailedNoteProvider("douyin", runtime), false);
});
