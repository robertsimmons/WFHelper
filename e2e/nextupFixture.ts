import type { Page } from "@playwright/test";

/** Share of masterable gear the synthetic account already owns. */
export const OWNED_PERCENT = 70;
/** Of that owned gear, the share left part-ranked so Mastery still has cards. */
export const PART_RANKED_PERCENT = 15;

interface OwnedRow {
  ItemType: string;
  ItemCount?: number;
}

export type SyntheticInventory = Record<string, OwnedRow[]> & {
  XPInfo: Array<{ ItemType: string; XP: number }>;
};

export interface FixtureBuild {
  inventory: SyntheticInventory;
  masterable: number;
  owned: number;
}

/** No committed fixture covers a lived-in account, so a deterministic share of
 *  every masterable frame and weapon in the shipped item database is marked
 *  owned; that share is what the acquisition sweep's cost scales with. */
export async function buildInventory(page: Page): Promise<FixtureBuild> {
  return page.evaluate(
    async (arg) => {
      const db = (await window.api.getItemDatabase()) as unknown as Record<
        string,
        {
          name?: string;
          masterable?: boolean;
          exalted?: boolean;
          isBuildComponent?: boolean;
          productCategory?: string;
        }
      >;

      const collections = [
        "Suits",
        "LongGuns",
        "Pistols",
        "Melee",
        "SpaceGuns",
        "SpaceMelee",
        "SentinelWeapons",
        "Sentinels",
      ];
      const excluded = /\/(?:Recipes|StoreItems|QuestVersions|PrototypeVersions|Test)\//i;

      // FNV-1a, so the same account comes back on every run and every machine.
      const bucket = (text: string): number => {
        let hash = 0x811c9dc5;
        for (let index = 0; index < text.length; index += 1) {
          hash ^= text.charCodeAt(index);
          hash = Math.imul(hash, 0x01000193) >>> 0;
        }
        return hash % 100;
      };

      const inventory: Record<string, unknown[]> = { XPInfo: [], MiscItems: [] };
      for (const key of collections) inventory[key] = [];
      const xp = inventory.XPInfo as Array<{ ItemType: string; XP: number }>;
      const misc = inventory.MiscItems as Array<{ ItemType: string; ItemCount: number }>;

      let masterable = 0;
      let owned = 0;
      for (const [uniqueName, entry] of Object.entries(db)) {
        // A relic shelf, without which the whole Relics section is absent and
        // the run measures three of the four at their cap rather than four.
        if (/VoidProjection/i.test(uniqueName)) misc.push({ ItemType: uniqueName, ItemCount: 3 });
        if (!entry?.name || entry.masterable !== true) continue;
        if (entry.exalted === true || entry.isBuildComponent === true) continue;
        const category = String(entry.productCategory ?? "");
        if (!collections.includes(category)) continue;
        if (excluded.test(uniqueName)) continue;
        masterable += 1;
        const slot = bucket(uniqueName);
        if (slot >= arg.ownedPercent) continue;
        owned += 1;
        (inventory[category] as unknown[]).push({ ItemType: uniqueName });
        xp.push({ ItemType: uniqueName, XP: slot < arg.partRankedPercent ? 40_000 : 900_000 });
      }

      return { inventory: inventory as never, masterable, owned };
    },
    { ownedPercent: OWNED_PERCENT, partRankedPercent: PART_RANKED_PERCENT },
  );
}
