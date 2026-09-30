import { describe, expect, it } from "vitest";

import { pinnedUpgrades, withoutPinnedUpgrades } from "../../../../src/components/nextup/pinnedUpgrades.js";
import {
  ARCANE_CATALOG,
  arcaneCopies,
  buildArcaneCard,
  copiesAtRank,
} from "../../../../src/lib/suggest/arcanes.js";
import { MOD_CATALOG, buildModCard, ownedModNames } from "../../../../src/lib/suggest/mods.js";
import { cardFor, upgradeSources } from "../../../../src/lib/suggest/upgrades.js";
import type { ItemDbEntry, RawInventoryData } from "../../../../src/types/inventory.js";
import type { Suggestion } from "../../../../src/types/suggest.js";

const ENERGIZE = "/Lotus/Upgrades/CosmeticEnhancers/Utility/Energize";
const EXODIA = "/Lotus/Upgrades/CosmeticEnhancers/Zaw/ExodiaMight";
const SERRATION = "/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod";

const itemDb: Record<string, ItemDbEntry> = {
  [ENERGIZE]: {
    name: "Arcane Energize",
    category: "Arcane",
    tradable: true,
    arcane: {
      slot: "Warframe",
      rarity: "Legendary",
      maxRank: 5,
      maxRankStats: ["On Energy Pickup:", "+1 Arcane Revive"],
    },
    vendors: [{ id: "devilsTriad", cost: { amount: 6, unit: "item", item: "Marks of Valiance" } }],
  },
  [EXODIA]: {
    name: "Exodia Might",
    category: "Arcane",
    arcane: { slot: "Zaw", rarity: "Rare", maxRank: 3, maxRankStats: [] },
  },
  [SERRATION]: {
    name: "Serration",
    category: "Mod",
    mod: {
      polarity: "madurai",
      rarity: "Uncommon",
      baseDrain: 4,
      fusionLimit: 10,
      compatName: "RIFLE",
      maxRankStats: ["+165% Damage"],
    },
  },
};

function inventory(rows: Partial<RawInventoryData>): RawInventoryData {
  return rows as RawInventoryData;
}

const ranked = (itemType: string, lvl: number) => ({
  ItemType: itemType,
  UpgradeFingerprint: JSON.stringify({ lvl }),
});

describe("arcane copies", () => {
  it("prices a rank in the copies that built it, 21 at rank 5", () => {
    expect([0, 1, 2, 3, 4, 5].map(copiesAtRank)).toEqual([1, 3, 6, 10, 15, 21]);
  });

  it("adds unranked stacks and ranked instances into one count", () => {
    const held = arcaneCopies(
      inventory({
        RawUpgrades: [{ ItemType: ENERGIZE, ItemCount: 3 }],
        Upgrades: [ranked(ENERGIZE, 2), ranked(SERRATION, 10)],
      }),
      itemDb,
    );
    expect(held?.get("arcane energize")).toBe(9);
    expect(held?.has("serration")).toBe(false);
  });

  it("knows nothing before the inventory is read", () => {
    expect(arcaneCopies(null, itemDb)).toBeNull();
  });
});

describe("arcane owned at max rank", () => {
  const entry = { name: "Arcane Energize", count: 12, wikiUrl: "w" };

  it("stays in the band short of 21 copies and reads the count", () => {
    const holdings = new Map([["arcane energize", 20]]);
    const card = buildArcaneCard(entry, itemDb, holdings);
    expect(card.owned).toBe(false);
    expect(card.copies).toEqual({ held: 20, max: 21 });
    expect(ARCANE_CATALOG.owns("Arcane Energize", itemDb, holdings)).toBe(false);
  });

  it("is owned at 21 copies, a whole rank 5 among them", () => {
    const holdings = new Map([["arcane energize", 21]]);
    expect(buildArcaneCard(entry, itemDb, holdings).owned).toBe(true);
    expect(ARCANE_CATALOG.owns("Arcane Energize", itemDb, holdings)).toBe(true);
  });

  it("tops out at 10 copies for an arcane that ranks only to 3", () => {
    const holdings = new Map([["exodia might", 10]]);
    const card = buildArcaneCard({ name: "Exodia Might", count: 0, wikiUrl: "" }, itemDb, holdings);
    expect(card.copies).toEqual({ held: 10, max: 10 });
    expect(card.owned).toBe(true);
  });

  it("draws zero copies held rather than none once the inventory is read", () => {
    expect(buildArcaneCard(entry, itemDb, new Map()).copies).toEqual({ held: 0, max: 21 });
  });

  it("leaves copies blank and nothing owned while the inventory is unread", () => {
    const card = buildArcaneCard(entry, itemDb, null);
    expect(card.copies).toBeNull();
    expect(card.owned).toBe(false);
  });

  it("carries slot, stats, vendors and a market slug from the item database", () => {
    const card = buildArcaneCard(entry, itemDb, null);
    expect(card).toMatchObject({
      kind: "arcanes",
      slot: "Warframe",
      rarity: "Legendary",
      stats: ["On Energy Pickup:", "+1 Arcane Revive"],
      drain: null,
      polarity: null,
      marketSlug: "arcane_energize",
      uniqueName: ENERGIZE,
    });
    expect(upgradeSources(card, [])).toEqual([{ kind: "vendor", vendor: card.vendors[0] }]);
  });
});

describe("mods on the shared card", () => {
  it("is owned on any copy held, ranked or not, and has no copy count", () => {
    const holdings = ownedModNames(inventory({ Upgrades: [ranked(SERRATION, 0)] }), itemDb);
    const card = buildModCard({ name: "Serration", count: 40, wikiUrl: "w" }, itemDb, holdings);
    expect(card).toMatchObject({
      kind: "mods",
      owned: true,
      copies: null,
      slot: "Rifle",
      drain: { min: 4, max: 14 },
      stats: ["+165% Damage"],
    });
  });

  it("owns nothing off an unread inventory", () => {
    expect(ownedModNames(null, itemDb).size).toBe(0);
    expect(MOD_CATALOG.owns("Serration", itemDb, ownedModNames(null, itemDb))).toBe(false);
  });

  it("builds a card for a pinned name no list carries", () => {
    const card = cardFor(MOD_CATALOG, "Not A Listed Mod", itemDb, new Map());
    expect(card).toMatchObject({ kind: "mods", count: 0, wikiUrl: "", owned: false });
  });

  it("reads a pinned name's count off the shipped list where it is on it", () => {
    const card = cardFor(MOD_CATALOG, "serration", itemDb, new Map());
    expect(card.count).toBeGreaterThan(0);
    expect(card.slot).toBe("Rifle");
  });
});

describe("pinned upgrades", () => {
  it("drops a pin once it is owned, per kind", () => {
    const holdings = new Map([["arcane energize", 21]]);
    const pins = pinnedUpgrades(ARCANE_CATALOG, ["Arcane Energize", "Exodia Might"], itemDb, holdings);
    expect(pins.map((pin) => [pin.kind, pin.name])).toEqual([["arcanes", "Exodia Might"]]);
  });

  it("takes pinned cards out of the band they came from", () => {
    const card = cardFor(ARCANE_CATALOG, "Arcane Energize", itemDb, null);
    const suggestion = { details: { upgrade: card } } as unknown as Suggestion;
    const other = { details: {} } as unknown as Suggestion;
    expect(withoutPinnedUpgrades([suggestion, other], ["Arcane Energize"])).toEqual([other]);
  });
});
