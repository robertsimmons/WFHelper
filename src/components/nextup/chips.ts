import { formatCompactDuration, parseIsoDate } from "../../lib/format.js";
import { clockStore } from "../../lib/timers.js";
import type { MessageKey } from "../../lib/i18n.js";
import type { OwnedReward } from "../../lib/suggest/ownedRewards.js";
import type { ValenceVerdict } from "../../lib/suggest/valence.js";
import type { ChoiceState, ChoiceStatus, ChoiceWin } from "../../types/suggest.js";

/** What a chip can say. Ownership is a fact about the player's inventory, not
 *  one of the choices a Circuit week puts in front of them. */
export type ChipState = ChoiceState | "owned";

/** Text colour by meaning. Every meaningful text colour in the feed resolves
 *  through here, so one tone never comes to mean two things. */
export const TONE = {
  good: "text-success",
  warn: "text-warning",
  bad: "text-danger",
  quiet: "text-text-secondary",
  plain: "text-text-muted",
} as const;

/** Border, background and text together: the box a toned chip draws as. */
export const CHIP_TONE = {
  good: "border-success/60 bg-success/10 text-success",
  warn: "border-warning/60 bg-warning/10 text-warning",
  bad: "border-danger/60 bg-danger/10 text-danger",
  plain: `border-border bg-bg-deep ${TONE.plain}`,
} as const;

/** The label a figure inside a tile wears. Carries no colour: the figure beside
 *  it takes the tone. */
export const TILE_MICRO =
  "font-display text-[0.5625rem] font-semibold uppercase leading-none tracking-[0.08em]";

/** What a count means. Green is the player's inventory; yellow is a copy the
 *  foundry has made or is making. */
export const COUNT_TONE = {
  inventory: TONE.good,
  foundry: TONE.warn,
  built: TONE.warn,
  /** Inventory read, and none in hand. An unread one draws nothing at all. */
  none: TONE.plain,
} as const;

/** One count the tile draws, in the order it draws them. */
export interface TileCount {
  kind: keyof typeof COUNT_LABEL;
  value: number;
  tone: string;
}

/** The label each count carries, since colour alone cannot tell a built copy
 *  from one the foundry is still running. */
export const COUNT_LABEL = {
  inventory: "nextUp.tileCountInventory",
  foundry: "nextUp.tileCountFoundry",
  built: "nextUp.tileCountBuilt",
} as const satisfies Record<string, MessageKey>;

export const COUNT_TITLE = {
  inventory: "nextUp.tileInInventory",
  foundry: "nextUp.tileInFoundry",
  built: "nextUp.tileBuilt",
} as const satisfies Record<keyof typeof COUNT_LABEL, MessageKey>;

/**
 * What a tile counts. An unread inventory is no counts at all rather than a
 * zero, and a foundry with nothing running says nothing. A read inventory
 * holding none does report its zero, which is a fact the player can act on.
 */
export function tileCounts(owned: OwnedReward | null | undefined): TileCount[] {
  if (!owned) return [];
  const counts: TileCount[] = [
    {
      kind: "inventory",
      value: owned.owned,
      tone: owned.owned > 0 ? COUNT_TONE.inventory : COUNT_TONE.none,
    },
  ];
  const pending = owned.pending ?? 0;
  if (pending > 0) counts.push({ kind: "foundry", value: pending, tone: COUNT_TONE.foundry });
  const built = owned.built ?? 0;
  if (built > 0) counts.push({ kind: "built", value: built, tone: COUNT_TONE.built });
  return counts;
}

/**
 * Whether a tile with nothing left owed reads dimmed. Only gear does, and only
 * where the tile was actually told the item is gear: a resource is always worth
 * more, so an unstated stacking rule keeps full contrast.
 */
export function tileDims(
  have: boolean | undefined,
  stacks: boolean | null | undefined,
  owned: OwnedReward | null | undefined,
): boolean {
  const piles = stacks ?? owned?.stacks ?? null;
  return have === true && piles === false;
}

// The riven --grade-* tokens run S green through F red, which reads as "S is a
// win" rather than as a tier, so the tier letters take their own ramp.
const TIER_TEXT: Record<string, string> = {
  S: "text-[color:var(--relic-requiem)]",
  A: TONE.good,
  B: TONE.warn,
  C: TONE.bad,
  D: TONE.bad,
  F: TONE.bad,
};

/** The same ramp as the letter, so a border never disagrees with the tier on it. */
const TIER_BORDER: Record<string, string> = {
  S: "border-[color:var(--relic-requiem)]",
  A: "border-success",
  B: "border-warning",
  C: "border-danger",
  D: "border-danger",
  F: "border-danger",
};

function tierKey(tier: string | null | undefined): string {
  return tier?.charAt(0).toUpperCase() ?? "";
}

/** Text class for a tier letter; a suffixed tier takes its letter's colour. */
export function tierTextClass(tier: string | null | undefined): string {
  return TIER_TEXT[tierKey(tier)] ?? TONE.plain;
}

/** Border class for a tier letter, or the plain border for anything unrated. */
export function tierBorderClass(tier: string | null | undefined): string {
  return TIER_BORDER[tierKey(tier)] ?? "border-border";
}

/** Off the one CHIP_TONE palette. In hand carries no chip either way: the
 *  coloured count and the dimmed tile already say it. */
export const STATE_CHIP: Record<ChipState, { label: MessageKey; tone: string } | null> = {
  wanted: { label: "nextUp.stateNeed", tone: CHIP_TONE.good },
  subsume: { label: "nextUp.stateSubsume", tone: CHIP_TONE.warn },
  done: null,
  owned: null,
};

/** Each win says so in words, both halves drawn whatever the answer: a banked
 *  one that went quiet is the thing the reader could not tell apart. */
const WIN_LABEL: Record<ChoiceWin, { done: MessageKey; todo: MessageKey }> = {
  mastery: { done: "common.mastered", todo: "common.notMastered" },
  subsume: { done: "common.subsumed", todo: "filters.notSubsumed" },
  adapter: { done: "nextUp.winAdapterOwned", todo: "nextUp.winAdapterTodo" },
};

export function winChip(status: ChoiceStatus): { label: MessageKey; tone: string } {
  const labels = WIN_LABEL[status.win];
  return {
    label: status.done ? labels.done : labels.todo,
    tone: status.done ? CHIP_TONE.good : CHIP_TONE.warn,
  };
}

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
  caps: TONE.good,
  ready: TONE.good,
  secondCopy: TONE.quiet,
  short: TONE.plain,
  done: TONE.plain,
};

export function valenceTone(verdict: ValenceVerdict): string {
  return VALENCE_TONE[verdict];
}
