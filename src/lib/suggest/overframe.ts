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
const loaded = import.meta.glob("../../data/suggest/overframeItems.json");

let index: Map<string, OverframeEntry> | null = null;

/** Three quarters of a megabyte of rows for one hyperlink, so it is fetched
 *  beside the view rather than inside its chunk. The load starts the moment the
 *  feed's module graph does, and the only caller is a modal the player has to
 *  open, so it has always landed by the time a url is asked for. */
function preload(): void {
  const open = Object.values(loaded)[0];
  if (!open) {
    index = new Map();
    return;
  }
  void open()
    .then((module) => {
      const raw = module && typeof module === "object" ? (module as { default?: unknown }) : null;
      index = overframeIndex(raw?.default ?? module);
    })
    .catch(() => {
      index = new Map();
    });
}

preload();

export function overframeUrl(
  name: string | null | undefined,
  uniqueName?: string | null | undefined,
): string | null {
  return index ? overframeUrlIn(index, name, uniqueName) : null;
}
