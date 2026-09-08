import { ownsAny, type OwnedReward } from "./ownedRewards.js";
import { clamp01 } from "./score.js";
import type { NeedReason } from "./acquisition/types.js";
import type { MasteryStatus } from "../../types/inventory.js";
import type { SuggestionSignals } from "../../types/suggest.js";

/**
 * Worth says what a reward is; gain says whether this player still needs it.
 * Every function here answers that for one kind of thing and returns 0..1.
 */

/** Nothing left to win, so the suggestion goes rather than ordering last. */
export const NO_GAIN = 0;
/** Either nothing is owned, or nothing is known about what is owned. */
export const FULL_GAIN = 1;
/** Some of the win is already banked: a part-ranked weapon, a frame that still
 *  owes only its subsume, a purchase that only gets the player closer. */
export const PARTIAL_GAIN = 0.5;

/** An absent signal reads as a full gain: a provider that says nothing about
 *  ownership has not found the player finished. */
export function gainOf(signals: SuggestionSignals): number {
  return signals.gain === undefined ? FULL_GAIN : clamp01(signals.gain);
}

export function advances(gain: number): boolean {
  return gain > NO_GAIN;
}

/** The least advancing of several reads, since one exhausted reason is enough. */
export function leastGain(...gains: (number | undefined)[]): number {
  let least = FULL_GAIN;
  for (const gain of gains) {
    if (gain !== undefined) least = Math.min(least, clamp01(gain));
  }
  return least;
}

/** A mastered weapon or frame is finished; one part-ranked still owes its XP.
 *  An unknown status is an unread roster, which is never "already done". */
export function masteryGain(status: MasteryStatus | undefined): number {
  if (status === "mastered") return NO_GAIN;
  if (status === "progress") return PARTIAL_GAIN;
  return FULL_GAIN;
}

/** A component, blueprint or frame the player already holds pays nothing a
 *  second time. Resources, Forma and relics stack, so they keep their gain. */
export function ownedGain(owned: OwnedReward | null | undefined, stacks = false): number {
  if (stacks || !owned) return FULL_GAIN;
  return ownsAny(owned) ? NO_GAIN : FULL_GAIN;
}

/** Owning a frame and feeding it to the Helminth are separate wins, so a frame
 *  that owes only its subsume still advances, just less. Anything else the
 *  resolver lists is not on its own a reason to farm gear. */
const NEED_GAIN: Record<NeedReason, number> = {
  mastery: FULL_GAIN,
  subsume: 0.6,
  incarnon: NO_GAIN,
  prime: NO_GAIN,
};

/** The best reason a target is still wanted, and zero when none of them is a
 *  reason to build the thing at all. */
export function needsGain(needs: readonly NeedReason[]): number {
  let best = NO_GAIN;
  for (const need of needs) best = Math.max(best, NEED_GAIN[need] ?? NO_GAIN);
  return best;
}
