import { describe, expect, it } from "vitest";

import { resolveAcquisition } from "../../../../../src/lib/suggest/acquisition/index.js";
import {
  materialsEffort,
  shortfallEffort,
} from "../../../../../src/lib/suggest/acquisition/materialEffort.js";
import { resourceEntry } from "../../../../../src/lib/suggest/acquisition/plan/resources.js";
import { remainingEffort } from "../../../../../src/lib/suggest/acquisition/sort.js";
import { frame, OROKIN_CELL, part, techrotDb } from "./fixtures.js";
import type {
  AcquisitionTarget,
  MaterialState,
  PartPlan,
} from "../../../../../src/lib/suggest/acquisition/types.js";
import type { ItemDbEntry } from "../../../../../src/types/inventory.js";

function material(name: string, missing: number): MaterialState {
  return { uniqueName: `/${name}`, name, required: missing + 10, owned: 10, missing };
}

function shortOn(...materials: MaterialState[]): AcquisitionTarget {
  const parts: PartPlan = {
    known: true,
    main: null,
    components: [],
    missing: [],
    sourcing: [],
    materials,
    credits: 0,
    copies: 1,
    foundry: false,
    buildable: false,
    foundryOnly: false,
  };
  return { name: "Short", modular: null, parts, paths: [], effort: 0.5 } as never;
}

const MECH = "/Lotus/Powersuits/Mech/Mech";
const MECH_BP = "/Lotus/Types/Recipes/Mechs/MechBlueprint";
const CAPSULE = "/Lotus/Types/Gameplay/Mechs/MechCapsuleItem";
const CAPSULE_BP = "/Lotus/Types/Recipes/Mechs/MechCapsuleBlueprint";
const POD = "/Lotus/Types/Gameplay/Mechs/MechPodItem";
const POD_BP = "/Lotus/Types/Recipes/Mechs/MechPodBlueprint";
const CUT_GEM = "/Lotus/Types/Items/Gems/CutGemItem";
const FIELDRON = "/Lotus/Types/Items/Research/EnergyComponent";

function recipe(blueprint: string, reusable: boolean) {
  return {
    buildPrice: 0,
    buildTime: 0,
    num: 1,
    blueprintUniqueName: blueprint,
    reusableBlueprint: reusable,
    ingredients: [{ uniqueName: OROKIN_CELL, count: 1 }],
  };
}

/** A Necramech-shaped build: a part spent per build, a part blueprint the
 *  recipe reaches below the top level, a cut gem and a researched resource. */
function partsTarget(): AcquisitionTarget {
  const itemDb: Record<string, ItemDbEntry> = {
    [MECH]: frame("Mech", MECH_BP, [CAPSULE, POD, CUT_GEM, FIELDRON]),
    [MECH_BP]: { name: "Mech Blueprint", buildsProduct: MECH },
    [CAPSULE]: { name: "Mech Capsule", category: "Resource", recipe: recipe(CAPSULE_BP, false) },
    [CAPSULE_BP]: { name: "Mech Capsule Blueprint", category: "Recipe", buildsProduct: CAPSULE },
    [POD]: { ...part("Mech Pod"), recipe: { ...recipe(POD_BP, false), ingredients: [] } },
    [POD_BP]: { name: "Mech Pod Blueprint", buildsProduct: POD, isBuildComponent: true },
    [CUT_GEM]: { name: "Cut Gem", category: "Resource", recipe: recipe("/CutGemBlueprint", true) },
    [FIELDRON]: {
      name: "Fieldron",
      category: "Resource",
      recipe: recipe("/FieldronBlueprint", false),
    },
    [OROKIN_CELL]: { name: "Orokin Cell", category: "Resource" },
  };
  const target = resolveAcquisition({ itemDb, inventory: null, only: ["Mech"] })[0];
  if (!target) throw new Error("no Mech");
  return target;
}

describe("materialsEffort", () => {
  it("weighs a common-only shortfall as nothing, whatever the amount", () => {
    const effort = materialsEffort([
      material("Plastids", 50_000),
      material("Nano Spores", 200_000),
      material("Ferrite", 30_000),
      material("Argon Crystal", 40),
    ]);
    expect(effort).toBe(0);
    expect(remainingEffort(shortOn(material("Plastids", 50_000)))).toBe(0.05);
  });

  it("ignores Credits and every alias of them", () => {
    expect(resourceEntry("Höllars")?.name).toBe("Credits");
    expect(materialsEffort([material("Credits", 5_000_000), material("Höllars", 900_000)])).toBe(0);
  });

  it("weighs a small non-common shortfall as a short farm", () => {
    const effort = materialsEffort([material("Temporal Dust", 5)]);
    expect(effort).toBeGreaterThan(0.25);
    expect(effort).toBeLessThan(0.3);
  });

  it("grows with the shortfall and saturates below the ceiling", () => {
    const small = shortfallEffort(10);
    const large = shortfallEffort(3_000);
    const huge = shortfallEffort(1_000_000);
    expect(large).toBeGreaterThan(small);
    expect(huge).toBeGreaterThan(large);
    expect(huge).toBeLessThanOrEqual(0.65);
  });

  it("takes the hardest material, never the sum", () => {
    const one = materialsEffort([material("Temporal Dust", 400)]);
    const both = materialsEffort([material("Temporal Dust", 400), material("Temporal Dust", 40)]);
    expect(both).toBe(one);
  });

  it("reads Cryotic as a real farm now that it is no staple", () => {
    expect(resourceEntry("Cryotic")?.common).toBe(false);
    expect(materialsEffort([material("Cryotic", 3_000)])).toBeGreaterThan(0.55);
  });

  it("ranks a large real shortfall behind a staple-only one in the work left", () => {
    const staple = remainingEffort(shortOn(material("Ferrite", 20_000)));
    const real = remainingEffort(shortOn(material("Cryotic", 3_000), material("Ferrite", 1)));
    expect(staple).toBeLessThan(real ?? 0);
  });

  it("leaves a part the recipe bills as a material to its own routes", () => {
    const part = { ...material("Bonewidow Capsule", 1), part: true as const };
    expect(materialsEffort([part])).toBe(0);
    expect(materialsEffort([part, material("Temporal Dust", 5)])).toBe(shortfallEffort(5));
  });

  it("flags parts and blueprints the planner billed, never farmed resources", () => {
    const flags = new Map(
      partsTarget().parts.materials.map((entry) => [entry.name, entry.part === true]),
    );
    expect(Object.fromEntries(flags)).toEqual({
      "Mech Capsule": true,
      "Mech Pod Blueprint": true,
      "Cut Gem": false,
      Fieldron: false,
      "Orokin Cell": false,
    });
  });

  it("floors every route at the build's material farm", () => {
    const target = resolveAcquisition({
      itemDb: techrotDb(),
      inventory: null,
      only: ["Spinnerex"],
    })[0];
    if (!target) throw new Error("no Spinnerex");
    const floor = materialsEffort(target.parts.materials);
    expect(floor).toBeGreaterThan(0.5);
    for (const path of target.paths) expect(path.effort).toBeGreaterThanOrEqual(floor);
  });
});
