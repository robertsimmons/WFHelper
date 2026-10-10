import { byStrength } from "./data.js";
import type { Tip, TipAnchor } from "./schema.js";
import type { PlanGroupType } from "../plan/schema.js";

/** A plan step as anchoring reads it. `route` is null for a group the resource
 *  store builds, which no item tip anchors to. */
export interface AnchorGroup {
  type: PlanGroupType;
  place: string;
  rows: readonly { label: string }[];
  route: "chosen" | "afterQuest" | null;
}

function holds(text: string, needle: string): boolean {
  return text.toLowerCase().includes(needle.trim().toLowerCase());
}

/** Group type, then place, then row label. A place nothing matches is no step;
 *  a row nothing matches still leaves the right group. -1 is plan level. */
export function anchorIndex(groups: readonly AnchorGroup[], anchor: TipAnchor): number {
  const route = anchor.route ?? "chosen";
  let found = groups
    .map((group, index) => ({ group, index }))
    .filter(({ group }) => group.route === route && group.type === anchor.group);
  if (anchor.place) {
    const place = anchor.place;
    found = found.filter(({ group }) => holds(group.place, place));
  }
  if (anchor.row) {
    const row = anchor.row;
    const narrowed = found.filter(({ group }) =>
      group.rows.some((entry) => holds(entry.label, row)),
    );
    if (narrowed.length > 0) found = narrowed;
  }
  return found[0]?.index ?? -1;
}

export interface PlacedTips<T> {
  /** Aligned with the groups handed in, strongest first. */
  groups: T[][];
  /** Anchored tips whose step this plan does not have. */
  rest: T[];
  sentiment: T[];
}

/** Every tip lands somewhere: its step, or plan level when the step is gone. */
export function placeTips<T extends Tip>(
  groups: readonly AnchorGroup[],
  tips: readonly T[],
): PlacedTips<T> {
  const placed: T[][] = groups.map(() => []);
  const rest: T[] = [];
  const sentiment: T[] = [];
  for (const tip of byStrength(tips)) {
    if (tip.kind === "sentiment") {
      sentiment.push(tip);
      continue;
    }
    const index = tip.anchor ? anchorIndex(groups, tip.anchor) : -1;
    if (index === -1) rest.push(tip);
    else placed[index].push(tip);
  }
  return { groups: placed, rest, sentiment };
}
