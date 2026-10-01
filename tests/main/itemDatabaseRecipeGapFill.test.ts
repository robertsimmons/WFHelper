import { beforeAll, describe, expect, it, vi } from "vitest";

const SUIT = "/Lotus/Powersuits/Test/TestPrime";
const MAIN_BP = "/Lotus/Types/Recipes/WarframeRecipes/TestPrimeBlueprint";
const CHASSIS = "/Lotus/Types/Recipes/WarframeRecipes/TestPrimeChassisComponent";
const CHASSIS_BP = "/Lotus/Types/Recipes/WarframeRecipes/TestPrimeChassisBlueprint";
const OROKIN_CELL = "/Lotus/Types/Items/MiscItems/OrokinCell";
const RHINO_PRIME = "/Lotus/Powersuits/Rhino/RhinoPrime";
const RHINO_PRIME_BP = "/Lotus/Types/Recipes/WarframeRecipes/RhinoPrimeBlueprint";

function recipe(uniqueName: string, resultType: string, ingredients: [string, number][]) {
  return {
    uniqueName,
    resultType,
    buildPrice: 25000,
    buildTime: 259200,
    num: 1,
    consumeOnUse: true,
    ingredients: ingredients.map(([ItemType, ItemCount]) => ({ ItemType, ItemCount })),
  };
}

vi.mock("../../services/publicExportSource", () => ({
  getOverlay: () => ({
    exports: {
      ExportWarframes: {
        [SUIT]: { uniqueName: SUIT, name: "Test Prime", productCategory: "Suits", masteryReq: 0 },
      },
      ExportRecipes: {
        [MAIN_BP]: recipe(MAIN_BP, SUIT, [
          [CHASSIS, 1],
          [OROKIN_CELL, 5],
        ]),
        [CHASSIS_BP]: recipe(CHASSIS_BP, CHASSIS, [["/Lotus/Types/Items/MiscItems/Rubedo", 1600]]),
        [RHINO_PRIME_BP]: recipe(RHINO_PRIME_BP, RHINO_PRIME, [[OROKIN_CELL, 99]]),
      },
      ExportResources: {
        [CHASSIS]: { uniqueName: CHASSIS, name: "Test Prime Chassis", primeSellingPrice: 15 },
      },
    },
    images: null,
  }),
}));

import * as itemDatabase from "../../services/itemDatabase";

describe("parts for gear only DE's export knows", () => {
  let lookup: ReturnType<typeof itemDatabase.getRendererLookup>;
  beforeAll(() => {
    itemDatabase.buildDatabase();
    lookup = itemDatabase.getRendererLookup();
  });

  it("lists the recipe's parts on the item the way @wfcd does", () => {
    const suit = lookup[SUIT];
    expect(suit?.masterable).toBe(true);
    expect(suit?.components.map((c) => [c.name, c.uniqueName, c.itemCount, c.tradable])).toEqual([
      ["Blueprint", MAIN_BP, 1, true],
      ["Chassis", CHASSIS, 1, true],
      ["Orokin Cell", OROKIN_CELL, 5, undefined],
    ]);
    expect(suit?.recipe?.ingredients).toEqual([
      { uniqueName: CHASSIS, count: 1 },
      { uniqueName: OROKIN_CELL, count: 5 },
    ]);
  });

  it("places the part and its blueprint under the item", () => {
    expect(lookup[CHASSIS]).toMatchObject({
      name: "Test Prime Chassis Blueprint",
      partName: "Test Prime Chassis",
      isBuildComponent: true,
      componentOf: SUIT,
      ducats: 15,
    });
    expect(lookup[CHASSIS]?.recipe?.blueprintUniqueName).toBe(CHASSIS_BP);
    expect(lookup[CHASSIS_BP]).toMatchObject({
      name: "Test Prime Chassis Blueprint",
      isBuildComponent: true,
      componentOf: SUIT,
      buildsProduct: CHASSIS,
    });
    expect(lookup[MAIN_BP]).toMatchObject({
      name: "Test Prime Blueprint",
      isBuildComponent: true,
      componentOf: SUIT,
      buildsProduct: SUIT,
    });
    expect(lookup[OROKIN_CELL]?.name).toBe("Orokin Cell");
    expect(lookup[OROKIN_CELL]?.isBuildComponent).toBe(false);
  });

  it("keeps the package's parts and recipe where it has them", () => {
    const rhino = lookup[RHINO_PRIME];
    expect(rhino?.components.some((c) => c.name === "Chassis")).toBe(true);
    const cells = rhino?.recipe?.ingredients.find((i) => i.uniqueName === OROKIN_CELL);
    expect(cells?.count).not.toBe(99);
  });
});
