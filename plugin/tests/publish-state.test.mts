import assert from "node:assert/strict";
import test from "node:test";

import {
  initialExpirySelection,
  initialThemeStyling,
  resolveExpirySelection
} from "../src/publish-state.ts";

test("preserves an existing expiration until the user changes it", () => {
  const existing = "2026-09-10T12:00:00.000Z";
  assert.equal(initialExpirySelection(existing, "never"), "keep");
  assert.equal(resolveExpirySelection("keep", existing), existing);
  assert.equal(resolveExpirySelection("never", existing), null);
  assert.equal(
    resolveExpirySelection("30", existing, new Date("2026-08-10T12:00:00.000Z")),
    "2026-09-09T12:00:00.000Z"
  );
});

test("uses configured expiration defaults only for new shares", () => {
  assert.equal(initialExpirySelection(null, "30"), "30");
  assert.equal(initialExpirySelection(undefined, "never"), "never");
});

test("preserves reader or full theme mode on update", () => {
  assert.equal(initialThemeStyling(true, "reader", true), false);
  assert.equal(initialThemeStyling(true, "full", true), true);
  assert.equal(initialThemeStyling(true, null, false), true);
  assert.equal(initialThemeStyling(false, "full", true), false);
});
