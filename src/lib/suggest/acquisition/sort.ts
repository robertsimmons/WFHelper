import { difficultyValue } from "./ratings.js";
import { recommendScore, tierOrder } from "./recommend.js";
import type { AcquisitionTarget } from "./types.js";
import type { SortDirection } from "../../../types/filters.js";

export const ACQUISITION_SORTS = ["recommended", "difficulty", "tier", "plat"] as const;
export type AcquisitionSort = (typeof ACQUISITION_SORTS)[number];

export const DEFAULT_ACQUISITION_SORT: AcquisitionSort = "recommended";

export interface SortRow {
  target: AcquisitionTarget;
  /** What the provider worked the farm out to cost, as the tie-breaker. */
  effort: number;
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

/** Lower sorts earlier under every mode; null is unknown and sorts last. */
export function sortValue(target: AcquisitionTarget, sort: AcquisitionSort): number | null {
  switch (sort) {
    case "difficulty":
      return difficultyValue(target.difficulty);
    case "tier":
      return tierOrder(target.rank);
    case "plat":
      return platFor(target);
    default:
      // The formula reads a missing half as neutral, but an item with neither
      // half rated is unknown, and unknown never leads the list.
      return target.rank === null && target.difficulty === null
        ? null
        : -recommendScore(target.rank, target.difficulty);
  }
}

/** An unrated item never leads the list, whichever way the arrow points. */
export function compareAcquisition(
  sort: AcquisitionSort,
  direction: SortDirection = "asc",
): (a: SortRow, b: SortRow) => number {
  const flip = direction === "desc" ? -1 : 1;
  return (a, b) => {
    const left = sortValue(a.target, sort);
    const right = sortValue(b.target, sort);
    if (left === null || right === null) {
      if (left !== right) return left === null ? 1 : -1;
    } else if (left !== right) {
      return (left - right) * flip;
    }
    return (
      a.effort - b.effort ||
      priceFor(a.target) - priceFor(b.target) ||
      a.target.name.localeCompare(b.target.name)
    );
  };
}
