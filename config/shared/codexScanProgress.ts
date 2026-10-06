/** One codex row as the progress diff sees it: a row key, its scan count and
 *  whether it has met its requirement. */
export interface CodexProgressRow {
  type: string;
  scanned: number;
  complete: boolean;
  /** Debug-log context only; the diff ignores both. */
  name?: string;
  required?: number | null;
}

export interface CodexProgressSnapshot {
  fetchedAt: number;
  scans: Record<string, number>;
  complete: string[];
  /** Raw profile scan counts by type, kept for the debug log's raw diff. */
  raw?: Record<string, number>;
}

export interface CodexProgressDiff {
  completed: number;
  newScans: number;
  snapshot: CodexProgressSnapshot;
}

export const CODEX_PROGRESS_TITLE = "Scanning Progress";

export function snapshotCodexProgress(
  fetchedAt: number,
  rows: CodexProgressRow[],
): CodexProgressSnapshot {
  const scans: Record<string, number> = {};
  const complete: string[] = [];
  for (const row of rows) {
    if (row.scanned > 0) scans[row.type] = row.scanned;
    if (row.complete) complete.push(row.type);
  }
  return { fetchedAt, scans, complete };
}

/** A null `previous` is the baseline load: it reports nothing. A row missing
 *  from the snapshot counts from zero; a falling count is ignored. */
export function diffCodexProgress(
  previous: CodexProgressSnapshot | null,
  fetchedAt: number,
  rows: CodexProgressRow[],
): CodexProgressDiff {
  const snapshot = snapshotCodexProgress(fetchedAt, rows);
  if (!previous) return { completed: 0, newScans: 0, snapshot };
  const wasComplete = new Set(previous.complete);
  let completed = 0;
  let newScans = 0;
  for (const row of rows) {
    const gained = row.scanned - (previous.scans[row.type] ?? 0);
    if (gained > 0) newScans += gained;
    if (row.complete && !wasComplete.has(row.type)) completed += 1;
  }
  return { completed, newScans, snapshot };
}

export function codexProgressBody(completed: number, newScans: number): string {
  const parts: string[] = [];
  if (completed > 0) parts.push(`${completed} ${completed === 1 ? "enemy" : "enemies"} completed`);
  if (newScans > 0) parts.push(`${newScans} new ${newScans === 1 ? "scan" : "scans"}`);
  return parts.join(", ");
}
