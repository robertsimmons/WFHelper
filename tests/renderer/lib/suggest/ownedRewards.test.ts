import { describe, expect, it } from "vitest";

import { compactCount, ownedRewardFor, ownsAny } from "../../../../src/lib/suggest/ownedRewards.js";
import type { ItemDbEntry } from "../../../../src/types/inventory.js";

const FORMA = "/Lotus/Types/Recipes/Components/FormaBlueprint";
const SHARD = "/Lotus/Types/Gameplay/NarmerSorties/ArchonCrystalRed";
const ADAPTER = "/Lotus/Types/Recipes/Components/MeleeIncarnonAdapterBlueprint";
const ADAPTER_BUILT = "/Lotus/Types/Items/MiscItems/MeleeIncarnonAdapter";
const PACK = "/Lotus/Types/BoosterPacks/CalendarPack";

const ITEM_DB = {
  [FORMA]: { name: "Forma Blueprint" },
  [SHARD]: { name: "Crimson Archon Shard" },
  [ADAPTER]: { name: "Melee Incarnon Adapter Blueprint", buildsProduct: ADAPTER_BUILT },
  [PACK]: { name: "Calendar Pack" },
} as unknown as Record<string, ItemDbEntry>;

const OWNERSHIP = new Map([
  [FORMA, 12],
  [SHARD, 3],
  [ADAPTER, 2],
  [ADAPTER_BUILT, 1],
]);

describe("ownedRewardFor", () => {
  it("counts a reward the world state named by uniqueName", () => {
    expect(
      ownedRewardFor({ name: "Crimson Archon Shard", uniqueName: SHARD }, ITEM_DB, OWNERSHIP),
    ).toEqual({ owned: 3 });
  });

  it("counts a reward the drop pool named only in words", () => {
    expect(ownedRewardFor({ name: "Forma Blueprint" }, ITEM_DB, OWNERSHIP)).toEqual({ owned: 12 });
  });

  it("splits a blueprint from the copies already built", () => {
    expect(
      ownedRewardFor({ name: "Melee Incarnon Adapter Blueprint" }, ITEM_DB, OWNERSHIP),
    ).toEqual({ owned: 2, built: 1 });
  });

  it("reports nothing owned rather than nothing at all", () => {
    expect(ownedRewardFor({ name: "Forma Blueprint" }, ITEM_DB, new Map([[SHARD, 1]]))).toEqual({
      owned: 0,
    });
  });

  it("reports the builds the foundry is running for it", () => {
    expect(
      ownedRewardFor(
        { name: "Melee Incarnon Adapter Blueprint" },
        ITEM_DB,
        OWNERSHIP,
        new Map([[ADAPTER, 2]]),
      ),
    ).toEqual({ owned: 2, built: 1, pending: 2 });
  });

  it("counts a build for a reward the drop pool named only in words", () => {
    expect(
      ownedRewardFor({ name: "Forma Blueprint" }, ITEM_DB, OWNERSHIP, new Map([[FORMA, 1]])),
    ).toEqual({ owned: 12, pending: 1 });
  });

  it("leaves the foundry count off when nothing is building", () => {
    expect(
      ownedRewardFor({ name: "Forma Blueprint" }, ITEM_DB, OWNERSHIP, new Map([[ADAPTER, 3]])),
    ).toEqual({ owned: 12 });
  });

  it("says nothing for a name no item answers to", () => {
    expect(ownedRewardFor({ name: "Riven Sliver" }, ITEM_DB, OWNERSHIP)).toBeNull();
  });

  it("says nothing for a pack, which is counted by what it grants", () => {
    expect(
      ownedRewardFor({ name: "Calendar Pack", uniqueName: PACK }, ITEM_DB, OWNERSHIP),
    ).toBeNull();
  });

  it("says nothing before an inventory has been read", () => {
    expect(ownedRewardFor({ name: "Forma Blueprint" }, ITEM_DB, new Map())).toBeNull();
    expect(ownedRewardFor(null, ITEM_DB, OWNERSHIP)).toBeNull();
  });
});

describe("ownsAny", () => {
  it("counts a copy already built as one the player has", () => {
    expect(ownsAny({ owned: 0, built: 1 })).toBe(true);
    expect(ownsAny({ owned: 2 })).toBe(true);
  });

  it("counts a copy the foundry is building, whose blueprint owned no longer holds", () => {
    expect(ownsAny({ owned: 0, pending: 1 })).toBe(true);
  });

  it("says no only for a count that was actually read as zero", () => {
    expect(ownsAny({ owned: 0 })).toBe(false);
    expect(ownsAny({ owned: 0, built: 0 })).toBe(false);
    expect(ownsAny(null)).toBe(false);
    expect(ownsAny(undefined)).toBe(false);
  });
});

describe("compactCount", () => {
  it("keeps a real count whole and shortens the rest to four characters", () => {
    expect(compactCount(0)).toBe("0");
    expect(compactCount(9999)).toBe("9999");
    expect(compactCount(10_000)).toBe("10k");
    expect(compactCount(2_500_000)).toBe("2M");
  });
});
