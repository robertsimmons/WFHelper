import data from "../../data/suggest/rewardValues.json";
import { noteUnplaced } from "./unplaced.js";
import { normalizeRewardName, parseQuantityName } from "../../../config/shared/quantityPrefix.js";
import { LADDER_GROUPS, type LadderGroup, type WorthGroup } from "../../types/suggest.js";

/** Each group owns a band, and an entry interpolates within its group's band, so
 *  moving group jumps the worth and reordering nudges it. The gaps between bands
 *  are wider than anything quantity can add, so a count cannot cross a group. */
const BANDS: Record<LadderGroup, { low: number; high: number }> = {
  must: { low: 0.86, high: 0.98 },
  want: { low: 0.66, high: 0.82 },
  useful: { low: 0.42, high: 0.62 },
  filler: { low: 0.18, high: 0.38 },
  junk: { low: 0.04, high: 0.14 },
};

/** Nothing the ladder has no opinion about scores at all. */
export const UNPLACED_WORTH = 0;

/** What a task pays when not one of its rewards resolved: low enough to sink
 *  under every placed reward, and not zero, so it is still a suggestion. */
export const UNRESOLVED_WORTH = 0.02;

/** Ten thousand of a thing is as much as the ladder cares to distinguish, which
 *  is enough to separate a daily act's standing from an elite act's. */
const QUANTITY_CAP = 10_000;

/** Quantity nudges an entry inside its own slot; it never reorders the ladder. */
const MAX_QUANTITY_LIFT = 0.015;

type LadderData = Record<string, string[] | undefined>;

const LADDER: LadderData = data.ladder;

/** One pile, many spellings: rewards arrive counted ("3x Forma", "50,000 Kuva",
 *  "10k Kuva") and as either the blueprint or the built item. */
export function normalizeName(name: string): string {
  return normalizeRewardName(name);
}

/** How many of the thing the name is counting; 1 when it counts nothing. */
export function rewardCount(name: string | null | undefined): number {
  return parseQuantityName(name).count ?? 1;
}

interface Placement {
  group: LadderGroup;
  /** Position in the group's shipped order, best first. */
  index: number;
  size: number;
}

function buildLadder(): Map<string, Placement> {
  const placements = new Map<string, Placement>();
  for (const group of LADDER_GROUPS) {
    const names = LADDER[group] ?? [];
    names.forEach((name, index) => {
      placements.set(normalizeName(name), { group, index, size: names.length });
    });
  }
  return placements;
}

const SHIPPED = buildLadder();

/** Normalized key to the spelling the ladder ships, for display. */
export const LADDER_DISPLAY_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  LADDER_GROUPS.flatMap((group) =>
    (LADDER[group] ?? []).map((name) => [normalizeName(name), name]),
  ),
);

/** Every entry the ladder ships, with the group it ships in. */
export function shippedPlacements(): Record<string, LadderGroup> {
  const placed: Record<string, LadderGroup> = {};
  for (const [key, placement] of SHIPPED) placed[key] = placement.group;
  return placed;
}

/** Half the gap to the entry above, so a count can never reorder the group. */
function liftCeiling(group: LadderGroup, key: string): number {
  const shipped = SHIPPED.get(key);
  if (!shipped || shipped.group !== group || shipped.size <= 1) return MAX_QUANTITY_LIFT;
  const band = BANDS[group];
  const step = (band.high - band.low) / (shipped.size - 1);
  return Math.min(MAX_QUANTITY_LIFT, step / 2);
}

function quantityLift(group: LadderGroup, key: string, count: number): number {
  if (count <= 1) return 0;
  const share = Math.min(1, Math.log(count) / Math.log(QUANTITY_CAP));
  return liftCeiling(group, key) * share;
}

/** Where an entry sits inside its group's band: the top of the band, the foot,
 *  and everything between. */
export const TOP_POSITION = 0;
export const FOOT_POSITION = 1;

/** One position per entry the player has dragged, keyed the way the ladder keys
 *  everything else. Only groups the player has reordered appear. */
export type LadderPositions = Readonly<Record<string, number>>;

const NO_POSITIONS: LadderPositions = {};

/** A chosen order has to reach `ladderWorth`, which the scorer calls with
 *  nothing but a group and a key, so the store publishes it here. */
let chosen: LadderPositions = NO_POSITIONS;

export function setLadderPositions(positions: LadderPositions): void {
  chosen = positions;
}

export function ladderPositionsForTest(): LadderPositions {
  return chosen;
}

function clampPosition(value: number): number {
  if (!Number.isFinite(value)) return FOOT_POSITION;
  return Math.min(FOOT_POSITION, Math.max(TOP_POSITION, value));
}

/** A position the player chose wins. Anything untouched keeps the position it
 *  ships at, and an entry in a group it does not ship in sits at the foot. */
export function entryPosition(
  group: LadderGroup,
  key: string,
  positions: LadderPositions = chosen,
): number {
  const picked = positions[key];
  if (picked !== undefined) return clampPosition(picked);
  const shipped = SHIPPED.get(key);
  if (!shipped || shipped.group !== group) return FOOT_POSITION;
  if (shipped.size <= 1) return TOP_POSITION;
  return shipped.index / (shipped.size - 1);
}

/** A group's entries best first, which is the order the settings ladder draws
 *  and the order a drag reads its indexes against. */
export function orderEntries(
  group: LadderGroup,
  keys: readonly string[],
  positions: LadderPositions = chosen,
): string[] {
  return [...keys].sort(
    (a, b) =>
      entryPosition(group, a, positions) - entryPosition(group, b, positions) || a.localeCompare(b),
  );
}

/** The positions a group takes once `key` lands at `index` of it. A drop spells
 *  out every entry in the group rather than only the one that moved, so a later
 *  drag elsewhere cannot re-space what this one settled. */
export function reorderPositions(
  ordered: readonly string[],
  key: string,
  index: number,
): Record<string, number> {
  const rest = ordered.filter((entry) => entry !== key);
  const at = Math.min(Math.max(index, 0), rest.length);
  const placed = [...rest.slice(0, at), key, ...rest.slice(at)];
  const last = placed.length - 1;
  const positions: Record<string, number> = {};
  placed.forEach((entry, position) => {
    positions[entry] = last <= 0 ? TOP_POSITION : position / last;
  });
  return positions;
}

/** An entry sits at its position inside its group's band, so reordering nudges
 *  the worth and moving group jumps it. The shipped arms are spelled out rather
 *  than folded through `entryPosition`, so an entry nobody dragged lands on the
 *  same float it landed on before the ladder could be dragged at all. */
function bandWorth(group: WorthGroup, key: string, positions: LadderPositions): number {
  if (group === "unplaced") return UNPLACED_WORTH;
  const band = BANDS[group];
  const picked = positions[key];
  if (picked !== undefined) return band.high - clampPosition(picked) * (band.high - band.low);
  const shipped = SHIPPED.get(key);
  // The ladder places this nowhere, so whatever group a caller named for it, it
  // has no worth to interpolate. A band floor here would invent one.
  if (!shipped) {
    noteUnplaced(key);
    return UNPLACED_WORTH;
  }
  // Moved out of the group it ships in, so it lands at the foot of the new band.
  if (shipped.group !== group) return band.low;
  if (shipped.size <= 1) return band.high;
  return band.high - (shipped.index / (shipped.size - 1)) * (band.high - band.low);
}

/** Where a placed entry lands, counting included. */
export function ladderWorthAt(
  positions: LadderPositions,
  group: WorthGroup,
  key: string,
  count = 1,
): number {
  if (group === "unplaced") {
    noteUnplaced(key);
    return UNPLACED_WORTH;
  }
  const base = bandWorth(group, key, positions);
  return Math.min(1, base + quantityLift(group, key, count));
}

export function ladderWorth(group: WorthGroup, key: string, count = 1): number {
  return ladderWorthAt(chosen, group, key, count);
}

/** Which group a worth reads as, so a suggestion that never named a reward can
 *  still be banded by what it scored. */
export function groupForWorth(worth: number): WorthGroup {
  for (const group of LADDER_GROUPS) {
    if (worth >= BANDS[group].low) return group;
  }
  return "unplaced";
}

/** The top of a group's band, which a bonus may lift an entry to but not past. */
export function bandCeiling(group: WorthGroup): number {
  return group === "unplaced" ? UNPLACED_WORTH : BANDS[group].high;
}

/** The foot of a group's band: where something belongs in a group without being
 *  worth pricing inside it. */
export function bandFloor(group: WorthGroup): number {
  return group === "unplaced" ? UNPLACED_WORTH : BANDS[group].low;
}

/** Where a position inside a group's band lands, for a reward the ladder cannot
 *  name but a tier can rate. */
export function bandWorthAt(group: LadderGroup, position: number): number {
  const band = BANDS[group];
  return band.high - clampPosition(position) * (band.high - band.low);
}

/** Best first, so a group compares as a number wherever order matters. */
export function groupRank(group: WorthGroup): number {
  const index = (LADDER_GROUPS as readonly string[]).indexOf(group);
  return index < 0 ? LADDER_GROUPS.length : index;
}

/** Rewards the curated table says a task pays, for the tasks whose payout no
 *  world state or drop pool ever names. */
export function taskRewardNames(taskId: string): readonly string[] {
  return (data.tasks as Record<string, string[] | undefined>)[taskId] ?? [];
}

/** Standing an act of each tier pays, which is the only reward most acts have. */
export const NIGHTWAVE_STANDING = data.nightwave.standing;
