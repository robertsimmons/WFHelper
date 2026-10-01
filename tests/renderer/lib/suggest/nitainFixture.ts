import type { ItemDbEntry, MasteryData } from "../../../../src/types/inventory.js";

export const NITAIN = "/Lotus/Types/Items/MiscItems/Alertium";
const OROKIN_CELL = "/Lotus/Types/Items/MiscItems/OrokinCell";

const HYDROID = "/Lotus/Powersuits/Pirate/Pirate";
export const HYDROID_NEURO = "/Lotus/Types/Recipes/WarframeRecipes/PirateHelmetComponent";
const HYDROID_PRIME = "/Lotus/Powersuits/Pirate/PiratePrime";
export const NIDUS = "/Lotus/Powersuits/Infestation/Infestation";
export const NEKROS = "/Lotus/Powersuits/Necro/Necro";

interface Ingredient {
  uniqueName: string;
  count: number;
}

function frame(name: string, blueprint: string, ingredients: Ingredient[]): ItemDbEntry {
  return {
    name,
    productCategory: "Suits",
    category: "Warframes",
    masterable: true,
    ...(/\sPrime$/.test(name) ? { isPrime: true } : {}),
    recipe: {
      buildPrice: 25_000,
      buildTime: 259_200,
      num: 1,
      blueprintUniqueName: blueprint,
      ingredients: [...ingredients, { uniqueName: OROKIN_CELL, count: 1 }],
    },
  };
}

/** A normal frame whose Nitain sits in a part recipe, its Prime, a frame sold
 *  after mastering it and a frame still in hand; none of them yet subsumed. */
export function nitainDb(): Record<string, ItemDbEntry> {
  const bp = "/Lotus/Types/Recipes/WarframeRecipes";
  return {
    [NITAIN]: { name: "Nitain Extract", category: "Resource" },
    [OROKIN_CELL]: { name: "Orokin Cell", category: "Resource" },

    [HYDROID]: frame("Hydroid", `${bp}/HydroidBlueprint`, [
      { uniqueName: HYDROID_NEURO, count: 1 },
    ]),
    [`${bp}/HydroidBlueprint`]: { name: "Hydroid Blueprint", buildsProduct: HYDROID },
    [HYDROID_NEURO]: {
      name: "Hydroid Neuroptics",
      isBuildComponent: true,
      recipe: {
        buildPrice: 15_000,
        buildTime: 43_200,
        num: 1,
        blueprintUniqueName: `${bp}/PirateHelmetBlueprint`,
        ingredients: [{ uniqueName: NITAIN, count: 5 }],
      },
    },
    [`${bp}/PirateHelmetBlueprint`]: {
      name: "Hydroid Neuroptics Blueprint",
      buildsProduct: HYDROID_NEURO,
      isBuildComponent: true,
    },

    [HYDROID_PRIME]: frame("Hydroid Prime", `${bp}/HydroidPrimeBlueprint`, [
      { uniqueName: NITAIN, count: 2 },
    ]),
    [`${bp}/HydroidPrimeBlueprint`]: {
      name: "Hydroid Prime Blueprint",
      buildsProduct: HYDROID_PRIME,
    },

    [NIDUS]: frame("Nidus", `${bp}/NidusBlueprint`, [{ uniqueName: NITAIN, count: 3 }]),
    [`${bp}/NidusBlueprint`]: { name: "Nidus Blueprint", buildsProduct: NIDUS },

    [NEKROS]: frame("Nekros", `${bp}/NekrosBlueprint`, [{ uniqueName: NITAIN, count: 10 }]),
    [`${bp}/NekrosBlueprint`]: { name: "Nekros Blueprint", buildsProduct: NEKROS },
  };
}

const HOUND_PARTS = "/Lotus/Types/Friendly/Pets/ZanukaPets/ZanukaPetParts";
export const DORMA = `${HOUND_PARTS}/ZanukaPetPartHeadA`;
export const WANZ = `${HOUND_PARTS}/ZanukaPetPartTailA`;

function houndPart(name: string, nitain: number): ItemDbEntry {
  return {
    name,
    recipe: {
      buildPrice: 10_000,
      buildTime: 60,
      num: 1,
      ingredients: [
        { uniqueName: OROKIN_CELL, count: 1 },
        ...(nitain > 0 ? [{ uniqueName: NITAIN, count: nitain }] : []),
      ],
    },
  };
}

/** Two Hound models, whose Nitain sits only in the stabilizer each build takes;
 *  the dearer stabilizer never sets the price. */
export function withHounds(db: Record<string, ItemDbEntry>): Record<string, ItemDbEntry> {
  return {
    ...db,
    [DORMA]: houndPart("Dorma Hound", 0),
    [`${HOUND_PARTS}/ZanukaPetPartHeadB`]: houndPart("Bhaira Hound", 0),
    [`${HOUND_PARTS}/ZanukaPetPartBodyA`]: houndPart("Adlet Core", 0),
    [WANZ]: houndPart("Wanz Stabilizer", 3),
    [`${HOUND_PARTS}/ZanukaPetPartTailB`]: houndPart("Hinta Stabilizer", 4),
    [`/Lotus/Types/Recipes/ZanukaPetParts/ZanukaPetPartTailABlueprint`]: {
      name: "Wanz Stabilizer Blueprint",
      buildsProduct: WANZ,
      isBuildComponent: true,
    },
  };
}

export function masteredNidus(): MasteryData {
  return { items: [{ name: "Nidus", status: "mastered" }], stats: {} } as unknown as MasteryData;
}
