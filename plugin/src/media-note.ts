import type { MediaNoteJobResponse } from "./types";

export type MediaNoteProgress = "starting" | "reading" | "writing" | "reviewing";

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

export function mediaNoteProgressMessage(progress: MediaNoteProgress): string {
  if (progress === "starting") return "Starting advanced import...";
  if (progress === "reading") return "Reading the source. Longer audio and video can take a few minutes.";
  if (progress === "writing") return "Creating your note. You can keep working while this finishes.";
  return "Preparing your preview...";
}

export function mediaNoteTitle(job: MediaNoteJobResponse): string {
  const title = job.result_contract?.title;
  if (typeof title === "string" && title.trim()) return title.trim().slice(0, 160);
  if (job.source_url) {
    try {
      return new URL(job.source_url).hostname.replace(/^www\./, "") || "Imported note";
    } catch {
      // The server already validated this URL; keep a harmless fallback for retained job shells.
    }
  }
  return "Imported note";
}

export function mediaNoteSummary(job: MediaNoteJobResponse): string {
  const summary = job.result_contract?.summary;
  const text =
    typeof summary === "string"
      ? summary
      : summary && typeof summary === "object" && "text" in summary
        ? (summary as { text?: unknown }).text
        : null;
  if (typeof text !== "string") return "";
  return text.replace(/\s+/g, " ").trim().slice(0, 320);
}

export function mediaNoteFailureMessage(job: MediaNoteJobResponse): string {
  if (job.status === "cancelled") return "This import was cancelled.";
  if (job.status === "expired") return "This import expired before it was saved.";
  if (job.status === "unsupported") return "DocFerry cannot prepare a note from this link yet.";
  return job.error_message || "DocFerry could not prepare a note from this link.";
}

export function mediaNoteMarkdownForObsidian(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const title = normalized.match(/^# [^\n]+\n+/);
  if (!title) return markdown;
  return normalized.slice(title[0].length);
}
