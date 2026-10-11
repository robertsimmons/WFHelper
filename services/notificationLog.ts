import { createJsonCache } from "./jsonCache";
import { reviveCodexScanRows } from "../config/shared/codexScanLog";
import { NOTIFICATION_KINDS, NOTIFICATION_LOG_MAX_ENTRIES } from "../config/shared/notifications";
import type {
  NotificationDetail,
  NotificationEntry,
  NotificationKind,
} from "../config/shared/notifications";

const MAX_TITLE_CHARS = 200;
const MAX_BODY_CHARS = 500;

const KINDS: ReadonlySet<string> = new Set<string>(NOTIFICATION_KINDS);

function reviveEntry(raw: unknown): NotificationEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const { id, at, kind, title, body } = raw as Record<string, unknown>;
  if (typeof id !== "string" || !id) return null;
  if (typeof at !== "string" || !at) return null;
  if (typeof kind !== "string" || !KINDS.has(kind)) return null;
  if (typeof title !== "string" || typeof body !== "string") return null;
  // Re-applied on load: the file is user-writable, so a stored entry is not
  // bounded by whatever record() enforced when it was written.
  const entry: NotificationEntry = {
    id,
    at,
    kind: kind as NotificationKind,
    title: title.slice(0, MAX_TITLE_CHARS),
    body: body.slice(0, MAX_BODY_CHARS),
  };
  return withDetail(entry, raw as NotificationDetail);
}

function withDetail(
  entry: NotificationEntry,
  detail: NotificationDetail | undefined,
): NotificationEntry {
  const codexScans = reviveCodexScanRows(detail?.codexScans);
  if (codexScans) entry.codexScans = codexScans;
  return entry;
}

// Stored oldest-first so the cap trims from the front; getAll reverses for the UI.
const cache = createJsonCache<NotificationEntry[]>("notification-log.json", (parsed) => {
  if (!Array.isArray(parsed)) return null;
  const entries: NotificationEntry[] = [];
  for (const raw of parsed) {
    const entry = reviveEntry(raw);
    if (entry) entries.push(entry);
  }
  return entries.slice(-NOTIFICATION_LOG_MAX_ENTRIES);
});

let entries: NotificationEntry[] | null = null;
let sequence = 0;

function load(): NotificationEntry[] {
  if (!entries) entries = cache.read() ?? [];
  return entries;
}

// Date.now alone repeats within a millisecond when one event fans out.
function nextId(): string {
  sequence += 1;
  return `${Date.now().toString(36)}-${sequence.toString(36)}`;
}

function trim(current: NotificationEntry[]): void {
  if (current.length > NOTIFICATION_LOG_MAX_ENTRIES) {
    current.splice(0, current.length - NOTIFICATION_LOG_MAX_ENTRIES);
  }
}

export function record(
  kind: NotificationKind,
  title: string,
  body: string,
  detail?: NotificationDetail,
): NotificationEntry {
  const entry = withDetail(
    {
      id: nextId(),
      at: new Date().toISOString(),
      kind,
      title: String(title).slice(0, MAX_TITLE_CHARS),
      body: String(body).slice(0, MAX_BODY_CHARS),
    },
    detail,
  );
  const current = load();
  current.push(entry);
  trim(current);
  cache.write(current);
  return entry;
}

// The live entry for a backfilled event was stamped a few milliseconds apart
// from its log line, so it is matched by text within this window.
const BACKFILL_MATCH_MS = 60_000;

function sameEvent(stored: NotificationEntry, incoming: NotificationEntry): boolean {
  if (stored.codexScans || !incoming.codexScans) return false;
  if (stored.title !== incoming.title || stored.body !== incoming.body) return false;
  return Math.abs(Date.parse(stored.at) - Date.parse(incoming.at)) <= BACKFILL_MATCH_MS;
}

/** Merges past events by timestamp. An id already stored is skipped, and a
 *  detail-less entry for the same event gains the detail instead of a twin. */
export function backfill(incoming: NotificationEntry[]): number {
  const current = load();
  let changed = 0;
  for (const raw of incoming) {
    const entry = reviveEntry(raw);
    if (!entry || current.some((stored) => stored.id === entry.id)) continue;
    const twin = current.find((stored) => sameEvent(stored, entry));
    if (twin) twin.codexScans = entry.codexScans;
    else current.push(entry);
    changed += 1;
  }
  if (changed === 0) return 0;
  current.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  trim(current);
  cache.write(current);
  return changed;
}

/** Newest first, the order the history modal renders. */
export function getAll(): NotificationEntry[] {
  return load().slice().reverse();
}

/** Drops one entry and says whether it was there. A test notification, or any
 *  single line the user would rather not keep, otherwise costs the whole log. */
export function remove(id: string): boolean {
  const current = load();
  const at = current.findIndex((entry) => entry.id === id);
  if (at < 0) return false;
  current.splice(at, 1);
  cache.write(current);
  return true;
}

export function clear(): void {
  entries = [];
  cache.write(entries);
}
