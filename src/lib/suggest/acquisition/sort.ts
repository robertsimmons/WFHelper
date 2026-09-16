import { planRating } from "./plan/index.js";
import { effortValue } from "./ratings.js";
import { tierOrder, tierScore } from "./recommend.js";
import { itemTierScore } from "./tiers.js";
import type { AcquisitionTarget } from "./types.js";
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

/** The cheapest plat any known route asks; null for a target nothing prices. */
export function platFor(target: AcquisitionTarget): number | null {
  let best: number | null = null;
  for (const path of target.paths) {
    const plat = path.cost.plat?.set ?? path.cost.plat?.partsTotal ?? null;
    if (plat !== null && (best === null || plat < best)) best = plat;
  }
  return best;
}

/** Hundreds of items tie at the same route, so price breaks the tie: the cheaper
 *  one is the genuinely easier win, and a name never is. */
function priceFor(target: AcquisitionTarget): number {
  const cost = target.paths[0]?.cost;
  if (!cost) return Number.POSITIVE_INFINITY;
  const plat = cost.plat?.set ?? cost.plat?.partsTotal ?? null;
  return plat ?? cost.credits ?? Number.POSITIVE_INFINITY;
}

const READY_BAND = 0;
const MATERIALS_BAND = 1;
/** No recipe to walk, so no blueprint count puts it anywhere: behind them all. */
const NO_RECIPE_BAND = Number.MAX_SAFE_INTEGER;

/** Closest to ready first: the foundry would take it now, then every blueprint
 *  in hand and only raw materials short, then one band per blueprint still to
 *  find, so two short sorts behind one short. */
export function readyBand(target: AcquisitionTarget): number {
  const modular = target.modular;
  // Each head part is its own build, so a gear type is as far from ready as the
  // heads it has still to bank.
  if (modular) return MATERIALS_BAND + (modular.heads.length - modular.owned);
  const parts = target.parts;
  if (!parts.known) return NO_RECIPE_BAND;
  if (parts.missing.length > 0) return MATERIALS_BAND + parts.missing.length;
  return parts.buildable ? READY_BAND : MATERIALS_BAND;
}

/** What a mode orders by, first key first. Lower sorts earlier; null is unknown
 *  and sorts last within its own key. */
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
        tierScore(target.tier, itemTierScore(target.name)),
        planRating(target.name).effort,
      ];
  }
}

export function sortRow(
  target: AcquisitionTarget,
  effort: number,
  sort: AcquisitionSort,
): SortRow {
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
