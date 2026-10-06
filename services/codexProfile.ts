import fs from "node:fs";
import https from "node:https";
import { withScope } from "./logger";
import { userDataPath } from "./userDataPath";
import { writeFileAtomicSync } from "./atomicFile";
import { normalizeErrorMessage } from "../config/shared/errors";
import type { CodexScanEntry, CodexScansResult } from "../config/shared/codexTypes";

const log = withScope("codexProfile");

const PROFILE_FILE = "codex-profile.json";
const CACHE_FILE = "codex-scans.json";
// Sync is manual-only (refresh button); the floor just absorbs double-clicks.
const REFRESH_MIN_INTERVAL_MS = 60_000;
const MAX_PROFILE_BYTES = 40_000_000;
const FETCH_TIMEOUT_MS = 20_000;

let _accountId: string | null = null;
let _cache: { fetchedAt: number; scans: CodexScanEntry[] } | null = null;
let _inFlight: Promise<CodexScansResult> | null = null;

function _profilePath(): string {
  return userDataPath(PROFILE_FILE);
}

function _cachePath(): string {
  return userDataPath(CACHE_FILE);
}

function _loadAccountId(): string | null {
  if (_accountId) return _accountId;
  try {
    const raw = JSON.parse(fs.readFileSync(_profilePath(), "utf8")) as { accountId?: unknown };
    if (typeof raw.accountId === "string" && /^[a-f0-9]{24}$/.test(raw.accountId)) {
      _accountId = raw.accountId;
    }
  } catch {
    // first run; the id arrives with the next inventory fetch
  }
  return _accountId;
}

export function codexAccountId(): string | null {
  return _loadAccountId();
}

/** Remember the account id seen in an inventory authz string. It never changes,
 * so persisting it keeps codex scans working while the game is closed. */
export function noteAuthz(authz: string): void {
  const id = /accountId=([a-f0-9]{24})/.exec(authz)?.[1];
  if (!id || id === _loadAccountId()) return;
  _accountId = id;
  try {
    writeFileAtomicSync(_profilePath(), JSON.stringify({ accountId: id }));
    log.info("[Codex] account id captured for profile fetches");
  } catch (err) {
    log.warn("[Codex] failed to persist account id:", normalizeErrorMessage(err));
  }
}

/** The scans array moved between root.Stats and Results[0].Stats historically. */
export function parseProfileScans(payload: unknown): CodexScanEntry[] | null {
  const root = payload as {
    Stats?: { Scans?: unknown };
    Results?: Array<{ Stats?: { Scans?: unknown } }>;
  } | null;
  const raw = root?.Stats?.Scans ?? root?.Results?.[0]?.Stats?.Scans;
  if (!Array.isArray(raw)) return null;
  const out: CodexScanEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { type?: unknown; scans?: unknown };
    const count = Number(record.scans);
    if (typeof record.type === "string" && record.type && Number.isFinite(count)) {
      out.push({ type: record.type, count: Math.max(0, Math.floor(count)) });
    }
  }
  return out;
}

function _httpsGetString(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json,*/*" } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_PROFILE_BYTES) {
            req.destroy(new Error("profile response too large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      },
    );
    req.setTimeout(FETCH_TIMEOUT_MS, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

function _loadDiskCache(): void {
  if (_cache) return;
  try {
    const raw = JSON.parse(fs.readFileSync(_cachePath(), "utf8")) as {
      fetchedAt?: unknown;
      scans?: unknown;
    };
    if (typeof raw.fetchedAt === "number" && Array.isArray(raw.scans)) {
      _cache = { fetchedAt: raw.fetchedAt, scans: raw.scans as CodexScanEntry[] };
    }
  } catch {
    // no cache yet
  }
}

export function cachedCodexScans(): { fetchedAt: number; scans: CodexScanEntry[] } | null {
  _loadDiskCache();
  return _cache;
}

export async function getCodexScans(refresh = false): Promise<CodexScansResult> {
  _loadDiskCache();
  if (!refresh) return _cache ?? { error: "no-data" };
  if (_cache && Date.now() - _cache.fetchedAt < REFRESH_MIN_INTERVAL_MS) return _cache;

  const accountId = _loadAccountId();
  if (!accountId) return _cache ?? { error: "no-account" };
  if (_inFlight) return _inFlight;

  _inFlight = (async (): Promise<CodexScansResult> => {
    try {
      const body = await _httpsGetString(
        `https://api.warframe.com/cdn/getProfileViewingData.php?playerId=${accountId}`,
      );
      const scans = parseProfileScans(JSON.parse(body));
      if (!scans) throw new Error("no scans array in profile payload");
      _cache = { fetchedAt: Date.now(), scans };
      try {
        writeFileAtomicSync(_cachePath(), JSON.stringify(_cache));
      } catch {
        // cache write is best effort
      }
      log.info(`[Codex] profile scans fetched: ${scans.length} entries`);
      return _cache;
    } catch (err) {
      log.warn("[Codex] profile fetch failed:", normalizeErrorMessage(err));
      return _cache ?? { error: "fetch-failed" };
    } finally {
      _inFlight = null;
    }
  })();
  return _inFlight;
}
