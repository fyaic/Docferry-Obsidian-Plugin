import assert from "node:assert/strict";
import test from "node:test";

import { enforceProductionServiceBoundary } from "../src/service-boundary.ts";
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
    }
  };

  assert.equal(enforceProductionServiceBoundary(settings, SERVICE_URL), true);
  assert.equal(settings.serverUrl, SERVICE_URL);
  assert.equal(settings.sessionToken, "");
  assert.equal(settings.connectedAccount, null);
  assert.equal(settings.membership, null);
  assert.equal(settings.pendingMediaNoteImport, null);
  assert.equal(settings.pendingMediaNoteSubmission, null);
  assert.equal(enforceProductionServiceBoundary(settings, SERVICE_URL), false);
});
