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

export interface ResourceEntry {
  harvestable: boolean;
  map: string | null;
  best: ResourceSource | null;
  alternates: ResourceSource[];
}

const META_KEYS = new Set(["coverage", "conflicts"]);

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

function buildTable(source: unknown): Map<string, ResourceEntry> {
  const out = new Map<string, ResourceEntry>();
  if (!source || typeof source !== "object") return out;
  for (const [name, value] of Object.entries(source as Record<string, unknown>)) {
    if (META_KEYS.has(name) || !value || typeof value !== "object") continue;
    const raw = value as Record<string, unknown>;
    const alternates = Array.isArray(raw.alternates)
      ? raw.alternates.map(readSource).filter((entry): entry is ResourceSource => entry !== null)
      : [];
    out.set(name.toLowerCase(), {
      harvestable: raw.harvestable === true,
      map: typeof raw.map === "string" ? raw.map : null,
      best: readSource(raw.best),
      alternates,
    });
  }
  return out;
}

const TABLE = buildTable(table);

/** Where a resource is farmed. Null for anything the table does not name, which
 *  is unknown rather than nowhere. */
export function resourceEntry(name: string): ResourceEntry | null {
  return TABLE.get(name.trim().toLowerCase()) ?? null;
}
