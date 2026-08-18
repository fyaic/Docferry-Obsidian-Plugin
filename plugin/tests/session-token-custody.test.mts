import assert from "node:assert/strict";
import test from "node:test";

import {
  PENDING_AUTH_STARTED_AT_SECRET_ID,
  PENDING_AUTH_STATE_SECRET_ID,
  PENDING_AUTH_VERIFIER_SECRET_ID,
  SESSION_TOKEN_SECRET_ID,
  clearPendingLoginCustody,
  migrateLegacyPendingLogin,
  persistPendingLogin,
  persistSessionToken,
  readPendingLogin,
  resolveSessionTokenOnLoad,
  type SessionTokenSecretStore
} from "../src/session-token-custody.ts";

function fakeStore(initial: Record<string, string> = {}): SessionTokenSecretStore & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getSecret: (id) => values.get(id) ?? null,
    setSecret: (id, secret) => {
      if (secret) values.set(id, secret);
      else values.delete(id);
    }
  };
}

test("migrates a legacy data.json token into SecretStorage and flags the scrub", () => {
  const store = fakeStore();
  const resolved = resolveSessionTokenOnLoad(store, "legacy-token", false);
  assert.equal(resolved.token, "legacy-token");
  assert.equal(resolved.scrubLegacy, true);
  assert.equal(store.getSecret(SESSION_TOKEN_SECRET_ID), "legacy-token");
});

test("a stored secret wins over a stale legacy token and flags the scrub", () => {
  const store = fakeStore({ [SESSION_TOKEN_SECRET_ID]: "stored-token" });
  const resolved = resolveSessionTokenOnLoad(store, "legacy-token", false);
  assert.equal(resolved.token, "stored-token");
  assert.equal(resolved.scrubLegacy, true);
  assert.equal(store.getSecret(SESSION_TOKEN_SECRET_ID), "stored-token");
});

test("a service-boundary reset clears the stored secret instead of migrating", () => {
  const store = fakeStore({ [SESSION_TOKEN_SECRET_ID]: "stored-token" });
  const resolved = resolveSessionTokenOnLoad(store, "legacy-token", true);
  assert.equal(resolved.token, "");
  assert.equal(resolved.scrubLegacy, true);
  assert.equal(store.getSecret(SESSION_TOKEN_SECRET_ID), null);
});

test("no token anywhere resolves to signed-out without writes", () => {
  const store = fakeStore();
  const resolved = resolveSessionTokenOnLoad(store, "", false);
  assert.deepEqual(resolved, { token: "", scrubLegacy: false });
  assert.equal(store.values.size, 0);
});

test("persistSessionToken stores and clears the secret with an empty token", () => {
  const store = fakeStore();
  persistSessionToken(store, "fresh-token");
  assert.equal(store.getSecret(SESSION_TOKEN_SECRET_ID), "fresh-token");
  persistSessionToken(store, "");
  assert.equal(store.getSecret(SESSION_TOKEN_SECRET_ID), null);
});

test("store failures propagate so callers fail closed instead of persisting plaintext", () => {
  const failing: SessionTokenSecretStore = {
    getSecret: () => {
      throw new Error("secret storage unavailable");
    },
    setSecret: () => {
      throw new Error("secret storage unavailable");
    }
  };
  assert.throws(() => resolveSessionTokenOnLoad(failing, "legacy-token", false), /unavailable/);
  assert.throws(() => persistSessionToken(failing, "token"), /unavailable/);
});

test("pending login secrets use SecretStorage-safe lowercase dashed ids", () => {
  for (const id of [PENDING_AUTH_STATE_SECRET_ID, PENDING_AUTH_STARTED_AT_SECRET_ID, PENDING_AUTH_VERIFIER_SECRET_ID]) {
    assert.match(id, /^[a-z0-9-]+$/, `${id} must satisfy the SecretStorage id constraint`);
  }
});

test("persistPendingLogin stores all three secrets and an empty state clears them", () => {
  const store = fakeStore();
  persistPendingLogin(store, { state: "state-1", startedAt: "2026-08-17T00:00:00.000Z", verifier: "verifier-1" });
  assert.deepEqual(readPendingLogin(store), {
    state: "state-1",
    startedAt: "2026-08-17T00:00:00.000Z",
    verifier: "verifier-1"
  });
  persistPendingLogin(store, { state: "", startedAt: "", verifier: "" });
  assert.equal(store.getSecret(PENDING_AUTH_STATE_SECRET_ID), null);
  assert.equal(store.getSecret(PENDING_AUTH_STARTED_AT_SECRET_ID), null);
  assert.equal(store.getSecret(PENDING_AUTH_VERIFIER_SECRET_ID), null);
  assert.deepEqual(readPendingLogin(store), { state: "", startedAt: "", verifier: "" });
});

test("clearPendingLoginCustody removes the pending handshake without touching the session token", () => {
  const store = fakeStore({
    [SESSION_TOKEN_SECRET_ID]: "session-token",
    [PENDING_AUTH_STATE_SECRET_ID]: "state-1",
    [PENDING_AUTH_STARTED_AT_SECRET_ID]: "2026-08-17T00:00:00.000Z",
    [PENDING_AUTH_VERIFIER_SECRET_ID]: "verifier-1"
  });
  clearPendingLoginCustody(store);
  assert.deepEqual(readPendingLogin(store), { state: "", startedAt: "", verifier: "" });
  assert.equal(store.getSecret(SESSION_TOKEN_SECRET_ID), "session-token");
});

test("a complete legacy pending login migrates into SecretStorage and flags the scrub", () => {
  const store = fakeStore();
  const migrated = migrateLegacyPendingLogin(store, {
    state: "legacy-state",
    startedAt: "2026-08-17T00:00:00.000Z",
    verifier: "legacy-verifier"
  });
  assert.equal(migrated, true);
  assert.deepEqual(readPendingLogin(store), {
    state: "legacy-state",
    startedAt: "2026-08-17T00:00:00.000Z",
    verifier: "legacy-verifier"
  });
});

test("an incomplete legacy pending login is dropped so the exchange fails closed", () => {
  const store = fakeStore();
  const migrated = migrateLegacyPendingLogin(store, {
    state: "legacy-state",
    startedAt: "2026-08-17T00:00:00.000Z",
    verifier: ""
  });
  assert.equal(migrated, true);
  assert.deepEqual(readPendingLogin(store), { state: "", startedAt: "", verifier: "" });
  assert.equal(store.values.size, 0);
});

test("no legacy pending login leaves SecretStorage untouched", () => {
  const store = fakeStore();
  const migrated = migrateLegacyPendingLogin(store, { state: "", startedAt: "", verifier: "" });
  assert.equal(migrated, false);
  assert.equal(store.values.size, 0);
});
