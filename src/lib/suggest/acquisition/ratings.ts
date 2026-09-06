import { curated, nameKey } from "./curated.js";

/**
 * Farm-difficulty and power tables are produced separately and may not exist.
 * Every read goes through here: an absent table, an absent key, a null entry
 * and a wrong-typed field all read as unknown, and unknown never ranks worse
 * than rated. Dropping richer data in later changes ranking quality without
 * touching a call site.
 */
export interface Ratings {
  /** 0..1, higher is a harder farm. Null is unknown. */
  difficulty(name: string): number | null;
  /** The word behind the number, for display. */
  difficultyLabel(name: string): string | null;
  /** Power/popularity tier letter. Null is unknown. */
  rank(name: string): string | null;
  /** 0..1 share of players running it. Null is unknown. */
  popularity(name: string): number | null;
}

/** Neutral, so an unrated item sorts exactly where a normal one does. */
export const UNKNOWN_DIFFICULTY = 0.5;

const WORD_DIFFICULTY: Record<string, number> = {
  trivial: 0.1,
  easy: 0.25,
  normal: 0.5,
  medium: 0.5,
  hard: 0.75,
  brutal: 0.9,
};

interface RatingEntry {
  difficulty?: unknown;
  rank?: unknown;
  popularity?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function unitInterval(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function difficultyWord(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function difficultyNumber(value: unknown): number | null {
  const direct = unitInterval(value);
  if (direct !== null) return direct;
  const word = difficultyWord(value);
  return word === null ? null : (WORD_DIFFICULTY[word] ?? null);
}

function buildTable(source: unknown): Map<string, RatingEntry> {
  const out = new Map<string, RatingEntry>();
  const record = asRecord(source);
  if (!record) return out;
  for (const [name, value] of Object.entries(record)) {
    const entry = asRecord(value);
    if (entry) out.set(nameKey(name), entry as RatingEntry);
  }
  return out;
}

export function createRatings(source?: unknown): Ratings {
  const table = buildTable(source);
  const entry = (name: string): RatingEntry | null => table.get(nameKey(name)) ?? null;

  const label = (name: string): string | null =>
    difficultyWord(entry(name)?.difficulty) ?? curated(name).difficulty;

  return {
    difficultyLabel: label,
    difficulty(name) {
      const supplied = difficultyNumber(entry(name)?.difficulty);
      if (supplied !== null) return supplied;
      return difficultyNumber(curated(name).difficulty);
    },
    rank(name) {
      const value = entry(name)?.rank;
      return typeof value === "string" && value.trim() ? value.trim() : null;
    },
    popularity(name) {
      return unitInterval(entry(name)?.popularity);
    },
  };
}
