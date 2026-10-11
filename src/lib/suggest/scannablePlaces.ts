import { SCAN_GROUPS, type ScanGroup, type ScannableEntry } from "./scannables.js";
import type { Suggestion } from "../../types/suggest.js";

export const PLACE_KINDS = ["landscape", "planet", "tileset", "stop", "drop"] as const;
export type ScannablePlaceKind = (typeof PLACE_KINDS)[number];

export interface ScannablePool {
  group: ScanGroup;
  types: string[];
  perItem: number;
  cap: number | null;
}

export interface ScannablePlace {
  id: string;
  name: string;
  kind: ScannablePlaceKind;
  /** A file name inside assets/scannables/. */
  art: string | null;
  mapKey: string | null;
  run: string;
  gear: string[];
  steps: string[];
  gates: string[];
  fixed: boolean;
  wiki: string | null;
  pools: ScannablePool[];
}

export interface ScannablePlaceItem {
  group: ScanGroup;
  entry: ScannableEntry;
  remaining: number;
}

export interface ScannableGroupCount {
  group: ScanGroup;
  count: number;
}

export interface ScannablePlaceCard {
  key: string;
  /** Null for the card holding every item no place lists. */
  place: ScannablePlace | null;
  left: number;
  perRun: number;
  groups: ScannableGroupCount[];
  /** By group, in SCAN_GROUPS order, then by name. */
  items: ScannablePlaceItem[];
}

export const UNPLACED_KEY = "unplaced";

type PlacedCard = ScannablePlaceCard & { place: ScannablePlace };

/** An unknown requirement still owes the first scan. */
function remainingOf(entry: ScannableEntry): number {
  return entry.required === null ? 1 : Math.max(0, entry.required - entry.scanned);
}

const typeKey = (type: string): string => type.toLowerCase();

function poolYield(pool: ScannablePool, items: readonly ScannablePlaceItem[]): number {
  const sum = items.reduce((total, item) => total + Math.min(item.remaining, pool.perItem), 0);
  return Math.min(pool.cap ?? Infinity, sum);
}

function groupCounts(items: readonly ScannablePlaceItem[]): ScannableGroupCount[] {
  return SCAN_GROUPS.map((group) => ({
    group,
    count: items.filter((item) => item.group === group).length,
  }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);
}

function sortItems(items: ScannablePlaceItem[]): ScannablePlaceItem[] {
  return items.sort(
    (a, b) =>
      SCAN_GROUPS.indexOf(a.group) - SCAN_GROUPS.indexOf(b.group) ||
      a.entry.name.localeCompare(b.entry.name),
  );
}

function cardFor(
  place: ScannablePlace,
  missing: ReadonlyMap<string, ScannablePlaceItem>,
  active: ReadonlySet<ScanGroup>,
): PlacedCard | null {
  const items = new Map<string, ScannablePlaceItem>();
  let perRun = 0;
  for (const pool of place.pools) {
    if (!active.has(pool.group)) continue;
    const found = pool.types.flatMap((type) => {
      const item = missing.get(typeKey(type));
      return item ? [item] : [];
    });
    for (const item of found) items.set(typeKey(item.entry.type), item);
    perRun += poolYield(pool, found);
  }
  if (items.size === 0) return null;
  const list = sortItems([...items.values()]);
  return {
    key: place.id,
    place,
    left: list.length,
    // Pools may cap at a fraction of a scan; tenths keep float noise out of ties.
    perRun: Math.round(perRun * 10) / 10,
    groups: groupCounts(list),
    items: list,
  };
}

function byRank(a: PlacedCard, b: PlacedCard): number {
  const pa = a.place;
  const pb = b.place;
  return (
    Number(pb.kind === "stop") - Number(pa.kind === "stop") ||
    b.perRun - a.perRun ||
    Number(pb.fixed) - Number(pa.fixed) ||
    a.left - b.left ||
    pa.name.localeCompare(pb.name)
  );
}

export function scannablePlaceCards(
  missing: Readonly<Record<ScanGroup, readonly ScannableEntry[]>>,
  places: readonly ScannablePlace[],
  groups: readonly ScanGroup[],
): ScannablePlaceCard[] {
  const active = new Set(groups);
  const byType = new Map<string, ScannablePlaceItem>();
  for (const group of SCAN_GROUPS) {
    if (!active.has(group)) continue;
    for (const entry of missing[group]) {
      const remaining = remainingOf(entry);
      if (remaining > 0) byType.set(typeKey(entry.type), { group, entry, remaining });
    }
  }

  const cards: ScannablePlaceCard[] = places
    .flatMap((place) => cardFor(place, byType, active) ?? [])
    .sort(byRank);

  const listed = new Set(
    places.flatMap((place) => place.pools.flatMap((pool) => pool.types.map(typeKey))),
  );
  const unplaced = sortItems(
    [...byType.entries()].flatMap(([key, item]) => (listed.has(key) ? [] : [item])),
  );
  if (unplaced.length > 0) {
    cards.push({
      key: UNPLACED_KEY,
      place: null,
      left: unplaced.length,
      perRun: 0,
      groups: groupCounts(unplaced),
      items: unplaced,
    });
  }
  return cards;
}

export function placeSuggestions(cards: readonly ScannablePlaceCard[]): Suggestion[] {
  return cards.map((card, index) => ({
    id: `scannablePlace:${card.key}`,
    category: "simulacrum",
    title: card.place?.name ?? "",
    why: "",
    signals: { value: 1, effort: 0, urgency: 0 },
    score: 0,
    fingerprint: card.key,
    order: index,
    details: { scannablePlace: card },
  }));
}

const isString = (value: unknown): value is string => typeof value === "string";
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter(isString) : []);
const nullableString = (value: unknown): string | null => (isString(value) && value ? value : null);

function parsePool(raw: unknown): ScannablePool | null {
  if (!raw || typeof raw !== "object") return null;
  const pool = raw as Record<string, unknown>;
  const group = pool["group"];
  if (!isString(group) || !(SCAN_GROUPS as readonly string[]).includes(group)) return null;
  const perItem = pool["perItem"];
  if (!isCount(perItem)) return null;
  const cap = pool["cap"];
  return {
    group: group as ScanGroup,
    types: strings(pool["types"]),
    perItem,
    cap: isCount(cap) ? cap : null,
  };
}

/** A hand-authored entry the shape does not hold is dropped, not guessed at. */
export function parsePlaces(raw: unknown): ScannablePlace[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value: unknown): ScannablePlace[] => {
    if (!value || typeof value !== "object") return [];
    const place = value as Record<string, unknown>;
    const { id, name, kind } = place;
    if (!isString(id) || !isString(name) || !isString(kind)) return [];
    if (!(PLACE_KINDS as readonly string[]).includes(kind)) return [];
    const pools = Array.isArray(place["pools"])
      ? place["pools"].flatMap((pool: unknown) => parsePool(pool) ?? [])
      : [];
    return [
      {
        id,
        name,
        kind: kind as ScannablePlaceKind,
        art: nullableString(place["art"]),
        mapKey: nullableString(place["mapKey"]),
        run: isString(place["run"]) ? place["run"] : "",
        gear: strings(place["gear"]),
        steps: strings(place["steps"]),
        gates: strings(place["gates"]),
        fixed: place["fixed"] === true,
        wiki: nullableString(place["wiki"]),
        pools,
      },
    ];
  });
}
