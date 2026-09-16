/** Reward and drop-table names carry their count in the name: "2X Forma
 *  Blueprint", "4000 Endo", "15,000 Credits", "6000 x Kuva", "10k Kuva", and now
 *  and then twice over ("2X 3,000 Credits Cache"). An "x" or "k" belongs to the
 *  prefix only when whitespace follows it, so "1500 Kuva" keeps its K. No real
 *  item name opens with a count, but "X3lp Glyph" does open with an x, so a
 *  leading "x2" is never one. */
const QUANTITY_PREFIX = /^(\d[\d,]*)\s*([xk])?\s+/i;

/** A bare number the name owns rather than counts: how long a booster runs
 *  ("3 Day Mod Drop Chance Booster") or how old an anniversary is ("10 Year
 *  Anniversary Community Sigil"). An x or a k still marks a count, so
 *  "2X Day Of The Dead Glyph" keeps its two. */
const NAMED_UNIT = /^(?:year|day|hour|minute|second|week|month)s?\b/i;

function quantityPrefix(value: string): RegExpExecArray | null {
  const match = QUANTITY_PREFIX.exec(value);
  if (!match) return null;
  return !match[2] && NAMED_UNIT.test(value.slice(match[0].length)) ? null : match;
}

/** Blueprint and built item are one pile. */
const BLUEPRINT_SUFFIX = /\s+blueprint$/i;

/** Drop tables star a footnoted reward ("Omni Forma*"). */
const TRAILING_NOISE = /[\s*.,:;!?]+$/;

export function hasQuantityPrefix(value: string): boolean {
  return quantityPrefix(value) !== null;
}

export function stripQuantityPrefix(value: string): string {
  const match = quantityPrefix(value);
  return match ? value.slice(match[0].length) : value;
}

export interface QuantityName {
  /** Null where the name counts nothing; never 1 standing in for unknown. */
  count: number | null;
  name: string;
}

function prefixCount(match: RegExpExecArray): number | null {
  const digits = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(digits) || digits <= 0) return null;
  return match[2]?.toLowerCase() === "k" ? digits * 1000 : digits;
}

/** The count a name carries and the name without it. A doubled prefix multiplies:
 *  "2X 3,000 Credits Cache" is two caches of three thousand. */
export function parseQuantityName(value: string | null | undefined): QuantityName {
  let name = (value ?? "").replace(/\s+/g, " ").trim();
  let count: number | null = null;
  for (;;) {
    const match = quantityPrefix(name);
    const found = match ? prefixCount(match) : null;
    if (!match || found === null) break;
    count = count === null ? found : count * found;
    name = name.slice(match[0].length);
  }
  return { count, name: name.replace(TRAILING_NOISE, "") };
}

/** One key for one pile: lowercased, no count, no " blueprint" tail, no
 *  footnote mark. Every by-name reward join goes through this. */
export function normalizeRewardName(value: string | null | undefined): string {
  return parseQuantityName((value ?? "").toLowerCase())
    .name.replace(BLUEPRINT_SUFFIX, "")
    .replace(TRAILING_NOISE, "")
    .trim();
}

/** Keys a name may be held under, best first: itself, then its singular, so an
 *  "Archon Shards" row still finds the "Archon Shard" it is a pile of. */
export function rewardNameKeys(value: string | null | undefined): string[] {
  const key = normalizeRewardName(value);
  if (!key.endsWith("s") || key.length < 4) return [key];
  return [key, key.slice(0, -1)];
}

/** Four characters holds every real count, so a column of them stays lined up.
 *  A count that fits stays whole; only a wider one reads compact, and then a
 *  floor never claims a unit the count has not reached. */
export function compactCount(count: number): string {
  if (count < 10_000) return String(count);
  if (count < 1_000_000) return `${Math.floor(count / 1_000)}k`;
  return `${Math.floor(count / 1_000_000)}M`;
}

/** A count folded back into the name it counts: "4000 Endo". One of a thing adds
 *  nothing, and an unknown count must add nothing rather than guess. */
export function countedName(count: number | null, name: string): string {
  return count !== null && count > 1 ? `${compactCount(count)} ${name}` : name;
}
