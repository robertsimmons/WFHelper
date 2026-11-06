// Builds src/data/modularMastery.json from the bundled public export: the
// modular pieces that award mastery, the companion parts each build needs one
// of per slot, the gild each owes, every gild blueprint, and the materials
// refined from a raw prospecting find.
// Usage: node scripts/suggest/build-modular-mastery.mjs

import path from "node:path";

import { DATA_DIR, readPublicExport, writeJsonAtomic } from "./io.mjs";

const OUT_FILE = path.join(DATA_DIR, "..", "modularMastery.json");

const recipes = readPublicExport("ExportRecipes.json") ?? {};
const resources = readPublicExport("ExportResources.json") ?? {};
const weapons = readPublicExport("ExportWeapons.json") ?? {};

const GILD_ACTION = "SIA_GILD_WEAPON";
const GEM_CLASS = "/Lotus/Types/Items/Gems/GemItem";

const ZAW_GILD = "/Lotus/Weapons/Ostron/Melee/LotusGildWeaponBlueprint";
const AMP_GILD = "/Lotus/Weapons/Sentients/OperatorAmplifiers/OperatorGildAmpBlueprint";
const CORPUS_AMP_GILD =
  "/Lotus/Weapons/Sentients/OperatorAmplifiers/OperatorGildAmpFortunaBlueprint";
const KITGUN_GILD = "/Lotus/Weapons/SolarisUnited/LotusGildKitgunBlueprint";
const INFESTED_KITGUN_GILD = "/Lotus/Weapons/SolarisUnited/LotusGildInfestedKitgunBlueprint";
// The export has no Hound gild; the wiki Debt-Bond page has Hounds gild like MOAs.
const MOA_GILD = "/Lotus/Types/Friendly/Pets/MoaPets/LotusGildMoaPetBlueprint";
const CREATURE_GILD = "/Lotus/Types/Friendly/Pets/CreaturePets/LotusGildCreaturePetBlueprint";

const KITGUN_GRIPS = ["LWPT_GUN_PRIMARY_HANDLE", "LWPT_GUN_SECONDARY_HANDLE"];

/** MR part type -> the part types one build takes one of each, and its gild. */
const MODULAR = {
  LWPT_BLADE: { slots: [["LWPT_HILT"], ["LWPT_HILT_WEIGHT"]], gild: () => ZAW_GILD },
  LWPT_AMP_OCULUS: {
    slots: [["LWPT_AMP_CORE"], ["LWPT_AMP_BRACE"]],
    gild: (uniqueName) => (uniqueName.includes("/Corpus/") ? CORPUS_AMP_GILD : AMP_GILD),
  },
  LWPT_GUN_BARREL: {
    slots: [KITGUN_GRIPS, ["LWPT_GUN_CLIP"]],
    gild: (uniqueName) => (uniqueName.includes("/InfKitGun/") ? INFESTED_KITGUN_GILD : KITGUN_GILD),
  },
  LWPT_MOA_HEAD: {
    slots: [["LWPT_MOA_ENGINE"], ["LWPT_MOA_PAYLOAD"], ["LWPT_MOA_LEG"]],
    gild: () => MOA_GILD,
  },
  LWPT_ZANUKA_HEAD: {
    slots: [["LWPT_ZANUKA_BODY"], ["LWPT_ZANUKA_LEG"], ["LWPT_ZANUKA_TAIL"]],
    gild: () => MOA_GILD,
  },
  LWPT_HB_DECK: {
    slots: [["LWPT_HB_FRONT"], ["LWPT_HB_JET"], ["LWPT_HB_ENGINE"]],
    gild: () => null,
  },
};

const CREATURES = "/Lotus/Types/Friendly/Pets/CreaturePets/";
const PREDASITE = ["LWPT_KUBROW_ANTIGEN", "LWPT_KUBROW_MUTAGEN"];
const VULPAPHYLA = ["LWPT_CATBROW_ANTIGEN", "LWPT_CATBROW_MUTAGEN"];
/** Bred, never built: each creature takes one antigen and one mutagen. */
const PETS = {
  [`${CREATURES}VizierPredatorKubrowPetPowerSuit`]: PREDASITE,
  [`${CREATURES}PharaohPredatorKubrowPetPowerSuit`]: PREDASITE,
  [`${CREATURES}MedjayPredatorKubrowPetPowerSuit`]: PREDASITE,
  [`${CREATURES}VulpineInfestedCatbrowPetPowerSuit`]: VULPAPHYLA,
  [`${CREATURES}HornedInfestedCatbrowPetPowerSuit`]: VULPAPHYLA,
  [`${CREATURES}ArmoredInfestedCatbrowPetPowerSuit`]: VULPAPHYLA,
};

const built = new Set(
  Object.values(recipes)
    .filter((recipe) => recipe.secretIngredientAction !== GILD_ACTION)
    .map((recipe) => recipe.resultType),
);

/** Part type -> its buildable parts, by uniqueName. */
const parts = {};
for (const [uniqueName, entry] of Object.entries(weapons)) {
  if (entry.partType && built.has(uniqueName)) (parts[entry.partType] ??= []).push(uniqueName);
}
for (const list of Object.values(parts)) list.sort();

const weaponPieces = Object.entries(weapons)
  .filter(([uniqueName, entry]) => MODULAR[entry.partType] && built.has(uniqueName))
  .sort(([a], [b]) => (a < b ? -1 : 1))
  .map(([uniqueName, entry]) => {
    const spec = MODULAR[entry.partType];
    const gild = spec.gild(uniqueName);
    return { uniqueName, slots: spec.slots, ...(gild ? { gild } : {}) };
  });
const petPieces = Object.entries(PETS).map(([uniqueName, slots]) => ({
  uniqueName,
  slots: slots.map((type) => [type]),
  gild: CREATURE_GILD,
}));

const gilds = {};
for (const [blueprint, recipe] of Object.entries(recipes)) {
  if (recipe.secretIngredientAction !== GILD_ACTION) continue;
  gilds[blueprint] = (recipe.ingredients ?? []).map((ingredient) => ({
    uniqueName: ingredient.ItemType,
    count: ingredient.ItemCount,
  }));
}

const refined = Object.values(recipes)
  .filter((recipe) => resources[recipe.resultType]?.parentName === GEM_CLASS)
  .map((recipe) => recipe.resultType)
  .sort();

await writeJsonAtomic(OUT_FILE, {
  source: "warframe-public-export-plus ExportWeapons, ExportRecipes, ExportResources",
  pieces: [...weaponPieces, ...petPieces],
  parts,
  gilds,
  refined,
});
console.log(`wrote ${OUT_FILE}`);
