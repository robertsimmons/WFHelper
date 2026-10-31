import { COSMETIC, type AuthoredShop, type ShopWare } from "./schema.js";

interface ShopUnit {
  /** Stable within the shop; what a stored pick names. */
  id: string;
  ware: string;
  item: string;
  price: Readonly<Record<string, number>>;
  /** Any one listed currency pays; otherwise every listed one is charged. */
  either: boolean;
  owned: boolean;
  /** Not owned yet, but a quest the plan still walks hands it over. */
  quest: boolean;
  picked: boolean;
}

interface ShopItemGroup {
  item: string;
  units: ShopUnit[];
}

export interface ShopTotal {
  /** Null for the pool any listed currency of an `either` ware pays, whose
   *  balance is what the currencies have spare after their own needs. */
  currency: string | null;
  /** Null when nothing the app reads holds the balance. */
  balance: number | null;
  need: number;
  /** Null while the balance is unreadable and something here needs it. */
  short: number | null;
}

/** One line per shop currency, then the either pool when anything draws on it. */
interface ShopSum {
  /** The picked units summed. */
  picks: number;
  totals: ShopTotal[];
  short: number | null;
  /** Runs to clear the shortfall; null when the data has no per-run yield. */
  runs: number | null;
  covered: boolean | null;
}

export interface ResolvedShop {
  key: string;
  vendor: string;
  place: string;
  notes: string[];
  /** Items first in shop order, cosmetics last. */
  groups: ShopItemGroup[];
  /** Every pick, for the shared picker. */
  all: ShopSum;
  /** The picks priced in a currency the plan's own unbought wares cost, plus
   *  what its recipe consumes of each currency. */
  own: ShopSum;
  /** The plan's own wares still to buy. */
  ownWares: number;
  /** The other plans that buy here. */
  also: string[];
}

export interface ShopPickInput {
  key: string;
  shop: AuthoredShop;
  /** A ware the recipe of the plan the shop is resolved for consumes. */
  own: (ware: ShopWare) => boolean;
  /** What the plan's recipe consumes of a currency. */
  crafting: (currency: string) => number;
  /** Units of a non-cosmetic ware the shop's items want in all. */
  wanted: (ware: ShopWare) => number;
  /** Units the player already holds, and units a pending quest gives. */
  held: (ware: ShopWare) => { owned: number; quest: number };
  balance: (currency: string) => number | null;
  /** Unit ids flipped away from their default pick. */
  flipped: readonly string[];
  also: readonly string[];
}

function wareUnits(input: ShopPickInput, ware: ShopWare, flipped: ReadonlySet<string>): ShopUnit[] {
  const cosmetic = ware.item === COSMETIC;
  const count = cosmetic ? 1 : input.wanted(ware);
  const held = cosmetic ? { owned: 0, quest: 0 } : input.held(ware);
  const either = input.shop.either === true && Object.keys(ware.price).length > 1 && !ware.all;
  return Array.from({ length: count }, (_, index) => {
    const id = count > 1 ? `${ware.name} #${index + 1}` : ware.name;
    const owned = index < held.owned;
    const quest = !owned && index < held.owned + held.quest;
    return {
      id,
      ware: ware.name,
      item: ware.item,
      price: ware.price,
      either,
      owned,
      quest,
      picked: !owned && !quest && !cosmetic !== flipped.has(id),
    };
  });
}

function groupsOf(units: readonly ShopUnit[]): ShopItemGroup[] {
  const byItem = new Map<string, ShopUnit[]>();
  for (const unit of units) byItem.set(unit.item, [...(byItem.get(unit.item) ?? []), unit]);
  const groups = [...byItem].map(([item, list]) => ({ item, units: list }));
  return [
    ...groups.filter((group) => group.item !== COSMETIC),
    ...groups.filter((group) => group.item === COSMETIC),
  ];
}

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

function runsFor(shop: AuthoredShop, totals: readonly ShopTotal[], short: number | null) {
  if (short === null) return null;
  if (short === 0) return 0;
  const yields = shop.currencies.map((currency) => currency.perRun ?? null);
  if (shop.either) {
    if (yields.some((value) => value === null)) return null;
    return Math.ceil(short / Math.min(...(yields as number[])));
  }
  const runs = shop.currencies.map((_, index) => {
    const owed = totals[index].short;
    if (!owed) return 0;
    const perRun = yields[index];
    return perRun === null ? null : Math.ceil(owed / perRun);
  });
  if (runs.some((value) => value === null)) return null;
  return shop.together ? Math.max(...(runs as number[])) : sum(runs as number[]);
}

function total(currency: string | null, balance: number | null, need: number): ShopTotal {
  return {
    currency,
    balance,
    need,
    short: balance === null ? (need > 0 ? null : 0) : Math.max(0, need - balance),
  };
}

const spare = (line: ShopTotal): number | null =>
  line.balance === null ? null : Math.max(0, line.balance - line.need);

/** Each currency's fixed cost, then what either currency pays from whatever
 *  the currencies have spare. The shorts add up to what no balance covers. */
function sumOf(
  input: ShopPickInput,
  units: readonly ShopUnit[],
  extra: (currency: string) => number,
): ShopSum {
  const { shop } = input;
  const fixed = new Map(shop.currencies.map(({ name }) => [name, extra(name)]));
  let pool = 0;
  for (const unit of units) {
    const prices = Object.entries(unit.price);
    if (unit.either) {
      pool += Math.min(...prices.map(([, amount]) => amount));
      continue;
    }
    for (const [currency, amount] of prices) {
      fixed.set(currency, (fixed.get(currency) ?? 0) + amount);
    }
  }
  const totals = shop.currencies.map(({ name }) =>
    total(name, input.balance(name), fixed.get(name) ?? 0),
  );
  if (pool > 0) {
    const spares = totals.map(spare);
    const free = spares.includes(null) ? null : sum(spares as number[]);
    totals.push(total(null, free, pool));
  }
  const shorts = totals.map((line) => line.short);
  const short = shorts.includes(null) ? null : sum(shorts as number[]);
  return {
    picks: units.length,
    totals,
    short,
    runs: runsFor(shop, totals, short),
    covered: short === null ? null : short === 0,
  };
}

/** What a farm banking one currency must reach: its own need, plus whatever of
 *  the either pool the other currencies' spare balance leaves. */
export function farmNeed(totals: readonly ShopTotal[], currency: string): number {
  const own = totals.find((line) => line.currency === currency);
  const pool = totals.find((line) => line.currency === null);
  if (!own) return 0;
  if (!pool) return own.need;
  const others = (pool.balance ?? 0) - (spare(own) ?? 0);
  return own.need + Math.max(0, pool.need - others);
}

const toBuy = (unit: ShopUnit): boolean => !unit.owned && !unit.quest;

/** One unit per row. A unit the player lacks starts picked, an owned one never
 *  is, and a cosmetic starts unpicked. The plan's own sum counts a pick only
 *  when it is priced in a currency one of the plan's own unbought wares costs. */
export function pickShop(input: ShopPickInput): ResolvedShop {
  const { shop } = input;
  const flipped = new Set(input.flipped);
  const mine = new Set(shop.wares.filter(input.own).map((ware) => ware.name));
  const units = shop.wares.flatMap((ware) => wareUnits(input, ware, flipped));
  const picked = units.filter((unit) => unit.picked);
  const own = units.filter((unit) => mine.has(unit.ware) && toBuy(unit));
  const scope = new Set(own.flatMap((unit) => Object.keys(unit.price)));
  const counted = picked.filter((unit) => Object.keys(unit.price).some((name) => scope.has(name)));
  return {
    key: input.key,
    vendor: shop.vendor,
    place: shop.place,
    notes: shop.notes ?? [],
    groups: groupsOf(units),
    all: sumOf(input, picked, () => 0),
    own: sumOf(input, counted, input.crafting),
    ownWares: own.length,
    also: [...input.also],
  };
}
