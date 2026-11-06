import { resourceEntry, type ResourceEntry, type ResourceLookup } from "./plan/resources.js";
import type { MaterialState } from "./types.js";

const CREDITS = "Credits";

/** Any real material farm costs at least a short run. */
const FLOOR = 0.25;
/** A huge shortfall reads as a real farm, never harder than the hardest route. */
const CEILING = 0.65;
/** The shortfall that sits halfway between floor and ceiling. */
const HALF_SHORT = 250;

/** Effort to farm a shortfall of one material that is not a star-chart staple. */
export function shortfallEffort(short: number): number {
  if (short <= 0) return 0;
  return FLOOR + (CEILING - FLOOR) * (short / (short + HALF_SHORT));
}

/** A build is as hard as its hardest material to farm, never the sum. Staples
 *  and Credits, aliases included, weigh nothing whatever the amount, and a
 *  part is weighed by its own routes. */
export function materialsEffort(
  materials: readonly MaterialState[],
  lookup: ResourceLookup = resourceEntry,
): number {
  let effort = 0;
  for (const material of materials) {
    if (material.part || trivial(lookup(material.name))) continue;
    effort = Math.max(effort, shortfallEffort(material.missing));
  }
  return effort;
}

function trivial(entry: ResourceEntry | null): boolean {
  return !!entry && (entry.common || entry.name === CREDITS);
}
