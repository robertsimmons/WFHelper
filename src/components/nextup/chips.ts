import { formatCompactDuration, parseIsoDate } from "../../lib/format.js";
import { clockStore } from "../../lib/timers.js";
import type { MessageKey } from "../../lib/i18n.js";
import type { ValenceVerdict } from "../../lib/suggest/valence.js";
import type { ChoiceState } from "../../types/suggest.js";

/** What a chip can say. Ownership is a fact about the player's inventory, not
 *  one of the choices a Circuit week puts in front of them. */
export type ChipState = ChoiceState | "owned";

/** In hand either way: a choice with nothing left to win, and an item the
 *  player simply owns. Split so either side can diverge on its own. */
const IN_HAND = {
  label: "nextUp.stateOwned",
  tone: "border-border bg-bg-deep text-text-muted",
} as const;

/** Off the STRIP palette SuggestionCard already draws choice states in. */
export const STATE_CHIP: Record<ChipState, { label: MessageKey; tone: string }> = {
  wanted: { label: "nextUp.stateNeed", tone: "border-success/60 bg-success/10 text-success" },
  subsume: { label: "nextUp.stateSubsume", tone: "border-warning/60 bg-warning/10 text-warning" },
  done: IN_HAND,
  owned: IN_HAND,
};

/** A pill reads in minutes, and every card in the feed shares the one interval. */
export const CARD_CLOCK_MS = 30_000;

export const cardClock = clockStore(CARD_CLOCK_MS);

/** The letter a tier draws as; null for anything unrated. */
export function tierLetter(tier: string | null | undefined): string | null {
  const trimmed = tier?.trim();
  return trimmed ? trimmed : null;
}

/** Null once the window has closed, so a stale pill never lingers. */
export function timeLeftText(expiry: string | null | undefined, nowMs: number): string | null {
  const end = parseIsoDate(expiry ?? null);
  if (!end) return null;
  return formatCompactDuration(end.getTime() - nowMs) || null;
}

/** The chip a card of choices draws: the best thing still outstanding, or the
 *  plain fact of ownership once the week has nothing left to offer. */
export function choicesState(states: readonly ChoiceState[]): ChipState | null {
  if (states.length === 0) return null;
  if (states.includes("wanted")) return "wanted";
  if (states.includes("subsume")) return "subsume";
  return "owned";
}

/** The wiki always reports one decimal place, so a whole number reads as one. */
export function valencePercent(bonus: number): string {
  return bonus.toFixed(1);
}

/**
 * What the offered percentage reads as. Only the two verdicts where the offer
 * itself puts the cap in reach read as good: a copy the player already holds
 * over the threshold finishes on any second copy, so that offer's percentage is
 * incidental rather than the reason to buy.
 */
const VALENCE_TONE: Record<ValenceVerdict, string> = {
  caps: "text-success",
  ready: "text-success",
  secondCopy: "text-text-secondary",
  short: "text-text-muted",
  done: "text-text-muted",
};

export function valenceTone(verdict: ValenceVerdict): string {
  return VALENCE_TONE[verdict];
}
