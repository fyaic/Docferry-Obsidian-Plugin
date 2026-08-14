import type { ShareStatus } from "./types";

export function hasActiveShareLink(status: ShareStatus): boolean {
  return status === "published" || status === "password_protected";
}

export function shareListSummary(statuses: readonly ShareStatus[]): string {
  const liveCount = statuses.filter(hasActiveShareLink).length;
  const pastCount = statuses.length - liveCount;
  const parts: string[] = [];

  if (liveCount) parts.push(`${liveCount} live ${liveCount === 1 ? "share" : "shares"}`);
  if (pastCount) parts.push(`${pastCount} past ${pastCount === 1 ? "share" : "shares"}`);

  return parts.length ? `${parts.join(", ")}.` : "No shares yet.";
}
