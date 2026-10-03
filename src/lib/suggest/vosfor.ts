import { arcaneCopies, arcaneMaxCopies, POPULAR_ARCANES } from "./arcanes.js";
import { shippedModule, upgradePlatinum, type Holdings, type PopularUpgrade } from "./upgrades.js";
import type { ItemDbEntry, RawInventoryData } from "../../types/inventory.js";

export const VOSFOR_PATH = "/Lotus/Types/Items/MiscItems/DistillPoints";
export const VOSFOR_WIKI = "https://wiki.warframe.com/w/Vosfor";
const PACK_COST = 200;

interface VosforPool {
  rarity: string;
  chance: number;
  arcanes: string[];
}

export interface VosforCollection {
  name: string;
  vosfor: number;
  credits: number;
  arcanesPerPack: number;
  pools: VosforPool[];
}

interface VosforData {
  collections: VosforCollection[];
  /** Vosfor one copy dissolves into, by English arcane name. */
  yields: Record<string, number>;
}

export type PackGoal = "arcanes" | "platinum";

interface PackRow {
  name: string;
  /** Odds of at least one copy in a pack, 0..1. */
  chance: number;
  /** Null while no inventory is read. */
  held: number | null;
  max: number;
  platinum: number | null;
  /** This arcane's share of the pack's score; 0 when it adds nothing. */
  contribution: number;
}

export interface PackRank {
  collection: string;
  /** Weighted needed copies per pack, or average platinum per pack. */
  score: number;
  /** The arcane adding most to the score; null when the score is 0. */
  top: PackRow | null;
  /** Every arcane in the collection, biggest contribution first. */
  rows: PackRow[];
}

export interface DissolveRow {
  name: string;
  spare: number;
  yield: number;
  platinum: number | null;
}

interface DissolvePlan {
  rows: DissolveRow[];
  spare: number;
  total: number;
}

function parsePool(raw: unknown): VosforPool | null {
  if (!raw || typeof raw !== "object") return null;
  const { rarity, chance, arcanes } = raw as Record<string, unknown>;
  if (typeof chance !== "number" || !Array.isArray(arcanes)) return null;
  return {
    rarity: typeof rarity === "string" ? rarity : "",
    chance,
    arcanes: arcanes.filter((name): name is string => typeof name === "string"),
  };
}

function parseCollection(raw: unknown): VosforCollection | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row["name"] !== "string" || !Array.isArray(row["pools"])) return null;
  const num = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return {
    name: row["name"],
    vosfor: num(row["vosfor"], PACK_COST),
    credits: num(row["credits"], 0),
    arcanesPerPack: num(row["arcanesPerPack"], 3),
    pools: row["pools"].map(parsePool).filter((pool): pool is VosforPool => pool !== null),
  };
}

function parseVosforData(raw: unknown): VosforData {
  if (!raw || typeof raw !== "object") return { collections: [], yields: {} };
  const { collections, yields } = raw as Record<string, unknown>;
  const parsedYields: Record<string, number> = {};
  if (yields && typeof yields === "object") {
    for (const [name, amount] of Object.entries(yields)) {
      if (typeof amount === "number" && amount > 0) parsedYields[name] = amount;
    }
  }
  return {
    collections: Array.isArray(collections)
      ? collections
          .map(parseCollection)
          .filter((entry): entry is VosforCollection => entry !== null)
      : [],
    yields: parsedYields,
  };
}

const loaded = import.meta.glob("../../data/suggest/vosfor.json", { eager: true });

export const VOSFOR_DATA: VosforData = parseVosforData(shippedModule(loaded));

/** Null while no inventory is read; a read one without the row holds none. */
export function miscItemCount(inventory: RawInventoryData | null, path: string): number | null {
  if (!inventory) return null;
  const rows = (inventory as Record<string, unknown>)["MiscItems"];
  if (!Array.isArray(rows)) return 0;
  let total = 0;
  for (const row of rows as Array<{ ItemType?: string; ItemCount?: unknown }>) {
    if (row?.ItemType === path && typeof row.ItemCount === "number") total += row.ItemCount;
  }
  return total;
}

export function vosforBalance(inventory: RawInventoryData | null): number | null {
  return miscItemCount(inventory, VOSFOR_PATH);
}

export function packs(balance: number | null): number {
  return balance === null ? 0 : Math.max(0, Math.floor(balance / PACK_COST));
}

/** Per-slot odds of each arcane, keyed by lowercased name; slots roll alone. */
function slotChances(collection: VosforCollection): Map<string, { name: string; p: number }> {
  const out = new Map<string, { name: string; p: number }>();
  for (const pool of collection.pools) {
    if (pool.arcanes.length === 0) continue;
    const p = pool.chance / pool.arcanes.length;
    for (const name of pool.arcanes) {
      const key = name.toLowerCase();
      const held = out.get(key);
      out.set(key, { name: held?.name ?? name, p: (held?.p ?? 0) + p });
    }
  }
  return out;
}

export function packChance(p: number, slots: number): number {
  return 1 - (1 - p) ** slots;
}

type MaxCopies = (name: string) => number;
type PriceOf = (name: string) => number | null;

type Scorer = (key: string, p: number, n: number, row: PackRow) => number;

function rankBy(
  collections: readonly VosforCollection[],
  holdings: Holdings,
  maxOf: MaxCopies,
  priceOf: PriceOf,
  score: Scorer,
  order: (a: PackRow, b: PackRow) => number,
): PackRank[] {
  const ranks = collections.map((collection): PackRank => {
    const n = collection.arcanesPerPack;
    const rows: PackRow[] = [];
    let total = 0;
    for (const [key, { name, p }] of slotChances(collection)) {
      const base: PackRow = {
        name,
        chance: packChance(p, n),
        held: holdings ? (holdings.get(key) ?? 0) : null,
        max: maxOf(name),
        platinum: priceOf(name),
        contribution: 0,
      };
      base.contribution = score(key, p, n, base);
      total += base.contribution;
      rows.push(base);
    }
    rows.sort((a, b) => order(a, b) || a.name.localeCompare(b.name));
    const top = total > 0 ? (rows[0] ?? null) : null;
    return { collection: collection.name, score: total, top, rows };
  });
  return ranks.sort((a, b) => b.score - a.score || a.collection.localeCompare(b.collection));
}

/** Every pack, ranked by how much its rolls land on popular arcanes not yet at
 *  max copies. Null while no inventory is read. */
export function rankForArcanes(
  collections: readonly VosforCollection[],
  popular: readonly PopularUpgrade[],
  holdings: Holdings,
  maxOf: MaxCopies,
  priceOf: PriceOf,
): PackRank[] | null {
  if (!holdings) return null;
  const popularity = new Map(popular.map((entry) => [entry.name.toLowerCase(), entry.count]));
  return rankBy(
    collections,
    holdings,
    maxOf,
    priceOf,
    (key, p, n, row) => {
      const count = popularity.get(key);
      if (count === undefined || (row.held ?? 0) >= row.max) return 0;
      return n * p * count;
    },
    (a, b) => b.contribution - a.contribution,
  );
}

/** Every pack, ranked by average platinum; an unpriced arcane is worth nothing. */
export function rankForPlatinum(
  collections: readonly VosforCollection[],
  holdings: Holdings,
  maxOf: MaxCopies,
  priceOf: PriceOf,
): PackRank[] {
  return rankBy(
    collections,
    holdings,
    maxOf,
    priceOf,
    (_key, p, n, row) => n * p * (row.platinum ?? 0),
    (a, b) =>
      Number(a.platinum === null) - Number(b.platinum === null) || b.contribution - a.contribution,
  );
}

/** Spare copies worth dissolving, cheapest to sell first. With `keepMax`, a
 *  full rank's worth of each stays behind. */
export function dissolvePlan(
  holdings: Holdings,
  yields: Readonly<Record<string, number>>,
  maxOf: MaxCopies,
  priceOf: PriceOf,
  keepMax: boolean,
): DissolvePlan | null {
  if (!holdings) return null;
  const rows: DissolveRow[] = [];
  for (const [name, amount] of Object.entries(yields)) {
    const copies = holdings.get(name.toLowerCase()) ?? 0;
    const spare = keepMax ? copies - maxOf(name) : copies;
    if (spare <= 0) continue;
    rows.push({ name, spare, yield: amount, platinum: priceOf(name) });
  }
  rows.sort(
    (a, b) =>
      (a.platinum ?? Infinity) - (b.platinum ?? Infinity) ||
      b.yield - a.yield ||
      a.name.localeCompare(b.name),
  );
  return {
    rows,
    spare: rows.reduce((sum, row) => sum + row.spare, 0),
    total: rows.reduce((sum, row) => sum + row.spare * row.yield, 0),
  };
}

export interface VosforSummary {
  balance: number | null;
  packs: number;
  forArcanes: PackRank[] | null;
  forPlatinum: PackRank[];
  dissolve: DissolvePlan | null;
}

/** Reads the price cache, so a caller re-runs it on a price revision. */
export function vosforSummary(
  inventory: RawInventoryData | null,
  itemDb: Record<string, ItemDbEntry>,
  keepMax: boolean,
): VosforSummary {
  const holdings = arcaneCopies(inventory, itemDb);
  const maxOf = (name: string): number => arcaneMaxCopies(name, itemDb);
  const balance = vosforBalance(inventory);
  const { collections, yields } = VOSFOR_DATA;
  return {
    balance,
    packs: packs(balance),
    forArcanes: rankForArcanes(collections, POPULAR_ARCANES, holdings, maxOf, upgradePlatinum),
    forPlatinum: rankForPlatinum(collections, holdings, maxOf, upgradePlatinum),
    dissolve: dissolvePlan(holdings, yields, maxOf, upgradePlatinum, keepMax),
  };
}
