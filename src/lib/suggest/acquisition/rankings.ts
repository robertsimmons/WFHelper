import { preferFreshRankings } from "../../../stores/overframeRankings.js";
import { nameKey } from "./curated.js";

/** Overframe averages its tier votes on a 1..5 scale where 1 is the top tier. */
export const TIERS = ["S", "A", "B", "C", "D"] as const;

const WARFRAME_CATEGORY_ID = 0;

const PRIME_SUFFIX = / prime$/;

export type RankTiers = (name: string) => string | null;

interface RankingRow {
  score: number;
  warframe: boolean;
}

function tierFor(score: number): string | null {
  if (!(score > 0)) return null;
  const index = Math.round(Math.min(score, TIERS.length)) - 1;
  return TIERS[index] ?? null;
}

function readRow(value: unknown): RankingRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const score = raw.averageScore;
  if (typeof score !== "number" || !Number.isFinite(score) || score <= 0) return null;
  return {
    score,
    warframe: raw.categoryId === WARFRAME_CATEGORY_ID || raw.category === "Warframes",
  };
}

function buildTable(source: unknown): Map<string, RankingRow> {
  const out = new Map<string, RankingRow>();
  if (!source || typeof source !== "object") return out;
  const items = (source as { items?: unknown }).items;
  if (!items || typeof items !== "object" || Array.isArray(items)) return out;
  for (const [name, value] of Object.entries(items as Record<string, unknown>)) {
    const row = readRow(value);
    if (row) out.set(nameKey(name), row);
  }
  return out;
}

/** Nothing about the file is trusted: it is generated, optional, and may lag
 *  the shape this expects. An unreadable row simply leaves the item unranked. */
export function createRankTiers(source?: unknown): RankTiers {
  const table = buildTable(source);
  return (name) => {
    const key = nameKey(name);
    const row = table.get(key) ?? null;
    const base = key.replace(PRIME_SUFFIX, "");
    if (base !== key) {
      const baseRow = table.get(base) ?? null;
      // A Prime frame and its base are one thing to rate, and the Prime's own
      // row carries a handful of votes; weapon Primes are genuinely separate.
      if (baseRow && (row ? row.warframe : baseRow.warframe)) return tierFor(baseRow.score);
    }
    return row ? tierFor(row.score) : null;
  };
}

// A glob rather than an import: the data build owns the file and it may not exist.
const loaded = import.meta.glob("../../../data/suggest/rankings.json", { eager: true });

function shipped(): unknown {
  const module = Object.values(loaded)[0];
  if (!module || typeof module !== "object") return null;
  return (module as { default?: unknown }).default ?? module;
}

export const rankTiers: RankTiers = preferFreshRankings(createRankTiers, shipped());
