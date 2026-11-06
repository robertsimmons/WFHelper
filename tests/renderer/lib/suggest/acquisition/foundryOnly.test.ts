import { describe, expect, it } from "vitest";

import { resolveAcquisition } from "../../../../../src/lib/suggest/acquisition/index.js";
import { readyBand } from "../../../../../src/lib/suggest/acquisition/sort.js";
import { inventory } from "./fixtures.js";
import type { AcquisitionTarget } from "../../../../../src/lib/suggest/acquisition/types.js";
import type { ItemDbEntry, RecipeData } from "../../../../../src/types/inventory.js";

const BUILD_BAND = 1;
const WORK_BAND = 2;

const GEMBLADE = "/Lotus/Weapons/Tenno/Melee/Gemblade/GembladeWeapon";
const GEMBLADE_BP = "/Lotus/Types/Recipes/Weapons/GembladeBlueprint";
const CUT_GEM = "/Lotus/Types/Gameplay/Venus/Resources/CutGemItem";
const CUT_GEM_BP = "/Lotus/Types/Recipes/Gameplay/CutGemRecipe";
const RAW_GEM = "/Lotus/Types/Gameplay/Venus/Resources/RawGemItem";

const ALLOYBLADE = "/Lotus/Weapons/Tenno/Melee/Alloyblade/AlloybladeWeapon";
const ALLOYBLADE_BP = "/Lotus/Types/Recipes/Weapons/AlloybladeBlueprint";
const ALLOY = "/Lotus/Types/Gameplay/Zariman/Resources/AlloyItem";
const ALLOY_BP = "/Lotus/Types/Recipes/Gameplay/AlloyRecipe";
const INGOT = "/Lotus/Types/Gameplay/Zariman/Resources/IngotItem";
const INGOT_BP = "/Lotus/Types/Recipes/Gameplay/IngotRecipe";
const ORE = "/Lotus/Types/Items/MiscItems/RawOre";

function recipe(
  blueprintUniqueName: string,
  ingredients: RecipeData["ingredients"],
  extra: Partial<RecipeData> = {},
): RecipeData {
  return { buildPrice: 1_000, buildTime: 60, num: 1, blueprintUniqueName, ingredients, ...extra };
}

function melee(name: string, blueprint: string, ingredients: RecipeData["ingredients"]) {
  return {
    name,
    productCategory: "Melee",
    masterable: true,
    recipe: recipe(blueprint, ingredients, { buildPrice: 20_000 }),
  };
}

/** 25 cut gems at five a run off a reusable blueprint: 50 raw gems. Two alloys,
 *  one consumable blueprint each, from three ingots apiece off a reusable one. */
function db(): Record<string, ItemDbEntry> {
  return {
    [GEMBLADE]: melee("Gemblade", GEMBLADE_BP, [{ uniqueName: CUT_GEM, count: 25 }]),
    [GEMBLADE_BP]: { name: "Gemblade Blueprint", buildsProduct: GEMBLADE },
    [CUT_GEM]: {
      name: "Cut Gem",
      category: "Resource",
      recipe: recipe(CUT_GEM_BP, [{ uniqueName: RAW_GEM, count: 10 }], {
        num: 5,
        reusableBlueprint: true,
      }),
    },
    [CUT_GEM_BP]: { name: "Cut Gem Blueprint", buildsProduct: CUT_GEM },
    [RAW_GEM]: { name: "Raw Gem", category: "Resource" },

    [ALLOYBLADE]: melee("Alloyblade", ALLOYBLADE_BP, [{ uniqueName: ALLOY, count: 2 }]),
    [ALLOYBLADE_BP]: { name: "Alloyblade Blueprint", buildsProduct: ALLOYBLADE },
    [ALLOY]: {
      name: "Alloy",
      category: "Resource",
      recipe: recipe(ALLOY_BP, [{ uniqueName: INGOT, count: 3 }]),
    },
    [ALLOY_BP]: { name: "Alloy Blueprint", buildsProduct: ALLOY },
    [INGOT]: {
      name: "Ingot",
      category: "Resource",
      recipe: recipe(INGOT_BP, [{ uniqueName: ORE, count: 4 }], { reusableBlueprint: true }),
    },
    [INGOT_BP]: { name: "Ingot Blueprint", buildsProduct: INGOT },
    [ORE]: { name: "Raw Ore", category: "Resource" },
  };
}

function target(
  name: string,
  recipes: Record<string, number>,
  misc: Record<string, number>,
): AcquisitionTarget {
  const targets = resolveAcquisition({ itemDb: db(), inventory: inventory({ recipes, misc }) });
  const match = targets.find((row) => row.name === name);
  if (!match) throw new Error(`no target for ${name}`);
  return match;
}

describe("a build short only of what the foundry can cook ranks as builds left", () => {
  it("reads a cut gem it can cut from raw gems in hand as foundry work", () => {
    const gemblade = target("Gemblade", { [GEMBLADE_BP]: 1, [CUT_GEM_BP]: 1 }, { [RAW_GEM]: 50 });
    expect(gemblade.parts.materials.find((row) => row.uniqueName === CUT_GEM)?.missing).toBe(25);
    expect(gemblade.parts.foundryOnly).toBe(true);
    expect(readyBand(gemblade)).toBe(BUILD_BAND);
  });

  it("keeps farming when one raw gem short of the cut", () => {
    const gemblade = target("Gemblade", { [GEMBLADE_BP]: 1, [CUT_GEM_BP]: 1 }, { [RAW_GEM]: 49 });
    expect(gemblade.parts.foundryOnly).toBe(false);
    expect(readyBand(gemblade)).toBe(WORK_BAND);
  });

  it("keeps farming without the blueprint that cuts the gem", () => {
    const gemblade = target("Gemblade", { [GEMBLADE_BP]: 1 }, { [RAW_GEM]: 50 });
    expect(readyBand(gemblade)).toBe(WORK_BAND);
  });

  it("works a chain of conversions down to raw ore", () => {
    const alloyblade = target(
      "Alloyblade",
      { [ALLOYBLADE_BP]: 1, [ALLOY_BP]: 2, [INGOT_BP]: 1 },
      { [ORE]: 24 },
    );
    expect(alloyblade.parts.foundryOnly).toBe(true);
    expect(readyBand(alloyblade)).toBe(BUILD_BAND);
  });

  it("spends a consumable conversion blueprint once per run", () => {
    const alloyblade = target(
      "Alloyblade",
      { [ALLOYBLADE_BP]: 1, [ALLOY_BP]: 1, [INGOT_BP]: 1 },
      { [ORE]: 24 },
    );
    expect(readyBand(alloyblade)).toBe(WORK_BAND);
  });

  it("counts stock already converted before cooking more", () => {
    const alloyblade = target(
      "Alloyblade",
      { [ALLOYBLADE_BP]: 1, [ALLOY_BP]: 1, [INGOT_BP]: 1 },
      { [ALLOY]: 1, [ORE]: 12 },
    );
    expect(readyBand(alloyblade)).toBe(BUILD_BAND);
  });
});
