import assert from "node:assert/strict";
import test from "node:test";

import {
  SHARE_PUBLISH_LOST_CONNECTION_MESSAGE,
  SHARE_PUBLISH_PENDING_ACCOUNT_MESSAGE,
  finalizeShareCreate,
  isDefinitiveSharePublishRejection,
  stableSharePayloadString,
  submitShareCreate,
  type PendingSharePublish,
  type SharePublishSubmissionDeps
} from "../src/share-publish-submission.ts";
import type { SharePayload, ShareResponse } from "../src/types.ts";


const OWNER = "psub_owner_one";
const OTHER_OWNER = "psub_owner_two";
const FILE_PATH = "Notes/hello.md";


function payload(title = "Hello"): SharePayload {
  return {
    vault_id: "vlt_test",
    source_path: FILE_PATH,
    source_path_normalized: "notes/hello.md",
    doc_identity: null,
    source_hash: "sha256:test",
    title,
    markdown: "# Hello",
    html_snapshot: null,
    theme_mode: "reader",
    css_asset_id: null,
    assets: [],
    outbound_links: [],
    expires_at: null,
    client: {
      plugin_id: "docferry",
      plugin_version: "0.0.67",
      obsidian_version: "1.5.0"
    }
  };
}

function share(shareId: string): ShareResponse {
  return {
    share_id: shareId,
    slug: `slug-${shareId}`,
    url: `https://docferry.example/s/slug-${shareId}`,
    title: "Hello",
    status: "active",
    theme_mode: "reader",
    password_enabled: false,
    expires_at: null,
    created_at: "2026-08-18T00:00:00Z",
    updated_at: "2026-08-18T00:00:00Z"
  };
}

interface FakeCreateCall {
  payload: SharePayload;
  key: string;
}

interface FakeResolveCall {
  key: string;
}

function makeDeps(options: {
  initial?: PendingSharePublish | null;
  failCreate?: (call: FakeCreateCall, attempt: number) => unknown;
  resolveShare?: (call: FakeResolveCall, attempt: number) => ShareResponse | unknown;
}): {
  deps: SharePublishSubmissionDeps;
  state: { record: PendingSharePublish | null };
  creates: FakeCreateCall[];
  resolves: FakeResolveCall[];
  saves: Array<PendingSharePublish | null>;
  generatedKeys: string[];
} {
  const state = { record: options.initial ?? null };
  const creates: FakeCreateCall[] = [];
  const resolves: FakeResolveCall[] = [];
  const saves: Array<PendingSharePublish | null> = [];
  const generatedKeys: string[] = [];
  const deps: SharePublishSubmissionDeps = {
    store: {
      read: () => state.record,
      save: async (record) => {
        saves.push(record);
        state.record = record;
      }
    },
    createShare: async (createPayload, key) => {
      const call = { payload: createPayload, key };
      creates.push(call);
      const failure = options.failCreate?.(call, creates.length);
      if (failure) throw failure;
      return share(`sh_attempt_${creates.length}`);
    },
    resolveShare: async (key) => {
      const call = { key };
      resolves.push(call);
      const result = options.resolveShare?.(call, resolves.length);
      if (
        result instanceof Error ||
        (result && typeof result === "object" && typeof (result as { status?: unknown }).status === "number")
      ) throw result;
      if (result) return result as ShareResponse;
      throw apiError(404, "share_idempotency_not_found");
    },
    generateKey: () => {
      const key = `plugin-test-key-${generatedKeys.length + 1}`;
      generatedKeys.push(key);
      return key;
    },
    now: () => "2026-08-18T00:00:00.000Z"
  };
  return { deps, state, creates, resolves, saves, generatedKeys };
}

function apiError(status: number, code: string): Error & { status: number; code: string } {
  return Object.assign(new Error(`status ${status}`), { status, code });
}

function input(overrides: { filePath?: string; payloadHash?: string; owner?: string } = {}) {
  return {
    filePath: overrides.filePath ?? FILE_PATH,
    payload: payload(),
    payloadHash: overrides.payloadHash ?? "payload-hash-1",
    sourceHash: "sha256:test",
    ownerProductSubjectId: overrides.owner ?? OWNER
  };
}


test("classifies only 4xx responses as definitive publish rejections", () => {
  assert.equal(isDefinitiveSharePublishRejection(apiError(400, "share_idempotency_key_invalid")), true);
  assert.equal(isDefinitiveSharePublishRejection(apiError(409, "share_idempotency_conflict")), true);
  assert.equal(isDefinitiveSharePublishRejection(apiError(403, "share_limit_reached")), true);
  assert.equal(isDefinitiveSharePublishRejection(apiError(500, "internal_error")), false);
  assert.equal(isDefinitiveSharePublishRejection(apiError(0, "offline")), false);
  assert.equal(isDefinitiveSharePublishRejection(new Error("network down")), false);
  assert.equal(isDefinitiveSharePublishRejection(null), false);
});

test("stable payload serialization is insensitive to key order", () => {
  const left = payload();
  const right = { ...payload(), client: { obsidian_version: "1.5.0", plugin_version: "0.0.67", plugin_id: "docferry" } };

  assert.equal(stableSharePayloadString(left), stableSharePayloadString(right));
  assert.notEqual(stableSharePayloadString(payload("Hello")), stableSharePayloadString(payload("Changed")));
});

test("persists the idempotency key and response until frontmatter commits", async () => {
  const { deps, state, creates, saves, generatedKeys } = makeDeps({});

  const created = await submitShareCreate(deps, input());

  assert.equal(created.response.share_id, "sh_attempt_1");
  assert.equal(created.operationKey, "plugin-test-key-1");
  assert.deepEqual(generatedKeys, ["plugin-test-key-1"]);
  // The record with the key is saved before the create request is made.
  assert.deepEqual(saves[0], {
    key: "plugin-test-key-1",
    filePath: FILE_PATH,
    payloadHash: "payload-hash-1",
    sourceHash: "sha256:test",
    ownerProductSubjectId: OWNER,
    createdAt: "2026-08-18T00:00:00.000Z"
  });
  assert.deepEqual(creates.map((call) => call.key), ["plugin-test-key-1"]);
  assert.equal(saves[1]?.response?.share_id, "sh_attempt_1");
  assert.equal(state.record?.key, "plugin-test-key-1");

  await finalizeShareCreate(deps.store, created.operationKey);
  assert.equal(state.record, null);
});

test("a retry after a lost response resolves the committed operation without another create", async () => {
  let failFirst = true;
  const committed = share("sh_committed_before_disconnect");
  const { deps, state, creates, resolves, generatedKeys } = makeDeps({
    failCreate: () => {
      if (failFirst) {
        failFirst = false;
        return new Error("network down");
      }
      return undefined;
    },
    resolveShare: () => committed
  });

  await assert.rejects(
    () => submitShareCreate(deps, input()),
    (error: unknown) => {
      assert.equal((error as Error).message, SHARE_PUBLISH_LOST_CONNECTION_MESSAGE);
      return true;
    }
  );
  assert.equal(state.record?.key, "plugin-test-key-1");

  const recovered = await submitShareCreate(deps, input());

  assert.equal(recovered.response.share_id, "sh_committed_before_disconnect");
  assert.deepEqual(generatedKeys, ["plugin-test-key-1"]);
  assert.deepEqual(creates.map((call) => call.key), ["plugin-test-key-1"]);
  assert.deepEqual(resolves.map((call) => call.key), ["plugin-test-key-1"]);
  assert.equal(state.record?.response?.share_id, "sh_committed_before_disconnect");
  await finalizeShareCreate(deps.store, recovered.operationKey);
  assert.equal(state.record, null);
});

test("a definitive 4xx clears the record and rethrows the server error unchanged", async () => {
  const rejection = apiError(403, "share_limit_reached");
  const { deps, state, generatedKeys } = makeDeps({ failCreate: () => rejection });

  await assert.rejects(
    () => submitShareCreate(deps, input()),
    (error: unknown) => {
      assert.equal(error, rejection);
      return true;
    }
  );
  assert.equal(state.record, null);
  assert.deepEqual(generatedKeys, ["plugin-test-key-1"]);
});

test("a changed payload resolves the original operation and reports that an update is required", async () => {
  const pending: PendingSharePublish = {
    key: "plugin-stored-key",
    filePath: FILE_PATH,
    payloadHash: "payload-hash-old",
    ownerProductSubjectId: OWNER,
    createdAt: "2026-08-18T00:00:00.000Z"
  };
  const recoveredResponse = share("sh_original_operation");
  const { deps, state, creates, resolves, generatedKeys } = makeDeps({
    initial: pending,
    resolveShare: () => recoveredResponse
  });

  const recovered = await submitShareCreate(deps, input({ payloadHash: "payload-hash-new" }));

  assert.equal(recovered.response.share_id, "sh_original_operation");
  assert.equal(recovered.payloadChanged, true);
  assert.equal(recovered.filePathChanged, false);
  assert.deepEqual(creates, []);
  assert.deepEqual(resolves.map((call) => call.key), ["plugin-stored-key"]);
  assert.deepEqual(generatedKeys, []);
  assert.equal(state.record?.key, "plugin-stored-key");
});

test("a pending operation for another note is resolved and marked for explicit reassignment", async () => {
  const pending: PendingSharePublish = {
    key: "plugin-other-note-key",
    filePath: "Notes/other.md",
    payloadHash: "payload-hash-old",
    ownerProductSubjectId: OWNER,
    createdAt: "2026-08-18T00:00:00.000Z"
  };
  const recoveredResponse = share("sh_other_note_operation");
  const { deps, creates, resolves, generatedKeys, state } = makeDeps({
    initial: pending,
    resolveShare: () => recoveredResponse
  });

  const recovered = await submitShareCreate(deps, input());

  assert.deepEqual(creates, []);
  assert.deepEqual(resolves.map((call) => call.key), ["plugin-other-note-key"]);
  assert.deepEqual(generatedKeys, []);
  assert.equal(state.record?.key, "plugin-other-note-key");
  assert.equal(recovered.filePathChanged, true);
  assert.equal(recovered.originalFilePath, "Notes/other.md");
  assert.equal(recovered.payloadChanged, true);
});

test("a publish record from another account is never discarded or replaced", async () => {
  const pending: PendingSharePublish = {
    key: "plugin-other-account-key",
    filePath: FILE_PATH,
    payloadHash: "payload-hash-1",
    ownerProductSubjectId: OTHER_OWNER,
    createdAt: "2026-08-18T00:00:00.000Z"
  };
  const { deps, state, creates, generatedKeys, resolves } = makeDeps({ initial: pending });

  await assert.rejects(
    () => submitShareCreate(deps, input()),
    (error: unknown) => {
      assert.equal((error as Error).message, SHARE_PUBLISH_PENDING_ACCOUNT_MESSAGE);
      return true;
    }
  );

  assert.deepEqual(creates, []);
  assert.deepEqual(resolves, []);
  assert.deepEqual(generatedKeys, []);
  assert.equal(state.record?.key, "plugin-other-account-key");
});

test("a stored response is revalidated with the server before it is reused", async () => {
  const recoveredResponse = share("sh_recovered");
  const pending: PendingSharePublish = {
    key: "plugin-stored-key",
    filePath: FILE_PATH,
    payloadHash: "payload-hash-1",
    ownerProductSubjectId: OWNER,
    createdAt: "2026-08-18T00:00:00.000Z",
    response: recoveredResponse
  };
  const currentResponse = share("sh_recovered_current");
  const { deps, creates, resolves } = makeDeps({
    initial: pending,
    resolveShare: () => currentResponse
  });

  const recovered = await submitShareCreate(deps, input());

  assert.equal(recovered.response.share_id, "sh_recovered_current");
  assert.equal(recovered.operationKey, "plugin-stored-key");
  assert.deepEqual(creates, []);
  assert.deepEqual(resolves.map((call) => call.key), ["plugin-stored-key"]);
});

test("an inactive resolved operation is cleared before a fresh share is created", async () => {
  const pending: PendingSharePublish = {
    key: "plugin-stopped-key",
    filePath: FILE_PATH,
    payloadHash: "payload-hash-old",
    ownerProductSubjectId: OWNER,
    createdAt: "2026-08-18T00:00:00.000Z"
  };
  const { deps, creates, generatedKeys, state } = makeDeps({
    initial: pending,
    resolveShare: () => apiError(409, "share_idempotency_inactive")
  });

  const created = await submitShareCreate(deps, input());

  assert.equal(created.response.share_id, "sh_attempt_1");
  assert.deepEqual(generatedKeys, ["plugin-test-key-1"]);
  assert.deepEqual(creates.map((call) => call.key), ["plugin-test-key-1"]);
  assert.equal(state.record?.key, "plugin-test-key-1");
});

test("an inactive idempotent replay clears the stale key and creates a fresh share", async () => {
  const inactive = apiError(409, "share_idempotency_inactive");
  const { deps, creates, generatedKeys, state } = makeDeps({
    failCreate: (_call, attempt) => attempt === 1 ? inactive : undefined
  });

  const created = await submitShareCreate(deps, input());

  assert.equal(created.response.share_id, "sh_attempt_2");
  assert.deepEqual(generatedKeys, ["plugin-test-key-1", "plugin-test-key-2"]);
  assert.deepEqual(creates.map((call) => call.key), ["plugin-test-key-1", "plugin-test-key-2"]);
  assert.equal(state.record?.key, "plugin-test-key-2");
});

test("an inactive idempotent replay is retried only once", async () => {
  const inactive = apiError(409, "share_idempotency_inactive");
  const { deps, creates, generatedKeys, state } = makeDeps({
    failCreate: () => inactive
  });

  await assert.rejects(
    () => submitShareCreate(deps, input()),
    (error: unknown) => error === inactive
  );

  assert.deepEqual(generatedKeys, ["plugin-test-key-1", "plugin-test-key-2"]);
  assert.deepEqual(creates.map((call) => call.key), ["plugin-test-key-1", "plugin-test-key-2"]);
  assert.equal(state.record, null);
});
