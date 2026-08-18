import type { MediaNoteJobResponse } from "./types";

export interface PendingMediaNoteSubmission {
  key: string;
  sourceUrl: string;
  ownerProductSubjectId: string;
  createdAt: string;
}

export interface MediaNoteSubmissionStore {
  read(): PendingMediaNoteSubmission | null;
  save(record: PendingMediaNoteSubmission | null): Promise<void>;
}

export interface MediaNoteSubmissionDeps {
  store: MediaNoteSubmissionStore;
  createJob(sourceUrl: string, key: string): Promise<MediaNoteJobResponse>;
  trackImport(job: MediaNoteJobResponse, record: PendingMediaNoteSubmission): Promise<void>;
  generateKey(): string;
  now(): string;
}

export const MEDIA_NOTE_SUBMISSION_LOST_CONNECTION_MESSAGE =
  "The connection was lost while starting your detailed note. Retrying the same link resumes safely without creating a duplicate.";

export const MEDIA_NOTE_SUBMISSION_RESUME_MESSAGE =
  "Your previous detailed note import resumed. Start this link again after it finishes or is cancelled.";

export const MEDIA_NOTE_CONFIRM_LOST_CONNECTION_MESSAGE =
  "The connection was lost while confirming your previous import. Retrying is safe and will not create a duplicate.";

export function isDefinitiveSubmissionRejection(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 && status < 500;
}

/**
 * Re-POST a persisted submission exactly once to resolve an uncertain create.
 * Returns the recovered job (import tracked, record cleared), or null when the
 * server definitively rejected the key (record cleared). Uncertain failures
 * keep the record so a later retry can reuse the same key.
 */
export async function resolvePendingMediaNoteSubmission(
  deps: MediaNoteSubmissionDeps,
  record: PendingMediaNoteSubmission
): Promise<MediaNoteJobResponse | null> {
  let created: MediaNoteJobResponse;
  try {
    created = await deps.createJob(record.sourceUrl, record.key);
  } catch (error) {
    if (isDefinitiveSubmissionRejection(error)) {
      await deps.store.save(null);
      return null;
    }
    throw new Error(MEDIA_NOTE_CONFIRM_LOST_CONNECTION_MESSAGE);
  }
  await deps.trackImport(created, record);
  await deps.store.save(null);
  return created;
}

/**
 * Create a Media Note job with a durable, owner-scoped operation key. The key
 * is persisted before the create request, reused across uncertain retries,
 * and cleared only when the server gives a definitive answer.
 */
export async function submitMediaNoteJob(
  deps: MediaNoteSubmissionDeps,
  sourceUrl: string,
  ownerProductSubjectId: string
): Promise<MediaNoteJobResponse> {
  const existing = deps.store.read();
  if (existing && existing.ownerProductSubjectId !== ownerProductSubjectId) {
    await deps.store.save(null);
  } else if (existing && existing.sourceUrl !== sourceUrl) {
    const recovered = await resolvePendingMediaNoteSubmission(deps, existing);
    if (recovered) throw new Error(MEDIA_NOTE_SUBMISSION_RESUME_MESSAGE);
  }
  let record = deps.store.read();
  if (!record) {
    record = {
      key: deps.generateKey(),
      sourceUrl,
      ownerProductSubjectId,
      createdAt: deps.now()
    };
    await deps.store.save(record);
  }
  let created: MediaNoteJobResponse;
  try {
    created = await deps.createJob(record.sourceUrl, record.key);
  } catch (error) {
    if (isDefinitiveSubmissionRejection(error)) {
      await deps.store.save(null);
      throw error;
    }
    throw new Error(MEDIA_NOTE_SUBMISSION_LOST_CONNECTION_MESSAGE);
  }
  await deps.trackImport(created, record);
  await deps.store.save(null);
  return created;
}
