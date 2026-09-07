/** Weekly refresh of the overframe.gg tier rankings. The bundled
 *  src/data/suggest/rankings.json stays the shipped fallback and is never
 *  written; a refresh lands in the user data directory instead. */

import fs from "node:fs";

import { normalizeErrorMessage } from "../config/shared/errors";
import { withAbortTimeout } from "../config/shared/fetchWithTimeout";
import type {
  OverframeRankings,
  OverframeRankingRow,
} from "../config/shared/overframeRankingTypes";
import { createJsonCache } from "./jsonCache";
import { withScope } from "./logger";
import { resolveRuntimeResourcePath } from "./runtimeResources";

const log = withScope("overframeRankings");

const TIER_LIST_URL = "https://overframe.gg/api/v1/tierlists/";
const USER_AGENT = "WFHelper (Warframe companion app) ranking refresh";
const REQUEST_TIMEOUT_MS = 20_000;
const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const SCHEDULE_TICK_MS = 6 * 60 * 60 * 1000;

// Cloudflare sprays a 403 over roughly one request in ten and the same url
// answers moments later, so a 403 retries where a rate limit backs off.
const BOT_CHECK_DELAY_MS = 5_000;
const RATE_LIMIT_DELAY_MS = 30_000;
const ATTEMPTS = 3;

interface TierListIndex {
  results?: Array<{ id?: unknown; title?: unknown }>;
}

interface TierListVotes {
  votes?: Array<{ item_id?: unknown; average_score?: unknown; total?: unknown }>;
}

let current: OverframeRankings | null = null;
let refreshPromise: Promise<{ refreshed: boolean }> | null = null;
let scheduled = false;

const cache = createJsonCache<OverframeRankings>("overframe-rankings-cache.json", (raw) =>
  reviveRankings(raw),
);

function isRow(value: unknown): value is OverframeRankingRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<OverframeRankingRow>;
  return (
    typeof row.id === "number" &&
    typeof row.categoryId === "number" &&
    typeof row.averageScore === "number" &&
    Number.isFinite(row.averageScore)
  );
}

/** A table with no usable row is treated as no table at all, so a truncated or
 *  reshaped payload never replaces good data. */
export function reviveRankings(raw: unknown): OverframeRankings | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const parsed = raw as Partial<OverframeRankings>;
  if (typeof parsed.fetchedAt !== "string" || !Date.parse(parsed.fetchedAt)) return null;
  if (!parsed.items || typeof parsed.items !== "object" || Array.isArray(parsed.items)) return null;
  const items: Record<string, OverframeRankingRow> = {};
  for (const [name, value] of Object.entries(parsed.items)) {
    if (isRow(value)) items[name] = value;
  }
  if (!Object.keys(items).length) return null;
  const categories =
    parsed.categories && typeof parsed.categories === "object" && !Array.isArray(parsed.categories)
      ? (parsed.categories as Record<string, string>)
      : {};
  return { fetchedAt: parsed.fetchedAt, categories, items };
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelay(status: number, retryAfter: string | null, attempt: number): number | null {
  if (status === 403) return attempt < ATTEMPTS - 1 ? BOT_CHECK_DELAY_MS : null;
  if (status !== 429 && status !== 503) return null;
  if (attempt > 0) return null;
  const after = Number(retryAfter);
  return Number.isFinite(after) && after > 0 ? after * 1000 : RATE_LIMIT_DELAY_MS;
}

interface Attempt {
  body?: string;
  delay?: number;
}

async function fetchJson(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const outcome = await withAbortTimeout<Attempt>(REQUEST_TIMEOUT_MS, async (signal) => {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal });
      if (res.ok) return { body: await res.text() };
      const delay = retryDelay(res.status, res.headers.get("retry-after"), attempt);
      if (delay === null) throw new Error(`${url}: HTTP ${res.status}`);
      return { delay };
    });
    if (outcome.body !== undefined) return JSON.parse(outcome.body);
    await sleep(outcome.delay ?? RATE_LIMIT_DELAY_MS);
  }
  throw new Error(`${url}: unreachable`);
}

interface Category {
  id: number;
  title: string;
}

interface Vote {
  itemId: number;
  averageScore: number;
  votes: number;
}

function readCategories(index: unknown): Category[] {
  const results = (index as TierListIndex)?.results;
  if (!Array.isArray(results)) return [];
  const out: Category[] = [];
  for (const entry of results) {
    if (typeof entry?.id !== "number" || typeof entry?.title !== "string") continue;
    out.push({ id: entry.id, title: entry.title });
  }
  return out.sort((a, b) => a.id - b.id);
}

function readVotes(list: unknown): Vote[] {
  const votes = (list as TierListVotes)?.votes;
  if (!Array.isArray(votes)) return [];
  const out: Vote[] = [];
  for (const vote of votes) {
    if (typeof vote?.item_id !== "number") continue;
    if (typeof vote?.average_score !== "number" || !Number.isFinite(vote.average_score)) continue;
    out.push({
      itemId: vote.item_id,
      averageScore: vote.average_score,
      votes: typeof vote.total === "number" ? vote.total : 0,
    });
  }
  return out;
}

function shippedRankings(): OverframeRankings | null {
  try {
    const file = resolveRuntimeResourcePath("src", "data", "suggest", "rankings.json");
    return reviveRankings(JSON.parse(fs.readFileSync(file, "utf-8")));
  } catch (err) {
    log.warn(`No bundled overframe rankings: ${normalizeErrorMessage(err)}`);
    return null;
  }
}

let names: Map<number, { name: string; slug: string | null }> | null = null;

// The vote rows carry only an item id, so names come from tables the data build
// already resolved; an id first ranked since that build stays unnamed.
function describe(id: number): { name: string; slug: string | null } | null {
  if (!names) {
    names = new Map();
    for (const table of [shippedRankings(), current]) {
      for (const row of Object.values(table?.items ?? {})) {
        if (row.name) names.set(row.id, { name: row.name, slug: row.slug });
      }
    }
  }
  return names.get(id) ?? null;
}

function buildItems(
  categories: Category[],
  votesByCategory: Map<number, Vote[]>,
): Record<string, OverframeRankingRow> {
  const items: Record<string, OverframeRankingRow> = {};
  for (const category of categories) {
    for (const vote of votesByCategory.get(category.id) ?? []) {
      const known = describe(vote.itemId);
      const key = known ? normalizeName(known.name) : `#${vote.itemId}`;
      const existing = items[key];
      if (existing && existing.votes >= vote.votes) continue;
      items[key] = {
        id: vote.itemId,
        name: known?.name ?? null,
        slug: known?.slug ?? null,
        category: category.title,
        categoryId: category.id,
        averageScore: vote.averageScore,
        votes: vote.votes,
      };
    }
  }
  const sorted: Record<string, OverframeRankingRow> = {};
  for (const key of Object.keys(items).sort()) sorted[key] = items[key];
  return sorted;
}

async function fetchRankings(): Promise<OverframeRankings> {
  const categories = readCategories(await fetchJson(TIER_LIST_URL));
  if (!categories.length) throw new Error("tier list index carried no categories");
  const votesByCategory = new Map<number, Vote[]>();
  for (const category of categories) {
    votesByCategory.set(category.id, readVotes(await fetchJson(`${TIER_LIST_URL}${category.id}/`)));
  }
  const items = buildItems(categories, votesByCategory);
  if (!Object.keys(items).length) throw new Error("tier lists carried no votes");
  return {
    fetchedAt: new Date().toISOString(),
    categories: Object.fromEntries(categories.map((c) => [String(c.id), c.title])),
    items,
  };
}

export function loadFromDisk(): OverframeRankings | null {
  if (!current) current = cache.read();
  return current;
}

/** The shipped table dates the gate until a refresh lands, so a fresh install
 *  does not go to the network for a week. */
function refreshDue(): boolean {
  const baseline = current?.fetchedAt ?? shippedRankings()?.fetchedAt;
  const at = baseline ? Date.parse(baseline) : NaN;
  return !Number.isFinite(at) || Date.now() - at >= REFRESH_INTERVAL_MS;
}

export async function refreshIfStale(): Promise<{ refreshed: boolean }> {
  loadFromDisk();
  if (!refreshDue()) return { refreshed: false };
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const fresh = await fetchRankings();
      current = fresh;
      names = null;
      cache.write(fresh);
      log.info(`Refreshed ${Object.keys(fresh.items).length} overframe ranking rows`);
      return { refreshed: true };
    } catch (err) {
      log.warn(`Overframe ranking refresh failed: ${normalizeErrorMessage(err)}`);
      return { refreshed: false };
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

function ensureScheduled(): void {
  if (scheduled) return;
  scheduled = true;
  setInterval(() => void refreshIfStale(), SCHEDULE_TICK_MS).unref();
}

/** Null while only the shipped table is available; the renderer falls back to
 *  the bundled file rather than waiting on a second refresh. */
export async function getRefreshedRankings(): Promise<OverframeRankings | null> {
  ensureScheduled();
  loadFromDisk();
  const pending = refreshIfStale();
  if (!current) await pending;
  return current;
}

export function resetForTest(): void {
  current = null;
  names = null;
  refreshPromise = null;
  scheduled = false;
}
