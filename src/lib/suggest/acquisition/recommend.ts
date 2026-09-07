import { UNKNOWN_DIFFICULTY, difficultyValue } from "./ratings.js";

/** What a tier letter is worth. An unrated item scores the middle letter, so a
 *  missing tier never sinks it. */
const TIER_POINTS: Record<string, number> = { S: 5, A: 4, B: 3, C: 2, D: 1 };
const UNRANKED_POINTS = 3;

/** What the grimmest farm gives back. Wide enough that a really easy A-tier
 *  outscores a very hard S-tier, narrow enough that the tier still leads. */
const DIFFICULTY_POINTS = 3;

export function tierPoints(rank: string | null | undefined): number {
  if (!rank) return UNRANKED_POINTS;
  return TIER_POINTS[rank.trim().toUpperCase()] ?? UNRANKED_POINTS;
}

/** Rank order for a tier letter, best first; unknown sorts last, not middling. */
export function tierOrder(rank: string | null | undefined): number | null {
  if (!rank) return null;
  const points = TIER_POINTS[rank.trim().toUpperCase()];
  return points === undefined ? null : -points;
}

/**
 * Tier points less a difficulty toll, higher is a better thing to farm next.
 * Both halves read the middle when nothing has rated the item.
 */
export function recommendScore(
  rank: string | null | undefined,
  difficulty: string | number | null | undefined,
): number {
  const toll = difficultyValue(difficulty) ?? UNKNOWN_DIFFICULTY;
  return tierPoints(rank) - toll * DIFFICULTY_POINTS;
}
