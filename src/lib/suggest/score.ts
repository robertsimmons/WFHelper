import type { ScoreWeights, SuggestionSignals } from "../../types/suggest.js";

/** Beyond this a deadline adds nothing; inside it, urgency climbs linearly. */
const URGENCY_HORIZON_MS = 72 * 60 * 60_000;

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** An expiry already past scores 0: the window is gone, not urgent. */
export function urgencyFromExpiry(expiry: string | null | undefined, nowMs: number): number {
  if (!expiry) return 0;
  const expiryMs = Date.parse(expiry);
  if (!Number.isFinite(expiryMs)) return 0;
  const remaining = expiryMs - nowMs;
  if (remaining <= 0) return 0;
  return clamp01(1 - remaining / URGENCY_HORIZON_MS);
}

export const DEFAULT_WEIGHTS: ScoreWeights = { value: 1, urgency: 0.8, effort: 0.5 };

/** A weight past this would let one signal swamp the other two. */
export const WEIGHT_MAX = 2;
export const WEIGHT_STEP = 0.05;

export function scoreSignals(
  signals: SuggestionSignals,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): number {
  return (
    clamp01(signals.value) * weights.value +
    clamp01(signals.urgency) * weights.urgency -
    clamp01(signals.effort) * weights.effort
  );
}
