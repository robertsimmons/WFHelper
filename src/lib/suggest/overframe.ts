const ARSENAL_BASE = "https://overframe.gg/items/arsenal";

interface OverframeEntry {
  id: string;
  slug: string;
}

/** One row of `src/data/suggest/overframeItems.json`, which the suggest data
 *  build writes and which is absent until it has run. */
interface RawItem {
  slug?: unknown;
  name?: unknown;
  uniqueName?: unknown;
}

function nameKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Nothing about the file is trusted: it is generated, optional, and may lag
 *  the shape this expects. Anything unreadable is simply not indexed. */
export function overframeIndex(raw: unknown): Map<string, OverframeEntry> {
  const index = new Map<string, OverframeEntry>();
  if (!raw || typeof raw !== "object") return index;
  const items = (raw as { items?: unknown }).items;
  if (!items || typeof items !== "object") return index;

  for (const [id, value] of Object.entries(items as Record<string, unknown>)) {
    if (!/^\d+$/.test(id) || !value || typeof value !== "object") continue;
    const item = value as RawItem;
    const slug = typeof item.slug === "string" ? item.slug.trim() : "";
    if (!slug) continue;
    const entry: OverframeEntry = { id, slug };
    if (typeof item.uniqueName === "string" && item.uniqueName.trim()) {
      index.set(item.uniqueName.trim(), entry);
    }
    const key = typeof item.name === "string" ? nameKey(item.name) : "";
    // Item paths and lowercased display names cannot collide, so one map holds both.
    if (key && !index.has(key)) index.set(key, entry);
  }
  return index;
}

/** The arsenal url for an item, or null when the mapping does not name it. The
 *  id is only ever known from the mapping, so a name alone builds nothing. */
export function overframeUrlIn(
  index: Map<string, OverframeEntry>,
  name: string | null | undefined,
  uniqueName?: string | null | undefined,
): string | null {
  const entry =
    (uniqueName ? index.get(uniqueName) : undefined) ??
    (name ? index.get(nameKey(name)) : undefined);
  return entry ? `${ARSENAL_BASE}/${entry.id}/${entry.slug}/` : null;
}

// A glob rather than an import: the data build owns the file and it may not exist.
const loaded = import.meta.glob("../../data/suggest/overframeItems.json", { eager: true });

function shippedIndex(): Map<string, OverframeEntry> {
  const module = Object.values(loaded)[0];
  const raw =
    module && typeof module === "object" ? (module as { default?: unknown }).default : null;
  return overframeIndex(raw ?? module);
}

const INDEX = shippedIndex();

export function overframeUrl(
  name: string | null | undefined,
  uniqueName?: string | null | undefined,
): string | null {
  return overframeUrlIn(INDEX, name, uniqueName);
}
