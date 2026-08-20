import type { SharePayload, ShareResponse } from "./types";

export interface PendingSharePublish {
  key: string;
  filePath: string;
  payloadHash: string;
  sourceHash?: string;
  ownerProductSubjectId: string;
  createdAt: string;
  response?: ShareResponse | null;
}

export interface SubmittedShareCreate {
  response: ShareResponse;
  operationKey: string;
  payloadChanged: boolean;
  filePathChanged: boolean;
  originalFilePath: string;
}

export interface SharePublishSubmissionStore {
  read(): PendingSharePublish | null;
  save(record: PendingSharePublish | null): Promise<void>;
}

export interface SharePublishSubmissionDeps {
  store: SharePublishSubmissionStore;
  createShare(payload: SharePayload, key: string): Promise<ShareResponse>;
  resolveShare(key: string): Promise<ShareResponse>;
  generateKey(): string;
  now(): string;
}

export const SHARE_PUBLISH_LOST_CONNECTION_MESSAGE =
  "The connection was lost while publishing. Publishing the same note again resumes safely without creating a duplicate link.";
export const SHARE_PUBLISH_PENDING_ACCOUNT_MESSAGE =
  "A share from another Bondie account is still being recovered. Reconnect that account before publishing a new link.";

export function isDefinitiveSharePublishRejection(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 && status < 500;
}

function isInactiveShareReplay(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "share_idempotency_inactive";
}

function isMissingShareOperation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "share_idempotency_not_found";
}

async function clearCurrentOperation(store: SharePublishSubmissionStore, key: string): Promise<void> {
  if (store.read()?.key === key) await store.save(null);
}

/**
 * Stable serialization for the client-side payload hash. Hashes are only ever
 * compared against other hashes from this function, so this does not need to
 * match the server's request hash byte-for-byte.
 */
export function stableSharePayloadString(payload: SharePayload): string {
  return JSON.stringify(sortKeysDeep(payload));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = sortKeysDeep(source[key]);
    return sorted;
  }
  return value;
}

/**
 * Create a share with a durable, owner-scoped idempotency key. The key is
 * persisted before the create request, resolved before the same note can be
 * published again after an uncertain failure, and retained until
 * the caller durably writes the returned share identity into frontmatter.
 *
 * A pending record for a different note blocks another create. It
 * cannot be discarded safely because the previous request may already have
 * committed remotely even when its response was lost.
 */
export async function submitShareCreate(
  deps: SharePublishSubmissionDeps,
  input: {
    filePath: string;
    payload: SharePayload;
    payloadHash: string;
    sourceHash: string;
    ownerProductSubjectId: string;
  },
  inactiveRetryRemaining = 1
): Promise<SubmittedShareCreate> {
  const existing = deps.store.read();
  if (existing && existing.ownerProductSubjectId !== input.ownerProductSubjectId) {
    throw new Error(SHARE_PUBLISH_PENDING_ACCOUNT_MESSAGE);
  } else if (existing) {
    try {
      const resolved = await deps.resolveShare(existing.key);
      await deps.store.save({ ...existing, response: resolved });
      return {
        response: resolved,
        operationKey: existing.key,
        payloadChanged: existing.payloadHash !== input.payloadHash,
        filePathChanged: existing.filePath !== input.filePath,
        originalFilePath: existing.filePath
      };
    } catch (error) {
      if (isMissingShareOperation(error) || isInactiveShareReplay(error)) {
        await clearCurrentOperation(deps.store, existing.key);
      } else if (isDefinitiveSharePublishRejection(error)) {
        throw error;
      } else {
        throw new Error(SHARE_PUBLISH_LOST_CONNECTION_MESSAGE);
      }
    }
  }
  let record = deps.store.read();
  if (!record) {
    record = {
      key: deps.generateKey(),
      filePath: input.filePath,
      payloadHash: input.payloadHash,
      sourceHash: input.sourceHash,
      ownerProductSubjectId: input.ownerProductSubjectId,
      createdAt: deps.now()
    };
    await deps.store.save(record);
  }
  let created: ShareResponse;
  try {
    created = await deps.createShare(input.payload, record.key);
  } catch (error) {
    if (isInactiveShareReplay(error)) {
      await clearCurrentOperation(deps.store, record.key);
      if (inactiveRetryRemaining > 0) {
        return submitShareCreate(deps, input, inactiveRetryRemaining - 1);
      }
      throw error;
    }
    if (isDefinitiveSharePublishRejection(error)) {
      await clearCurrentOperation(deps.store, record.key);
      throw error;
    }
    throw new Error(SHARE_PUBLISH_LOST_CONNECTION_MESSAGE);
  }
  await deps.store.save({ ...record, response: created });
  return {
    response: created,
    operationKey: record.key,
    payloadChanged: false,
    filePathChanged: false,
    originalFilePath: record.filePath
  };
}

export async function finalizeShareCreate(
  store: SharePublishSubmissionStore,
  operationKey: string
): Promise<void> {
  await clearCurrentOperation(store, operationKey);
}
