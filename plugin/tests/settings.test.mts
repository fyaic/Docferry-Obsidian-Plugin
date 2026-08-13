import assert from "node:assert/strict";
import test from "node:test";

import {
  DOCFERRY_LEGACY_BONDIE_SERVICE_URL,
  DOCFERRY_PRODUCTION_SERVICE_URL,
  shouldMigrateLegacyBondieServiceUrl,
  type ServiceUrlSettings
} from "../src/service-url.ts";

function settings(overrides: Partial<ServiceUrlSettings> = {}): ServiceUrlSettings {
  return {
    serverUrl: DOCFERRY_PRODUCTION_SERVICE_URL,
    sessionToken: "",
    connectedAccount: null,
    ...overrides
  };
}

test("migrates old unauthenticated Bondie service settings to Fuyonder", () => {
  assert.equal(
    shouldMigrateLegacyBondieServiceUrl(settings({ serverUrl: `${DOCFERRY_LEGACY_BONDIE_SERVICE_URL}/` })),
    true
  );
});

test("does not rewrite connected legacy sessions", () => {
  assert.equal(
    shouldMigrateLegacyBondieServiceUrl(
      settings({
        serverUrl: DOCFERRY_LEGACY_BONDIE_SERVICE_URL,
        sessionToken: "session-token"
      })
    ),
    false
  );
  assert.equal(
    shouldMigrateLegacyBondieServiceUrl(
      settings({
        serverUrl: DOCFERRY_LEGACY_BONDIE_SERVICE_URL,
        connectedAccount: {
          productSubjectId: "product_subject",
          connectedAt: "2026-08-13T00:00:00.000Z"
        }
      })
    ),
    false
  );
});
