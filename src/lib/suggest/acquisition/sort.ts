import { masteryXp } from "./masteryXp.js";
import { ownedParts, totalParts } from "./parts.js";
import { headlinePath, isBlueprintPrice } from "./paths.js";
import { effortValue } from "./ratings.js";
import { tierOrder, tierScore } from "./recommend.js";
import { subsumeValue } from "./subsumes.js";
import { itemTierScore } from "./tiers.js";
import { traderAt } from "./traders.js";
import type { AcquisitionPath, AcquisitionTarget, PlatCost } from "./types.js";
import type { SortDirection } from "../../../types/filters.js";

export const ACQUISITION_SORTS = ["recommended", "difficulty", "tier", "plat"] as const;
export type AcquisitionSort = (typeof ACQUISITION_SORTS)[number];

export const DEFAULT_ACQUISITION_SORT: AcquisitionSort = "recommended";

export interface SortRow {
  target: AcquisitionTarget;
  /** What the provider worked the farm out to cost, as the tie-breaker. */
  effort: number;
  /** Every key a comparison reads, worked out once. The comparator runs
   *  O(n log n) times over a few thousand rows and each key behind it is a
   *  name normalize and a table lookup. */
  keys: readonly (number | null)[];
  price: number;
}

/** What finishing the item off the market costs: the parts still missing, or the
 *  whole set where that covers them for less. */
function completionPlat(plat: PlatCost | null | undefined): number | null {
  if (!plat) return null;
  const options = [plat.partsTotal, plat.set].filter((value): value is number => value !== null);
  return options.length > 0 ? Math.min(...options) : null;
}

/** The cheapest plat any known route asks; null for a target nothing prices. */
export function platFor(target: AcquisitionTarget): number | null {
  let best: number | null = null;
  for (const path of target.paths) {
    const plat = completionPlat(path.cost.plat);
    if (plat !== null && (best === null || plat < best)) best = plat;
  }
  return best;
}

/** Hundreds of items tie at the same route, so price breaks the tie: the cheaper
 *  one is the genuinely easier win, and a name never is. */
function priceFor(target: AcquisitionTarget): number {
  const cost = headlinePath(target.paths)?.cost;
  if (!cost) return Number.POSITIVE_INFINITY;
  const plat = completionPlat(cost.plat);
  return plat ?? cost.credits ?? Number.POSITIVE_INFINITY;
}

const READY_BAND = 0;
const BUILD_BAND = 1;
const WORK_BAND = 2;
const PLAT_BAND = 3;

/** Every part is in hand and the foundry will take it: nothing left to farm. */
const READY_EFFORT = 0.05;
/** Every part or its blueprint is in hand, but the foundry is still owed work. */
const MATERIALS_EFFORT = 0.35;

function isReady(target: AcquisitionTarget): boolean {
  const parts = target.parts;
  return !target.modular && parts.known && parts.buildable;
}

/** Every part or its blueprint and every material is in hand: only sub-builds left. */
function isBuildOnly(target: AcquisitionTarget): boolean {
  const parts = target.parts;
  return (
    !target.modular &&
    parts.known &&
    parts.sourcing.length === 0 &&
    parts.materials.every((material) => material.missing === 0)
  );
}

/** The foundry would take it now, only builds are left, or there is still a farm. */
export function readyBand(target: AcquisitionTarget): number {
  if (isReady(target)) return READY_BAND;
  return isBuildOnly(target) ? BUILD_BAND : WORK_BAND;
}

/** What the rest of the build costs on its cheapest route. Null where nothing
 *  the app knows finishes it, which is not a cost of nothing. */
export function remainingEffort(target: AcquisitionTarget): number | null {
  if (headlinePath(target.paths)) return target.effort;
  const parts = target.parts;
  if (target.modular || !parts.known || parts.sourcing.length > 0) return planEffort(target);
  return parts.buildable ? READY_EFFORT : MATERIALS_EFFORT;
}

/** Plan effort is 1-10; a sort key's is 0-1. */
function planEffort(target: AcquisitionTarget): number | null {
  const effort = target.rating?.effort;
  return typeof effort === "number" ? effort / 10 : null;
}

/** A route's effort reads the same for one drop as for four, so the count
 *  settles a tie between two farms of the same route. */
export function partsLeft(target: AcquisitionTarget): number | null {
  const modular = target.modular;
  // Each head part is its own build, so a gear type is as far from ready as the
  // heads it has still to bank.
  if (modular) return modular.heads.length - modular.owned;
  return target.parts.known ? target.parts.missing.length : null;
}

/** A rank-30 frame's mastery, the unit every other need is weighed in. */
const FRAME_MASTERY_XP = 6000;
/** Tier score 1 (best) lifts mastery by a fifth, 5 (worst) cuts it by a fifth. */
const TIER_LIFT = 0.2;
const MID_TIER_SCORE = 3;
/** A gear type has no part count, so it reads as halfway there. */
const MODULAR_CLOSENESS = 0.5;
/** Nothing is free, and a near-zero farm would swamp every other term. */
const MIN_DIFFICULTY = 0.05;

function tierMultiplier(target: AcquisitionTarget): number {
  const score = tierScore(target.tier, itemTierScore(target.name));
  return score === null ? 1 : 1 + ((MID_TIER_SCORE - score) / 2) * TIER_LIFT;
}

/** Incarnon and Prime-upgrade needs win nothing toward building the thing. */
function worth(target: AcquisitionTarget): number {
  let total = 0;
  if (target.needs.includes("mastery")) {
    total += (masteryXp(target) / FRAME_MASTERY_XP) * tierMultiplier(target);
  }
  if (target.needs.includes("subsume")) total += subsumeValue(target.name);
  return total;
}

function closeness(target: AcquisitionTarget): number {
  if (target.modular || !target.parts.known) return MODULAR_CLOSENESS;
  return (ownedParts(target.parts) + 1) / (totalParts(target.parts) + 1);
}

/** A route only Baro or Varzia sells walks while they are in and stock it. */
function traderOnly(path: AcquisitionPath): boolean {
  return path.steps.length > 0 && path.steps.every((step) => traderAt(step.where) !== null);
}

function walkable(path: AcquisitionPath): boolean {
  if (path.kind === "trade" || isBlueprintPrice(path)) return false;
  if (traderOnly(path) && !path.stocked) return false;
  return (path.cost.relics?.stranded.length ?? 0) === 0;
}

/** The route the headline would lead with if plat were off the table. */
export function inGamePath(paths: readonly AcquisitionPath[]): AcquisitionPath | null {
  return paths.find(walkable) ?? null;
}

/** Nothing in game walks it now, but the market finishes it. */
function platOnly(target: AcquisitionTarget): boolean {
  if (!headlinePath(target.paths) || inGamePath(target.paths)) return false;
  return target.paths.some(
    (path) => path.kind === "trade" && completionPlat(path.cost.plat) !== null,
  );
}

/** A trade is the plat alternative, never the farm the score weighs. */
function farmDifficulty(target: AcquisitionTarget): number | null {
  if (!headlinePath(target.paths)) return remainingEffort(target);
  return inGamePath(target.paths)?.effort ?? null;
}

/** Still farming orders by what the build wins for how close and how cheap it
 *  is; negated so the best reads lowest. Null where no difficulty is known. */
export function farmScore(target: AcquisitionTarget): number | null {
  const difficulty = farmDifficulty(target);
  if (difficulty === null) return null;
  return -((worth(target) * closeness(target)) / Math.max(MIN_DIFFICULTY, difficulty));
}

/** What a mode orders by, first key first. Lower sorts earlier; null is unknown
 *  and sorts last within its own key. Recommended bands ready, then only builds
 *  left, then still farming, then plat only; the first two order by the cheapest
 *  work left, then tier, still farming by its farm score, and plat only by plat. */
export function sortKeys(target: AcquisitionTarget, sort: AcquisitionSort): (number | null)[] {
  switch (sort) {
    case "difficulty":
      return [effortValue(target.difficulty) ?? planEffort(target)];
    case "tier":
      return [tierOrder(target.tier)];
    case "plat":
      return [platFor(target)];
    default: {
      const band = readyBand(target);
      if (band === WORK_BAND) {
        return platOnly(target) ? [PLAT_BAND, platFor(target)] : [band, farmScore(target)];
      }
      return [
        band,
        remainingEffort(target),
        partsLeft(target),
        tierScore(target.tier, itemTierScore(target.name)),
      ];
    }
  }
}

export function sortRow(target: AcquisitionTarget, effort: number, sort: AcquisitionSort): SortRow {
  return { target, effort, keys: sortKeys(target, sort), price: priceFor(target) };
}

function rankKey(left: number | null, right: number | null, flip: number): number {
  if (left === null || right === null) {
    if (left === right) return 0;
    return left === null ? 1 : -1;
  }
  return left === right ? 0 : (left - right) * flip;
}

/** An unrated item never leads the list, whichever way the arrow points. */
export function compareAcquisition(
  direction: SortDirection = "asc",
): (a: SortRow, b: SortRow) => number {
  const flip = direction === "desc" ? -1 : 1;
  return (a, b) => {
    const left = a.keys;
    const right = b.keys;
    for (let index = 0; index < left.length; index += 1) {
      const rank = rankKey(left[index] ?? null, right[index] ?? null, flip);
      if (rank !== 0) return rank;
    }
    return a.effort - b.effort || a.price - b.price || a.target.name.localeCompare(b.target.name);
  };
}
