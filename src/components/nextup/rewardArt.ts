import { resolveDropArt } from "../../lib/suggest/dropPools.js";
import { clockStore } from "../../lib/timers.js";
import type { ItemDbEntry } from "../../types/inventory.js";
import type { SuggestionPoolRow, SuggestionReward } from "../../types/suggest.js";

export interface ArtPiece {
  name: string;
  imageUrl: string;
  /** Second chance for a mirrored icon that 404s, where the provider held one. */
  fallbackUrl: string | null;
}

/** DE prefixes its calendar packs; a card about the Calendar says it twice. */
export function plainName(name: string): string {
  return name.replace(/^Calendar\s+/i, "");
}

/** Drop tables carry the count in the name. "2X Amber Archon Shard" is the same
 *  shard as "Amber Archon Shard", and only the bare name joins on anything. */
const COUNT_PREFIX = /^\d[\d,]*\s*[xk]?\s+/i;

function bareName(name: string): string {
  return name.replace(/\s+/g, " ").trim().replace(COUNT_PREFIX, "").trim();
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
    const name = bareName(row.name);
    const key = name.toLowerCase();
    if (!name || seen.has(key) || tail(name) !== family) continue;
    seen.add(key);
    out.push({ name, uniqueName: row.uniqueName });
  }
  return out;
}

/** One member per kind, so a rotation steps through the family rather than
 *  showing one colour several times over. */
function oneEach(members: readonly SuggestionReward[]): SuggestionReward[] {
  return members.filter(
    (member, index) => !members.slice(0, index).some((other) => sameKind(member.name, other.name)),
  );
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

/**
 * Art for each member that has any, one picture per distinct image. Two names
 * the database resolves to the same icon are one frame, not two: a rotation
 * that repeats a picture reads as stuck, and two identical frames in a pair
 * read as that one item rather than as a choice between kinds.
 *
 * The provider's own art is the last resort behind every itemDb join, so a
 * member the database cannot place still gets a picture rather than dropping
 * out of the family.
 */
function resolve(
  itemDb: Record<string, ItemDbEntry>,
  members: readonly SuggestionReward[],
): ArtPiece[] {
  const seen = new Set<string>();
  const out: ArtPiece[] = [];
  for (const member of members) {
    const hit = resolveDropArt(itemDb, member.name, member.uniqueName);
    const supplied = member.imageUrl ?? null;
    const imageUrl = hit?.imageUrl || supplied;
    if (!imageUrl || seen.has(imageUrl)) continue;
    seen.add(imageUrl);
    out.push({
      name: plainName(hit?.name ?? member.name),
      imageUrl,
      fallbackUrl: supplied === imageUrl ? null : supplied,
    });
  }
  return out;
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
  const kinds = oneEach(members);
  // One kind in two grades: the colour is known, so there is nothing to step
  // through and the pair says all of it at once.
  if (kinds.length < 2) {
    const pieces = resolve(itemDb, members.slice(0, 2));
    return pieces.length > 1
      ? { mode: "pair", pieces }
      : { mode: "single", pieces: pieces.slice(0, 1) };
  }
  const pieces = resolve(itemDb, kinds.slice(0, MAX_CYCLE));
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
  const still = pieces.length > 1 ? pieces : resolve(itemDb, [lead, other]);
  // Whatever the family said, one picture is one picture: a mode is chosen off
  // what actually resolved, so no card is ever handed an empty box.
  if (still.length > 1) return { mode: "pair", pieces: still.slice(0, 2) };
  return { mode: "single", pieces: still.slice(0, 1) };
}
