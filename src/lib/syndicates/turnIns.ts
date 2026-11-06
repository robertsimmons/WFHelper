import { ownedComponentCount } from "../../../config/shared/componentNames.js";
import { SYNDICATE_RANKS } from "../../data/syndicateRanks.js";
import {
  SHOP_TRADES,
  SYNDICATE_TURN_INS,
  type SyndicateTurnIn,
} from "../../data/syndicateTurnIns.js";
import { remainingBuildDemand, type BuildDemand, type BuildDemandInput } from "../buildDemand.js";
import { exchangeOffers, type ExchangeVendor } from "../suggest/vendorExchange.js";
import { planSteps } from "./rankup.js";
import type { RawInventoryData } from "../../types/inventory.js";

const EXCHANGE_VENDORS: readonly ExchangeVendor[] = ["yonta", "marie"];

export type TurnInReservationKind =
  | "rank"
  | "recipe"
  | "pinned"
  | "exchange"
  | "shop"
  | "fishParts";

export interface TurnInReservation {
  kind: TurnInReservationKind;
  quantity: number;
  params: Readonly<Record<string, string | number>>;
}

export interface TurnInRow {
  itemType: string;
  name: string;
  held: number;
  safe: number;
  standingPerUnit: number;
  reservations: TurnInReservation[];
}

export interface SyndicateTurnIns {
  rows: TurnInRow[];
  safeStanding: number;
}

export interface TurnInInput extends BuildDemandInput {
  owned: Map<string, number>;
  /** uniqueName -> units the pinned mastery goals ask for. */
  pinned: ReadonlyMap<string, number>;
}

interface RankNeed {
  tag: string;
  level: number;
  count: number;
}

interface TurnInContext {
  input: TurnInInput;
  ranks: ReadonlyMap<string, RankNeed[]>;
  builds: ReadonlyMap<string, BuildDemand>;
}

function rankNeeds(inventory: RawInventoryData | null): Map<string, RankNeed[]> {
  const needs = new Map<string, RankNeed[]>();
  for (const meta of SYNDICATE_RANKS) {
    for (const step of planSteps(inventory, meta, Number.POSITIVE_INFINITY)) {
      for (const item of step.items) {
        const list = needs.get(item.itemType) ?? [];
        list.push({ tag: meta.tag, level: step.level, count: item.count });
        needs.set(item.itemType, list);
      }
    }
  }
  return needs;
}

function rankReservations(needs: readonly RankNeed[]): TurnInReservation[] {
  return needs.map((need) => ({
    kind: "rank",
    quantity: need.count,
    params: { tag: need.tag, level: need.level },
  }));
}

function recipeReservations(demand: BuildDemand | undefined): TurnInReservation[] {
  if (!demand || demand.units <= 0) return [];
  const items = demand.drivers.map((driver) => driver.name).join(", ");
  return [{ kind: "recipe", quantity: demand.units, params: { item: items } }];
}

function pinnedReservations(units: number | undefined): TurnInReservation[] {
  return units ? [{ kind: "pinned", quantity: units, params: {} }] : [];
}

function demandReservations(itemType: string, ctx: TurnInContext): TurnInReservation[] {
  return [
    ...rankReservations(ctx.ranks.get(itemType) ?? []),
    ...recipeReservations(ctx.builds.get(itemType)),
    ...pinnedReservations(ctx.input.pinned.get(itemType)),
  ];
}

/** A pin is usually an unbuilt item the recipe demand already counts, so the
 *  two compose by max; every other source is a separate use. */
function heldBack(reservations: readonly TurnInReservation[]): number {
  let recipe = 0;
  let pinned = 0;
  let separate = 0;
  for (const reservation of reservations) {
    if (reservation.kind === "recipe") recipe += reservation.quantity;
    else if (reservation.kind === "pinned") pinned = Math.max(pinned, reservation.quantity);
    else separate += reservation.quantity;
  }
  return Math.max(recipe, pinned) + separate;
}

function shortfall(itemType: string, ctx: TurnInContext): number {
  return (
    heldBack(demandReservations(itemType, ctx)) - ownedComponentCount(itemType, ctx.input.owned)
  );
}

/** Enough whole trades of `perTrade` units to cover the bought item's shortfall. */
function tradeReservation(
  bought: string,
  perTrade: number,
  price: number,
  ctx: TurnInContext,
  reservation: Omit<TurnInReservation, "quantity">,
): TurnInReservation[] {
  const short = shortfall(bought, ctx);
  if (short <= 0) return [];
  const trades = Math.ceil(short / Math.max(1, perTrade));
  return [{ ...reservation, quantity: trades * price }];
}

function exchangeReservations(itemType: string, ctx: TurnInContext): TurnInReservation[] {
  return EXCHANGE_VENDORS.flatMap((vendor) =>
    exchangeOffers(vendor).flatMap((offer) =>
      offer.prices
        .filter((price) => price.uniqueName === itemType)
        .flatMap((price) =>
          tradeReservation(offer.uniqueName, offer.quantity, price.max, ctx, {
            kind: "exchange",
            params: { vendor, item: offer.name },
          }),
        ),
    ),
  );
}

function shopReservations(itemType: string, ctx: TurnInContext): TurnInReservation[] {
  return SHOP_TRADES.flatMap((trade) =>
    trade.prices
      .filter((price) => price.itemType === itemType)
      .flatMap((price) =>
        tradeReservation(trade.itemType, trade.quantity, price.count, ctx, {
          kind: "shop",
          params: { item: trade.name },
        }),
      ),
  );
}

interface PartShort {
  name: string;
  short: number;
}

function partsOf(turnIns: readonly SyndicateTurnIn[]): Map<string, string> {
  const parts = new Map<string, string>();
  for (const turnIn of turnIns) {
    for (const part of turnIn.yields ?? []) {
      if (part.itemType) parts.set(part.itemType, part.name);
    }
  }
  return parts;
}

function partShortfalls(
  turnIns: readonly SyndicateTurnIn[],
  ctx: TurnInContext,
): Map<string, PartShort> {
  const shorts = new Map<string, PartShort>();
  for (const [itemType, name] of partsOf(turnIns)) {
    const short = shortfall(itemType, ctx);
    if (short > 0) shorts.set(itemType, { name, short });
  }
  return shorts;
}

function yieldOf(turnIn: SyndicateTurnIn, part: string): number {
  return turnIn.yields?.find((entry) => entry.itemType === part)?.count ?? 0;
}

/** Fish to keep uncut so their parts cover each shortfall, largest yield first.
 *  A kept fish's other parts count against their own shortfalls too. */
function fishKeeps(
  turnIns: readonly SyndicateTurnIn[],
  shorts: ReadonlyMap<string, PartShort>,
  owned: Map<string, number>,
): Map<string, TurnInReservation[]> {
  const remaining = new Map([...shorts].map(([part, entry]) => [part, entry.short]));
  const kept = new Map<string, number>();
  const keeps = new Map<string, TurnInReservation[]>();
  for (const [part, { name }] of shorts) {
    const sources = turnIns
      .filter((turnIn) => turnIn.itemType && yieldOf(turnIn, part) > 0)
      .sort((a, b) => yieldOf(b, part) - yieldOf(a, part));
    for (const fish of sources) {
      const left = remaining.get(part) ?? 0;
      if (left <= 0) break;
      const fishType = fish.itemType ?? "";
      const free = ownedComponentCount(fishType, owned) - (kept.get(fishType) ?? 0);
      const count = Math.min(free, Math.ceil(left / yieldOf(fish, part)));
      if (count <= 0) continue;
      kept.set(fishType, (kept.get(fishType) ?? 0) + count);
      for (const entry of fish.yields ?? []) {
        if (entry.itemType && remaining.has(entry.itemType))
          remaining.set(entry.itemType, (remaining.get(entry.itemType) ?? 0) - count * entry.count);
      }
      const list = keeps.get(fishType) ?? [];
      list.push({ kind: "fishParts", quantity: count, params: { part: name } });
      keeps.set(fishType, list);
    }
  }
  return keeps;
}

function turnInRow(
  turnIn: SyndicateTurnIn,
  itemType: string,
  ctx: TurnInContext,
  fish: ReadonlyMap<string, TurnInReservation[]>,
): TurnInRow {
  const held = ownedComponentCount(itemType, ctx.input.owned);
  const reservations = [
    ...demandReservations(itemType, ctx),
    ...exchangeReservations(itemType, ctx),
    ...shopReservations(itemType, ctx),
    ...(fish.get(itemType) ?? []),
  ];
  return {
    itemType,
    name: turnIn.name,
    held,
    safe: Math.max(0, held - heldBack(reservations)),
    standingPerUnit: turnIn.standing,
    reservations,
  };
}

function syndicateTurnIns(
  turnIns: readonly SyndicateTurnIn[],
  ctx: TurnInContext,
): SyndicateTurnIns {
  const fish = fishKeeps(turnIns, partShortfalls(turnIns, ctx), ctx.input.owned);
  const rows = turnIns.flatMap((turnIn) =>
    turnIn.itemType ? [turnInRow(turnIn, turnIn.itemType, ctx, fish)] : [],
  );
  const held = rows.filter((row) => row.held > 0);
  return {
    rows: held,
    safeStanding: held.reduce((sum, row) => sum + row.safe * row.standingPerUnit, 0),
  };
}

/** Syndicate tag -> what can be handed in without costing anything still owed. */
export function turnInsBySyndicate(input: TurnInInput): Map<string, SyndicateTurnIns> {
  const ctx: TurnInContext = {
    input,
    ranks: rankNeeds(input.inventory),
    builds: remainingBuildDemand(input),
  };
  const result = new Map<string, SyndicateTurnIns>();
  for (const [tag, { turnIns }] of Object.entries(SYNDICATE_TURN_INS)) {
    const entry = syndicateTurnIns(turnIns, ctx);
    if (entry.rows.length > 0) result.set(tag, entry);
  }
  return result;
}
