import table from "../../../../data/suggest/acquisitionPlans/resources.json";

export interface ResourceSource {
  place: string;
  sub: string | null;
  activity: string | null;
  /** How it drops once you are in the mission: destructibles, mining, a named
   *  enemy. Null when nothing stated a mechanism. */
  how: string | null;
  meta: string | null;
}

const RESOURCE_KINDS = ["farm", "craft", "standing", "currency"] as const;

type ResourceKind = (typeof RESOURCE_KINDS)[number];

interface RecipePart {
  qty: number;
  label: string;
}

export interface ResourceEntry {
  /** The key as the store spells it; an alias answers with its target's. */
  name: string;
  /** The key the lookup matched, which differs from `name` only on an alias. */
  spelled: string;
  /** Null on an auto-drafted entry nobody has curated yet. */
  kind: ResourceKind | null;
  harvestable: boolean;
  map: string | null;
  best: ResourceSource | null;
  alternates: ResourceSource[];
  tips: string[];
  /** Units one craft makes; the recipe is per craft, not per unit. */
  yield: number;
  /** Empty for anything that is not crafted. */
  recipe: RecipePart[];
}

/** Null for anything the store does not name, which is unknown rather than nowhere. */
export type ResourceLookup = (name: string) => ResourceEntry | null;

const META_KEYS = new Set(["coverage", "conflicts"]);
const KINDS = new Set<string>(RESOURCE_KINDS);

function readSource(value: unknown): ResourceSource | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.place !== "string" || raw.place === "") return null;
  return {
    place: raw.place,
    sub: typeof raw.sub === "string" ? raw.sub : null,
    activity: typeof raw.activity === "string" ? raw.activity : null,
    how: typeof raw.how === "string" ? raw.how : null,
    meta: typeof raw.meta === "string" ? raw.meta : null,
  };
}

function readRecipePart(value: unknown): RecipePart | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.label !== "string" || raw.label === "") return null;
  if (typeof raw.qty !== "number" || !Number.isFinite(raw.qty) || raw.qty <= 0) return null;
  return { qty: raw.qty, label: raw.label };
}

function readYield(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : 1;
}

function readList<T>(value: unknown, read: (entry: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.map(read).filter((entry): entry is T => entry !== null);
}

function buildTable(source: unknown): Map<string, ResourceEntry> {
  const out = new Map<string, ResourceEntry>();
  if (!source || typeof source !== "object") return out;
  const aliases: [string, string][] = [];
  for (const [name, value] of Object.entries(source as Record<string, unknown>)) {
    if (META_KEYS.has(name) || !value || typeof value !== "object") continue;
    const raw = value as Record<string, unknown>;
    if (typeof raw.alias === "string") {
      aliases.push([name, raw.alias]);
      continue;
    }
    out.set(name.toLowerCase(), {
      name,
      spelled: name,
      kind: typeof raw.kind === "string" && KINDS.has(raw.kind) ? (raw.kind as ResourceKind) : null,
      harvestable: raw.harvestable === true,
      map: typeof raw.map === "string" ? raw.map : null,
      best: readSource(raw.best),
      alternates: readList(raw.alternates, readSource),
      tips: readList(raw.tips, (tip) => (typeof tip === "string" && tip !== "" ? tip : null)),
      yield: readYield(raw.yield),
      recipe: readList(raw.recipe, readRecipePart),
    });
  }
  // An alias names a real entry, never another alias, so one pass resolves them all.
  for (const [name, target] of aliases) {
    const entry = out.get(target.trim().toLowerCase());
    if (entry) out.set(name.toLowerCase(), { ...entry, spelled: name });
  }
  return out;
}

/** A lookup over a table shaped like resources.json, keyed case-insensitively. */
export function resourceLookup(source: unknown): ResourceLookup {
  const built = buildTable(source);
  return (name) => built.get(name.trim().toLowerCase()) ?? null;
}

export const resourceEntry: ResourceLookup = resourceLookup(table);
