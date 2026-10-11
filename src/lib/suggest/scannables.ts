import type { CodexRow } from "../codexScans.js";
import type { RawInventoryData, RawLoreFragmentScan } from "../../types/inventory.js";
export const SCAN_GROUPS = ["somachords", "fragments", "prex", "frameFighter", "objects"] as const;
export type ScanGroup = (typeof SCAN_GROUPS)[number];

export const SCAN_CATEGORIES = ["simulacrum", "all", ...SCAN_GROUPS] as const;
export type ScanCategory = (typeof SCAN_CATEGORIES)[number];
export type PlaceCategory = Exclude<ScanCategory, "simulacrum">;
export const PLACE_CATEGORIES: readonly PlaceCategory[] = ["all", ...SCAN_GROUPS];

/** The codex keeps Prex cards among the lore fragments; only the path tells them apart. */
const PREX_PATH = "/lotus/types/lore/fragments/lorecardfragments/";

/** The missing-entry buckets the codex sections map onto, before Prex splits out. */
export type ScannableCategory = "objects" | "somachords" | "fragments" | "frameFighter";

const BY_SECTION: Readonly<Partial<Record<string, ScannableCategory>>> = {
  objects: "objects",
  plants: "objects",
  songs: "somachords",
  loreFragments: "fragments",
  fighterFrames: "frameFighter",
};

export interface ScannableEntry {
  type: string;
  name: string;
  scanned: number;
  required: number | null;
  image: string | null;
  planet: string | null;
  wiki: string | null;
}

interface ExtraMeta {
  section?: string;
  planet?: string;
  wiki?: string;
}

export type MissingScannables = Record<ScannableCategory, ScannableEntry[]>;

/** An unknown requirement reads as missing only until the first scan. */
function isMissing(scanned: number, required: number | null): boolean {
  return required !== null ? scanned < required : scanned === 0;
}

/** One inventory `LoreFragmentScans` row. */
export interface LoreScan {
  type: string;
  progress: number;
  region: string | null;
}

/** The profile's codex stats never record these, so the inventory counts too. */
const LORE_CATEGORIES: ReadonlySet<ScannableCategory> = new Set([
  "somachords",
  "fragments",
  "frameFighter",
]);

export function loreFragmentScans(inventory: RawInventoryData | null): LoreScan[] {
  const raw = inventory?.LoreFragmentScans;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry: RawLoreFragmentScan | null) =>
    typeof entry?.ItemType === "string" && typeof entry.Progress === "number"
      ? [
          {
            type: entry.ItemType,
            progress: entry.Progress,
            region: typeof entry.Region === "string" && entry.Region ? entry.Region : null,
          },
        ]
      : [],
  );
}

/** Only a plain `Locations/<Planet>` key naming a known planet reads as a place. */
function regionPlanet(region: string | null, planets: ReadonlySet<string>): string | null {
  const tail = region ? /^\/Lotus\/Language\/Locations\/([^/]+)$/.exec(region)?.[1] : undefined;
  return tail && planets.has(tail) ? tail : null;
}

export function missingScannables(
  rows: readonly CodexRow[],
  extras: Readonly<Record<string, ExtraMeta | undefined>>,
  lore: readonly LoreScan[] = [],
  planets: ReadonlySet<string> = new Set(),
): MissingScannables {
  const loreByType = new Map(lore.map((scan) => [scan.type.toLowerCase(), scan]));
  const out: MissingScannables = { objects: [], somachords: [], fragments: [], frameFighter: [] };
  for (const row of rows) {
    const extra = extras[row.type];
    const category = extra?.section ? BY_SECTION[extra.section] : undefined;
    if (!category) continue;
    const scan = LORE_CATEGORIES.has(category) ? loreByType.get(row.type.toLowerCase()) : undefined;
    const scanned = Math.max(row.scanned, scan?.progress ?? 0);
    if (!isMissing(scanned, row.required)) continue;
    out[category].push({
      type: row.type,
      name: row.name,
      scanned,
      required: row.required,
      image: row.image,
      planet: extra?.planet ?? regionPlanet(scan?.region ?? null, planets),
      wiki: extra?.wiki ?? null,
    });
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function isPrex(type: string): boolean {
  return type.toLowerCase().startsWith(PREX_PATH);
}

export function scanGroups(missing: MissingScannables): Record<ScanGroup, ScannableEntry[]> {
  return {
    somachords: missing.somachords,
    fragments: missing.fragments.filter((entry) => !isPrex(entry.type)),
    prex: missing.fragments.filter((entry) => isPrex(entry.type)),
    frameFighter: missing.frameFighter,
    objects: missing.objects,
  };
}

export function groupsFor(category: PlaceCategory): readonly ScanGroup[] {
  return category === "all" ? SCAN_GROUPS : [category];
}
