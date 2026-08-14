import assert from "node:assert/strict";
import test from "node:test";

import { hasActiveShareLink, shareListSummary } from "../src/share-actions.ts";

test("keeps actions only for share links that can still be opened", () => {
  assert.equal(hasActiveShareLink("published"), true);
  assert.equal(hasActiveShareLink("password_protected"), true);
  assert.equal(hasActiveShareLink("expired"), false);
  assert.equal(hasActiveShareLink("stopped"), false);
});

test("summarizes live and past shares without treating history as active", () => {
  assert.equal(shareListSummary([]), "No shares yet.");
  assert.equal(shareListSummary(["published", "password_protected"]), "2 live shares.");
  assert.equal(shareListSummary(["stopped", "expired"]), "2 past shares.");
  assert.equal(shareListSummary(["published", "stopped"]), "1 live share, 1 past share.");
});
