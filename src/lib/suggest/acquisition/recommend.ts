/** What a tier letter is worth. */
const TIER_POINTS: Record<string, number> = { S: 5, A: 4, B: 3, C: 2, D: 1 };

/** Overframe averages its votes on a 1..5 scale with 1 at the top, and the tier
 *  letter is that average rounded. */
const TIER_SCORE: Record<string, number> = { S: 1, A: 2, B: 3, C: 4, D: 5 };

const TIER_SCALE = 5;

/** The score behind a letter, lower is better; null for a letter nothing
 *  recognises. A score rounding to a different letter is a player's own
 *  override, so the midpoint stands instead. */
export function tierScore(
  tier: string | null | undefined,
  score: number | null = null,
): number | null {
  const midpoint = tier ? TIER_SCORE[tier.trim().toUpperCase()] : undefined;
  if (midpoint === undefined) return null;
  if (score === null || !Number.isFinite(score) || score <= 0) return midpoint;
  return Math.round(Math.min(score, TIER_SCALE)) === midpoint ? score : midpoint;
}

/** Sort order for a tier letter, best first; unknown sorts last, not middling. */
export function tierOrder(tier: string | null | undefined): number | null {
  if (!tier) return null;
  const points = TIER_POINTS[tier.trim().toUpperCase()];
  return points === undefined ? null : -points;
}
