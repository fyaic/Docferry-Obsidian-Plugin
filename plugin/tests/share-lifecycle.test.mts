import assert from "node:assert/strict";
import test from "node:test";

import {
  isExpiredShareError,
  isInactiveShareError,
  isMissingShareError,
  isStoppedShareError
} from "../src/share-lifecycle.ts";

test("classifies 404 share_not_found as a missing share", () => {
  assert.equal(isMissingShareError({ status: 404, code: "share_not_found" }), true);
  assert.equal(isMissingShareError({ status: 404, code: "folder_share_not_found" }), false);
  assert.equal(isMissingShareError({ status: 410, code: "share_stopped" }), false);
  assert.equal(isMissingShareError(new Error("network down")), false);
  assert.equal(isMissingShareError(null), false);
});

test("classifies 410 share_stopped as a stopped share", () => {
  assert.equal(isStoppedShareError({ status: 410, code: "share_stopped" }), true);
  assert.equal(isStoppedShareError({ status: 410, code: "asset_upload_intent_expired" }), false);
  assert.equal(isStoppedShareError({ status: 404, code: "share_not_found" }), false);
  assert.equal(isStoppedShareError(undefined), false);
});

test("classifies both stopped and expired shares as inactive", () => {
  assert.equal(isExpiredShareError({ status: 410, code: "share_expired" }), true);
  assert.equal(isExpiredShareError({ status: 410, code: "share_stopped" }), false);
  assert.equal(isInactiveShareError({ status: 410, code: "share_expired" }), true);
  assert.equal(isInactiveShareError({ status: 410, code: "share_stopped" }), true);
  assert.equal(isInactiveShareError({ status: 404, code: "share_not_found" }), false);
});
