import subsumes from "../../../data/suggest/subsumes.json";
import { nameKey } from "./curated.js";

interface SubsumeRow {
  ability?: unknown;
  points?: unknown;
}

const POINTS = new Map<string, number>();
for (const [name, row] of Object.entries(subsumes as Record<string, SubsumeRow>)) {
  const points = row.points;
  if (typeof points === "number" && Number.isFinite(points) && points > 0) {
    POINTS.set(nameKey(name), points);
  }
}

const MAX_POINTS = Math.max(0, ...POINTS.values());

/** How often build guides reach for the frame's ability, 0..1. The root lifts
 *  the long tail so a handful of picks still reads above none. */
export function subsumeValue(name: string): number {
  const points = POINTS.get(nameKey(name));
  if (!points || MAX_POINTS === 0) return 0;
  return Math.sqrt(points / MAX_POINTS);
}
