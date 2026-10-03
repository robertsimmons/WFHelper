import { describe, expect, it } from "vitest";

import {
  AYA_PATH,
  RELIC_PACK_POOL,
  STEEL_ESSENCE_PATH,
  bestPackSyndicate,
  relicPacksSummary,
} from "../../../../src/lib/suggest/relicPacks.js";
import type { RawInventoryData } from "../../../../src/types/inventory.js";
import type { RelicDatabase, RelicGroup, RelicReward } from "../../../../src/types/relics.js";
import type { SuggestionContext } from "../../../../src/types/suggest.js";
import type { WorldState } from "../../../../src/types/world.js";

const NOW = Date.parse("2026-10-03T12:00:00Z");
const BEFORE = new Date(NOW - 86_400_000).toISOString();
const AFTER = new Date(NOW + 12 * 86_400_000).toISOString();

function reward(name: string, chance: number): RelicReward {
  return { name, uniqueName: `/${name}`, chance, rarity: "Common", urlName: null, ducats: null };
}

function relic(key: string, rewards: RelicReward[]): RelicGroup {
  const [tier = "", code = ""] = key.split(" ");
  return {
    key,
    name: key,
    tier,
    code,
    imageUrl: null,
    qualities: { intact: { uniqueName: `/Relic/${key}`, rewards } },
  };
}

const partOf = (name: string, parent: string) => ({
  name,
  isBuildComponent: true,
  componentOf: parent,
});

function setOf(parent: string, parts: string[]) {
  return {
    [parent]: {
      name: parent.slice(1),
      masterable: true,
      components: parts.map((part) => ({ name: part, uniqueName: `/${part}`, itemCount: 1 })),
    },
    ...Object.fromEntries(parts.map((part) => [`/${part}`, partOf(part, parent)])),
  };
}

// Volt and Gara owe every part, Nekros only its systems; Mag is built.
const ITEM_DB = {
  ...setOf("/Volt Prime", ["Volt Prime Chassis", "Volt Prime Systems"]),
  ...setOf("/Nekros Prime", ["Nekros Prime Blueprint", "Nekros Prime Systems"]),
  ...setOf("/Gara Prime", ["Gara Prime Chassis", "Gara Prime Systems"]),
  ...setOf("/Mag Prime", ["Mag Prime Chassis"]),
} as unknown as SuggestionContext["itemDb"];

const GROUPS: RelicGroup[] = [
  relic("Axi A7", [reward("Volt Prime Chassis", 76), reward("Volt Prime Systems", 2)]),
  // One part, but it finishes Nekros: worth as much as two.
  relic("Neo N16", [reward("Mag Prime Chassis", 76), reward("Nekros Prime Systems", 2)]),
  relic("Axi B1", [reward("Gara Prime Chassis", 76)]),
  // Held, so its part never counts towards the pack.
  relic("Meso N9", [reward("Gara Prime Systems", 76)]),
  relic("Lith P7", [reward("Mag Prime Chassis", 76)]),
];
const POOL = GROUPS.map((group) => group.key);

function db(): RelicDatabase {
  return {
    groups: Object.fromEntries(GROUPS.map((group) => [group.key, group])),
    byUniqueName: Object.fromEntries(
      GROUPS.map((group) => [`/Relic/${group.key}`, { groupKey: group.key, quality: "intact" }]),
    ) as RelicDatabase["byUniqueName"],
  };
}

function inventory(extra: Record<string, unknown> = {}): RawInventoryData {
  return {
    MiscItems: [
      { ItemType: "/Relic/Meso N9", ItemCount: 2 },
      { ItemType: "/Nekros Prime Blueprint", ItemCount: 1 },
      { ItemType: STEEL_ESSENCE_PATH, ItemCount: 212 },
      { ItemType: AYA_PATH, ItemCount: 4 },
    ],
    Recipes: [],
    Suits: [{ ItemType: "/Mag Prime" }],
    ...extra,
  } as unknown as RawInventoryData;
}

function varzia(keys: string[], activation = BEFORE, expiry = AFTER): WorldState {
  return {
    vaultTrader: {
      activation,
      expiry,
      inventory: [
        ...keys.map((key) => ({ uniqueName: `/Lotus/Types/Game/Projections/${key}`, aya: 1 })),
        { uniqueName: "/Lotus/Types/StoreItems/Packages/SomeBundle", regalAya: 6 },
      ],
    },
  } as unknown as WorldState;
}

/** Varzia's store paths join through byUniqueName like any other relic. */
function dbWithVarzia(): RelicDatabase {
  const base = db();
  for (const group of GROUPS) {
    base.byUniqueName[`/Lotus/Types/Game/Projections/${group.key}`] = {
      groupKey: group.key,
      quality: "intact",
    };
  }
  return base;
}

function summary(
  overrides: Partial<Parameters<typeof relicPacksSummary>[0]> = {},
  pool: readonly string[] = POOL,
) {
  return relicPacksSummary(
    {
      inventory: inventory(),
      itemDb: ITEM_DB,
      mastery: null,
      relicDb: dbWithVarzia(),
      world: null,
      nowMs: NOW,
      ...overrides,
    },
    pool,
  );
}

const names = (rows: readonly { name: string }[]): string[] => rows.map((row) => row.name);

describe("relic pack pool", () => {
  it("ships a pool of unvaulted relics", () => {
    expect(RELIC_PACK_POOL.length).toBeGreaterThan(0);
    expect(RELIC_PACK_POOL.some((name) => name.startsWith("Requiem"))).toBe(false);
  });

  it("counts distinct needed parts only off pool relics none of which are held", () => {
    const result = summary();
    // Volt's two, Nekros Systems, Gara Chassis; Gara Systems sits in a held relic.
    expect(result.poolParts).toBe(4);
  });

  it("lists pool relics that pay something, by parts paid", () => {
    expect(names(summary().pool)).toEqual(["Axi A7", "Neo N16", "Axi B1", "Meso N9"]);
  });

  it("reads balances out of MiscItems, and nothing while no inventory is read", () => {
    const read = summary();
    expect(read.steelEssence).toBe(212);
    expect(read.aya).toBe(4);
    const unread = summary({ inventory: null });
    expect(unread).toMatchObject({ steelEssence: null, aya: null, poolParts: null, pool: [] });
  });
});

describe("best pack syndicate", () => {
  const standing = (rows: Record<string, number>) =>
    inventory({
      Affiliations: Object.entries(rows).map(([Tag, Standing]) => ({ Tag, Standing })),
    });

  it("picks the pack vendor with the most standing, ignoring syndicates that sell none", () => {
    expect(
      bestPackSyndicate(
        standing({ SteelMeridianSyndicate: 84_000, CetusSyndicate: 90_000, ZarimanSyndicate: 1e6 }),
      ),
    ).toEqual({ tag: "CetusSyndicate", name: "Ostron", standing: 90_000 });
  });

  it("still names the best one when none can afford a pack", () => {
    expect(bestPackSyndicate(standing({ SteelMeridianSyndicate: 5_000 }))?.standing).toBe(5_000);
  });

  it("is null with no pack vendor row or no inventory", () => {
    expect(bestPackSyndicate(standing({ ZarimanSyndicate: 50_000 }))).toBeNull();
    expect(bestPackSyndicate(null)).toBeNull();
  });
});

describe("Aya picks", () => {
  it("suggests a relic Varzia sells only if it pays a needed part and none is held", () => {
    const result = summary({ world: varzia(POOL) });
    expect(names(result.ayaPicks)).not.toContain("Meso N9");
    expect(names(result.ayaPicks)).not.toContain("Lith P7");
  });

  it("ranks picks by what they pay, a finishing part worth a second one", () => {
    const result = summary({ world: varzia(POOL) });
    expect(names(result.ayaPicks)).toEqual(["Axi A7", "Neo N16", "Axi B1"]);
    expect(result.ayaPicks[1]?.parts[0]).toMatchObject({
      name: "Nekros Prime Systems",
      status: "needed",
      finishes: true,
    });
  });

  it("lists every relic Varzia sells, payers first, with her price", () => {
    const result = summary({ world: varzia(POOL) });
    expect(names(result.varzia)).toEqual(["Axi A7", "Neo N16", "Axi B1", "Meso N9", "Lith P7"]);
    expect(result.varzia.every((relic) => relic.aya === 1)).toBe(true);
    expect(result.varziaExpiry).toBe(AFTER);
  });

  it("says nothing of her stock while she is away", () => {
    for (const world of [null, varzia(POOL, AFTER, AFTER), varzia(POOL, BEFORE, BEFORE)]) {
      const result = summary({ world });
      expect(result).toMatchObject({ varziaExpiry: null, ayaPicks: [], varzia: [] });
    }
  });
});
