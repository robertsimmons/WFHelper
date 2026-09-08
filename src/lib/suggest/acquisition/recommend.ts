import { UNKNOWN_EFFORT, effortValue } from "./ratings.js";

/** What a tier letter is worth. An unrated item scores the middle letter, so a
 *  missing tier never sinks it. */
const TIER_POINTS: Record<string, number> = { S: 5, A: 4, B: 3, C: 2, D: 1 };
const UNTIERED_POINTS = 3;

/** What the grimmest farm gives back. Wide enough that a really easy A-tier
 *  outscores a very hard S-tier, narrow enough that the tier still leads. */
const EFFORT_POINTS = 3;

export function tierPoints(tier: string | null | undefined): number {
  if (!tier) return UNTIERED_POINTS;
  return TIER_POINTS[tier.trim().toUpperCase()] ?? UNTIERED_POINTS;
}

/** Sort order for a tier letter, best first; unknown sorts last, not middling. */
export function tierOrder(tier: string | null | undefined): number | null {
  if (!tier) return null;
  const points = TIER_POINTS[tier.trim().toUpperCase()];
  return points === undefined ? null : -points;
}

/**
 * Tier points less an effort toll, higher is a better thing to farm next.
 * Both halves read the middle when nothing has rated the item.
 */
export function recommendScore(
  tier: string | null | undefined,
  difficulty: string | number | null | undefined,
): number {
  const toll = effortValue(difficulty) ?? UNKNOWN_EFFORT;
  return tierPoints(tier) - toll * EFFORT_POINTS;
}
