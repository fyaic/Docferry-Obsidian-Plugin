import type { MediaNoteJobResponse } from "./types";

export const MEDIA_NOTE_READY_STATUSES = new Set(["extracted", "degraded"]);
export const MEDIA_NOTE_TERMINAL_STATUSES = new Set([
  "extracted",
  "degraded",
  "unsupported",
  "failed",
  "cancelled",
  "expired"
]);

export const MEDIA_NOTE_POLL_INTERVAL_MS = 1_500;
export const MEDIA_NOTE_MAX_POLL_ATTEMPTS = 800;

export function mediaNoteTitle(job: MediaNoteJobResponse): string {
  const title = job.result_contract?.title;
  if (typeof title === "string" && title.trim()) return title.trim().slice(0, 160);
  if (job.source_url) {
    try {
      return new URL(job.source_url).hostname.replace(/^www\./, "") || "Detailed note";
    } catch {
      // The server already validated this URL; keep a harmless fallback for retained job shells.
    }
  }
  return "Detailed note";
}

export function mediaNoteSummary(job: MediaNoteJobResponse): string {
  const summary = job.result_contract?.summary;
  if (typeof summary !== "string") return "";
  return summary.replace(/\s+/g, " ").trim().slice(0, 320);
}

export function mediaNoteFailureMessage(job: MediaNoteJobResponse): string {
  if (job.status === "cancelled") return "Detailed note creation was cancelled.";
  if (job.status === "expired") return "This detailed note expired before it was saved.";
  if (job.status === "unsupported") return "This page cannot be turned into a detailed note yet.";
  return job.error_message || "DocFerry could not create a detailed note from this page.";
}
