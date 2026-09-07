import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_OPTIONS, defaultPreferences } from "../../../../src/lib/suggest/preferences.js";
import { RELICS_ACTIVITY, relicsProvider } from "../../../../src/lib/suggest/providers/relics.js";
import { setCachedPrice } from "../../../../src/lib/wfm/priceCache.js";
import { relicDb } from "../../../../src/stores/relics.js";
import type { Translator } from "../../../../src/lib/i18n.js";
import type { TrackerState } from "../../../../src/lib/world/dailies.js";
import type { RawInventoryData } from "../../../../src/types/inventory.js";
import type { RelicDatabase, RelicGroup, RelicReward } from "../../../../src/types/relics.js";
import type {
  ActivityPref,
  SuggestionContext,
  SuggestionDraft,
  SuggestionOptions,
} from "../../../../src/types/suggest.js";
import type { WorldState } from "../../../../src/types/world.js";

const NOW = Date.parse("2026-09-05T12:00:00Z");
const SOON = new Date(NOW + 90 * 60_000).toISOString();
// The why line is assembled from interpolations, so the stub keeps them.
const t = ((key: string, params?: Record<string, string>) =>
  params ? `${key}(${Object.values(params).join("|")})` : key) as unknown as Translator;

const INTACT = "/Relic/MesoF3Intact";
const RADIANT = "/Relic/MesoF3Radiant";

function reward(name: string, chance: number, ducats: number, urlName: string): RelicReward {
  return { name, uniqueName: `/${name}`, chance, rarity: "Common", urlName, ducats };
}

const COMMON = reward("Mag Prime Chassis", 76, 15, "mag_prime_chassis");
const RARE = reward("Wukong Prime Blueprint", 2, 65, "wukong_prime_blueprint");
const RADIANT_COMMON = reward("Mag Prime Chassis", 60, 15, "mag_prime_chassis");
const RADIANT_RARE = reward("Wukong Prime Blueprint", 20, 65, "wukong_prime_blueprint");

function db(): RelicDatabase {
  return {
    groups: {
      "Meso F3": {
        key: "Meso F3",
        name: "Meso F3",
        tier: "Meso",
        code: "F3",
        imageUrl: null,
        qualities: {
          intact: { uniqueName: INTACT, rewards: [COMMON, RARE] },
          radiant: { uniqueName: RADIANT, rewards: [RADIANT_COMMON, RADIANT_RARE] },
        },
      },
    },
    byUniqueName: {
      [INTACT]: { groupKey: "Meso F3", quality: "intact" },
      [RADIANT]: { groupKey: "Meso F3", quality: "radiant" },
    },
  };
}

function inventory(): RawInventoryData {
  return {
    MiscItems: [
      { ItemType: INTACT, ItemCount: 4 },
      { ItemType: RADIANT, ItemCount: 2 },
    ],
  };
}

function fissures(missionType: string, tier = "Meso"): WorldState {
  return {
    fissures: [{ tier, missionType, node: "Bode (Ceres)", expiry: SOON, isHard: false }],
  } as unknown as WorldState;
}

function tracker(): TrackerState {
  return { progress: {}, hidden: [], periods: {}, custom: [], seq: 0 };
}

let database: RelicDatabase | null = null;

function loadDb(): void {
  database = db();
}

function context(
  world: WorldState | null,
  activities: Record<string, ActivityPref> = {},
  options: Partial<SuggestionOptions> = {},
): SuggestionContext {
  return {
    world,
    inventory: inventory(),
    itemDb: {},
    inventoryModifiedAt: null,
    mastery: null,
    relicDb: database,
    plat: null,
    tracker: tracker(),
    prefs: { ...defaultPreferences(), activities, options: { ...DEFAULT_OPTIONS, ...options } },
    dropPools: {},
    nowMs: NOW,
    t,
  };
}

function only(
  world: WorldState | null,
  activities: Record<string, ActivityPref> = {},
  options: Partial<SuggestionOptions> = {},
) {
  return relicsProvider.collect(context(world, activities, options))[0] as
    | SuggestionDraft
    | undefined;
}

afterEach(() => {
  database = null;
  relicDb.set(null);
});

describe("relicsProvider", () => {
  it("takes its relic database from the context, not the store behind it", () => {
    relicDb.set(db());
    expect(relicsProvider.collect(context(fissures("Capture")))).toEqual([]);
    loadDb();
    expect(only(fissures("Capture"))?.id).toBe("relics:Meso F3");
  });

  it("says nothing while no fissure matches a relic the player holds", () => {
    loadDb();
    expect(relicsProvider.collect(context(fissures("Capture", "Axi")))).toEqual([]);
    expect(relicsProvider.collect(context(null))).toEqual([]);
  });

  it("runs the best grade held when the goal is platinum", () => {
    loadDb();
    const draft = only(fissures("Capture"));
    expect(draft?.id).toBe("relics:Meso F3");
    expect(draft?.why).toContain("relics.quality.radiant");
    expect(draft?.details?.missions).toEqual([{ name: "Capture", opinion: "good" }]);
  });

  it("runs the cheapest grade held when the goal is ducats", () => {
    loadDb();
    const draft = only(fissures("Capture"), {}, { relicGoal: "ducats" });
    expect(draft?.why).toContain("relics.quality.intact");
    expect(draft?.fingerprint).toContain("ducats|intact");
  });

  it("values a run off the price cache when the goal is platinum", () => {
    loadDb();
    setCachedPrice("wukong_prime_blueprint", 100);
    setCachedPrice("mag_prime_chassis", 5);
    const priced = only(fissures("Capture"));
    expect(priced?.signals.value).toBeCloseTo((0.2 * 100 + 0.6 * 5) / 40, 5);
  });

  it("prefers a fissure the player likes and charges for one they do not", () => {
    loadDb();
    const world = {
      fissures: [
        { tier: "Meso", missionType: "Interception", node: "Ophelia (Uranus)", expiry: SOON },
        { tier: "Meso", missionType: "Capture", node: "Bode (Ceres)", expiry: SOON },
      ],
    } as unknown as WorldState;
    expect(only(world)?.why).toContain("Bode (Ceres)");

    const slow = only(fissures("Interception"));
    expect(slow?.details?.missions).toEqual([{ name: "Interception", opinion: "bad" }]);
    expect(slow?.signals.effort).toBeGreaterThan(only(fissures("Capture"))?.signals.effort ?? 0);
  });

  it("keeps a turned-down domain below everything else rather than dropping it", () => {
    loadDb();
    expect(only(fissures("Capture"), { [RELICS_ACTIVITY]: "low" })?.deprioritized).toBe(true);
    expect(
      relicsProvider.collect(context(fissures("Capture"), { [RELICS_ACTIVITY]: "never" })),
    ).toEqual([]);
  });
});

const MESO_A = "/Relic/MesoA1Intact";
const MESO_B = "/Relic/MesoB2Intact";
const LITH_C = "/Relic/LithC4Intact";
const MESO_D = "/Relic/MesoD5Intact";

function shelf(name: string, tier: string, uniqueName: string, drop: RelicReward): RelicGroup {
  return {
    key: name,
    name,
    tier,
    code: name.slice(-2),
    imageUrl: null,
    qualities: { intact: { uniqueName, rewards: [drop] } },
  };
}

// One drop each at the same chance, so a relic's order is its drop's worth.
const ASH = reward("Ash Prime Systems", 25, 100, "ash_prime_systems");
const BRATON = reward("Braton Prime Blueprint", 25, 15, "braton_prime_blueprint");
const FROST = reward("Frost Prime Blueprint", 25, 45, "frost_prime_blueprint");
const NYX = reward("Nyx Prime Blueprint", 25, 30, "nyx_prime_blueprint");

const SHELF: Array<[string, string, string, RelicReward]> = [
  ["Meso A1", "Meso", MESO_A, ASH],
  ["Meso B2", "Meso", MESO_B, BRATON],
  ["Lith C4", "Lith", LITH_C, FROST],
];

function shelfDb(extra: Array<[string, string, string, RelicReward]> = []): RelicDatabase {
  const groups: Record<string, RelicGroup> = {};
  const byUniqueName: RelicDatabase["byUniqueName"] = {};
  for (const [name, tier, uniqueName, drop] of [...SHELF, ...extra]) {
    groups[name] = shelf(name, tier, uniqueName, drop);
    byUniqueName[uniqueName] = { groupKey: name, quality: "intact" };
  }
  return { groups, byUniqueName };
}

function shelfInventory(uniqueNames: readonly string[]): RawInventoryData {
  return { MiscItems: uniqueNames.map((ItemType) => ({ ItemType, ItemCount: 3 })) };
}

const OPEN_TIERS = {
  fissures: [
    { tier: "Meso", missionType: "Capture", node: "Bode (Ceres)", expiry: SOON, isHard: false },
    { tier: "Lith", missionType: "Capture", node: "Everest (Earth)", expiry: SOON, isHard: false },
  ],
} as unknown as WorldState;

function shelfIds(
  options: Partial<SuggestionOptions>,
  extra: Array<[string, string, string, RelicReward]> = [],
): string[] {
  const held = [MESO_A, MESO_B, LITH_C, ...extra.map(([, , uniqueName]) => uniqueName)];
  const ctx: SuggestionContext = {
    ...context(OPEN_TIERS, {}, options),
    relicDb: shelfDb(extra),
    inventory: shelfInventory(held),
  };
  return relicsProvider.collect(ctx).map((draft) => draft.id);
}

function priceShelf(): void {
  setCachedPrice("ash_prime_systems", 5);
  setCachedPrice("braton_prime_blueprint", 90);
  setCachedPrice("frost_prime_blueprint", 50);
}

describe("relicsProvider era filter", () => {
  it("drops every relic of an era the player has unticked", () => {
    expect(shelfIds({ relicEras: ["Lith", "Neo", "Axi", "Requiem"] })).toEqual(["relics:Lith C4"]);
    expect(shelfIds({ relicEras: ["Meso"] }).sort()).toEqual(["relics:Meso A1", "relics:Meso B2"]);
  });

  it("reads no era at all as every era", () => {
    expect(shelfIds({ relicEras: [] })).toHaveLength(3);
  });

  it("leaves a tier the boxes cannot name alone", () => {
    const VANGUARD = "/Relic/VanguardV1Intact";
    const world = {
      fissures: [
        { tier: "Lith", missionType: "Capture", node: "Everest (Earth)", expiry: SOON },
        { tier: "Vanguard", missionType: "Capture", node: "Kappa (Sedna)", expiry: SOON },
      ],
    } as unknown as WorldState;
    const ctx: SuggestionContext = {
      ...context(world, {}, { relicEras: ["Lith"] }),
      relicDb: shelfDb([["Vanguard V1", "Vanguard", VANGUARD, NYX]]),
      inventory: shelfInventory([MESO_A, MESO_B, LITH_C, VANGUARD]),
    };
    expect(
      relicsProvider
        .collect(ctx)
        .map((draft) => draft.id)
        .sort(),
    ).toEqual(["relics:Lith C4", "relics:Vanguard V1"]);
  });
});

describe("relicsProvider sort", () => {
  it("leads with the fattest platinum run and flips on the arrow", () => {
    priceShelf();
    const sort = { relicSort: "platinum", relicGoal: "ducats" } as const;
    expect(shelfIds(sort)).toEqual(["relics:Meso B2", "relics:Lith C4", "relics:Meso A1"]);
    expect(shelfIds({ ...sort, relicSortDir: "desc" })).toEqual([
      "relics:Meso A1",
      "relics:Lith C4",
      "relics:Meso B2",
    ]);
  });

  it("leads with the fattest ducat run when the sort asks for ducats", () => {
    priceShelf();
    const sort = { relicSort: "ducats", relicGoal: "platinum" } as const;
    expect(shelfIds(sort)).toEqual(["relics:Meso A1", "relics:Lith C4", "relics:Meso B2"]);
    expect(shelfIds({ ...sort, relicSortDir: "desc" })).toEqual([
      "relics:Meso B2",
      "relics:Lith C4",
      "relics:Meso A1",
    ]);
  });

  it("keeps the engine's own ranking under recommended, which the goal drives", () => {
    priceShelf();
    expect(shelfIds({ relicSort: "recommended", relicGoal: "ducats" })).toEqual([
      "relics:Meso A1",
      "relics:Lith C4",
      "relics:Meso B2",
    ]);
    expect(shelfIds({ relicSort: "recommended", relicGoal: "platinum" })).toEqual([
      "relics:Meso B2",
      "relics:Lith C4",
      "relics:Meso A1",
    ]);
  });

  it("still turns over on the arrow when nothing is priced and every relic ties", () => {
    const asc = shelfIds({ relicSort: "platinum" });
    expect(asc).toHaveLength(3);
    expect(shelfIds({ relicSort: "platinum", relicSortDir: "desc" })).toEqual([...asc].reverse());
  });

  it("never leads with an unpriced relic, whichever way the arrow points", () => {
    priceShelf();
    const unpriced: Array<[string, string, string, RelicReward]> = [
      ["Meso D5", "Meso", MESO_D, NYX],
    ];
    expect(shelfIds({ relicSort: "platinum" }, unpriced)).not.toContain("relics:Meso D5");
    expect(shelfIds({ relicSort: "platinum", relicSortDir: "desc" }, unpriced)).not.toContain(
      "relics:Meso D5",
    );
  });
});
