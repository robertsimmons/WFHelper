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

interface CodexScanLogRaw {
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

const MAX_DETAIL_ROWS = 500;
const MAX_DETAIL_TEXT = 300;
const MAX_DETAIL_SCANS = 10_000_000;

function isDetailCount(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_DETAIL_SCANS
  );
}

function reviveCodexScanRow(raw: unknown): CodexScanLogRow | null {
  if (!raw || typeof raw !== "object") return null;
  const { type, name, before, after, required, completedNow } = raw as Record<string, unknown>;
  if (typeof type !== "string" || !type || type.length > MAX_DETAIL_TEXT) return null;
  if (name !== null && typeof name !== "string") return null;
  if (!isDetailCount(before) || !isDetailCount(after)) return null;
  if (required !== null && !isDetailCount(required)) return null;
  if (typeof completedNow !== "boolean") return null;
  return {
    type,
    name: name === null ? null : name.slice(0, MAX_DETAIL_TEXT),
    before,
    after,
    required,
    completedNow,
  };
}

/** Drops malformed rows rather than the whole list; null when nothing survives. */
export function reviveCodexScanRows(raw: unknown): CodexScanLogRow[] | null {
  if (!Array.isArray(raw)) return null;
  const rows: CodexScanLogRow[] = [];
  for (const entry of raw.slice(0, MAX_DETAIL_ROWS)) {
    const row = reviveCodexScanRow(entry);
    if (row) rows.push(row);
  }
  return rows.length > 0 ? rows : null;
}

export interface CodexScanHistoryLine {
  at: string;
  fetchedAt: number;
  rows: CodexScanLogRow[];
}

/** The newest `count` log lines that carry row deltas, oldest first. */
export function recentCodexScanLines(text: string, count: number): CodexScanHistoryLine[] {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const out: CodexScanHistoryLine[] = [];
  for (const line of lines.slice(-count)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const { at, fetchedAt, rows } = parsed as Record<string, unknown>;
    if (typeof at !== "string" || Number.isNaN(new Date(at).getTime())) continue;
    if (typeof fetchedAt !== "number" || !Number.isFinite(fetchedAt)) continue;
    const revived = reviveCodexScanRows(rows);
    if (revived) out.push({ at: new Date(at).toISOString(), fetchedAt, rows: revived });
  }
  return out;
}
