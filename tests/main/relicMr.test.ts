import { describe, expect, it } from "vitest";

import {
  masteredKeys,
  relicAdvice,
  relicMr,
  relicRarity,
  type RelicAdviceReward,
  type RelicMrItem,
} from "../../config/shared/relicMr";

const NEKROS = "/Lotus/Powersuits/Necro/NekrosPrime";
const BLUEPRINT = "/Lotus/Types/Recipes/WarframeRecipes/NekrosPrimeBlueprint";
const CHASSIS = "/Lotus/Types/Recipes/WarframeRecipes/NekrosPrimeChassisBlueprint";
const CHASSIS_BUILT = "/Lotus/Types/Recipes/WarframeRecipes/NekrosPrimeChassisComponent";
const SYSTEMS = "/Lotus/Types/Recipes/WarframeRecipes/NekrosPrimeSystemsBlueprint";
const CELL = "/Lotus/Types/Items/MiscItems/OrokinCell";
const FORMA = "/Lotus/Types/Items/MiscItems/Forma";
const FORMA_BP = "/Lotus/Types/Recipes/Components/FormaBlueprint";

const part = (name: string): RelicMrItem => ({
  name,
  isBuildComponent: true,
  componentOf: NEKROS,
});

const ITEM_DB: Record<string, RelicMrItem> = {
  [NEKROS]: {
    name: "Nekros Prime",
    masterable: true,
    components: [
      { uniqueName: BLUEPRINT, itemCount: 1 },
      { uniqueName: CHASSIS, itemCount: 1 },
      { uniqueName: SYSTEMS, itemCount: 1 },
      { uniqueName: CELL, itemCount: 5 },
    ],
  },
  [BLUEPRINT]: part("Nekros Prime Blueprint"),
  [CHASSIS]: part("Nekros Prime Chassis Blueprint"),
  [SYSTEMS]: part("Nekros Prime Systems Blueprint"),
  [CELL]: { name: "Orokin Cell" },
  [FORMA]: { name: "Forma", components: [{ uniqueName: FORMA_BP }] },
  [FORMA_BP]: { name: "Forma Blueprint", isBuildComponent: true, componentOf: FORMA },
};

const REWARDS = [
  { name: "Nekros Prime Chassis Blueprint", uniqueName: CHASSIS },
  { name: "Nekros Prime Systems Blueprint", uniqueName: SYSTEMS },
  { name: "Forma Blueprint", uniqueName: FORMA_BP },
  { name: "Unknown Part", uniqueName: null },
];

function read(owned: Record<string, number>, mastered: string[] = []) {
  return relicMr({
    rewards: REWARDS,
    itemDb: ITEM_DB,
    ownership: new Map(Object.entries(owned)),
    mastered: new Set(mastered),
  });
}

describe("relicMr", () => {
  it("counts a part needed while neither it nor the built item is held", () => {
    const mr = read({});
    expect(mr.rewards.map((row) => row.status)).toEqual(["needed", "needed", null, null]);
    expect(mr.needed).toBe(2);
    expect(mr.value).toBe(2);
    expect(mr.finishes).toEqual([]);
  });

  it("reads a built component as the part it came from", () => {
    const mr = read({ [CHASSIS_BUILT]: 1 });
    expect(mr.rewards[0]).toMatchObject({ status: "owned", ownedCount: 1 });
    expect(mr.needed).toBe(1);
  });

  it("marks the last missing part as finishing its item and scores it extra", () => {
    const mr = read({ [BLUEPRINT]: 1, [CHASSIS]: 1 });
    expect(mr.rewards[1]).toMatchObject({
      status: "needed",
      finishes: true,
      builds: "Nekros Prime",
    });
    expect(mr.finishes).toEqual(["Nekros Prime"]);
    expect(mr.value).toBe(2);
  });

  it("ignores resources when asking whether a set is finished", () => {
    const mr = read({ [BLUEPRINT]: 1, [SYSTEMS]: 1 });
    expect(mr.rewards[0]?.finishes).toBe(true);
  });

  it("owes nothing for a mastered item, whatever is held", () => {
    const mr = read({}, [NEKROS]);
    expect(mr.rewards[0]?.status).toBe("mastered");
    expect(mr.value).toBe(0);
  });

  it("reads mastery by name where the roster carries no uniqueName", () => {
    expect(read({}, ["nekros prime"]).rewards[0]?.status).toBe("mastered");
  });

  it("calls a part owned once the built item is held", () => {
    const mr = read({ [NEKROS]: 1 });
    expect(mr.rewards[0]).toMatchObject({ status: "owned", ownedCount: 1 });
    expect(mr.needed).toBe(0);
  });

  it("counts a build in the foundry as held", () => {
    const mr = relicMr({
      rewards: REWARDS,
      itemDb: ITEM_DB,
      ownership: new Map(),
      mastered: new Set(),
      pending: new Map([[NEKROS, 1]]),
    });
    expect(mr.rewards[0]?.status).toBe("owned");
  });

  it("counts Forma as a stack, owned only when held", () => {
    expect(read({}).rewards[2]).toMatchObject({ status: null, ownedCount: 0 });
    expect(read({ [FORMA_BP]: 3 }).rewards[2]).toMatchObject({ status: "owned", ownedCount: 3 });
  });

  it("reads a main blueprint that joined by name to its item as that item's part", () => {
    const readMain = (owned: Record<string, number>, mastered: string[] = []) =>
      relicMr({
        rewards: [{ name: "Nekros Prime Blueprint", uniqueName: NEKROS }],
        itemDb: ITEM_DB,
        ownership: new Map(Object.entries(owned)),
        mastered: new Set(mastered),
      }).rewards[0];
    expect(readMain({})).toMatchObject({
      status: "needed",
      builds: "Nekros Prime",
      finishes: false,
    });
    expect(readMain({ [CHASSIS]: 1, [SYSTEMS]: 1 })).toMatchObject({
      status: "needed",
      finishes: true,
    });
    expect(readMain({ [BLUEPRINT]: 1 })).toMatchObject({ status: "owned", ownedCount: 1 });
    expect(readMain({ [NEKROS]: 1 })?.status).toBe("owned");
    expect(readMain({}, [NEKROS])?.status).toBe("mastered");
  });

  it("reads the main blueprint by its own key as a part", () => {
    const mr = relicMr({
      rewards: [{ name: "Nekros Prime Blueprint", uniqueName: BLUEPRINT }],
      itemDb: ITEM_DB,
      ownership: new Map(),
      mastered: new Set(),
    });
    expect(mr.rewards[0]).toMatchObject({ status: "needed", builds: "Nekros Prime" });
  });

  it("leaves a reward the item database cannot place without a status", () => {
    expect(read({}).rewards[3]).toMatchObject({ status: null, ownedCount: null, builds: null });
  });
});

describe("masteredKeys", () => {
  it("keeps only finished items, by uniqueName and lowercased name", () => {
    const keys = masteredKeys([
      { uniqueName: NEKROS, name: "Nekros Prime", status: "mastered" },
      { uniqueName: "/Other", name: "Other", status: "progress" },
    ]);
    expect([...keys].sort()).toEqual([NEKROS, "nekros prime"]);
  });
});

describe("relicRarity", () => {
  it("reads rarity off the refinement's own chance bands", () => {
    expect(relicRarity("intact", { chance: 25.33 })).toBe("common");
    expect(relicRarity("intact", { chance: 11 })).toBe("uncommon");
    expect(relicRarity("radiant", { chance: 10 })).toBe("rare");
  });

  it("falls back on the shipped label when the chance fits no band", () => {
    expect(relicRarity("intact", { chance: 50, rarity: "Rare" })).toBe("rare");
    expect(relicRarity("intact", { chance: 50 })).toBeNull();
  });
});

const row = (overrides: Partial<RelicAdviceReward>): RelicAdviceReward => ({
  rarity: "common",
  platinum: null,
  ducats: null,
  status: null,
  ...overrides,
});

describe("relicAdvice", () => {
  it("advises MR by the rarest needed part", () => {
    expect(relicAdvice([row({ status: "needed" })]).mr).toBe("intact");
    const mixed = [row({ status: "needed" }), row({ rarity: "uncommon", status: "needed" })];
    expect(relicAdvice(mixed).mr).toBe("flawless");
    expect(relicAdvice([row({ rarity: "rare", status: "needed" })]).mr).toBe("radiant");
    expect(relicAdvice([row({ rarity: "rare", status: "owned" })]).mr).toBeNull();
  });

  it("goes Radiant for platinum only when the rare is the most valuable drop", () => {
    expect(
      relicAdvice([row({ platinum: 10 }), row({ rarity: "rare", platinum: 60 })]).platinum,
    ).toBe("radiant");
    expect(
      relicAdvice([row({ platinum: 70 }), row({ rarity: "rare", platinum: 60 })]).platinum,
    ).toBe("intact");
    expect(relicAdvice([row({ platinum: 5 }), row({ rarity: "rare" })]).platinum).toBe("intact");
  });

  it("goes Radiant for ducats only on a 100-ducat rare", () => {
    expect(relicAdvice([row({ rarity: "rare", ducats: 100 })]).ducats).toBe("radiant");
    expect(relicAdvice([row({ rarity: "rare", ducats: 65 })]).ducats).toBe("intact");
  });
});
