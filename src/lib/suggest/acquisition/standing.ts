import { nameKey } from "./curated.js";
import { rankMet } from "./plan/ranks.js";
import { parseQuantity, readPlayerState, standingBalance, type PlayerState } from "./plan/state.js";
import type { PlanCurrency, PlanGroup, PlanRank, PlanRow } from "./plan/schema.js";
import type { PartState } from "./types.js";
import type { RawInventoryData } from "../../../types/inventory.js";

/** A path effort for earning each standing. How much a route costs never counts,
 *  only which standing pays for it. */
const STANDING_TEDIUM: Record<string, number> = {
  ventkids: 0.5,
  "cephalon simaris": 0.35,
  simaris: 0.35,
};
const BASELINE_TEDIUM = 0.2;
/** Standing already banked settles a tie, never more. */
const BANKED_NUDGE = 0.01;

const STANDING = / standing$/i;
const LEADING_THE = /^the\s+/i;
const BLUEPRINT = / blueprint$/i;

export function standingTedium(currency: string): number {
  const key = currency.replace(STANDING, "").replace(LEADING_THE, "").trim().toLowerCase();
  return STANDING_TEDIUM[key] ?? BASELINE_TEDIUM;
}

interface StandingBuy {
  label: string;
  price: PlanCurrency[];
  rank: PlanRank | null;
  count: number;
}

function standingBuy(row: PlanRow): StandingBuy {
  const price = (row.buy?.price ?? row.pick?.spends ?? []).filter((entry) =>
    STANDING.test(entry.currency),
  );
  return {
    label: row.label,
    price,
    rank: row.buy?.rank ?? row.pick?.rank ?? null,
    count: row.buy?.each ? parseQuantity(row.qty) : 1,
  };
}

/** A row that reaches a rank is the grind toward a purchase, not a purchase. */
function standingBuys(groups: readonly PlanGroup[]): StandingBuy[] {
  return groups
    .flatMap((group) => group.rows)
    .filter((row) => !row.rank)
    .map(standingBuy)
    .filter((buy) => buy.price.length > 0);
}

function partKey(name: string): string {
  return nameKey(name.replace(BLUEPRINT, ""));
}

/** Plans spell a part "Barrel Blueprint" as often as "Cortege Barrel Blueprint". */
function buysPart(buy: StandingBuy, part: PartState, itemName: string): boolean {
  const key = partKey(part.name);
  return partKey(buy.label) === key || partKey(`${itemName} ${buy.label}`) === key;
}

const STATES = new WeakMap<RawInventoryData, PlayerState>();

function playerState(inventory: RawInventoryData): PlayerState {
  let state = STATES.get(inventory);
  if (!state) {
    state = readPlayerState(inventory, {});
    STATES.set(inventory, state);
  }
  return state;
}

/** True only when the inventory shows every rank and every standing the buys ask for. */
function banked(buys: readonly StandingBuy[], inventory: RawInventoryData | null): boolean {
  if (!inventory) return false;
  if (!buys.every((buy) => !buy.rank || rankMet(inventory, buy.rank) === true)) return false;
  const owed = new Map<string, number>();
  for (const buy of buys) {
    for (const { currency, amount } of buy.price) {
      owed.set(currency, (owed.get(currency) ?? 0) + parseQuantity(amount) * buy.count);
    }
  }
  const state = playerState(inventory);
  return [...owed].every(
    ([currency, amount]) => (standingBalance(state, currency) ?? -1) >= amount,
  );
}

export interface StandingNeed {
  /** The missing parts the plan buys with standing. */
  covers: ReadonlySet<string>;
  /** The most tedious standing still to spend, less the nudge once it is all banked. */
  effort: number;
}

/** Null when nothing the route still needs is bought with standing. An item whose
 *  parts the app cannot list still has every purchase in the plan ahead of it. */
export function standingNeed(
  groups: readonly PlanGroup[],
  itemName: string,
  missing: readonly PartState[],
  partsKnown: boolean,
  inventory: RawInventoryData | null,
): StandingNeed | null {
  const buys = standingBuys(groups);
  const bought = missing.filter((part) => buys.some((buy) => buysPart(buy, part, itemName)));
  const needed = partsKnown
    ? buys.filter((buy) => missing.some((part) => buysPart(buy, part, itemName)))
    : buys;
  if (needed.length === 0) return null;
  const tedium = Math.max(
    ...needed.flatMap((buy) => buy.price).map((entry) => standingTedium(entry.currency)),
  );
  return {
    covers: new Set(bought.map((part) => part.name)),
    effort: tedium - (banked(needed, inventory) ? BANKED_NUDGE : 0),
  };
}
