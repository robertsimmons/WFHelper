import { afterEach, describe, expect, it } from "vitest";

import { defaultPreferences } from "../../../../src/lib/suggest/preferences.js";
import {
  RELICS_ACTIVITY,
  relicGoalKey,
  relicsProvider,
} from "../../../../src/lib/suggest/providers/relics.js";
import { setCachedPrice } from "../../../../src/lib/wfm/priceCache.js";
import { relicDb } from "../../../../src/stores/relics.js";
import type { Translator } from "../../../../src/lib/i18n.js";
import type { TrackerState } from "../../../../src/lib/world/dailies.js";
import type { RawInventoryData } from "../../../../src/types/inventory.js";
import type { RelicDatabase, RelicReward } from "../../../../src/types/relics.js";
import type {
  ActivityPref,
  SuggestionContext,
  SuggestionDraft,
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

function context(
  world: WorldState | null,
  activities: Record<string, ActivityPref> = {},
): SuggestionContext {
  return {
    world,
    inventory: inventory(),
    itemDb: {},
    inventoryModifiedAt: null,
    tracker: tracker(),
    prefs: { ...defaultPreferences(), activities },
    dropPools: {},
    nowMs: NOW,
    t,
  };
}

function only(world: WorldState | null, activities: Record<string, ActivityPref> = {}) {
  return relicsProvider.collect(context(world, activities))[0] as SuggestionDraft | undefined;
}

afterEach(() => relicDb.set(null));

describe("relicsProvider", () => {
  it("says nothing while no fissure matches a relic the player holds", () => {
    relicDb.set(db());
    expect(relicsProvider.collect(context(fissures("Capture", "Axi")))).toEqual([]);
    expect(relicsProvider.collect(context(null))).toEqual([]);
  });

  it("runs the best grade held when the goal is platinum", () => {
    relicDb.set(db());
    const draft = only(fissures("Capture"));
    expect(draft?.id).toBe("relics:Meso F3");
    expect(draft?.why).toContain("relics.quality.radiant");
    expect(draft?.details?.missions).toEqual([{ name: "Capture", opinion: "good" }]);
  });

  it("runs the cheapest grade held when the goal is ducats", () => {
    relicDb.set(db());
    const draft = only(fissures("Capture"), { [relicGoalKey("platinum")]: "never" });
    expect(draft?.why).toContain("relics.quality.intact");
    expect(draft?.fingerprint).toContain("ducats|intact");
  });

  it("values a run off the price cache when the goal is platinum", () => {
    relicDb.set(db());
    setCachedPrice("wukong_prime_blueprint", 100);
    setCachedPrice("mag_prime_chassis", 5);
    const priced = only(fissures("Capture"));
    expect(priced?.signals.value).toBeCloseTo((0.2 * 100 + 0.6 * 5) / 40, 5);
  });

  it("prefers a fissure the player likes and charges for one they do not", () => {
    relicDb.set(db());
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
    relicDb.set(db());
    expect(only(fissures("Capture"), { [RELICS_ACTIVITY]: "low" })?.deprioritized).toBe(true);
    expect(
      relicsProvider.collect(context(fissures("Capture"), { [RELICS_ACTIVITY]: "never" })),
    ).toEqual([]);
  });
});
