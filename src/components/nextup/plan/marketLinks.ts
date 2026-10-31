import { getLookupByGameRef, getLookupByName } from "../../../lib/inventoryMarket.js";
import type { ItemDbEntry } from "../../../types/inventory.js";
import type { WfmItemsLookup } from "../../../types/ipc.js";

interface MarketLink {
  /** The part's name; null for the item or its set. */
  part: string | null;
  slug: string;
}

function slugFor(
  uniqueName: string,
  entry: ItemDbEntry | undefined,
  lookup: WfmItemsLookup,
): string | null {
  if (!entry?.tradable || !entry.name) return null;
  const hit = getLookupByGameRef(uniqueName, lookup) ?? getLookupByName(entry.name, lookup);
  return hit?.url_name ?? null;
}

/** The set's page when the market lists one, else the item's own, else one page per
 *  tradeable blueprint or part in its recipe. */
export function marketLinks(
  root: string | null,
  itemDb: Record<string, ItemDbEntry>,
  lookup: WfmItemsLookup,
): MarketLink[] {
  const entry = root ? itemDb[root] : undefined;
  if (!root || !entry?.name) return [];
  const set = getLookupByName(`${entry.name} Set`, lookup)?.url_name;
  if (set) return [{ part: null, slug: set }];
  const own = slugFor(root, entry, lookup);
  if (own) return [{ part: null, slug: own }];
  const blueprints = Object.entries(itemDb)
    .filter(([, row]) => row.buildsProduct === root)
    .map(([name]) => name);
  const parts = [...blueprints, ...(entry.recipe?.ingredients ?? []).map((row) => row.uniqueName)];
  const prefix = `${entry.name.toLowerCase()} `;
  return [...new Set(parts)].flatMap((name): MarketLink[] => {
    const row = itemDb[name];
    const slug = slugFor(name, row, lookup);
    if (!row?.name || !slug) return [];
    const label = row.name.toLowerCase().startsWith(prefix)
      ? row.name.slice(prefix.length)
      : row.name;
    return [{ part: label, slug }];
  });
}
