/**
 * Session token custody: the DocFerry bearer token lives in Obsidian
 * SecretStorage, never in persisted plugin data (`data.json`). This module
 * keeps the load/migrate/clear decisions testable behind a minimal store seam
 * (`app.secretStorage` satisfies it).
 */

export const SESSION_TOKEN_SECRET_ID = "session-token";

export interface SessionTokenSecretStore {
  getSecret(id: string): string | null;
  setSecret(id: string, secret: string): void;
}

export interface SessionTokenResolution {
  /** Runtime token to keep in memory for this launch. */
  token: string;
  /** True when persisted settings still carry a legacy token to scrub on save. */
  scrubLegacy: boolean;
}

/**
 * Resolves the runtime session token at plugin load.
 * - A service-boundary reset clears the stored secret instead of migrating.
 * - A stored secret always wins over a legacy persisted token.
 * - A legacy persisted token with no stored secret is migrated into
 *   SecretStorage and flagged so the caller scrubs it from persisted data.
 * Store errors propagate: callers must fail closed rather than persist the
 * token in plaintext.
 */
export function resolveSessionTokenOnLoad(
  store: SessionTokenSecretStore,
  legacyToken: unknown,
  boundaryReset: boolean
): SessionTokenResolution {
  const legacy = typeof legacyToken === "string" ? legacyToken : "";
  if (boundaryReset) {
    store.setSecret(SESSION_TOKEN_SECRET_ID, "");
    return { token: "", scrubLegacy: Boolean(legacy) };
  }
  const stored = store.getSecret(SESSION_TOKEN_SECRET_ID) || "";
  if (stored) return { token: stored, scrubLegacy: Boolean(legacy) };
  if (legacy) {
    store.setSecret(SESSION_TOKEN_SECRET_ID, legacy);
    return { token: legacy, scrubLegacy: true };
  }
  return { token: "", scrubLegacy: false };
}

/** Persists the session token; an empty token clears the stored secret. */
export function persistSessionToken(store: SessionTokenSecretStore, token: string): void {
  store.setSecret(SESSION_TOKEN_SECRET_ID, token);
}

export const PENDING_AUTH_STATE_SECRET_ID = "pending-auth-state";
export const PENDING_AUTH_STARTED_AT_SECRET_ID = "pending-auth-started-at";
export const PENDING_AUTH_VERIFIER_SECRET_ID = "pending-auth-verifier";

export interface PendingLoginSnapshot {
  state: string;
  startedAt: string;
  verifier: string;
}

/**
 * Reads the pending login handshake from SecretStorage. An empty state means
 * no login is in flight.
 */
export function readPendingLogin(store: SessionTokenSecretStore): PendingLoginSnapshot {
  return {
    state: store.getSecret(PENDING_AUTH_STATE_SECRET_ID) || "",
    startedAt: store.getSecret(PENDING_AUTH_STARTED_AT_SECRET_ID) || "",
    verifier: store.getSecret(PENDING_AUTH_VERIFIER_SECRET_ID) || ""
  };
}

/**
 * Persists the pending login handshake into SecretStorage; an empty state
 * clears all three secrets. The PKCE verifier never touches persisted plugin
 * data, so a reader of `data.json` cannot complete the exchange.
 */
export function persistPendingLogin(store: SessionTokenSecretStore, snapshot: PendingLoginSnapshot): void {
  if (!snapshot.state) {
    clearPendingLoginCustody(store);
    return;
  }
  store.setSecret(PENDING_AUTH_STATE_SECRET_ID, snapshot.state);
  store.setSecret(PENDING_AUTH_STARTED_AT_SECRET_ID, snapshot.startedAt);
  store.setSecret(PENDING_AUTH_VERIFIER_SECRET_ID, snapshot.verifier);
}

export function clearPendingLoginCustody(store: SessionTokenSecretStore): void {
  store.setSecret(PENDING_AUTH_STATE_SECRET_ID, "");
  store.setSecret(PENDING_AUTH_STARTED_AT_SECRET_ID, "");
  store.setSecret(PENDING_AUTH_VERIFIER_SECRET_ID, "");
}

/**
 * Migrates a legacy plaintext pending login (persisted by older plugin
 * versions) into SecretStorage. Returns true when persisted settings carry
 * legacy fields the caller must scrub. An incomplete legacy snapshot is
 * dropped instead of migrated: the login fails closed and the user restarts
 * it.
 */
export function migrateLegacyPendingLogin(
  store: SessionTokenSecretStore,
  legacy: { state?: unknown; startedAt?: unknown; verifier?: unknown }
): boolean {
  const state = typeof legacy.state === "string" ? legacy.state : "";
  const startedAt = typeof legacy.startedAt === "string" ? legacy.startedAt : "";
  const verifier = typeof legacy.verifier === "string" ? legacy.verifier : "";
  if (!state && !startedAt && !verifier) return false;
  if (state && startedAt && verifier) {
    persistPendingLogin(store, { state, startedAt, verifier });
  }
  return true;
}
