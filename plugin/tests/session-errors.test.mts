import assert from "node:assert/strict";
import test from "node:test";

import { isInvalidProductSessionError } from "../src/session-errors.ts";

test("clears a rejected or centrally revoked product session", () => {
  assert.equal(isInvalidProductSessionError({ status: 401, code: "unauthorized" }), true);
  assert.equal(isInvalidProductSessionError({ status: 401, code: "bondie_session_revoked" }), true);
  assert.equal(isInvalidProductSessionError({ status: 401 }), true);
});

test("keeps non-terminal authentication challenges", () => {
  assert.equal(isInvalidProductSessionError({ status: 401, code: "password_required" }), false);
  assert.equal(isInvalidProductSessionError({ status: 401, code: "synapsehub_user_session_required" }), false);
});

test("keeps an existing product session when a login callback cannot be exchanged", () => {
  for (const code of [
    "auth_code_consumed",
    "auth_code_expired",
    "invalid_auth_code",
    "invalid_auth_redirect",
    "invalid_auth_state"
  ]) {
    assert.equal(isInvalidProductSessionError({ status: 401, code }), false, code);
  }
});

test("ignores non-401 and malformed errors", () => {
  assert.equal(isInvalidProductSessionError({ status: 403, code: "forbidden" }), false);
  assert.equal(isInvalidProductSessionError(new Error("network")), false);
  assert.equal(isInvalidProductSessionError(null), false);
});
