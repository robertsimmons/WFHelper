import { headlinePath } from "./paths.js";
import { effortValue } from "./ratings.js";
import { tierOrder, tierScore } from "./recommend.js";
import { itemTierScore } from "./tiers.js";
import type { AcquisitionTarget, PlatCost } from "./types.js";
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
const WORK_BAND = 1;

/** Every part is in hand and the foundry will take it: nothing left to farm. */
const READY_EFFORT = 0.05;
/** Every part is in hand but the raw materials are not. */
const MATERIALS_EFFORT = 0.35;

function isReady(target: AcquisitionTarget): boolean {
  const parts = target.parts;
  return !target.modular && parts.known && parts.missing.length === 0 && parts.buildable;
}

/** The foundry would take it now, or there is still work to do. */
export function readyBand(target: AcquisitionTarget): number {
  return isReady(target) ? READY_BAND : WORK_BAND;
}

/** What the rest of the build costs on its cheapest route. Null where nothing
 *  the app knows finishes it, which is not a cost of nothing. */
export function remainingEffort(target: AcquisitionTarget): number | null {
  if (headlinePath(target.paths)) return target.effort;
  const parts = target.parts;
  if (target.modular || !parts.known || parts.missing.length > 0) return null;
  return parts.buildable ? READY_EFFORT : MATERIALS_EFFORT;
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

/** What a mode orders by, first key first. Lower sorts earlier; null is unknown
 *  and sorts last within its own key. Recommended leads with what the foundry
 *  would take now, then the cheapest work left, then tier. */
export function sortKeys(target: AcquisitionTarget, sort: AcquisitionSort): (number | null)[] {
  switch (sort) {
    case "difficulty":
      return [effortValue(target.difficulty)];
    case "tier":
      return [tierOrder(target.tier)];
    case "plat":
      return [platFor(target)];
    default:
      return [
        readyBand(target),
        remainingEffort(target),
        partsLeft(target),
        tierScore(target.tier, itemTierScore(target.name)),
      ];
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
