import {
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

/** Everything the needs pull in, recipes expanded. A craft makes `yield` units, so
 *  a part is needed once per whole craft of every parent, summed over all asks for
 *  that parent before rounding up. */
function totalNeeds(needs: readonly MaterialNeed[], lookup: ResourceLookup): Map<string, Total> {
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
      const crafts = Math.ceil(demand(parent) / (totals.get(parent)?.entry?.yield ?? 1));
      qty += crafts * perCraft;
    }
    pending.delete(key);
    resolved.set(key, qty);
    return qty;
  };
  for (const [key, total] of totals) total.qty = demand(key);
  return totals;
}

function sourceText(source: ResourceSource): string {
  const price = (source.buy?.price ?? []).map((spend) => `${spend.amount} ${spend.currency}`);
  const detail = [source.sub, source.activity, ...price].filter(
    (part): part is string => part !== null,
  );
  return detail.length > 0 ? `${source.place} (${detail.join(", ")})` : source.place;
}

/** What a material's best source charges, as the row carries it: a crafted
 *  material's price buys its blueprint, anything else's buys one unit. */
function rowPurchase(entry: ResourceEntry | null): PlanPurchase | null {
  const buy = entry?.best?.buy;
  if (!buy) return null;
  const blueprint = entry?.kind === "craft";
  return {
    price: buy.price,
    ...(buy.rank ? { rank: buy.rank } : {}),
    ...(buy.reusable ? { reusable: true } : {}),
    ...(blueprint ? { blueprint: true } : { each: true }),
  };
}

/** A group's spends: each row's price, once for a blueprint and per unit otherwise. */
function purchaseSpends(rows: readonly PlanRow[]): PlanCurrency[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const times = row.buy?.each ? parseQuantity(row.qty) : 1;
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

function otherSpots(members: readonly Total[]): string | null {
  const listed = members.filter((member) => (member.entry?.alternates.length ?? 0) > 0);
  if (listed.length === 0) return null;
  const spots = (member: Total): string =>
    (member.entry?.alternates ?? []).map(sourceText).join("; ");
  if (members.length === 1) return spots(listed[0]);
  return listed.map((member) => `${member.label}: ${spots(member)}`).join(". ");
}

/** Materials group under the mission the resource store names, so the same
 *  resource reads the same way in every plan that needs it. Everything one vendor
 *  sells is one step, whatever each purchase is for. A crafted resource adds its
 *  recipe to the farm and is built where the store says. */
export function materialGroups(
  needs: readonly MaterialNeed[],
  lookup: ResourceLookup = resourceEntry,
  /** True when the plan already buys this material's source by hand, so it is not bought twice. */
  bought: (label: string, source: ResourceSource) => boolean = () => false,
): PlanGroup[] {
  const totals = totalNeeds(needs, lookup);

  const buckets = new Map<string, Bucket>();
  for (const total of totals.values()) {
    const { entry } = total;
    const best = entry?.best ?? null;
    const craft = entry?.kind === "craft";
    const place = best?.place ?? (craft ? "FOUNDRY" : "MATERIALS");
    const buy = best && bought(total.label, best) ? null : rowPurchase(entry);
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
      done: false,
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
    const spots = otherSpots(members);
    if (spots) group.disclosures.push({ title: "Other spots", body: spots });
    return group;
  });
  return [
    ...groups.filter((group) => group.type !== "craft"),
    ...groups.filter((group) => group.type === "craft"),
  ];
}
