import assert from "node:assert/strict";
import test from "node:test";

import {
  canUseMediaNote,
  hasMediaNoteJobCapacity,
  requiresDetailedNoteProvider,
  shouldPrepareDetailedNote,
  supportsDetailedNoteProvider
} from "../src/media-note-availability.ts";

test("treats a null job limit as unlimited and detects exhausted quotas", () => {
  assert.equal(hasMediaNoteJobCapacity(200, null), true);
  assert.equal(hasMediaNoteJobCapacity(29, 30), true);
  assert.equal(hasMediaNoteJobCapacity(30, 30), false);
  assert.equal(hasMediaNoteJobCapacity(31, 30), false);
});

test("requires paid entitlement and an enabled DocFerry runtime", () => {
  const ready = { enabled: true, supportedProviders: ["web", "wechat", "youtube"] };

  assert.equal(canUseMediaNote(true, ready), true);
  assert.equal(canUseMediaNote(false, ready), false);
  assert.equal(canUseMediaNote(true, { ...ready, enabled: false }), false);
  assert.equal(canUseMediaNote(true, { enabled: true, supportedProviders: [] }), false);
});

test("reports providers advertised by the current server runtime", () => {
  const runtime = { enabled: true, supportedProviders: ["web", "wechat", "youtube"] };

  assert.equal(supportsDetailedNoteProvider("web", runtime), true);
  assert.equal(supportsDetailedNoteProvider("wechat", runtime), true);
  assert.equal(supportsDetailedNoteProvider("youtube", runtime), true);
  assert.equal(supportsDetailedNoteProvider("bilibili", runtime), false);
  assert.equal(supportsDetailedNoteProvider("tiktok", runtime), false);
  assert.equal(supportsDetailedNoteProvider("douyin", runtime), false);
});

test("marks mandatory paid video providers so callers never silently downgrade them", () => {
  assert.equal(requiresDetailedNoteProvider("bilibili"), true);
  assert.equal(requiresDetailedNoteProvider("tiktok"), true);
  assert.equal(requiresDetailedNoteProvider("douyin"), true);
  assert.equal(requiresDetailedNoteProvider("web"), false);
  assert.equal(requiresDetailedNoteProvider("wechat"), false);
});

test("automatically prepares only entitled links supported by the current runtime", () => {
  const runtime = { enabled: true, supportedProviders: ["web", "youtube", "audio"] };

  assert.equal(shouldPrepareDetailedNote(true, "youtube", runtime), true);
  assert.equal(shouldPrepareDetailedNote(true, "audio", runtime), true);
  assert.equal(shouldPrepareDetailedNote(false, "youtube", runtime), false);
  assert.equal(shouldPrepareDetailedNote(true, "bilibili", runtime), false);
  assert.equal(shouldPrepareDetailedNote(true, "web", { ...runtime, enabled: false }), false);
});
