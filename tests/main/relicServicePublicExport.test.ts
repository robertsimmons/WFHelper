import { beforeAll, describe, expect, it, vi } from "vitest";

const NEW_INTACT = "/Lotus/Types/Game/Projections/T2VoidProjectionTestPrimeABronze";
const NEW_RADIANT = "/Lotus/Types/Game/Projections/T2VoidProjectionTestPrimeAPlatinum";
const KNOWN = "/Lotus/Types/Game/Projections/T1VoidProjectionCalibanPrimeBBronze";

function relic(uniqueName: string, name: string, rewards: [string, string][]) {
  return {
    uniqueName,
    name,
    relicRewards: rewards.map(([rewardName, rarity]) => ({
      rewardName,
      rarity,
      tier: 0,
      itemCount: 1,
    })),
  };
}

const REWARDS: [string, string][] = [
  ["/Lotus/StoreItems/Types/Recipes/Weapons/KompressaPrimeBlueprint", "RARE"],
  ["/Lotus/StoreItems/Types/Recipes/Weapons/WeaponParts/TestPrimeReceiver", "COMMON"],
];

vi.mock("../../services/publicExportSource", () => ({
  getOverlay: () => ({
    exports: {
      ExportRelicArcane: {
        [NEW_INTACT]: relic(NEW_INTACT, "Meso Z99 Relic", REWARDS),
        [NEW_RADIANT]: relic(NEW_RADIANT, "Meso Z99 Relic", REWARDS),
        [KNOWN]: relic(KNOWN, "Lith C14 Relic", [["/Lotus/StoreItems/Types/Bogus/Part", "RARE"]]),
        "/Lotus/Upgrades/CosmeticEnhancers/Test": { name: "Arcane Test" },
      },
    },
    images: null,
  }),
}));

import * as itemDatabase from "../../services/itemDatabase";
import { getRelicDatabase } from "../../services/relicService";

describe("relic database fill from DE's public export", () => {
  beforeAll(() => {
    itemDatabase.buildDatabase();
  });

  it("adds a relic the bundled package does not know yet, per refinement", () => {
    const db = getRelicDatabase();
    expect(db.byUniqueName[NEW_INTACT]).toEqual({ groupKey: "Meso Z99", quality: "intact" });
    expect(db.byUniqueName[NEW_RADIANT]).toEqual({ groupKey: "Meso Z99", quality: "radiant" });

    const group = db.groups["Meso Z99"];
    expect(group).toMatchObject({ tier: "Meso", code: "Z99" });
    const intact = group?.qualities.intact?.rewards ?? [];
    expect(
      intact.map((reward) => [reward.name, reward.uniqueName, reward.chance, reward.rarity]),
    ).toEqual([
      [
        "Kompressa Prime Blueprint",
        "/Lotus/Types/Recipes/Weapons/KompressaPrimeBlueprint",
        2,
        "Rare",
      ],
      [
        "Test Prime Receiver",
        "/Lotus/Types/Recipes/Weapons/WeaponParts/TestPrimeReceiver",
        25.33,
        "Common",
      ],
    ]);
    expect(group?.qualities.radiant?.rewards.map((reward) => reward.chance)).toEqual([10, 16.67]);
  });

  it("keeps the package's table for a relic it already knows", () => {
    const db = getRelicDatabase();
    const key = db.byUniqueName[KNOWN]?.groupKey ?? "";
    const names = (db.groups[key]?.qualities.intact?.rewards ?? []).map((reward) => reward.name);
    expect(names.length).toBeGreaterThan(0);
    expect(names.some((name) => /Bogus|Part$/.test(name))).toBe(false);
  });
});
