import { describe, expect, it } from "vitest";

import { attachPartMasteryFlags, buildPartMasteryResolver } from "../../../src/lib/parentMastery";
import type { ItemDbEntry, MasteryData } from "../../../src/types/inventory";

const itemDb = {
  "/W/BratonPrime": {
    name: "Braton Prime",
    components: [{ name: "Barrel", uniqueName: "/W/BratonPrimeBarrel", itemCount: 1 }],
  },
  "/W/BratonPrimeBarrel": {
    name: "Braton Prime Barrel",
    isBuildComponent: true,
    componentOf: "/W/BratonPrime",
  },
  "/W/SomaPrime": {
    name: "Soma Prime",
    components: [{ name: "Stock", uniqueName: "/W/SomaPrimeStock", itemCount: 2 }],
  },
  "/W/SomaPrimeStock": {
    name: "Soma Prime Stock",
    isBuildComponent: true,
    componentOf: "/W/SomaPrime",
  },
  "/W/AnkyrosPrime": {
    name: "Ankyros Prime",
    components: [{ name: "Gauntlet", uniqueName: "/W/AnkyrosPrimeGauntlet", itemCount: 2 }],
  },
  "/W/AnkyrosPrimeGauntlet": {
    name: "Ankyros Prime Gauntlet",
    isBuildComponent: true,
    componentOf: "/W/AnkyrosPrime",
  },
} as unknown as Record<string, ItemDbEntry>;

const mastery = {
  items: [
    { name: "Braton Prime", uniqueName: "/W/BratonPrime", status: "mastered" },
    { name: "Soma Prime", uniqueName: "/W/SomaPrime", status: "progress" },
    { name: "Ankyros Prime", uniqueName: "/W/AnkyrosPrime", status: "missing" },
  ],
} as unknown as MasteryData;

// Soma Prime is built and levelling; Braton Prime was mastered and sold.
const resolve = buildPartMasteryResolver(itemDb, mastery, {
  LongGuns: [{ ItemType: "/W/SomaPrime", XP: 1000 }],
});

describe("buildPartMasteryResolver", () => {
  it("marks a part of a mastered item yes and of an unmastered item no", () => {
    expect(
      resolve({ name: "Braton Prime Barrel", internalName: "/W/BratonPrimeBarrel" }).parentMastered,
    ).toBe(true);
    expect(
      resolve({ name: "Soma Prime Stock", internalName: "/W/SomaPrimeStock" }).parentMastered,
    ).toBe(false);
  });

  it("resolves blueprint-suffixed inventory keys through the alias", () => {
    expect(
      resolve({ name: "Soma Prime Stock", internalName: "/W/SomaPrimeStockBlueprint" })
        .parentMastered,
    ).toBe(false);
  });

  it("falls back to the display name when the key is unknown", () => {
    expect(
      resolve({ name: "Braton Prime Barrel", internalName: "/Unknown/Key" }).parentMastered,
    ).toBe(true);
  });

  it("resolves set rows through the base item", () => {
    expect(resolve({ name: "Braton Prime Set" }).parentMastered).toBe(true);
    expect(resolve({ name: "Soma Prime Set" }).parentMastered).toBe(false);
  });

  it("resolves a masterable row through itself", () => {
    expect(resolve({ name: "Soma Prime", internalName: "/W/SomaPrime" }).parentMastered).toBe(
      false,
    );
  });

  it("returns nothing for rows nothing masterable needs", () => {
    expect(resolve({ name: "Forma" })).toEqual({});
  });

  it("returns nothing without mastery data", () => {
    const cold = buildPartMasteryResolver(itemDb, null);
    expect(cold({ name: "Braton Prime Barrel", internalName: "/W/BratonPrimeBarrel" })).toEqual({});
  });
});

describe("spares", () => {
  it("counts everything above the recipe as spare while the owner is missing", () => {
    const row = { name: "Ankyros Prime Gauntlet", internalName: "/W/AnkyrosPrimeGauntlet" };
    expect(resolve({ ...row, amount: 2 }).spare).toBe(false);
    expect(resolve({ ...row, amount: 3 }).spare).toBe(true);
  });

  it("treats every copy as spare once the owner is built or mastered", () => {
    expect(
      resolve({ name: "Soma Prime Stock", internalName: "/W/SomaPrimeStock", amount: 1 }).spare,
    ).toBe(true);
    expect(
      resolve({ name: "Braton Prime Barrel", internalName: "/W/BratonPrimeBarrel", amount: 1 })
        .spare,
    ).toBe(true);
  });

  it("leaves spare unset without an amount or a resolvable part", () => {
    expect(
      resolve({ name: "Ankyros Prime Gauntlet", internalName: "/W/AnkyrosPrimeGauntlet" }).spare,
    ).toBeUndefined();
    expect(resolve({ name: "Braton Prime Set", amount: 3 }).spare).toBeUndefined();
  });
});

describe("attachPartMasteryFlags", () => {
  it("stamps resolvable rows and leaves the rest untouched", () => {
    const rows: Array<{
      name: string;
      internalName?: string;
      amount?: number;
      parentMastered?: boolean;
      spare?: boolean;
    }> = [
      { name: "Braton Prime Barrel", internalName: "/W/BratonPrimeBarrel", amount: 4 },
      { name: "Forma" },
    ];
    const [barrel, forma] = attachPartMasteryFlags(rows, resolve);
    expect(barrel.parentMastered).toBe(true);
    expect(barrel.spare).toBe(true);
    expect(forma).toBe(rows[1]);
  });
});
