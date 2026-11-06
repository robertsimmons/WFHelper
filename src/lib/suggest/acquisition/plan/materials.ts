import {
  isCredits,
  resourceEntry,
  type ResourceEntry,
  type ResourceLookup,
  type ResourceSource,
} from "./resources.js";
import type { PlanCurrency, PlanGroup, PlanGroupType, PlanPurchase, PlanRow } from "./schema.js";
import { formatQuantity, parseQuantity } from "./state.js";

interface MaterialNeed {
  label: string;
  qty: number;
  note: string | null;
}

interface Total extends MaterialNeed {
  entry: ResourceEntry | null;
}

interface Bucket {
  group: PlanGroup;
  members: Total[];
}

interface Use {
  parent: string;
  perCraft: number;
}

export function planGroup(
  type: PlanGroupType,
  place: string,
  rows: PlanRow[],
  extra: Partial<PlanGroup> = {},
): PlanGroup {
  return {
    type,
    place,
    sub: null,
    activity: null,
    meta: null,
    mode: null,
    live: null,
    skip: null,
    earns: null,
    spends: [],
    map: null,
    rows,
    conditions: [],
    bonuses: [],
    disclosures: [],
    ...extra,
  };
}

const keyOf = (label: string): string => label.trim().toLowerCase();

/** What the player holds of a material; 0 where nothing answers. */
type Owned = (label: string) => number;

/** Everything the needs pull in, recipes expanded. A craft makes `yield` units, so
 *  a part is needed once per whole craft of every parent still short, after what
 *  the player holds of that parent, summed over all asks before rounding up. */
function totalNeeds(
  needs: readonly MaterialNeed[],
  lookup: ResourceLookup,
  owned: Owned,
): Map<string, Total> {
  const totals = new Map<string, Total>();
  const direct = new Map<string, number>();
  const uses = new Map<string, Use[]>();
  const expanded = new Set<string>();
  // An alias and its target are one resource, so they share a key.
  const keyFor = (label: string): string => keyOf(lookup(label)?.name ?? label);

  const visit = (label: string, note: string | null): void => {
    const key = keyFor(label);
    let total = totals.get(key);
    if (!total) {
      total = { label, qty: 0, note, entry: lookup(label) };
      totals.set(key, total);
    }
    total.note ??= note;
    if (total.entry?.kind !== "craft" || expanded.has(key)) return;
    expanded.add(key);
    for (const part of total.entry.recipe) {
      const partKey = keyFor(part.label);
      uses.set(partKey, [...(uses.get(partKey) ?? []), { parent: key, perCraft: part.qty }]);
      visit(part.label, null);
    }
  };
  for (const need of needs) {
    const key = keyFor(need.label);
    direct.set(key, (direct.get(key) ?? 0) + need.qty);
    visit(need.label, need.note);
  }

  const resolved = new Map<string, number>();
  const pending = new Set<string>();
  const demand = (key: string): number => {
    const known = resolved.get(key);
    if (known !== undefined) return known;
    pending.add(key);
    let qty = direct.get(key) ?? 0;
    for (const { parent, perCraft } of uses.get(key) ?? []) {
      if (pending.has(parent)) continue;
      const total = totals.get(parent);
      const short = Math.max(0, demand(parent) - owned(total?.label ?? parent));
      const crafts = Math.ceil(short / (total?.entry?.yield ?? 1));
      qty += crafts * perCraft;
    }
    pending.delete(key);
    resolved.set(key, qty);
    return qty;
  };
  for (const [key, total] of totals) total.qty = demand(key);
  return totals;
}

/** How many crafts deep a material sits: a raw one is 0, a craft one more than its deepest part. */
function craftDepth(
  entry: ResourceEntry | null,
  lookup: ResourceLookup,
  seen = new Set<string>(),
): number {
  if (entry?.kind !== "craft" || seen.has(entry.name)) return 0;
  seen.add(entry.name);
  const parts = entry.recipe.map((part) => craftDepth(lookup(part.label), lookup, seen));
  seen.delete(entry.name);
  return 1 + Math.max(0, ...parts);
}

/** A crafted material made from a single input refines it; any other is built. */
export function craftVerb(entry: ResourceEntry): "refine" | "build" {
  return entry.recipe.length === 1 ? "refine" : "build";
}

export function sourceText(source: ResourceSource): string {
  const price = (source.buy?.price ?? []).map((spend) => `${spend.amount} ${spend.currency}`);
  const detail = [source.sub, source.activity, ...price].filter(
    (part): part is string => part !== null,
  );
  return detail.length > 0 ? `${source.place} (${detail.join(", ")})` : source.place;
}

/** The crafts a still-short crafted material takes. */
export function craftsShort(short: number, entry: ResourceEntry): number {
  return Math.ceil(Math.max(0, short) / entry.yield);
}

/** What a material's best source charges, as the row carries it: a crafted
 *  material's price buys its blueprint, one a craft unless it is reusable, and
 *  anything else's buys one unit, or the one tool reused for good. */
function rowPurchase(entry: ResourceEntry | null, short: number): PlanPurchase | null {
  const buy = entry?.best?.buy;
  if (!buy) return null;
  if (entry?.kind !== "craft") {
    return {
      price: buy.price,
      ...(buy.rank ? { rank: buy.rank } : {}),
      ...(buy.reusable ? { reusable: true } : { each: true }),
    };
  }
  return {
    price: buy.price,
    ...(buy.rank ? { rank: buy.rank } : {}),
    blueprint: true,
    ...(buy.reusable ? { reusable: true } : { count: craftsShort(short, entry) }),
  };
}

/** How many times a row's purchase is made: per unit when priced each, else its count. */
export function purchaseCount(row: PlanRow): number {
  if (!row.buy) return 0;
  return row.buy.each ? parseQuantity(row.qty) : (row.buy.count ?? 1);
}

/** A group's spends: each row's price, as many times as it is bought. */
function purchaseSpends(rows: readonly PlanRow[]): PlanCurrency[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const times = purchaseCount(row);
    for (const spend of row.buy?.price ?? []) {
      totals.set(
        spend.currency,
        (totals.get(spend.currency) ?? 0) + parseQuantity(spend.amount) * times,
      );
    }
  }
  return [...totals].map(([currency, value]) => ({ currency, amount: formatQuantity(value) }));
}

function shared(values: readonly (string | null)[]): string | null {
  return values.every((value) => value === values[0]) ? (values[0] ?? null) : null;
}

/** Materials group under the mission the resource store names, so the same
 *  resource reads the same way in every plan that needs it. Everything one vendor
 *  sells is one step, whatever each purchase is for. A crafted resource adds its
 *  recipe to the farm and is built where the store says. */
export function materialGroups(
  needs: readonly MaterialNeed[],
  lookup: ResourceLookup = resourceEntry,
  /** True when the plan already buys this material's blueprint by hand, so it is not bought twice. */
  bought: (label: string, source: ResourceSource, blueprint: boolean) => boolean = () => false,
  /** What the player already holds of a material, which a craft of it no longer needs parts for. */
  owned: Owned = () => 0,
): PlanGroup[] {
  const totals = totalNeeds(needs, lookup, owned);

  const buckets = new Map<string, Bucket>();
  // A craft reads after the crafts its recipe holds, so the foundry steps run in order.
  const ordered = [...totals.values()].sort(
    (left, right) => craftDepth(left.entry, lookup) - craftDepth(right.entry, lookup),
  );
  for (const total of ordered) {
    const { entry } = total;
    const best = entry?.best ?? null;
    const craft = entry?.kind === "craft";
    const place = best?.place ?? (craft ? "FOUNDRY" : "MATERIALS");
    const short = total.qty - owned(total.label);
    const buy = best && bought(total.label, best, craft) ? null : rowPurchase(entry, short);
    const key = buy
      ? `buy|${place}|${best?.sub ?? ""}`
      : `${craft ? "craft" : "farm"}|${place}|${best?.sub ?? ""}|${best?.activity ?? ""}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        members: [],
        group: planGroup(craft ? "craft" : "farm", place, [], {
          sub: best?.sub ?? null,
          map: entry?.harvestable ? entry.map : null,
        }),
      };
      buckets.set(key, bucket);
    }
    bucket.members.push(total);
    bucket.group.rows.push({
      qty: total.qty.toLocaleString("en-US"),
      label: total.label,
      note: total.note,
      alt: null,
      // Nothing left to make of it is nothing left to do.
      done: total.qty === 0,
      ...(buy ? { buy } : {}),
    });
  }

  const groups = [...buckets.values()].map(({ group, members }) => {
    const sources = members.map((member) => member.entry?.best ?? null);
    if (members.some((member) => member.entry?.kind === "craft")) group.type = "craft";
    group.activity = shared(sources.map((source) => source?.activity ?? null));
    group.meta = shared(sources.map((source) => source?.meta ?? null));
    // A meta the members do not share is each one's own, so it moves to the row.
    if (group.meta === null) {
      group.rows.forEach((row, index) => {
        const own = sources[index]?.meta ?? null;
        if (own) row.note = row.note ? `${row.note}; ${own}` : own;
      });
    }
    if (group.rows.some((row) => row.buy)) group.spends = purchaseSpends(group.rows);
    group.bonuses = [...new Set(members.flatMap((member) => member.entry?.tips ?? []))];
    return group;
  });
  return [
    ...groups.filter((group) => group.type !== "craft"),
    ...groups.filter((group) => group.type === "craft"),
  ];
}

/** Per-row shares of a group's spend, but only when the rows' prices add up to the
 *  group total exactly. A decomposition that does not check out is not used, so
 *  the ledger never invents a split. A pick row's price is outside the total. */
export function rowShares(
  group: PlanGroup,
  currency: string,
  total: number,
  ledgerName: (currency: string) => string,
): number[] | null {
  const shares: number[] = [];
  for (const row of group.rows) {
    if (row.pick) {
      shares.push(0);
      continue;
    }
    if (!row.buy) return null;
    const times = purchaseCount(row);
    const price = row.buy.price.find(
      (spend) => ledgerName(spend.currency) === ledgerName(currency),
    );
    shares.push(price ? parseQuantity(price.amount) * times : 0);
  }
  const sum = shares.reduce((carry, value) => carry + value, 0);
  return sum === total ? shares : null;
}

/** How many times a price is paid over `copies` builds. An authored price is one
 *  build's; a reusable purchase is made once, and a material row is already sized
 *  for every copy. */
export function timesPaid(reusable: boolean, material: boolean, copies: number): number {
  return reusable || material ? 1 : copies;
}

const PLATINUM = /^platinum$/i;

/** A currency the groups spend that nothing in the plan earns or lists, as a need
 *  of the whole spend over every copy, so it farms like any material. Only a
 *  currency the store names has a source to farm it from. */
export function unearnedNeeds(
  authored: readonly PlanGroup[],
  materials: readonly PlanGroup[],
  needs: readonly MaterialNeed[],
  copies: number,
  lookup: ResourceLookup = resourceEntry,
): MaterialNeed[] {
  const name = (label: string): string => lookup(label)?.name ?? label;
  const earned = new Set(needs.map((need) => name(need.label)));
  const spent = new Map<string, number>();
  const tally = (group: PlanGroup, material: boolean): void => {
    if (group.skip !== null) return;
    if (group.earns) earned.add(name(group.earns.currency));
    if (group.ref) earned.add(name(group.ref));
    for (const spend of group.spends) {
      const currency = name(spend.currency);
      const total = parseQuantity(spend.amount);
      const shares = rowShares(group, spend.currency, total, name);
      const paid = (index: number): number =>
        timesPaid(group.rows[index].buy?.reusable === true, material, copies);
      const value = shares
        ? shares.reduce((sum, share, index) => sum + share * paid(index), 0)
        : total * timesPaid(false, material, copies);
      spent.set(currency, (spent.get(currency) ?? 0) + value);
    }
  };
  for (const group of authored) tally(group, false);
  for (const group of materials) tally(group, true);
  return [...spent]
    .filter(([currency]) => !earned.has(currency) && !PLATINUM.test(currency))
    .filter(([currency]) => !isCredits(currency, lookup))
    .filter(([currency]) => lookup(currency) !== null)
    .map(([label, qty]) => ({ label, qty, note: null }));
}
