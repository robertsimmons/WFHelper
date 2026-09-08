import { resolveDropArt } from "../../lib/suggest/dropPools.js";
import { clockStore } from "../../lib/timers.js";
import type { ItemDbEntry } from "../../types/inventory.js";
import type { SuggestionPoolRow, SuggestionReward } from "../../types/suggest.js";

export interface ArtPiece {
  name: string;
  imageUrl: string;
}

/** DE prefixes its calendar packs; a card about the Calendar says it twice. */
export function plainName(name: string): string {
  return name.replace(/^Calendar\s+/i, "");
}

function words(name: string): string[] {
  return name.trim().split(/\s+/);
}

/** The two words a family shares: every Archon Shard ends in "Archon Shard",
 *  and no Arcane Adapter does. */
function tail(name: string): string {
  return words(name).slice(-2).join(" ").toLowerCase();
}

/**
 * Whether two names are the same thing in two grades. A modifier is a prefix,
 * so a Tauforged Amber Archon Shard ends with the plain Amber one's whole name
 * while an Azure shard does not.
 */
function sameKind(a: string, b: string): boolean {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  return left === right || left.endsWith(` ${right}`) || right.endsWith(` ${left}`);
}

/**
 * Everything the reward could turn out to be. `oneOf` only carries one member
 * per modifier grade, which is one colour of a pool that pays several, so the
 * drop rows fill the rest of the family in wherever the provider listed them.
 */
function familyMembers(
  reward: SuggestionReward,
  pool: readonly (SuggestionPoolRow | string)[],
): SuggestionReward[] {
  const members = reward.oneOf ?? [];
  if (members.length < 2) return [...members];
  const shallow = members.reduce((best, next) =>
    words(next.name).length < words(best.name).length ? next : best,
  );
  const family = tail(shallow.name);
  const seen = new Set(members.map((member) => member.name.toLowerCase()));
  const out: SuggestionReward[] = [...members];
  for (const entry of pool) {
    const row = typeof entry === "string" ? { name: entry } : entry;
    const key = row.name.toLowerCase();
    if (seen.has(key) || tail(row.name) !== family) continue;
    seen.add(key);
    out.push({ name: row.name, uniqueName: row.uniqueName });
  }
  return out;
}

/** Flip to false and every reward art goes back to one still picture. */
export const ROTATE_REWARD_ART = true;

/** One frame per member. Slow enough to read past, long enough to see the set. */
export const ART_CYCLE_MS = 3000;

/** Every rotating card reads this one interval, so the whole feed steps
 *  together and no card owns a timer. */
export const artCycle = clockStore(ART_CYCLE_MS);

/** A system setting, so it is read once rather than per card. */
export const REDUCED_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** Past this the cycle stops being a set and becomes a slideshow. */
const MAX_CYCLE = 12;

/**
 * How a reward's art reads. `pair` is the case where the colour is knowable and
 * only the grade is not, so the plain and modified pictures together are the
 * whole uncertainty. `cycle` is the case where the family spans several kinds,
 * where no two pictures are the set and the art steps through it instead.
 */
export type RewardArtMode = "single" | "pair" | "cycle";

export interface RewardArt {
  mode: RewardArtMode;
  pieces: ArtPiece[];
}

function resolve(
  itemDb: Record<string, ItemDbEntry>,
  members: readonly SuggestionReward[],
): ArtPiece[] {
  return members
    .map((member) => resolveDropArt(itemDb, member.name, member.uniqueName))
    .filter((hit): hit is NonNullable<typeof hit> => hit !== null)
    .map((hit) => ({ name: plainName(hit.name), imageUrl: hit.imageUrl }));
}

/**
 * What a card draws for its reward: one picture where the reward is one thing,
 * a plain-and-modified pair where only the grade is unknown, and the whole
 * family in rotation where the kind is unknown too.
 */
export function rewardArt(
  itemDb: Record<string, ItemDbEntry>,
  reward: SuggestionReward | null | undefined,
  pool: readonly (SuggestionPoolRow | string)[] = [],
): RewardArt {
  if (!reward) return { mode: "single", pieces: [] };
  const members = familyMembers(reward, pool);
  if (members.length < 2) return { mode: "single", pieces: resolve(itemDb, [reward]) };
  const kinds = members.filter(
    (member, index) => !members.slice(0, index).some((other) => sameKind(member.name, other.name)),
  );
  // One kind in two grades: the colour is known, so there is nothing to step
  // through and the pair says all of it at once.
  if (kinds.length < 2) return { mode: "pair", pieces: resolve(itemDb, members.slice(0, 2)) };
  const pieces = resolve(itemDb, members.slice(0, MAX_CYCLE));
  if (ROTATE_REWARD_ART && !REDUCED_MOTION && pieces.length > 1) {
    return { mode: "cycle", pieces };
  }
  // Rotation off, or the reader asked for stillness: a plain one and a modified
  // one of another kind still read as "one of these" rather than as a colour.
  const lead = members[0];
  const other =
    members.find(
      (member) =>
        words(member.name).length !== words(lead.name).length && !sameKind(member.name, lead.name),
    ) ?? members[1];
  return { mode: "pair", pieces: resolve(itemDb, [lead, other]) };
}
