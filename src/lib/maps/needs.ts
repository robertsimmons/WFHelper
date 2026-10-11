import {
  resourceEntry,
  type ResourceEntry,
  type ResourceLookup,
} from "../suggest/acquisition/plan/resources.js";
import type { ResolvedPlan } from "../suggest/acquisition/plan/types.js";
import { baseMap, baseMapKey } from "./registry.js";

export interface MapNeed {
  /** The resource store's spelling, which is what pins name in `refs`. */
  name: string;
  /** Still to farm, summed over every row; null when no row states a figure. */
  qty: number | null;
  where: string | null;
  color: string;
}

// Data colours for the pins, kept stable per resource so a plan switch never
// repaints a resource the player has already learned.
const RESOURCE_COLORS: Readonly<Record<string, string>> = {
  aggristone: "#78716c",
  "ariette scale": "#3b82f6",
  "connla sprout": "#4ade80",
  dracroot: "#ef4444",
  eevani: "#a78bfa",
  kovnik: "#2dd4bf",
  "maw fang": "#94a3b8",
  "nacreous pebble": "#fb923c",
  "saggen pearl": "#e8e4dc",
  silphsela: "#a3e635",
  "tasoma extract": "#f472b6",
  ueymag: "#facc15",
  "yao shrub": "#7dd3fc",
};

// The first eight spread round the hue wheel with no two reds or pinks among them.
const FALLBACK_COLORS = [
  "#f59e0b",
  "#22d3ee",
  "#e879f9",
  "#84cc16",
  "#f87171",
  "#60a5fa",
  "#22c55e",
  "#a68cfa",
  "#fde047",
  "#818cf8",
  "#34d399",
  "#fda4af",
  "#c084fc",
  "#fdba74",
  "#5eead4",
  "#f0abfc",
  "#bef264",
  "#fca5a5",
];

const hex = (value: number): string =>
  Math.round(value * 255)
    .toString(16)
    .padStart(2, "0");

/** Golden-angle hues past the hand palette, light enough to read on the dark map. */
function generatedColor(index: number): string {
  const hue = (index * 137.508) % 360;
  const s = 0.7;
  const l = 0.66;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number): number => {
    const k = (n + hue / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return `#${hex(channel(0))}${hex(channel(8))}${hex(channel(4))}`;
}

function whereText(entry: ResourceEntry, mapName: string): string | null {
  const best = entry.best;
  if (!best) return null;
  const place = best.place.trim().toLowerCase() === mapName.toLowerCase() ? null : best.place;
  const parts = [place, best.sub, best.activity, best.meta].filter(
    (part): part is string => !!part,
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

function assignColors(names: readonly string[]): string[] {
  const used = new Set<string>();
  const fixed = names.map((name) => RESOURCE_COLORS[name.toLowerCase()] ?? null);
  for (const color of fixed) if (color) used.add(color);
  const spare = FALLBACK_COLORS.filter((color) => !used.has(color));
  let generated = 0;
  const take = (): string => {
    const pick = spare.shift();
    if (pick) return pick;
    let color = generatedColor(generated++);
    while (used.has(color)) color = generatedColor(generated++);
    return color;
  };
  return fixed.map((color) => {
    if (color) return color;
    const pick = take();
    used.add(pick);
    return pick;
  });
}

/** What the plan still has to gather on one base map: every open row of every
 *  group whose map opens that base map, merged per resource. A row joins only
 *  when the store calls it harvestable on this map, so currencies, boss drops
 *  and rewards stay off it. */
export function mapNeeds(
  plan: Pick<ResolvedPlan, "groups">,
  mapKey: string,
  lookup: ResourceLookup = resourceEntry,
): MapNeed[] {
  const map = baseMap(mapKey);
  if (!map) return [];
  const totals = new Map<string, { entry: ResourceEntry; qty: number | null }>();
  for (const group of plan.groups) {
    if (group.skip !== null || baseMap(group.map)?.key !== map.key) continue;
    for (const row of group.rows) {
      if (row.done) continue;
      const entry = lookup(row.label);
      if (!entry?.harvestable || baseMapKey(entry.map) !== map.key) continue;
      const key = entry.name.toLowerCase();
      const qty = row.qty ? row.qty.remaining : null;
      const total = totals.get(key);
      if (!total) totals.set(key, { entry, qty });
      else if (qty !== null) total.qty = (total.qty ?? 0) + qty;
    }
  }
  const merged = [...totals.values()];
  const colors = assignColors(merged.map((total) => total.entry.name));
  return merged.map((total, index) => ({
    name: total.entry.name,
    qty: total.qty,
    where: whereText(total.entry, map.name),
    color: colors[index],
  }));
}
