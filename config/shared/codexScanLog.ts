import type { CodexProgressRow, CodexProgressSnapshot } from "./codexScanProgress";
import type { CodexScanEntry } from "./codexTypes";

export const CODEX_SCAN_LOG_CAP = 200;

export interface CodexScanLogRow {
  type: string;
  name: string | null;
  before: number;
  after: number;
  required: number | null;
  completedNow: boolean;
}

export interface CodexScanLogRaw {
  type: string;
  before: number;
  after: number;
}

export interface CodexScanLogLine {
  at: string;
  fetchedAt: number;
  rows: CodexScanLogRow[];
  raw: CodexScanLogRaw[];
}

export function rawScanCounts(scans: CodexScanEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of scans) counts[entry.type] = entry.count;
  return counts;
}

/** Only increases; a type first seen counts from zero. */
export function diffRawScans(
  before: Record<string, number>,
  after: Record<string, number>,
): CodexScanLogRaw[] {
  const out: CodexScanLogRaw[] = [];
  for (const [type, count] of Object.entries(after)) {
    const was = before[type] ?? 0;
    if (count > was) out.push({ type, before: was, after: count });
  }
  return out;
}

/** Null for the baseline load or when nothing went up. Raw deltas need both raw
 *  lists; a missing one logs rows only. */
export function codexScanLogLine(
  previous: CodexProgressSnapshot | null,
  fetchedAt: number,
  rows: CodexProgressRow[],
  raw: Record<string, number> | null,
  now: Date,
): CodexScanLogLine | null {
  if (!previous) return null;
  const wasComplete = new Set(previous.complete);
  const rowDeltas: CodexScanLogRow[] = [];
  for (const row of rows) {
    const before = previous.scans[row.type] ?? 0;
    const completedNow = row.complete && !wasComplete.has(row.type);
    if (row.scanned <= before && !completedNow) continue;
    rowDeltas.push({
      type: row.type,
      name: row.name ?? null,
      before,
      after: row.scanned,
      required: row.required ?? null,
      completedNow,
    });
  }
  const rawDeltas = raw && previous.raw ? diffRawScans(previous.raw, raw) : [];
  if (rowDeltas.length === 0 && rawDeltas.length === 0) return null;
  return { at: now.toISOString(), fetchedAt, rows: rowDeltas, raw: rawDeltas };
}

export function appendCappedLines(existing: string, line: string, cap: number): string {
  const lines = existing.split("\n").filter((text) => text.trim() !== "");
  lines.push(line);
  return `${lines.slice(-cap).join("\n")}\n`;
}
