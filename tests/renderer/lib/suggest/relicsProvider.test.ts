import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_OPTIONS, defaultPreferences } from "../../../../src/lib/suggest/preferences.js";
import { RELICS_ACTIVITY, relicsProvider } from "../../../../src/lib/suggest/providers/relics.js";
import { __test__ as priceCache, setCachedPrice } from "../../../../src/lib/wfm/priceCache.js";
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
  it("ranks by the goal, best first, and turns the whole ranking on the arrow", () => {
    priceShelf();
    expect(shelfIds({ relicGoal: "ducats" })).toEqual([
      "relics:Meso A1",
      "relics:Lith C4",
      "relics:Meso B2",
    ]);
    expect(shelfIds({ relicGoal: "platinum" })).toEqual([
      "relics:Meso B2",
      "relics:Lith C4",
      "relics:Meso A1",
    ]);
    expect(shelfIds({ relicGoal: "platinum", relicSortDir: "desc" })).toEqual([
      "relics:Meso A1",
      "relics:Lith C4",
      "relics:Meso B2",
    ]);
  });

  it("leads a recommendation with the mission the player would rather run", () => {
    priceShelf();
    const world = {
      fissures: [
        { tier: "Meso", missionType: "Capture", node: "Bode (Ceres)", expiry: SOON },
        { tier: "Lith", missionType: "Interception", node: "Everest (Earth)", expiry: SOON },
      ],
    } as unknown as WorldState;
    const ctx: SuggestionContext = {
      ...context(world, {}, { relicGoal: "platinum" }),
      relicDb: shelfDb(),
      inventory: shelfInventory([MESO_A, MESO_B, LITH_C]),
    };
    expect(relicsProvider.collect(ctx).map((draft) => draft.id)).toEqual([
      "relics:Meso B2",
      "relics:Meso A1",
      "relics:Lith C4",
    ]);
  });

  it("still turns over on the arrow when nothing is priced and every relic ties", () => {
    priceCache.clearPriceCache();
    const asc = shelfIds({ relicGoal: "platinum" });
    expect(asc).toHaveLength(3);
    expect(shelfIds({ relicGoal: "platinum", relicSortDir: "desc" })).toEqual([...asc].reverse());
  });

  /** NextUpView reads `order` ahead of score, so the sort only reaches the cards
   *  if the provider hands the section its positions in the order it chose. */
  it("hands the section the positions the sort put the relics in", () => {
    priceShelf();
    const ctx: SuggestionContext = {
      ...context(OPEN_TIERS, {}, { relicGoal: "ducats" }),
      relicDb: shelfDb(),
      inventory: shelfInventory([MESO_A, MESO_B, LITH_C]),
    };
    expect(relicsProvider.collect(ctx).map((draft) => [draft.id, draft.order])).toEqual([
      ["relics:Meso A1", 0],
      ["relics:Lith C4", 1],
      ["relics:Meso B2", 2],
    ]);
  });

  it("keeps an unpriced relic on the shelf with no payoff to claim", () => {
    priceShelf();
    const unpriced: Array<[string, string, string, RelicReward]> = [
      ["Meso D5", "Meso", MESO_D, NYX],
    ];
    expect(shelfIds({ relicGoal: "platinum" }, unpriced)).toContain("relics:Meso D5");
  });

  it("says nothing about a payoff nothing prices", () => {
    priceCache.clearPriceCache();
    for (const relicGoal of ["platinum", "ducats"] as const) {
      const ctx: SuggestionContext = {
        ...context(OPEN_TIERS, {}, { relicGoal }),
        relicDb: shelfDb(),
        inventory: shelfInventory([MESO_A]),
      };
      const draft = relicsProvider.collect(ctx)[0];
      if (relicGoal === "platinum") expect(draft?.details?.relic?.payoff).toBeNull();
      expect(draft?.why.split(" - ")).toHaveLength(draft?.details?.relic?.payoff ? 3 : 2);
    }
  });

  it("pages the whole shelf rather than a shortlist, and stops at the guardrail", () => {
    const spare = (count: number): Array<[string, string, string, RelicReward]> =>
      Array.from({ length: count }, (_, index) => [
        `Meso X${index}`,
        "Meso",
        `/Relic/MesoX${index}Intact`,
        NYX,
      ]);
    // Three relics are on the shelf already, so twelve more is fifteen cards.
    expect(shelfIds({}, spare(12))).toHaveLength(15);
    expect(shelfIds({}, spare(45))).toHaveLength(40);
  });
});

const MAG = "/Mag Prime";
const WUKONG = "/Wukong Prime";

function mrReward(name: string, chance: number, rarity: string, ducats: number): RelicReward {
  const urlName = name.toLowerCase().replace(/ /g, "_");
  return { name, uniqueName: `/${name}`, chance, rarity, urlName, ducats };
}

function mrDb(): RelicDatabase {
  const group: RelicGroup = {
    key: "Meso F3",
    name: "Meso F3",
    tier: "Meso",
    code: "F3",
    imageUrl: null,
    qualities: {
      intact: {
        uniqueName: INTACT,
        rewards: [
          mrReward("Mag Prime Chassis", 25.33, "Common", 15),
          mrReward("Wukong Prime Blueprint", 2, "Rare", 100),
        ],
      },
      radiant: {
        uniqueName: RADIANT,
        rewards: [
          mrReward("Mag Prime Chassis", 16.67, "Common", 15),
          mrReward("Wukong Prime Blueprint", 10, "Rare", 100),
        ],
      },
    },
  };
  return {
    groups: { "Meso F3": group },
    byUniqueName: {
      [INTACT]: { groupKey: "Meso F3", quality: "intact" },
      [RADIANT]: { groupKey: "Meso F3", quality: "radiant" },
    },
  };
}

const partOf = (name: string, parent: string) => ({
  name,
  isBuildComponent: true,
  componentOf: parent,
});

// Mag still owes two parts; Wukong's blueprint is the only part it has.
const MR_ITEMS: SuggestionContext["itemDb"] = {
  [MAG]: {
    name: "Mag Prime",
    masterable: true,
    components: [
      { name: "Blueprint", uniqueName: "/Mag Prime Blueprint", itemCount: 1 },
      { name: "Chassis", uniqueName: "/Mag Prime Chassis", itemCount: 1 },
    ],
  },
  "/Mag Prime Blueprint": partOf("Mag Prime Blueprint", MAG),
  "/Mag Prime Chassis": partOf("Mag Prime Chassis", MAG),
  [WUKONG]: {
    name: "Wukong Prime",
    masterable: true,
    components: [{ name: "Blueprint", uniqueName: "/Wukong Prime Blueprint", itemCount: 1 }],
  },
  "/Wukong Prime Blueprint": partOf("Wukong Prime Blueprint", WUKONG),
};

function mrContext(
  options: Partial<SuggestionOptions> = {},
  mastered: string[] = [],
): SuggestionContext {
  database = mrDb();
  return {
    ...context(fissures("Capture"), {}, { relicGoal: "mr", ...options }),
    itemDb: MR_ITEMS,
    mastery: {
      items: mastered.map((uniqueName) => ({ uniqueName, name: uniqueName, status: "mastered" })),
      stats: {},
    } as unknown as SuggestionContext["mastery"],
  };
}

describe("relicsProvider MR goal", () => {
  it("chases the part that finishes a set, at the grade its rarity calls for", () => {
    const draft = relicsProvider.collect(mrContext())[0];
    expect(draft?.reward?.name).toBe("Wukong Prime Blueprint");
    expect(draft?.reward).toMatchObject({ rarity: "rare", ducats: 100 });
    expect(draft?.why).toContain("nextUp.whyRelicMrFinishes(2|Wukong Prime)");
    expect(draft?.fingerprint).toBe(`mr|radiant|Bode (Ceres)|${SOON}|2`);
    expect(draft?.details?.relic).toMatchObject({
      quality: "radiant",
      advice: { mr: "radiant", ducats: "radiant" },
      payoff: "nextUp.whyRelicMrFinishes(2|Wukong Prime)",
      mr: { needed: 2, finishes: ["Wukong Prime"], value: 3 },
    });
  });

  it("lists every drop with its rarity and what the player still owes", () => {
    const pool = relicsProvider.collect(mrContext())[0]?.details?.pool;
    expect(pool).toMatchObject([
      { name: "Mag Prime Chassis", rarity: "common", status: "needed", ducats: 15 },
      { name: "Wukong Prime Blueprint", rarity: "rare", status: "needed", ducats: 100 },
    ]);
  });

  it("offers nothing once every part is mastered", () => {
    expect(relicsProvider.collect(mrContext({}, [MAG, WUKONG]))).toEqual([]);
  });

  it("drops a mastered item's part from the count", () => {
    const draft = relicsProvider.collect(mrContext({}, [WUKONG]))[0];
    expect(draft?.reward?.name).toBe("Mag Prime Chassis");
    expect(draft?.why).toContain("nextUp.whyRelicMr(1)");
    expect(draft?.details?.relic?.advice.mr).toBe("intact");
    // Intact is advised and held, so the card runs it.
    expect(draft?.details?.relic?.quality).toBe("intact");
  });

  it("advises Intact for platinum while holding Radiant, and hands the card its payoff", () => {
    database = mrDb();
    setCachedPrice("wukong_prime_blueprint", 5);
    setCachedPrice("mag_prime_chassis", 30);
    const draft = relicsProvider.collect({
      ...context(fissures("Capture")),
      itemDb: MR_ITEMS,
    })[0];
    expect(draft?.details?.relic).toMatchObject({
      quality: "radiant",
      advice: { platinum: "intact" },
      payoff: expect.stringContaining("nextUp.whyRelicPlat(") as unknown,
    });
    expect(draft?.why).toContain("nextUp.whyRelicPlat(");
  });

  it("names every live fissure of the tier, best first", () => {
    database = mrDb();
    const world = {
      fissures: [
        { tier: "Meso", missionType: "Interception", node: "Ophelia (Uranus)", expiry: SOON },
        { tier: "Meso", missionType: "Capture", node: "Bode (Ceres)", expiry: SOON, isHard: true },
      ],
    } as unknown as WorldState;
    const draft = relicsProvider.collect({ ...mrContext(), world })[0];
    expect(draft?.details?.relic?.missions.map((mission) => mission.missionType)).toEqual([
      "Capture",
      "Interception",
    ]);
    expect(draft?.details?.relic?.missions[0]).toMatchObject({ isHard: true, opinion: "good" });
    expect(draft?.details?.missions).toEqual([
      { name: "Capture", opinion: "good" },
      { name: "Interception", opinion: "bad" },
    ]);
  });
});
