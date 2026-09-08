import { groupForWorth, groupRank } from "./worthLadder.js";
import type {
  ScoreWeights,
  SuggestionDetails,
  SuggestionSignals,
  WorthGroup,
} from "../../types/suggest.js";

const HOUR_MS = 60 * 60_000;

/** The window a caller that cannot name its own is measured against. */
export const URGENCY_HORIZON_MS = 72 * HOUR_MS;

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Urgency is how far through its own window the offer is, so a weekly climbs
 *  across its week exactly as a daily climbs across its day. An expiry already
 *  past scores 0: the window is gone, not urgent. */
export function urgencyFromExpiry(
  expiry: string | null | undefined,
  nowMs: number,
  windowMs: number = URGENCY_HORIZON_MS,
): number {
  if (!expiry) return 0;
  const expiryMs = Date.parse(expiry);
  if (!Number.isFinite(expiryMs)) return 0;
  const remaining = expiryMs - nowMs;
  if (remaining <= 0) return 0;
  const window = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : URGENCY_HORIZON_MS;
  return clamp01(1 - remaining / window);
}

/** Stored, and no longer read by the ordering: bands decide the feed. */
export const DEFAULT_WEIGHTS: ScoreWeights = { value: 1, urgency: 0.8, effort: 0.5 };

/** A weight past this would let one signal swamp the other two. */
export const WEIGHT_MAX = 2;
export const WEIGHT_STEP = 0.05;

/** Everything the ordering reads off a suggestion, draft or scored. */
export interface Orderable {
  signals: SuggestionSignals;
  details?: SuggestionDetails | undefined;
  deprioritized?: boolean | undefined;
}

/** Worth is what the reward is; gain is whether this player still needs it.
 *  Absent gain reads as 1, and zero gain is dropped rather than ordered. */
export function effectiveWorth(signals: SuggestionSignals): number {
  return clamp01(signals.value) * clamp01(signals.gain ?? 1);
}

export function worthGroupOf(suggestion: Orderable): WorthGroup {
  return groupForWorth(effectiveWorth(suggestion.signals));
}

/** How long the window has left. No live deadline reads as forever, which is
 *  the one thing that can never be about to close. */
export function timeLeftMs(suggestion: Orderable, nowMs: number): number {
  const expiry = suggestion.details?.expiry;
  if (!expiry) return Number.POSITIVE_INFINITY;
  const expiryMs = Date.parse(expiry);
  if (!Number.isFinite(expiryMs)) return Number.POSITIVE_INFINITY;
  const remaining = expiryMs - nowMs;
  return remaining > 0 ? remaining : Number.POSITIVE_INFINITY;
}

const CLOSING_MS = 6 * HOUR_MS;
const TODAY_MS = 24 * HOUR_MS;

/** Useful is the floor for anything a closing window may promote. */
const PROMOTABLE = groupRank("useful");

export const ORDER_BANDS = 4;

/** Worth leads; time only ever decides a cutoff. A low-worth thing about to
 *  expire is still a low-worth thing. */
export function bandFor(suggestion: Orderable, nowMs: number): number {
  const rank = groupRank(worthGroupOf(suggestion));
  const left = timeLeftMs(suggestion, nowMs);
  if (rank <= PROMOTABLE && left < CLOSING_MS) return 1;
  if (rank <= groupRank("want")) return 2;
  if (rank <= PROMOTABLE && left < TODAY_MS) return 3;
  return 4;
}

/** Nearness as a bounded, monotone stand-in for time left. */
function nearness(left: number): number {
  if (!Number.isFinite(left)) return 0;
  return 1 / (1 + left / HOUR_MS);
}

/** One number the bands, worth and time left fold into, in that order of
 *  authority, so anything that sorts by score alone agrees with
 *  `compareSuggestions`. */
export function orderingScore(suggestion: Orderable, nowMs: number): number {
  const band = bandFor(suggestion, nowMs);
  const turnedDown = suggestion.deprioritized === true ? 0 : 1;
  return (
    turnedDown * 1000 +
    (ORDER_BANDS - band) * 10 +
    effectiveWorth(suggestion.signals) +
    nearness(timeLeftMs(suggestion, nowMs)) * 1e-4
  );
}
