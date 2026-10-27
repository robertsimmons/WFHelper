import { componentUniqueNameAliases } from "../../../../config/shared/componentNames.js";
import { parseOwnedRelics } from "../../relic/relicInventory.js";
import type { RawInventoryData } from "../../../types/inventory.js";
import type { RelicDatabase, RelicGroup } from "../../../types/relics.js";
import type { PartState, RelicCost, RelicHolding } from "./types.js";

/** "Mag Prime Neuroptics Blueprint" -> "mag prime neuroptics". */
function partKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+blueprint$/, "")
    .trim();
}

interface PartMatcher {
  part: PartState;
  uniqueNames: Set<string>;
  key: string;
}

function matcher(part: PartState): PartMatcher {
  return {
    part,
    uniqueNames: new Set(
      componentUniqueNameAliases(part.uniqueName).map((name) => name.toLowerCase()),
    ),
    key: partKey(part.name),
  };
}

/** Unknown vault state reads as still dropping. */
function stillDrops(group: RelicGroup): boolean {
  if (group.dropping) return group.dropping !== "none";
  return group.vaulted !== true;
}

/** Relic counts the player holds against the parts a Prime is still short of.
 *  Without a relic database the path still stands; only the counts are unknown.
 *  A vaulted relic a trader sells now, by group name in `sold`, is in reach. */
export function relicCost(
  missing: readonly PartState[],
  inventory: RawInventoryData | null,
  relicDb: RelicDatabase | null | undefined,
  sold: ReadonlySet<string> = new Set(),
): RelicCost {
  const needed = missing.reduce((sum, part) => sum + part.missing, 0);
  if (!relicDb) return { known: false, held: 0, needed, rows: [], stranded: [] };

  const owned = parseOwnedRelics(inventory, relicDb);
  const matchers = missing.map(matcher);
  const rows: RelicHolding[] = [];
  const paid = new Set<string>();
  const reachable = new Set<string>();
  let held = 0;

  for (const [groupKey, group] of Object.entries(relicDb.groups)) {
    const counts = owned[groupKey];
    const copies = counts
      ? counts.intact + counts.exceptional + counts.flawless + counts.radiant
      : 0;
    const hit = new Set<string>();
    for (const quality of Object.values(group.qualities)) {
      for (const reward of quality?.rewards ?? []) {
        const uniqueName = reward.uniqueName?.toLowerCase() || "";
        const found = matchers.find(
          (entry) =>
            (uniqueName && entry.uniqueNames.has(uniqueName)) || entry.key === partKey(reward.name),
        );
        if (found) hit.add(found.part.name);
      }
    }
    if (hit.size === 0) continue;
    const open = copies > 0 || stillDrops(group) || sold.has(group.name);
    for (const part of hit) {
      rows.push({ relic: group.name, part, held: copies });
      paid.add(part);
      if (open) reachable.add(part);
    }
    held += copies;
  }

  rows.sort((a, b) => b.held - a.held || a.relic.localeCompare(b.relic));
  const stranded = [...paid].filter((part) => !reachable.has(part));
  return { known: true, held, needed, rows, stranded };
}
