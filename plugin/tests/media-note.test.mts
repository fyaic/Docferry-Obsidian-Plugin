import assert from "node:assert/strict";
import test from "node:test";

import {
  MEDIA_NOTE_MAX_POLL_ATTEMPTS,
  MEDIA_NOTE_POLL_INTERVAL_MS,
  MEDIA_NOTE_READY_STATUSES,
  MEDIA_NOTE_TERMINAL_STATUSES,
  mediaNoteFailureMessage,
  mediaNoteSummary,
  mediaNoteTitle
} from "../src/media-note.ts";
import type { MediaNoteJobResponse } from "../src/types.ts";


function job(overrides: Partial<MediaNoteJobResponse> = {}): MediaNoteJobResponse {
  return {
    job_id: "mnj_test",
    source_url: "https://example.com/article",
    source_kind: "article",
    provider: "web",
    output_language: "en",
    status: "extracted",
    fetched_bytes: 1024,
    redirect_count: 0,
    warnings: [],
    result_contract: {
      title: "A reliable article note",
      summary: "  A useful summary\nwith clean spacing.  "
    },
    markdown: "# A reliable article note\n",
    expires_at: "2026-07-21T00:00:00Z",
    created_at: "2026-07-14T00:00:00Z",
    updated_at: "2026-07-14T00:00:01Z",
    ...overrides
  };
}

test("recognizes only completed note states as ready while all final states are terminal", () => {
  assert.deepEqual([...MEDIA_NOTE_READY_STATUSES], ["extracted", "degraded"]);
  for (const status of ["extracted", "degraded", "unsupported", "failed", "cancelled", "expired"]) {
    assert.equal(MEDIA_NOTE_TERMINAL_STATUSES.has(status), true, status);
  }
  assert.equal(MEDIA_NOTE_TERMINAL_STATUSES.has("fetching"), false);
});

test("waits long enough for two queued three-stage Ark pipelines", () => {
  assert.ok(MEDIA_NOTE_MAX_POLL_ATTEMPTS * MEDIA_NOTE_POLL_INTERVAL_MS >= 18 * 60 * 1_000);
});

test("uses bounded server title and summary with safe retained-job fallbacks", () => {
  assert.equal(mediaNoteTitle(job()), "A reliable article note");
  assert.equal(mediaNoteSummary(job()), "A useful summary with clean spacing.");
  assert.equal(mediaNoteTitle(job({ result_contract: null })), "example.com");
  assert.equal(mediaNoteTitle(job({ source_url: null, result_contract: null })), "Detailed note");
});

test("keeps failure messages useful without leaking internal details", () => {
  assert.equal(mediaNoteFailureMessage(job({ status: "cancelled" })), "Detailed note creation was cancelled.");
  assert.equal(
    mediaNoteFailureMessage(job({ status: "failed", error_message: "The page could not be read safely." })),
    "The page could not be read safely."
  );
});
