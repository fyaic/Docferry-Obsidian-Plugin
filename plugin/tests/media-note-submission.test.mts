import assert from "node:assert/strict";
import test from "node:test";

import {
  MEDIA_NOTE_CONFIRM_LOST_CONNECTION_MESSAGE,
  MEDIA_NOTE_SUBMISSION_LOST_CONNECTION_MESSAGE,
  MEDIA_NOTE_SUBMISSION_RESUME_MESSAGE,
  isDefinitiveSubmissionRejection,
  submitMediaNoteJob,
  type MediaNoteSubmissionDeps,
  type PendingMediaNoteSubmission
} from "../src/media-note-submission.ts";
import type { MediaNoteJobResponse } from "../src/types.ts";


const OWNER = "psub_owner_one";
const OTHER_OWNER = "psub_owner_two";
const URL_A = "https://example.com/article-a";
const URL_B = "https://example.com/article-b";


function job(jobId: string, sourceUrl: string): MediaNoteJobResponse {
  return {
    job_id: jobId,
    source_url: sourceUrl,
    source_kind: "article",
    provider: "web",
    output_language: "source",
    status: "queued",
    fetched_bytes: 0,
    redirect_count: 0,
    warnings: [],
    result_contract: null,
    markdown: null,
    expires_at: "2026-08-18T00:00:00Z",
    created_at: "2026-08-17T00:00:00Z",
    updated_at: "2026-08-17T00:00:00Z"
  };
}

interface FakeCreateCall {
  sourceUrl: string;
  key: string;
}

function makeDeps(options: {
  initial?: PendingMediaNoteSubmission | null;
  failCreate?: (call: FakeCreateCall, attempt: number) => unknown;
}): {
  deps: MediaNoteSubmissionDeps;
  state: { record: PendingMediaNoteSubmission | null };
  creates: FakeCreateCall[];
  tracked: Array<{ jobId: string; record: PendingMediaNoteSubmission }>;
  saves: Array<PendingMediaNoteSubmission | null>;
  generatedKeys: string[];
} {
  const state = { record: options.initial ?? null };
  const creates: FakeCreateCall[] = [];
  const tracked: Array<{ jobId: string; record: PendingMediaNoteSubmission }> = [];
  const saves: Array<PendingMediaNoteSubmission | null> = [];
  const generatedKeys: string[] = [];
  const deps: MediaNoteSubmissionDeps = {
    store: {
      read: () => state.record,
      save: async (record) => {
        saves.push(record);
        state.record = record;
      }
    },
    createJob: async (sourceUrl, key) => {
      const call = { sourceUrl, key };
      creates.push(call);
      const failure = options.failCreate?.(call, creates.length);
      if (failure) throw failure;
      return job(`mnj_attempt_${creates.length}`, sourceUrl);
    },
    trackImport: async (created, record) => {
      tracked.push({ jobId: created.job_id, record });
    },
    generateKey: () => {
      const key = `plugin-test-key-${generatedKeys.length + 1}`;
      generatedKeys.push(key);
      return key;
    },
    now: () => "2026-08-17T00:00:00.000Z"
  };
  return { deps, state, creates, tracked, saves, generatedKeys };
}

function apiError(status: number, code: string): Error & { status: number; code: string } {
  return Object.assign(new Error(`status ${status}`), { status, code });
}


test("classifies only 4xx responses as definitive submission rejections", () => {
  assert.equal(isDefinitiveSubmissionRejection(apiError(400, "media_note_idempotency_key_required")), true);
  assert.equal(isDefinitiveSubmissionRejection(apiError(409, "media_note_idempotency_conflict")), true);
  assert.equal(isDefinitiveSubmissionRejection(apiError(429, "media_note_active_limit")), true);
  assert.equal(isDefinitiveSubmissionRejection(apiError(500, "internal_error")), false);
  assert.equal(isDefinitiveSubmissionRejection(apiError(0, "invalid_share_url")), false);
  assert.equal(isDefinitiveSubmissionRejection(new Error("network down")), false);
  assert.equal(isDefinitiveSubmissionRejection(null), false);
});

test("persists the operation key before the create request and clears it after success", async () => {
  const { deps, state, creates, tracked, saves, generatedKeys } = makeDeps({});

  const created = await submitMediaNoteJob(deps, URL_A, OWNER);

  assert.equal(created.job_id, "mnj_attempt_1");
  assert.deepEqual(generatedKeys, ["plugin-test-key-1"]);
  // The record with the key is saved before the create request is made.
  assert.deepEqual(saves[0], {
    key: "plugin-test-key-1",
    sourceUrl: URL_A,
    ownerProductSubjectId: OWNER,
    createdAt: "2026-08-17T00:00:00.000Z"
  });
  assert.deepEqual(creates, [{ sourceUrl: URL_A, key: "plugin-test-key-1" }]);
  // Success tracks the import, then clears the submission record.
  assert.deepEqual(tracked, [
    {
      jobId: "mnj_attempt_1",
      record: {
        key: "plugin-test-key-1",
        sourceUrl: URL_A,
        ownerProductSubjectId: OWNER,
        createdAt: "2026-08-17T00:00:00.000Z"
      }
    }
  ]);
  assert.equal(saves[1], null);
  assert.equal(state.record, null);
});

test("a retry after a lost response reuses the same key and recovers the job", async () => {
  let failFirst = true;
  const { deps, state, creates, tracked, generatedKeys } = makeDeps({
    failCreate: () => {
      if (failFirst) {
        failFirst = false;
        return new Error("network down");
      }
      return undefined;
    }
  });

  await assert.rejects(
    () => submitMediaNoteJob(deps, URL_A, OWNER),
    (error: unknown) => {
      assert.equal((error as Error).message, MEDIA_NOTE_SUBMISSION_LOST_CONNECTION_MESSAGE);
      return true;
    }
  );
  assert.equal(state.record?.key, "plugin-test-key-1");
  assert.equal(tracked.length, 0);

  const recovered = await submitMediaNoteJob(deps, URL_A, OWNER);

  assert.equal(recovered.job_id, "mnj_attempt_2");
  assert.deepEqual(generatedKeys, ["plugin-test-key-1"]);
  assert.deepEqual(creates, [
    { sourceUrl: URL_A, key: "plugin-test-key-1" },
    { sourceUrl: URL_A, key: "plugin-test-key-1" }
  ]);
  assert.equal(tracked[0]?.jobId, "mnj_attempt_2");
  assert.equal(state.record, null);
});

test("a definitive 4xx clears the record and rethrows the server error unchanged", async () => {
  const rejection = apiError(403, "media_note_paid_required");
  const { deps, state, generatedKeys } = makeDeps({ failCreate: () => rejection });

  await assert.rejects(
    () => submitMediaNoteJob(deps, URL_A, OWNER),
    (error: unknown) => {
      assert.equal(error, rejection);
      return true;
    }
  );
  assert.equal(state.record, null);
  assert.deepEqual(generatedKeys, ["plugin-test-key-1"]);
});

test("a different link while a submission is unresolved resumes the previous job and blocks the new one", async () => {
  const pending: PendingMediaNoteSubmission = {
    key: "plugin-stored-key",
    sourceUrl: URL_A,
    ownerProductSubjectId: OWNER,
    createdAt: "2026-08-17T00:00:00.000Z"
  };
  const { deps, state, creates, tracked, generatedKeys } = makeDeps({ initial: pending });

  await assert.rejects(
    () => submitMediaNoteJob(deps, URL_B, OWNER),
    (error: unknown) => {
      assert.equal((error as Error).message, MEDIA_NOTE_SUBMISSION_RESUME_MESSAGE);
      return true;
    }
  );

  // The stored submission is re-POSTed once; the new link is never submitted.
  assert.deepEqual(creates, [{ sourceUrl: URL_A, key: "plugin-stored-key" }]);
  assert.equal(tracked[0]?.jobId, "mnj_attempt_1");
  assert.equal(tracked[0]?.record, pending);
  assert.equal(state.record, null);
  assert.deepEqual(generatedKeys, []);
});

test("a definitive 4xx while resolving a different pending link clears it and proceeds with the new link", async () => {
  const pending: PendingMediaNoteSubmission = {
    key: "plugin-stored-key",
    sourceUrl: URL_A,
    ownerProductSubjectId: OWNER,
    createdAt: "2026-08-17T00:00:00.000Z"
  };
  const rejection = apiError(409, "media_note_job_deleted");
  const { deps, state, creates, generatedKeys } = makeDeps({
    initial: pending,
    failCreate: (call) => (call.key === "plugin-stored-key" ? rejection : undefined)
  });

  const created = await submitMediaNoteJob(deps, URL_B, OWNER);

  assert.equal(created.job_id, "mnj_attempt_2");
  assert.deepEqual(creates, [
    { sourceUrl: URL_A, key: "plugin-stored-key" },
    { sourceUrl: URL_B, key: "plugin-test-key-1" }
  ]);
  assert.equal(state.record, null);
  assert.deepEqual(generatedKeys, ["plugin-test-key-1"]);
});

test("an uncertain failure while resolving a different pending link keeps the record", async () => {
  const pending: PendingMediaNoteSubmission = {
    key: "plugin-stored-key",
    sourceUrl: URL_A,
    ownerProductSubjectId: OWNER,
    createdAt: "2026-08-17T00:00:00.000Z"
  };
  const { deps, state, creates, generatedKeys } = makeDeps({
    initial: pending,
    failCreate: () => new Error("network down")
  });

  await assert.rejects(
    () => submitMediaNoteJob(deps, URL_B, OWNER),
    (error: unknown) => {
      assert.equal((error as Error).message, MEDIA_NOTE_CONFIRM_LOST_CONNECTION_MESSAGE);
      return true;
    }
  );
  assert.equal(state.record, pending);
  assert.deepEqual(creates, [{ sourceUrl: URL_A, key: "plugin-stored-key" }]);
  assert.deepEqual(generatedKeys, []);
});

test("a submission record from another account is dropped before a fresh key is persisted", async () => {
  const pending: PendingMediaNoteSubmission = {
    key: "plugin-other-account-key",
    sourceUrl: URL_A,
    ownerProductSubjectId: OTHER_OWNER,
    createdAt: "2026-08-17T00:00:00.000Z"
  };
  const { deps, state, creates, generatedKeys } = makeDeps({ initial: pending });

  const created = await submitMediaNoteJob(deps, URL_A, OWNER);

  assert.equal(created.job_id, "mnj_attempt_1");
  assert.deepEqual(creates, [{ sourceUrl: URL_A, key: "plugin-test-key-1" }]);
  assert.deepEqual(generatedKeys, ["plugin-test-key-1"]);
  assert.equal(state.record, null);
});
