import type { ItemDbEntry, RawInventoryData } from "../../../../../src/types/inventory.js";
import type { RelicDatabase } from "../../../../../src/types/relics.js";

export const MAG = "/Lotus/Powersuits/Mag/Mag";
export const MAG_BP = "/Lotus/Types/Recipes/Warframes/MagBlueprint";
export const MAG_NEURO = "/Lotus/Types/Recipes/Warframes/MagNeuropticsComponent";
export const MAG_CHASSIS = "/Lotus/Types/Recipes/Warframes/MagChassisComponent";
export const MAG_SYSTEMS = "/Lotus/Types/Recipes/Warframes/MagSystemsComponent";

export const MAGP = "/Lotus/Powersuits/Mag/MagPrime";
export const MAGP_BP = "/Lotus/Types/Recipes/Warframes/MagPrimeBlueprint";
export const MAGP_NEURO = "/Lotus/Types/Recipes/Warframes/MagPrimeNeuropticsComponent";

export const VOLT = "/Lotus/Powersuits/Volt/Volt";
export const VOLT_BP = "/Lotus/Types/Recipes/Warframes/VoltBlueprint";
export const VOLT_NEURO = "/Lotus/Types/Recipes/Warframes/VoltNeuropticsComponent";

export const OROKIN_CELL = "/Lotus/Types/Items/MiscItems/OrokinCell";
export const LITH_M1 = "/Lotus/Types/Game/Projections/T1VoidProjectionMagPrimeA";

export function part(name: string): ItemDbEntry {
  return { name, isBuildComponent: true, tradable: true };
}

export function frame(name: string, blueprint: string, components: string[]): ItemDbEntry {
  return {
    name,
    productCategory: "Suits",
    category: "Warframes",
    masterable: true,
    imageUrl: `https://example.test/${name.replace(/\s+/g, "")}.png`,
    wikiaUrl: `https://wiki.test/${name.replace(/\s+/g, "_")}`,
    ...(/\sPrime$/.test(name) ? { isPrime: true } : {}),
    recipe: {
      buildPrice: 25_000,
      buildTime: 259_200,
      num: 1,
      blueprintUniqueName: blueprint,
      ingredients: [
        ...components.map((uniqueName) => ({ uniqueName, count: 1 })),
        { uniqueName: OROKIN_CELL, count: 1 },
      ],
    },
  };
}

export function itemDb(): Record<string, ItemDbEntry> {
  return {
    [MAG]: frame("Mag", MAG_BP, [MAG_NEURO, MAG_CHASSIS, MAG_SYSTEMS]),
    [MAG_BP]: { name: "Mag Blueprint", buildsProduct: MAG },
    [MAG_NEURO]: part("Mag Neuroptics"),
    [MAG_CHASSIS]: part("Mag Chassis"),
    [MAG_SYSTEMS]: part("Mag Systems"),

    [MAGP]: frame("Mag Prime", MAGP_BP, [MAGP_NEURO]),
    [MAGP_BP]: { name: "Mag Prime Blueprint", buildsProduct: MAGP },
    [MAGP_NEURO]: part("Mag Prime Neuroptics"),

    [VOLT]: frame("Volt", VOLT_BP, [VOLT_NEURO]),
    [VOLT_BP]: { name: "Volt Blueprint", buildsProduct: VOLT },
    [VOLT_NEURO]: part("Volt Neuroptics"),

    [OROKIN_CELL]: { name: "Orokin Cell", category: "Resource" },
    "/Lotus/Powersuits/Excalibur/ExcaliburExaltedBlade": {
      name: "Exalted Blade",
      productCategory: "Suits",
      exalted: true,
    },
  };
}

interface InventoryShape {
  suits?: string[];
  recipes?: Record<string, number>;
  misc?: Record<string, number>;
  subsumed?: string[];
}

export function inventory(shape: InventoryShape = {}): RawInventoryData {
  return {
    Suits: (shape.suits ?? []).map((ItemType) => ({ ItemType, XP: 1_500_000 })),
    Recipes: Object.entries(shape.recipes ?? {}).map(([ItemType, ItemCount]) => ({
      ItemType,
      ItemCount,
    })),
    MiscItems: Object.entries(shape.misc ?? {}).map(([ItemType, ItemCount]) => ({
      ItemType,
      ItemCount,
    })),
    ...(shape.subsumed
      ? { InfestedFoundry: { ConsumedSuits: shape.subsumed.map((s) => ({ s })) } }
      : {}),
  } as RawInventoryData;
}

export function relicDb(): RelicDatabase {
  return {
    groups: {
      "Lith M1": {
        key: "Lith M1",
        name: "Lith M1",
        tier: "Lith",
        code: "M1",
        imageUrl: null,
        qualities: {
          intact: {
            uniqueName: LITH_M1,
            rewards: [
              {
                name: "Mag Prime Neuroptics Blueprint",
                uniqueName: MAGP_NEURO,
                rarity: "common",
                chance: 25.33,
                urlName: null,
                ducats: 15,
              },
            ],
          },
        },
      },
    },
    byUniqueName: { [LITH_M1]: { groupKey: "Lith M1", quality: "intact" } },
  };
}
