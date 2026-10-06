import { assertMainRendererSender, handleAuthorized } from "./ipcSecurity";
import { sendDesktopNotificationRaw } from "./worldStateIpc";
import { cachedCodexScans, codexAccountId } from "../services/codexProfile";
import { appendCodexScanLog } from "../services/codexScanLog";
import { codexScanLogLine, rawScanCounts } from "../config/shared/codexScanLog";
import { createJsonCache } from "../services/jsonCache";
import { dispatch } from "../services/notificationChannels";
import { CODEX_SCAN_PROGRESS } from "../config/shared/ipcChannels";
import {
  CODEX_PROGRESS_TITLE,
  codexProgressBody,
  diffCodexProgress,
} from "../config/shared/codexScanProgress";
import type { CodexProgressRow, CodexProgressSnapshot } from "../config/shared/codexScanProgress";

const MAX_ROWS = 20_000;
const MAX_TYPE_CHARS = 300;
const MAX_SCANS = 10_000_000;

interface ProgressPayload {
  fetchedAt: number;
  rows: CodexProgressRow[];
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_SCANS;
}

function parseRow(raw: unknown): CodexProgressRow | null {
  if (!raw || typeof raw !== "object") return null;
  const { type, scanned, complete } = raw as Record<string, unknown>;
  if (typeof type !== "string" || !type || type.length > MAX_TYPE_CHARS) return null;
  if (!isCount(scanned) || typeof complete !== "boolean") return null;
  const row: CodexProgressRow = { type, scanned, complete };
  const { name, required } = raw as Record<string, unknown>;
  if (typeof name === "string" && name.length <= MAX_TYPE_CHARS) row.name = name;
  if (required === null || isCount(required)) row.required = required;
  return row;
}

function reviveCounts(raw: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [type, count] of Object.entries(raw as Record<string, unknown>)) {
    if (isCount(count)) counts[type] = count;
  }
  return counts;
}

function parsePayload(raw: unknown): ProgressPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const { fetchedAt, rows } = raw as Record<string, unknown>;
  if (typeof fetchedAt !== "number" || !Number.isFinite(fetchedAt) || fetchedAt <= 0) return null;
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) return null;
  const parsed: CodexProgressRow[] = [];
  for (const row of rows) {
    const valid = parseRow(row);
    if (!valid) return null;
    parsed.push(valid);
  }
  return { fetchedAt, rows: parsed };
}

function reviveSnapshot(raw: unknown): CodexProgressSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const { fetchedAt, scans, complete } = raw as Record<string, unknown>;
  if (typeof fetchedAt !== "number" || !scans || typeof scans !== "object") return null;
  if (!Array.isArray(complete)) return null;
  const counts: Record<string, number> = {};
  for (const [type, count] of Object.entries(scans as Record<string, unknown>)) {
    if (isCount(count)) counts[type] = count;
  }
  const done = complete.filter((type): type is string => typeof type === "string");
  const snapshot: CodexProgressSnapshot = { fetchedAt, scans: counts, complete: done };
  const { raw: rawScans } = raw as Record<string, unknown>;
  if (rawScans && typeof rawScans === "object") snapshot.raw = reviveCounts(rawScans);
  return snapshot;
}

const cache = createJsonCache<Record<string, CodexProgressSnapshot>>(
  "codex-scan-snapshots.json",
  (parsed) => {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out: Record<string, CodexProgressSnapshot> = {};
    for (const [account, raw] of Object.entries(parsed as Record<string, unknown>)) {
      const snapshot = reviveSnapshot(raw);
      if (snapshot) out[account] = snapshot;
    }
    return out;
  },
);

let snapshots: Record<string, CodexProgressSnapshot> | null = null;

/** The service hands back its cache when a fetch fails, so a fetchedAt no newer
 *  than the snapshot is stale data and leaves both the bell and the file alone. */
function onProgress(payload: ProgressPayload): boolean {
  const account = codexAccountId();
  if (!account) return false;
  snapshots ??= cache.read() ?? {};
  const previous = snapshots[account] ?? null;
  if (previous && payload.fetchedAt <= previous.fetchedAt) return false;

  const diff = diffCodexProgress(previous, payload.fetchedAt, payload.rows);
  if (diff.completed > 0 || diff.newScans > 0) {
    // English on purpose: the body is kept in the notification history.
    const body = codexProgressBody(diff.completed, diff.newScans);
    dispatch({ source: "codexScans", title: CODEX_PROGRESS_TITLE, body }, () =>
      sendDesktopNotificationRaw(CODEX_PROGRESS_TITLE, body),
    );
  }
  // The service cache is the list the renderer just built rows from; any other
  // fetchedAt means it moved on, so the previous raw list is carried over.
  const cached = cachedCodexScans();
  const raw = cached?.fetchedAt === payload.fetchedAt ? rawScanCounts(cached.scans) : null;
  const line = codexScanLogLine(previous, payload.fetchedAt, payload.rows, raw, new Date());
  if (line) appendCodexScanLog(line);
  const keptRaw = raw ?? previous?.raw;
  if (keptRaw) diff.snapshot.raw = keptRaw;
  snapshots[account] = diff.snapshot;
  cache.write(snapshots);
  return true;
}

export function register(): void {
  handleAuthorized(CODEX_SCAN_PROGRESS, assertMainRendererSender, (_event, payload: unknown) => {
    const parsed = parsePayload(payload);
    return parsed ? onProgress(parsed) : false;
  });
}
