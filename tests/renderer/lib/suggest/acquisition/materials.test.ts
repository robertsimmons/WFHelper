import { describe, expect, it } from "vitest";

import { buildCraftingTree, isResourceEntry } from "../../../../../src/lib/craftingTree.js";
import { resolveAcquisition } from "../../../../../src/lib/suggest/acquisition/index.js";
import { inventory } from "./fixtures.js";
import type {
  AcquisitionContext,
  AcquisitionTarget,
  MaterialState,
  PartState,
} from "../../../../../src/lib/suggest/acquisition/types.js";
import type { ItemDbEntry } from "../../../../../src/types/inventory.js";

// Every uniqueName, ingredient count and yield below is copied out of the game
// export (ExportRecipes / ExportResources / ExportWeapons), so a spec that
// passes here is a claim about a recipe the player can actually open.

const VENATO = "/Lotus/Weapons/Sentients/SentJointedScythe/SentJointedScytheWeapon";
const VENATO_BP = "/Lotus/Types/Recipes/Weapons/NewWar/SentJointedScytheBlueprint";
const NARMER_ISOPLAST = "/Lotus/Types/Items/MiscItems/NarmerBountyResource";
const ANOMALY_SHARD = "/Lotus/Types/Items/MiscItems/SentientFragmentLootItem";
const IRADITE = "/Lotus/Types/Gameplay/Eidolon/Resources/IraditeItem";

const EXCEPTIONAL_CORE = "/Lotus/Types/Gameplay/Eidolon/Resources/QuillsUncommonDogTag";
const INTACT_CORE = "/Lotus/Types/Gameplay/Eidolon/Resources/QuillsDogTag";
const CORE_CONVERSION_BP = "/Lotus/Types/Recipes/EidolonRecipes/SentientCoreConversionABlueprint";

const RADIAN_SENTIRUM = "/Lotus/Types/Items/Gems/Eidolon/EidolonGemACutAItem";
const PROSPECTING = "/Lotus/Types/Recipes/EidolonRecipes/Prospecting";
const RADIAN_SENTIRUM_BP = `${PROSPECTING}/EidolonGemACutABlueprint`;
const SENTIRUM = "/Lotus/Types/Items/Gems/Eidolon/EidolonGemAItem";
const HEART_NYTH = "/Lotus/Types/Items/Gems/Eidolon/EidolonGemBCutAItem";
const HEART_NYTH_BP = `${PROSPECTING}/EidolonGemBCutABlueprint`;
const NYTH = "/Lotus/Types/Items/Gems/Eidolon/EidolonGemBItem";
const STAR_CRIMZIAN = "/Lotus/Types/Items/Gems/Eidolon/RareGemACutAItem";
const GROKDRUL = "/Lotus/Types/Gameplay/Eidolon/Resources/GrokdrulItem";

const AMBER_STAR = "/Lotus/Types/Items/FusionTreasures/OroFusexOrnamentB";
const AMBER_STAR_BP = "/Lotus/Types/Recipes/Components/AmberStarBlueprint";
const CYAN_STAR = "/Lotus/Types/Items/FusionTreasures/OroFusexOrnamentA";
const VITUS_ESSENCE = "/Lotus/Types/Items/MiscItems/Elitium";

const OROKIN_CELL = "/Lotus/Types/Items/MiscItems/OrokinCell";
const ARGON_CRYSTAL = "/Lotus/Types/Items/MiscItems/ArgonCrystal";
const RUBEDO = "/Lotus/Types/Items/MiscItems/Rubedo";
const SALVAGE = "/Lotus/Types/Items/MiscItems/Salvage";
const ALLOY_PLATE = "/Lotus/Types/Items/MiscItems/AlloyPlate";
const RADIANT_ZODIAN = "/Lotus/Types/Items/Gems/Solaris/SolarisEidolonGemACutItem";
const MARQUISE_THYST = "/Lotus/Types/Items/Gems/Solaris/SolarisEidolonGemBCutItem";
const MYTOCARDIA_SPORE = "/Lotus/Types/Gameplay/Venus/Resources/FungusHeartItem";
const THERMAL_SLUDGE = "/Lotus/Types/Gameplay/Venus/Resources/CoolantItem";

const GAUSS = "/Lotus/Powersuits/Runner/Runner";
const GAUSS_BP = "/Lotus/Types/Recipes/WarframeRecipes/GaussBlueprint";
const GAUSS_HELMET = "/Lotus/Types/Recipes/WarframeRecipes/GaussHelmetComponent";
const GAUSS_CHASSIS = "/Lotus/Types/Recipes/WarframeRecipes/GaussChassisComponent";
const GAUSS_SYSTEMS = "/Lotus/Types/Recipes/WarframeRecipes/GaussSystemsComponent";

const GEODE = "/Lotus/Powersuits/Geode/Geode";
const GEODE_BP = "/Lotus/Types/Recipes/WarframeRecipes/GeodeBlueprint";
const GEODE_HELMET = "/Lotus/Types/Recipes/WarframeRecipes/GeodeHelmetComponent";
const GEODE_CHASSIS = "/Lotus/Types/Recipes/WarframeRecipes/GeodeChassisComponent";
const GEODE_SYSTEMS = "/Lotus/Types/Recipes/WarframeRecipes/GeodeSystemsComponent";

const VOLT = "/Lotus/Powersuits/Volt/Volt";
const VOLT_BP = "/Lotus/Types/Recipes/WarframeRecipes/VOLTBlueprint";
const VOLT_HELMET = "/Lotus/Types/Recipes/WarframeRecipes/VOLTHelmetComponent";
const VOLT_CHASSIS = "/Lotus/Types/Recipes/WarframeRecipes/VOLTChassisComponent";
const VOLT_SYSTEMS = "/Lotus/Types/Recipes/WarframeRecipes/VOLTSystemsComponent";

const CHROMA = "/Lotus/Powersuits/Dragon/Dragon";
const CHROMA_BP = "/Lotus/Types/Recipes/WarframeRecipes/ChromaBlueprint";
const CHROMA_HELMET = "/Lotus/Types/Recipes/WarframeRecipes/ChromaHelmetComponent";
const CHROMA_CHASSIS = "/Lotus/Types/Recipes/WarframeRecipes/ChromaChassisComponent";
const CHROMA_SYSTEMS = "/Lotus/Types/Recipes/WarframeRecipes/ChromaSystemsComponent";

interface Ingredient {
  uniqueName: string;
  count: number;
}

function need(uniqueName: string, count: number): Ingredient {
  return { uniqueName, count };
}

/** An ExportResources row: a material, whatever else the export says about it. */
function resource(name: string): ItemDbEntry {
  return { name, category: "Resource" };
}

/** A resource DE also lets the foundry convert into. Still a resource. */
function convertible(
  name: string,
  blueprint: string,
  num: number,
  ingredients: readonly Ingredient[],
): ItemDbEntry {
  return {
    ...resource(name),
    recipe: {
      buildPrice: 10_000,
      buildTime: 60,
      num,
      blueprintUniqueName: blueprint,
      ingredients: [...ingredients],
    },
  };
}

function component(name: string): ItemDbEntry {
  return { name, isBuildComponent: true, tradable: true };
}

/** A component the foundry builds from materials, blueprint spelling included. */
function builtComponent(
  uniqueName: string,
  name: string,
  ingredients: readonly Ingredient[],
): Record<string, ItemDbEntry> {
  const blueprint = uniqueName.replace(/Component$/, "Blueprint");
  return {
    [uniqueName]: {
      ...component(name),
      recipe: {
        buildPrice: 15_000,
        buildTime: 43_200,
        num: 1,
        blueprintUniqueName: blueprint,
        ingredients: [...ingredients],
      },
    },
    [blueprint]: { name: `${name} Blueprint`, buildsProduct: uniqueName, isBuildComponent: true },
  };
}

function gear(
  name: string,
  productCategory: string,
  blueprint: string,
  ingredients: readonly Ingredient[],
): ItemDbEntry {
  return {
    name,
    productCategory,
    ...(productCategory === "Suits" ? { category: "Warframes" } : {}),
    masterable: true,
    imageUrl: `https://example.test/${name.replace(/\s+/g, "")}.png`,
    wikiaUrl: `https://wiki.test/${name.replace(/\s+/g, "_")}`,
    recipe: {
      buildPrice: 25_000,
      buildTime: 259_200,
      num: 1,
      blueprintUniqueName: blueprint,
      ingredients: [...ingredients],
    },
  };
}

/** The Eidolon conversion ladder: raw gem -> cut gem -> Sentient Core, every
 *  rung an ExportResources row carrying a recipe, and Venato, which asks for
 *  one rung of it beside three materials that carry no recipe at all. */
function eidolonDb(): Record<string, ItemDbEntry> {
  return {
    [VENATO]: gear("Venato", "Melee", VENATO_BP, [
      need(NARMER_ISOPLAST, 16),
      need(ANOMALY_SHARD, 5),
      need(EXCEPTIONAL_CORE, 5),
      need(IRADITE, 60),
    ]),
    [VENATO_BP]: { name: "Venato Blueprint", buildsProduct: VENATO },

    [NARMER_ISOPLAST]: resource("Narmer Isoplast"),
    [ANOMALY_SHARD]: resource("Anomaly Shard"),
    [IRADITE]: resource("Iradite"),
    [INTACT_CORE]: resource("Intact Sentient Core"),
    [SENTIRUM]: resource("Sentirum"),
    [NYTH]: resource("Nyth"),
    [CYAN_STAR]: resource("Ayatan Cyan Star"),
    [VITUS_ESSENCE]: resource("Vitus Essence"),

    [EXCEPTIONAL_CORE]: convertible("Exceptional Sentient Core", CORE_CONVERSION_BP, 10, [
      need(INTACT_CORE, 10),
      need(RADIAN_SENTIRUM, 1),
      need(HEART_NYTH, 1),
    ]),
    [CORE_CONVERSION_BP]: {
      name: "Sentient Core Conversion",
      buildsProduct: EXCEPTIONAL_CORE,
      reusableBlueprint: true,
    },

    [RADIAN_SENTIRUM]: convertible("Radian Sentirum", RADIAN_SENTIRUM_BP, 3, [need(SENTIRUM, 3)]),
    [RADIAN_SENTIRUM_BP]: { name: "Radian Sentirum Blueprint", buildsProduct: RADIAN_SENTIRUM },
    [HEART_NYTH]: convertible("Heart Nyth", HEART_NYTH_BP, 3, [need(NYTH, 3)]),
    [HEART_NYTH_BP]: { name: "Heart Nyth Blueprint", buildsProduct: HEART_NYTH },

    [AMBER_STAR]: convertible("Ayatan Amber Star", AMBER_STAR_BP, 1, [
      need(CYAN_STAR, 2),
      need(VITUS_ESSENCE, 1),
    ]),
    [AMBER_STAR_BP]: { name: "Amber Star Blueprint", buildsProduct: AMBER_STAR },
  };
}

/** Four Warframes out of the export. Gauss builds its parts from cut gems;
 *  Chroma's recipe asks for Volt's helmet, which is how one crafted component
 *  lands at the top of two different builds. */
function frameDb(): Record<string, ItemDbEntry> {
  return {
    [GAUSS]: gear("Gauss", "Suits", GAUSS_BP, [
      need(GAUSS_CHASSIS, 1),
      need(GAUSS_HELMET, 1),
      need(GAUSS_SYSTEMS, 1),
      need(OROKIN_CELL, 3),
    ]),
    [GAUSS_BP]: { name: "Gauss Blueprint", buildsProduct: GAUSS },
    ...builtComponent(GAUSS_CHASSIS, "Gauss Chassis", [
      need(RADIAN_SENTIRUM, 3),
      need(HEART_NYTH, 3),
      need(STAR_CRIMZIAN, 6),
      need(GROKDRUL, 55),
    ]),
    ...builtComponent(GAUSS_HELMET, "Gauss Helmet", [
      need(ARGON_CRYSTAL, 1),
      need(RUBEDO, 1_600),
      need(SALVAGE, 6_200),
      need(ALLOY_PLATE, 2_950),
    ]),
    ...builtComponent(GAUSS_SYSTEMS, "Gauss Systems", [
      need(RADIANT_ZODIAN, 3),
      need(MARQUISE_THYST, 3),
      need(MYTOCARDIA_SPORE, 70),
      need(THERMAL_SLUDGE, 85),
    ]),

    [GEODE]: gear("Geode", "Suits", GEODE_BP, [
      need(GEODE_HELMET, 1),
      need(GEODE_CHASSIS, 1),
      need(GEODE_SYSTEMS, 1),
      need(OROKIN_CELL, 3),
    ]),
    [GEODE_BP]: { name: "Geode Blueprint", buildsProduct: GEODE },
    [GEODE_HELMET]: component("Geode Neuroptics"),
    [GEODE_CHASSIS]: component("Geode Chassis"),
    [GEODE_SYSTEMS]: component("Geode Systems"),

    [VOLT]: gear("Volt", "Suits", VOLT_BP, [
      need(VOLT_CHASSIS, 1),
      need(VOLT_HELMET, 1),
      need(VOLT_SYSTEMS, 1),
      need(OROKIN_CELL, 1),
    ]),
    [VOLT_BP]: { name: "Volt Blueprint", buildsProduct: VOLT },
    [VOLT_HELMET]: component("Volt Neuroptics"),
    [VOLT_CHASSIS]: component("Volt Chassis"),
    [VOLT_SYSTEMS]: component("Volt Systems"),

    [CHROMA]: gear("Chroma", "Suits", CHROMA_BP, [
      need(CHROMA_HELMET, 1),
      need(CHROMA_CHASSIS, 1),
      need(CHROMA_SYSTEMS, 1),
      need(VOLT_HELMET, 1),
    ]),
    [CHROMA_BP]: { name: "Chroma Blueprint", buildsProduct: CHROMA },
    [CHROMA_HELMET]: component("Chroma Neuroptics"),
    [CHROMA_CHASSIS]: component("Chroma Chassis"),
    [CHROMA_SYSTEMS]: component("Chroma Systems"),

    [OROKIN_CELL]: resource("Orokin Cell"),
    [ARGON_CRYSTAL]: resource("Argon Crystal"),
    [RUBEDO]: resource("Rubedo"),
    [SALVAGE]: resource("Salvage"),
    [ALLOY_PLATE]: resource("Alloy Plate"),
    [GROKDRUL]: resource("Grokdrul"),
    [STAR_CRIMZIAN]: resource("Star Crimzian"),
    [SENTIRUM]: resource("Sentirum"),
    [NYTH]: resource("Nyth"),
    [RADIANT_ZODIAN]: resource("Radiant Zodian"),
    [MARQUISE_THYST]: resource("Marquise Thyst"),
    [MYTOCARDIA_SPORE]: resource("Mytocardia Spore"),
    [THERMAL_SLUDGE]: resource("Thermal Sludge"),
    [RADIAN_SENTIRUM]: convertible("Radian Sentirum", RADIAN_SENTIRUM_BP, 3, [need(SENTIRUM, 3)]),
    [RADIAN_SENTIRUM_BP]: { name: "Radian Sentirum Blueprint", buildsProduct: RADIAN_SENTIRUM },
    [HEART_NYTH]: convertible("Heart Nyth", HEART_NYTH_BP, 3, [need(NYTH, 3)]),
    [HEART_NYTH_BP]: { name: "Heart Nyth Blueprint", buildsProduct: HEART_NYTH },
  };
}

function targets(
  itemDb: Record<string, ItemDbEntry>,
  overrides: Partial<AcquisitionContext> = {},
): AcquisitionTarget[] {
  return resolveAcquisition({ itemDb, inventory: null, ...overrides });
}

function find(rows: AcquisitionTarget[], name: string): AcquisitionTarget {
  const match = rows.find((target) => target.name === name);
  if (!match) throw new Error(`no target for ${name}`);
  return match;
}

function material(target: AcquisitionTarget, name: string): MaterialState {
  const row = target.parts.materials.find((entry) => entry.name === name);
  if (!row) throw new Error(`${target.name} has no material row for ${name}`);
  return row;
}

function materialNames(target: AcquisitionTarget): string[] {
  return target.parts.materials.map((row) => row.name).sort();
}

function part(target: AcquisitionTarget, name: string): PartState {
  const row = target.parts.components.find((entry) => entry.name === name);
  if (!row) throw new Error(`${target.name} has no component row for ${name}`);
  return row;
}

function componentNames(target: AcquisitionTarget): string[] {
  return target.parts.components.map((row) => row.name).sort();
}

describe("a resource is a material, whatever recipe the export hangs off it", () => {
  it("bills Venato for four materials and no components at all", () => {
    const venato = find(targets(eidolonDb()), "Venato");
    expect(venato.parts.known).toBe(true);
    expect(venato.parts.main?.name).toBe("Venato Blueprint");
    expect(componentNames(venato)).toEqual([]);
    expect(materialNames(venato)).toEqual([
      "Anomaly Shard",
      "Exceptional Sentient Core",
      "Iradite",
      "Narmer Isoplast",
    ]);
  });

  it("counts a plain material with no recipe at the figure the recipe asks for", () => {
    const venato = find(targets(eidolonDb()), "Venato");
    expect(material(venato, "Narmer Isoplast")).toMatchObject({ required: 16, missing: 16 });
    expect(material(venato, "Iradite")).toMatchObject({ required: 60, missing: 60 });
  });

  it("counts a Sentient Core as a material even though the Quills convert one", () => {
    const venato = find(targets(eidolonDb()), "Venato");
    expect(material(venato, "Exceptional Sentient Core")).toMatchObject({
      required: 5,
      owned: 0,
      missing: 5,
    });
  });

  it("keeps the conversion recipe's own ingredients off Venato's bill", () => {
    const venato = find(targets(eidolonDb()), "Venato");
    for (const leaked of ["Intact Sentient Core", "Radian Sentirum", "Heart Nyth"]) {
      expect(materialNames(venato)).not.toContain(leaked);
    }
    expect(materialNames(venato)).not.toContain("Sentient Core Conversion");
  });

  it("keeps a refined gem a material where a crafted component asks for it", () => {
    const gauss = find(targets(frameDb()), "Gauss");
    expect(material(gauss, "Radian Sentirum")).toMatchObject({ required: 3 });
    expect(material(gauss, "Heart Nyth")).toMatchObject({ required: 3 });
    // The gems convert from raw stones, and that ladder stays shut too.
    expect(materialNames(gauss)).not.toContain("Sentirum");
    expect(materialNames(gauss)).not.toContain("Nyth");
  });

  it("keeps a genuinely crafted component a component", () => {
    const gauss = find(targets(frameDb()), "Gauss");
    expect(componentNames(gauss)).toEqual(["Gauss Chassis", "Gauss Helmet", "Gauss Systems"]);
    expect(materialNames(gauss)).not.toContain("Gauss Chassis");
  });

  it("still walks the conversion recipe when the core itself is what was asked for", () => {
    const tree = buildCraftingTree(EXCEPTIONAL_CORE, eidolonDb(), new Map());
    const ingredients = (tree?.children ?? []).filter((child) => !child.isBlueprintItem);
    expect(ingredients.map((child) => child.name).sort()).toEqual([
      "Heart Nyth",
      "Intact Sentient Core",
      "Radian Sentirum",
    ]);
    // One rung only: the gems below it are leaves again.
    expect(ingredients.every((child) => child.children.length === 0)).toBe(true);
  });
});

describe("a card reports what the player holds, not a share of the sweep", () => {
  it("shows the whole pile when it dwarfs what this build asks for", () => {
    const rows = targets(eidolonDb(), { inventory: inventory({ misc: { [IRADITE]: 900 } }) });
    const venato = find(rows, "Venato");
    expect(material(venato, "Iradite")).toMatchObject({ required: 60, owned: 900, missing: 0 });
  });

  it("shows nothing held as nothing rather than as a covered row", () => {
    const gauss = find(targets(frameDb()), "Gauss");
    expect(material(gauss, "Orokin Cell")).toMatchObject({ required: 3, owned: 0, missing: 3 });
  });

  it("gives every build in one sweep the same figure for a shared material", () => {
    const rows = targets(frameDb(), { inventory: inventory({ misc: { [OROKIN_CELL]: 5 } }) });
    for (const name of ["Gauss", "Geode", "Volt"]) {
      expect(material(find(rows, name), "Orokin Cell")).toMatchObject({ owned: 5, missing: 0 });
    }
  });

  it("does not let an early build in the sweep drain a later one's materials", () => {
    // Gauss and Geode each want three Orokin Cells and the account holds four.
    // Both rows say four: neither card is a claim on the other's stock.
    const rows = targets(frameDb(), { inventory: inventory({ misc: { [OROKIN_CELL]: 4 } }) });
    expect(material(find(rows, "Gauss"), "Orokin Cell")).toMatchObject({ owned: 4, missing: 0 });
    expect(material(find(rows, "Geode"), "Orokin Cell")).toMatchObject({ owned: 4, missing: 0 });
  });

  it("reports a part the player partly holds against the rest of the set", () => {
    const rows = targets(frameDb(), { inventory: inventory({ misc: { [GEODE_CHASSIS]: 1 } }) });
    const geode = find(rows, "Geode");
    expect(part(geode, "Geode Chassis")).toMatchObject({ required: 1, owned: 1, missing: 0 });
    expect(part(geode, "Geode Systems")).toMatchObject({ required: 1, owned: 0, missing: 1 });
    expect(geode.parts.buildable).toBe(false);
  });

  it("gives both builds that need one component the same count for it", () => {
    // Chroma's recipe asks for Volt's Neuroptics, so the single copy in the
    // foundry is a real answer to two cards at once.
    const rows = targets(frameDb(), { inventory: inventory({ misc: { [VOLT_HELMET]: 1 } }) });
    expect(part(find(rows, "Volt"), "Volt Neuroptics")).toMatchObject({ owned: 1, missing: 0 });
    expect(part(find(rows, "Chroma"), "Volt Neuroptics")).toMatchObject({ owned: 1, missing: 0 });
  });
});

describe("the resource rule is the export category, not a list of paths", () => {
  it("classes every convertible resource a material wherever its path sits", () => {
    const db = eidolonDb();
    for (const uniqueName of [EXCEPTIONAL_CORE, RADIAN_SENTIRUM, HEART_NYTH, AMBER_STAR, IRADITE]) {
      expect(isResourceEntry(db[uniqueName])).toBe(true);
    }
    expect(isResourceEntry(frameDb()[GAUSS_CHASSIS])).toBe(false);
    expect(isResourceEntry(undefined)).toBe(false);
  });

  it("still opens an Ayatan Amber Star's own recipe when that is what was asked", () => {
    const tree = buildCraftingTree(AMBER_STAR, eidolonDb(), new Map());
    const ingredients = (tree?.children ?? []).filter((child) => !child.isBlueprintItem);
    expect(ingredients.map((child) => child.name).sort()).toEqual([
      "Ayatan Cyan Star",
      "Vitus Essence",
    ]);
  });
});
