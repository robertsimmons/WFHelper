import type { ItemDbEntry, RawInventoryData } from "../../../../../src/types/inventory.js";
import type { RelicDatabase } from "../../../../../src/types/relics.js";

export const MAG = "/Lotus/Powersuits/Mag/Mag";
export const MAG_BP = "/Lotus/Types/Recipes/Warframes/MagBlueprint";
export const MAG_NEURO = "/Lotus/Types/Recipes/Warframes/MagNeuropticsComponent";
export const MAG_CHASSIS = "/Lotus/Types/Recipes/Warframes/MagChassisComponent";
export const MAG_SYSTEMS = "/Lotus/Types/Recipes/Warframes/MagSystemsComponent";

export const MAGP = "/Lotus/Powersuits/Mag/MagPrime";
const MAGP_BP = "/Lotus/Types/Recipes/Warframes/MagPrimeBlueprint";
export const MAGP_NEURO = "/Lotus/Types/Recipes/Warframes/MagPrimeNeuropticsComponent";

const VOLT = "/Lotus/Powersuits/Volt/Volt";
const VOLT_BP = "/Lotus/Types/Recipes/Warframes/VoltBlueprint";
const VOLT_NEURO = "/Lotus/Types/Recipes/Warframes/VoltNeuropticsComponent";

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
  longGuns?: string[];
  pistols?: string[];
  melee?: string[];
  spaceGuns?: string[];
  sentinelWeapons?: string[];
  /** Owned rifles carrying the installed Incarnon Genesis feature bit. */
  incarnon?: string[];
  recipes?: Record<string, number>;
  misc?: Record<string, number>;
  subsumed?: string[];
}

const INCARNON_FEATURE = 512;

function gear(itemTypes: string[] | undefined): Array<{ ItemType: string; XP: number }> {
  return (itemTypes ?? []).map((ItemType) => ({ ItemType, XP: 1_500_000 }));
}

export function inventory(shape: InventoryShape = {}): RawInventoryData {
  return {
    Suits: gear(shape.suits),
    LongGuns: [
      ...gear(shape.longGuns),
      ...(shape.incarnon ?? []).map((ItemType) => ({
        ItemType,
        XP: 1_500_000,
        Features: INCARNON_FEATURE,
      })),
    ],
    Pistols: gear(shape.pistols),
    Melee: gear(shape.melee),
    SpaceGuns: gear(shape.spaceGuns),
    SentinelWeapons: gear(shape.sentinelWeapons),
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

export const BRATON = "/Lotus/Weapons/Tenno/Rifle/BratonRifle";
export const BRATON_BP = "/Lotus/Types/Recipes/Weapons/BratonBlueprint";
export const BRATON_BARREL = "/Lotus/Types/Recipes/Weapons/BratonBarrel";
const BRATON_RECEIVER = "/Lotus/Types/Recipes/Weapons/BratonReceiver";
export const BRATON_ADAPTER = "/Lotus/Types/Items/MiscItems/IncarnonAdapters/BratonIncarnonAdapter";

const BRATONP = "/Lotus/Weapons/Tenno/Rifle/PrimeBratonRifle";
const BRATONP_BP = "/Lotus/Types/Recipes/Weapons/BratonPrimeBlueprint";
export const BRATONP_BARREL = "/Lotus/Types/Recipes/Weapons/BratonPrimeBarrel";

export const AKBOLTO = "/Lotus/Weapons/Tenno/Pistol/AkboltoPistol";
const AKBOLTO_BP = "/Lotus/Types/Recipes/Weapons/AkboltoBlueprint";

export const NIKANA = "/Lotus/Weapons/Tenno/Melee/Swords/Nikana";
const NIKANA_BP = "/Lotus/Types/Recipes/Weapons/NikanaBlueprint";

export const CORVAS = "/Lotus/Weapons/Tenno/Archwing/Primary/CorvasCannon";
const CORVAS_BP = "/Lotus/Types/Recipes/Weapons/CorvasBlueprint";

export const SWEEPER = "/Lotus/Types/Sentinels/SentinelWeapons/SentinelSweeper";
const SWEEPER_BP = "/Lotus/Types/Recipes/Weapons/SweeperBlueprint";

export const KUVA_BRAMMA = "/Lotus/Weapons/Grineer/KuvaLich/Primary/KuvaBrammaBow";
const TENET_LIVIA = "/Lotus/Weapons/Corpus/Melee/Sister/TenetLivia";
const CODA_MOTOVORE = "/Lotus/Weapons/Infested/Melee/Coda/CodaMotovore";

const EXALTED_SWORD = "/Lotus/Weapons/Tenno/Melee/PowerSuits/ExcaliburSword";
export const LITH_B1 = "/Lotus/Types/Game/Projections/T1VoidProjectionBratonPrimeA";

function weapon(
  name: string,
  productCategory: string,
  blueprint: string,
  components: string[] = [],
): ItemDbEntry {
  return {
    name,
    productCategory,
    masterable: true,
    imageUrl: `https://example.test/${name.replace(/\s+/g, "")}.png`,
    wikiaUrl: `https://wiki.test/${name.replace(/\s+/g, "_")}`,
    ...(/\sPrime$/.test(name) ? { isPrime: true } : {}),
    recipe: {
      buildPrice: 15_000,
      buildTime: 43_200,
      num: 1,
      blueprintUniqueName: blueprint,
      ingredients: [
        ...components.map((uniqueName) => ({ uniqueName, count: 1 })),
        { uniqueName: OROKIN_CELL, count: 1 },
      ],
    },
  };
}

function unbuilt(name: string, productCategory: string): ItemDbEntry {
  return {
    name,
    productCategory,
    masterable: true,
    imageUrl: `https://example.test/${name.replace(/\s+/g, "")}.png`,
    wikiaUrl: `https://wiki.test/${name.replace(/\s+/g, "_")}`,
  };
}

export function weaponDb(): Record<string, ItemDbEntry> {
  return {
    [BRATON]: weapon("Braton", "LongGuns", BRATON_BP, [BRATON_BARREL, BRATON_RECEIVER]),
    [BRATON_BP]: { name: "Braton Blueprint", buildsProduct: BRATON },
    [BRATON_BARREL]: part("Braton Barrel"),
    [BRATON_RECEIVER]: part("Braton Receiver"),
    [BRATON_ADAPTER]: { name: "Braton Incarnon Genesis", category: "Misc" },

    [BRATONP]: weapon("Braton Prime", "LongGuns", BRATONP_BP, [BRATONP_BARREL]),
    [BRATONP_BP]: { name: "Braton Prime Blueprint", buildsProduct: BRATONP },
    [BRATONP_BARREL]: part("Braton Prime Barrel"),

    [AKBOLTO]: weapon("Akbolto", "Pistols", AKBOLTO_BP),
    [AKBOLTO_BP]: { name: "Akbolto Blueprint", buildsProduct: AKBOLTO },

    [NIKANA]: weapon("Nikana", "Melee", NIKANA_BP),
    [NIKANA_BP]: { name: "Nikana Blueprint", buildsProduct: NIKANA },

    [CORVAS]: weapon("Corvas", "SpaceGuns", CORVAS_BP),
    [CORVAS_BP]: { name: "Corvas Blueprint", buildsProduct: CORVAS },

    [SWEEPER]: weapon("Sweeper", "SentinelWeapons", SWEEPER_BP),
    [SWEEPER_BP]: { name: "Sweeper Blueprint", buildsProduct: SWEEPER },

    // A nemesis hands the weapon over whole; there is no recipe to walk.
    [KUVA_BRAMMA]: unbuilt("Kuva Bramma", "LongGuns"),
    [TENET_LIVIA]: unbuilt("Tenet Livia", "Melee"),
    [CODA_MOTOVORE]: unbuilt("Coda Motovore", "Melee"),

    [OROKIN_CELL]: { name: "Orokin Cell", category: "Resource" },
    [EXALTED_SWORD]: { name: "Excalibur Sword", productCategory: "Melee" },
  };
}

export function weaponRelicDb(): RelicDatabase {
  return {
    groups: {
      "Lith B1": {
        key: "Lith B1",
        name: "Lith B1",
        tier: "Lith",
        code: "B1",
        imageUrl: null,
        qualities: {
          intact: {
            uniqueName: LITH_B1,
            rewards: [
              {
                name: "Braton Prime Barrel",
                uniqueName: BRATONP_BARREL,
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
    byUniqueName: { [LITH_B1]: { groupKey: "Lith B1", quality: "intact" } },
  };
}
