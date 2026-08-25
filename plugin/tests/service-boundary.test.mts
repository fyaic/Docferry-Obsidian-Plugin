import assert from "node:assert/strict";
import test from "node:test";

import { enforceProductionServiceBoundary } from "../src/service-boundary.ts";
import { SESSION_TOKEN_SECRET_ID, resolveSessionTokenOnLoad } from "../src/session-token-custody.ts";
import { shareMetaBelongsToService } from "../src/share-url.ts";


const SERVICE_URL = "https://docferry.bondie.io";


test("accepts management metadata only from the configured product service", () => {
  assert.equal(shareMetaBelongsToService({
    id: "shr_current",
    url: "https://docferry.bondie.io/s/current"
  }, SERVICE_URL), true);
  assert.equal(shareMetaBelongsToService({
    id: "shr_retired",
    url: "https://retired.example/s/history"
  }, SERVICE_URL), false);
  assert.equal(shareMetaBelongsToService({ id: "shr_ambiguous" }, SERVICE_URL), false);
});

test("switching product services clears sessions and owner-scoped pending work", () => {
  const settings = {
    serverUrl: "https://retired.example",
    sessionToken: "retired-session",
    connectedAccount: {
      productSubjectId: "retired-owner",
      connectedAt: "2026-08-14T00:00:00.000Z"
    },
    membership: { planKey: "free" },
    pendingMediaNoteImport: {
      jobId: "job_retired",
      ownerProductSubjectId: "retired-owner",
      sourceUrl: "https://example.com/video",
      createdAt: "2026-08-14T00:00:00.000Z"
    },
    pendingMediaNoteSubmission: {
      key: "plugin-retired-key",
      sourceUrl: "https://example.com/video",
      ownerProductSubjectId: "retired-owner",
      createdAt: "2026-08-14T00:00:00.000Z"
    },
    pendingSharePublish: null,
    pendingServiceBoundaryReset: false,
    serviceBoundaryRevision: 0
  };

  assert.equal(enforceProductionServiceBoundary(settings, SERVICE_URL), true);
  assert.equal(settings.serverUrl, SERVICE_URL);
  assert.equal(settings.sessionToken, "");
  assert.equal(settings.connectedAccount, null);
  assert.equal(settings.membership, null);
  assert.equal(settings.pendingMediaNoteImport, null);
  assert.equal(settings.pendingMediaNoteSubmission, null);
  assert.equal(settings.pendingServiceBoundaryReset, true);
  assert.equal(settings.serviceBoundaryRevision, 1);
  assert.equal(enforceProductionServiceBoundary(settings, SERVICE_URL), true);
  settings.pendingServiceBoundaryReset = false;
  assert.equal(enforceProductionServiceBoundary(settings, SERVICE_URL), false);
});

test("an unfinished secure boundary reset remains pending after the URL is normalized", () => {
  const settings = {
    serverUrl: SERVICE_URL,
    sessionToken: "",
    connectedAccount: null,
    membership: null,
    pendingMediaNoteImport: null,
    pendingMediaNoteSubmission: null,
    pendingSharePublish: null,
    pendingServiceBoundaryReset: true,
    serviceBoundaryRevision: 1
  };
  assert.equal(enforceProductionServiceBoundary(settings, SERVICE_URL), true);
});

test("a failed secure reset retries on the next launch before an old token can load", () => {
  const settings = {
    serverUrl: "https://retired.example",
    sessionToken: "",
    connectedAccount: null,
    membership: null,
    pendingMediaNoteImport: null,
    pendingMediaNoteSubmission: null,
    pendingSharePublish: null,
    pendingServiceBoundaryReset: false,
    serviceBoundaryRevision: 0
  };
  const unavailableStore = {
    getSecret: () => "retired-token",
    setSecret: () => {
      throw new Error("SecretStorage unavailable");
    }
  };

  assert.equal(enforceProductionServiceBoundary(settings, SERVICE_URL), true);
  assert.throws(() => resolveSessionTokenOnLoad(unavailableStore, "", true), /unavailable/);
  assert.equal(settings.pendingServiceBoundaryReset, true);

  const secrets = new Map([[SESSION_TOKEN_SECRET_ID, "retired-token"]]);
  const recoveredStore = {
    getSecret: (id: string) => secrets.get(id) ?? null,
    setSecret: (id: string, value: string) => value ? secrets.set(id, value) : secrets.delete(id)
  };
  assert.equal(enforceProductionServiceBoundary(settings, SERVICE_URL), true);
  assert.equal(resolveSessionTokenOnLoad(recoveredStore, "", true).token, "");
  settings.pendingServiceBoundaryReset = false;
  assert.equal(enforceProductionServiceBoundary(settings, SERVICE_URL), false);
  assert.equal(secrets.get(SESSION_TOKEN_SECRET_ID), undefined);
});

test("an upgrade clears a historical token even when an older build already normalized the URL", () => {
  const settings = {
    serverUrl: SERVICE_URL,
    sessionToken: "",
    connectedAccount: null,
    membership: null,
    pendingMediaNoteImport: null,
    pendingMediaNoteSubmission: null,
    pendingSharePublish: null,
    pendingServiceBoundaryReset: false,
    serviceBoundaryRevision: 0
  };
  const secrets = new Map([[SESSION_TOKEN_SECRET_ID, "retired-service-token"]]);
  const store = {
    getSecret: (id: string) => secrets.get(id) ?? null,
    setSecret: (id: string, value: string) => value ? secrets.set(id, value) : secrets.delete(id)
  };

  assert.equal(enforceProductionServiceBoundary(settings, SERVICE_URL), true);
  assert.equal(resolveSessionTokenOnLoad(store, "", true).token, "");
  assert.equal(settings.serviceBoundaryRevision, 1);
  assert.equal(secrets.get(SESSION_TOKEN_SECRET_ID), undefined);
});
