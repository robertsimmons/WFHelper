import { beforeAll, describe, expect, it } from "vitest";

import * as itemDatabase from "../../../../services/itemDatabase";
import { ARCANE_CATALOG } from "../../../../src/lib/suggest/arcanes.js";
import { MOD_CATALOG, buildModCard } from "../../../../src/lib/suggest/mods.js";
import {
  UPGRADE_VENDOR_OPTIONS,
  availableVendorOptions,
  cardMatchesVendors,
  pickedVendor,
  vendorBalance,
  vendorMatchesOption,
} from "../../../../src/lib/suggest/upgradeVendorFilters.js";
import type {
  ItemDbEntry,
  RawInventoryData,
  UpgradeVendorSource,
} from "../../../../src/types/inventory.js";
import {
  createEntries,
  createNameIndex,
  upgradeCountText,
  type UpgradeCatalog,
} from "../../../../src/lib/suggest/upgrades.js";
import type { Translator } from "../../../../src/lib/i18n.js";

const BARO_KEY = "/Lotus/Language/G1Quests/VoidTraderName";
const VITUS = "/Lotus/Types/Items/MiscItems/Elitium";

const meridian: UpgradeVendorSource = {
  name: "Steel Meridian",
  syndicate: "SteelMeridianSyndicate",
  cost: { amount: 25000, unit: "standing" },
};
const baro: UpgradeVendorSource = { name: "Baro Ki'Teer", nameKey: BARO_KEY };
const honors: UpgradeVendorSource = {
  id: "arbitrationHonors",
  cost: { amount: 20, unit: "item", item: "Vitus Essence", currency: VITUS },
};
const nightwave: UpgradeVendorSource = {
  name: "Nightwave",
  syndicate: "RadioLegionIntermission15Syndicate",
};

describe("vendorMatchesOption", () => {
  it("matches a syndicate by tag, never by its shown name", () => {
    expect(vendorMatchesOption(meridian, "steelMeridian")).toBe(true);
    expect(vendorMatchesOption({ name: "Steel Meridian" }, "steelMeridian")).toBe(false);
    expect(vendorMatchesOption(meridian, "redVeil")).toBe(false);
  });

  it("matches a named shop by id and Baro by his name key", () => {
    expect(vendorMatchesOption(honors, "arbitrationHonors")).toBe(true);
    expect(vendorMatchesOption(honors, "steelPathHonors")).toBe(false);
    expect(vendorMatchesOption(baro, "baro")).toBe(true);
    expect(vendorMatchesOption({ name: "Baro Ki'Teer" }, "baro")).toBe(false);
  });

  it("matches any Nightwave season's tag", () => {
    expect(vendorMatchesOption(nightwave, "nightwave")).toBe(true);
    expect(
      vendorMatchesOption({ ...nightwave, syndicate: "RadioLegion3Syndicate" }, "nightwave"),
    ).toBe(true);
  });

  it("knows nothing of an unlisted option", () => {
    expect(vendorMatchesOption(meridian, "nope")).toBe(false);
  });
});

describe("cardMatchesVendors", () => {
  it("lets every card through while nothing is picked", () => {
    expect(cardMatchesVendors({ vendors: [] }, [])).toBe(true);
  });

  it("keeps a card any picked option sells, across groups", () => {
    const card = { vendors: [baro] };
    expect(cardMatchesVendors(card, ["steelMeridian", "baro"])).toBe(true);
    expect(cardMatchesVendors(card, ["steelMeridian"])).toBe(false);
    expect(cardMatchesVendors({ vendors: [] }, ["baro"])).toBe(false);
  });

  it("names the picked seller, not the card's first one", () => {
    expect(pickedVendor({ vendors: [meridian, honors] }, ["arbitrationHonors"])).toBe(honors);
  });
});

describe("vendorBalance", () => {
  const inventory = {
    Affiliations: [{ Tag: "SteelMeridianSyndicate", Standing: 132000 }],
    MiscItems: [{ ItemType: VITUS, ItemCount: 340 }],
  } as unknown as RawInventoryData;

  it("reads standing off the vendor's syndicate and currency off MiscItems", () => {
    expect(vendorBalance(meridian, inventory)).toBe(132000);
    expect(vendorBalance(honors, inventory)).toBe(340);
  });

  it("is unknown with no inventory, no syndicate row or no price", () => {
    expect(vendorBalance(meridian, null)).toBeNull();
    expect(vendorBalance({ ...meridian, syndicate: "RedVeilSyndicate" }, inventory)).toBeNull();
    expect(vendorBalance(baro, inventory)).toBeNull();
  });
});

describe("availableVendorOptions", () => {
  it("offers only options some upgrade on the kind's full list is sold by", () => {
    const entries = [
      { name: "A", count: 1, wikiUrl: "" },
      { name: "B", count: 0, wikiUrl: "" },
    ];
    const catalog: UpgradeCatalog = {
      ...MOD_CATALOG,
      kind: "mods",
      popular: entries.slice(0, 1),
      entries: () => entries,
      build: (entry) => ({
        ...MOD_CATALOG.build(entry, {}, null),
        vendors: entry.name === "A" ? [meridian] : [honors],
      }),
    };
    const available = availableVendorOptions(catalog, {});
    expect([...available].sort()).toEqual(["arbitrationHonors", "steelMeridian"]);
  });
});

describe("createEntries", () => {
  const index = createNameIndex(
    () => true,
    () => false,
  );
  const itemDb: Record<string, ItemDbEntry> = {
    "/Lotus/Upgrades/Mods/Rifle/Serration": { name: "Serration", type: "Primary Mod" },
    "/Lotus/Upgrades/Mods/Rifle/Ammo": { name: "Ammo Drum", type: "Primary Mod" },
    "/Lotus/Upgrades/Mods/Rifle/Aim": { name: "Agile Aim", type: "Primary Mod" },
    "/Lotus/Upgrades/Focus/Attack/Dash": { name: "Blazing Dash", type: "Focus Way" },
    "/Lotus/Upgrades/Mods/Sets/Amar/AmarSetMod": { name: "Amarsetmod", type: "Mod Set Mod" },
    "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare": {
      name: "Rifle Riven Mod",
      type: "Rifle Riven Mod",
    },
  };

  it("keeps the popular order, then the rest by name at a count of 0", () => {
    const entries = createEntries([{ name: "Serration", count: 9, wikiUrl: "w" }], index)(itemDb);
    expect(entries).toEqual([
      { name: "Serration", count: 9, wikiUrl: "w" },
      { name: "Agile Aim", count: 0, wikiUrl: "" },
      { name: "Ammo Drum", count: 0, wikiUrl: "" },
    ]);
  });

  it("renders a count of 0 like any other count", () => {
    const card = buildModCard({ name: "Agile Aim", count: 0, wikiUrl: "" }, itemDb, null);
    const t = (key: string, vars?: Record<string, string>) => `${key}${JSON.stringify(vars ?? {})}`;
    expect(upgradeCountText(card, t as Translator)).toBe('nextUp.modOnLists{"count":"0"}');
  });
});

describe("on the real game data", () => {
  let itemDb: Record<string, ItemDbEntry>;

  beforeAll(() => {
    itemDatabase.buildDatabase();
    itemDb = itemDatabase.getRendererLookup() as unknown as Record<string, ItemDbEntry>;
  });

  it("lists every collectible upgrade, the popular ones first and unchanged", () => {
    for (const catalog of [MOD_CATALOG, ARCANE_CATALOG]) {
      const entries = catalog.entries(itemDb);
      expect(entries.slice(0, catalog.popular.length)).toEqual(catalog.popular);
      const rest = entries.slice(catalog.popular.length);
      expect(rest.every((entry) => entry.count === 0)).toBe(true);
      expect(rest.some((entry) => /Riven Mod$/.test(entry.name))).toBe(false);
      expect(new Set(entries.map((entry) => entry.name.toLowerCase())).size).toBe(entries.length);
    }
    expect(MOD_CATALOG.entries(itemDb).length).toBeGreaterThan(MOD_CATALOG.popular.length);
  });

  it("every option sells at least one mod or arcane, and only those show", () => {
    const mods = availableVendorOptions(MOD_CATALOG, itemDb);
    const arcanes = availableVendorOptions(ARCANE_CATALOG, itemDb);
    const count = (catalog: UpgradeCatalog, id: string) =>
      catalog
        .entries(itemDb)
        .filter((entry) =>
          catalog
            .build(entry, itemDb, null)
            .vendors.some((source) => vendorMatchesOption(source, id)),
        ).length;
    for (const id of UPGRADE_VENDOR_OPTIONS) {
      const modCount = count(MOD_CATALOG, id);
      const arcaneCount = count(ARCANE_CATALOG, id);
      expect(modCount + arcaneCount, `${id} sells nothing`).toBeGreaterThan(0);
      expect(mods.has(id)).toBe(modCount > 0);
      expect(arcanes.has(id)).toBe(arcaneCount > 0);
    }
  });
});
