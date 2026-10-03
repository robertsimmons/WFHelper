import { describe, expect, it } from "vitest";

import { resolveAcquisition } from "../../../../../src/lib/suggest/acquisition/index.js";
import { DEFAULT_OPTIONS, defaultPreferences } from "../../../../../src/lib/suggest/preferences.js";
import { acquisitionProvider } from "../../../../../src/lib/suggest/providers/acquisition.js";
import { inventory, itemDb, weaponDb } from "./fixtures.js";
import type { Translator } from "../../../../../src/lib/i18n.js";
import type { ItemDbEntry, RawInventoryData } from "../../../../../src/types/inventory.js";
import type { SuggestionContext } from "../../../../../src/types/suggest.js";

const EXCALIBUR_PRIME = "/Lotus/Powersuits/Excalibur/ExcaliburPrime";
const LATO_PRIME = "/Lotus/Weapons/Tenno/Pistol/LatoPrime";
const SKANA_PRIME = "/Lotus/Weapons/Tenno/Melee/LongSword/SkanaPrime";
const LATO = "/Lotus/Weapons/Tenno/Pistol/Pistol";
const SKANA = "/Lotus/Weapons/Tenno/Melee/LongSword/LongSword";

const FOUNDERS = ["Excalibur Prime", "Lato Prime", "Skana Prime"];

function gear(
  name: string,
  productCategory: string,
  extra: Partial<ItemDbEntry> = {},
): ItemDbEntry {
  return { name, productCategory, masterable: true, ...extra };
}

/** Founders gear never shipped a blueprint, so there is no recipe to walk. */
function db(): Record<string, ItemDbEntry> {
  return {
    ...itemDb(),
    ...weaponDb(),
    [EXCALIBUR_PRIME]: gear("Excalibur Prime", "Suits", { category: "Warframes", isPrime: true }),
    [LATO_PRIME]: gear("Lato Prime", "Pistols", { isPrime: true }),
    [SKANA_PRIME]: gear("Skana Prime", "Melee", { isPrime: true }),
    [LATO]: gear("Lato", "Pistols"),
    [SKANA]: gear("Skana", "Melee"),
  };
}

function names(inv: RawInventoryData | null): string[] {
  return resolveAcquisition({ itemDb: db(), inventory: inv }).map((t) => t.name);
}

describe("unobtainable gear", () => {
  it("never asks for a Founders exclusive the player does not own", () => {
    const listed = names(null);
    for (const name of FOUNDERS) expect(listed).not.toContain(name);
    expect(listed).toContain("Mag");
  });

  it("offers no Prime upgrade onto a Founders exclusive over the owned base", () => {
    const listed = names(inventory({ pistols: [LATO], melee: [SKANA] }));
    expect(listed).not.toContain("Lato Prime");
    expect(listed).not.toContain("Skana Prime");
  });

  it("leaves no acquisition card for one", () => {
    const ctx: SuggestionContext = {
      world: null,
      inventory: null,
      itemDb: db(),
      inventoryModifiedAt: null,
      mastery: null,
      relicDb: null,
      plat: null,
      tracker: { progress: {}, hidden: [], periods: {}, custom: [], seq: 0 },
      prefs: { ...defaultPreferences(), options: { ...DEFAULT_OPTIONS } },
      dropPools: {},
      acquisitionPins: [EXCALIBUR_PRIME],
      nowMs: Date.parse("2026-09-05T12:00:00Z"),
      t: ((key: string) => key) as unknown as Translator,
    };
    const ids = acquisitionProvider.collect(ctx).map((draft) => draft.id);
    expect(ids).not.toContain(`acquisition:${EXCALIBUR_PRIME}`);
    expect(ids).not.toContain(`acquisition:${LATO_PRIME}`);
    expect(ids).not.toContain(`acquisition:${SKANA_PRIME}`);
  });
});
