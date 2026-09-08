import { describe, expect, it } from "vitest";

import { resolveDropArt, summarizeDropPool } from "../../../../src/lib/suggest/dropPools.js";
import type { DropRow } from "../../../../config/shared/dropTypes.js";
import type { ItemDbEntry } from "../../../../src/types/inventory.js";

const row = (item: string, place: string, chance: number, rarity = "Uncommon"): DropRow => ({
  kind: "bounty",
  item,
  place,
  rarity,
  chance,
});

// Copied out of drop-data-cache.json.
const SORTIE: DropRow[] = [
  row("Ayatan Anasa Sculpture", "Sortie", 28),
  row("4000 Endo", "Sortie", 12),
  row("6000X Kuva", "Sortie", 12),
  row("Melee Riven Mod", "Sortie", 9.8, "Rare"),
  row("Rifle Riven Mod", "Sortie", 7, "Rare"),
  row("Pistol Riven Mod", "Sortie", 7, "Rare"),
  row("Affinity Booster", "Sortie", 3.27, "Rare"),
  row("Resource Drop Chance Booster", "Sortie", 3.27, "Rare"),
  row("Mod Drop Chance Booster", "Sortie", 3.27, "Rare"),
  row("Forma", "Sortie", 2.5, "Rare"),
  row("Exilus Warframe Adapter", "Sortie", 2.5, "Rare"),
  row("Orokin Reactor Blueprint", "Sortie", 2.5, "Rare"),
  row("Orokin Catalyst Blueprint", "Sortie", 2.5, "Rare"),
  row("Shotgun Riven Mod", "Sortie", 2.2, "Rare"),
  row("Zaw Riven Mod", "Sortie", 1, "Rare"),
  row("Kitgun Riven Mod", "Sortie", 1, "Rare"),
  row("Legendary Core", "Sortie", 0.19, "Legendary"),
];

const NETRACELLS: DropRow[] = [
  row("Entrati Lanthorn", "Entrati Netracell Coffer", 100, "Common"),
  row("Crimson Archon Shard", "Entrati Netracell Coffer (Level 0 - 100)", 17.5),
  row("Azure Archon Shard", "Entrati Netracell Coffer (Level 0 - 100)", 17.5),
  row("Amber Archon Shard", "Entrati Netracell Coffer (Level 0 - 100)", 17.5),
  row("Melee Arcane Adapter", "Entrati Netracell Coffer (Level 0 - 100)", 15),
  row("Melee Crescendo", "Entrati Netracell Coffer (Level 0 - 100)", 10),
  row("Melee Duplicate", "Entrati Netracell Coffer (Level 0 - 100)", 10),
  row("Tauforged Crimson Archon Shard", "Entrati Netracell Coffer (Level 0 - 100)", 4.17, "Rare"),
  row("Tauforged Azure Archon Shard", "Entrati Netracell Coffer (Level 0 - 100)", 4.17, "Rare"),
  row("Tauforged Amber Archon Shard", "Entrati Netracell Coffer (Level 0 - 100)", 4.17, "Rare"),
];

const DEEP_ARCHIMEDEA: DropRow[] = [
  row("Melee Duplicate", "Deep Archimedea Legendary Rewards", 25),
  row("Melee Crescendo", "Deep Archimedea Legendary Rewards", 25),
  row("Crimson Archon Shard", "Deep Archimedea Silver Rewards", 17.5),
  row("Azure Archon Shard", "Deep Archimedea Silver Rewards", 17.5),
  row("Amber Archon Shard", "Deep Archimedea Silver Rewards", 17.5),
  row("Tauforged Crimson Archon Shard", "Deep Archimedea Legendary Rewards", 16.67),
  row("Tauforged Azure Archon Shard", "Deep Archimedea Legendary Rewards", 16.67),
  row("Tauforged Amber Archon Shard", "Deep Archimedea Legendary Rewards", 16.67),
  row("Melee Arcane Adapter", "Deep Archimedea Silver Rewards", 15),
  row("Crimson Archon Shard", "Deep Archimedea Gold Rewards", 13.13),
  row("Azure Archon Shard", "Deep Archimedea Gold Rewards", 13.13),
  row("Amber Archon Shard", "Deep Archimedea Gold Rewards", 13.13),
  row("Tauforged Crimson Archon Shard", "Deep Archimedea Gold Rewards", 8.54, "Rare"),
  row("Tauforged Azure Archon Shard", "Deep Archimedea Gold Rewards", 8.54, "Rare"),
  row("Tauforged Amber Archon Shard", "Deep Archimedea Gold Rewards", 8.54, "Rare"),
];

// Mirrors the shipped rewardValues.json ratings for the names these pools use.
const RATED = new Set(
  [
    "Endo",
    "Kuva",
    "Forma",
    "Orokin Reactor",
    "Orokin Catalyst",
    "Rifle Riven Mod",
    "Shotgun Riven Mod",
    "Zaw Riven Mod",
    "Kitgun Riven Mod",
    "Melee Arcane Adapter",
    "Azure Archon Shard",
    "Amber Archon Shard",
    "Crimson Archon Shard",
    "Tauforged Azure Archon Shard",
    "Tauforged Amber Archon Shard",
    "Tauforged Crimson Archon Shard",
  ].map((name) => name.toLowerCase()),
);

const rated = (name: string): number | null => {
  const normalized = name
    .toLowerCase()
    .replace(/^\d[\d,]*\s*[xk]?\s+/, "")
    .replace(/\s+blueprint$/, "");
  return RATED.has(normalized) ? 1 : null;
};

describe("summarizeDropPool", () => {
  it("names what a sortie pays, unrated fluff dropped", () => {
    const families = summarizeDropPool(SORTIE, rated);
    expect(families.map((f) => f.label)).toEqual(["Endo", "Kuva", "Riven Mods"]);
    expect(families.map((f) => f.members[0].item)).toEqual([
      "4000 Endo",
      "6000X Kuva",
      "Melee Riven Mod",
    ]);
  });

  it("collapses netracell shards into one family", () => {
    const families = summarizeDropPool(NETRACELLS, rated);
    expect(families[0].label).toBe("Archon Shards");
    expect(families[0].chance).toBeCloseTo(65.01, 2);
    expect(families.map((f) => f.label)).not.toContain("Entrati Lanthorn");
  });

  it("carries every shard the coffer can pay, not one of them", () => {
    const family = summarizeDropPool(NETRACELLS, rated)[0];
    expect(family.members.map((member) => member.name)).toEqual([
      "Amber Archon Shard",
      "Azure Archon Shard",
      "Crimson Archon Shard",
      "Tauforged Amber Archon Shard",
      "Tauforged Azure Archon Shard",
      "Tauforged Crimson Archon Shard",
    ]);
  });

  it("pictures a family with one member per variant, plain against tauforged", () => {
    const family = summarizeDropPool(NETRACELLS, rated)[0];
    expect(family.variants.map((member) => member.name)).toEqual([
      "Amber Archon Shard",
      "Tauforged Amber Archon Shard",
    ]);
  });

  it("makes a lone member its own family and its own variant", () => {
    const family = summarizeDropPool(NETRACELLS, rated).find(
      (entry) => entry.label === "Melee Arcane Adapter",
    );
    expect(family?.members).toHaveLength(1);
    expect(family?.variants.map((member) => member.name)).toEqual(["Melee Arcane Adapter"]);
  });

  it("keeps a lone member's own name unpluralised", () => {
    const families = summarizeDropPool(DEEP_ARCHIMEDEA, rated);
    expect(families.map((f) => f.label)).toEqual(["Archon Shards", "Melee Arcane Adapter"]);
  });

  it("counts an item once per pool even when several tables carry it", () => {
    const families = summarizeDropPool(DEEP_ARCHIMEDEA, rated);
    expect(families[0].chance).toBeCloseTo(102.51, 2);
  });

  it("returns nothing when the rating knows none of the pool", () => {
    expect(summarizeDropPool(SORTIE, () => null)).toEqual([]);
    expect(summarizeDropPool([], rated)).toEqual([]);
  });

  it("honours the family limit", () => {
    expect(summarizeDropPool(SORTIE, rated, 1)).toHaveLength(1);
  });
});

describe("resolveDropArt", () => {
  const itemDb: Record<string, ItemDbEntry> = {
    "/Lotus/Types/Items/MiscItems/ArchonShardAmber": {
      name: "Amber Archon Shard",
      imageUrl: "https://cdn/amber.png",
    },
    "/Lotus/Types/Items/MiscItems/Forma": { name: "Forma", imageUrl: "https://cdn/forma.png" },
    "/Lotus/Types/Items/MiscItems/Kuva": { name: "Kuva", imageUrl: "https://cdn/kuva.png" },
    "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare": {
      name: "Rifle Riven Mod",
      category: "Mod",
      imageUrl: "https://mirror/mod-art/RifleRivenMod.webp",
    },
    "/Lotus/Upgrades/Mods/Randomized/LotusModularPistolRandomModRare": {
      name: "Kitgun Riven Mod",
      category: "Mod",
      imageUrl: "https://mirror/mod-art/KitgunRivenMod.webp",
    },
    "/Lotus/Upgrades/Mods/Randomized/RawSentinelWeaponRandomMod": {
      name: "Companion Weapon Riven Mod",
      category: "Mod",
      imageUrl: "https://mirror/mod-art/CompanionWeaponRivenMod.webp",
    },
  };

  it("prefers an exact uniqueName hit", () => {
    expect(
      resolveDropArt(itemDb, "Amber Archon Shard", "/Lotus/Types/Items/MiscItems/ArchonShardAmber"),
    ).toEqual({ imageUrl: "https://cdn/amber.png", name: "Amber Archon Shard" });
  });

  it("falls back to a normalized display-name match", () => {
    expect(resolveDropArt(itemDb, "3X Forma")).toEqual({
      imageUrl: "https://cdn/forma.png",
      name: "Forma",
    });
  });

  it("stands a calendar pack in with something it grants, under the pack's own name", () => {
    expect(
      resolveDropArt(
        itemDb,
        "Calendar Kuva Bundle Small",
        "/Lotus/Types/StoreItems/Packages/Calendar/CalendarKuvaBundleSmall",
      ),
    ).toEqual({ imageUrl: "https://cdn/kuva.png", name: "Calendar Kuva Bundle Small" });
  });

  it("pictures a riven with the veiled card for its own weapon class", () => {
    expect(resolveDropArt(itemDb, "Kitgun Riven Mod")).toEqual({
      imageUrl: "https://mirror/mod-art/KitgunRivenMod.webp",
      name: "Kitgun Riven Mod",
    });
    expect(resolveDropArt(itemDb, "Companion Weapon Riven Mod")?.imageUrl).toContain(
      "CompanionWeaponRivenMod",
    );
  });

  it("pictures a pool that names no weapon class with the rifle card", () => {
    expect(resolveDropArt(itemDb, "Riven Mod")).toEqual({
      imageUrl: "https://mirror/mod-art/RifleRivenMod.webp",
      name: "Riven Mod",
    });
  });

  it("bundles a card for the class no database placed", () => {
    const art = resolveDropArt(itemDb, "Melee Riven Mod");
    expect(art?.name).toBe("Melee Riven Mod");
    expect(art?.imageUrl).toContain("RivenCard");
  });

  it("keeps the riven card off the Rivens view template", () => {
    for (const name of ["Riven Mod", "Melee Riven Mod"]) {
      expect(resolveDropArt(itemDb, name)?.imageUrl).not.toContain("RivenTemplate");
    }
  });

  it("keeps the riven card away from mods that are not rivens", () => {
    expect(resolveDropArt(itemDb, "Riven Sliver")).toBeNull();
    expect(resolveDropArt(itemDb, "Serration")).toBeNull();
  });

  it("returns null when nothing resolves", () => {
    expect(resolveDropArt(itemDb, "Legendary Core")).toBeNull();
    expect(resolveDropArt(itemDb, "Forma", "/Lotus/Types/Nope")).not.toBeNull();
  });
});
