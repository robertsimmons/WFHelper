// Regenerates syndicate-turn-in-slice.json from the api-helper's inventory.json:
//   node scripts/safe-to-sell/capture-turn-in-slice.mjs <path-to-inventory.json>
// Keeps every audited syndicate's turn-in items (and fish parts), every recipe chain that consumes
// them (blueprints, sibling parts, built products), the vendor exchange rows,
// standing, foundry builds and Helminth-consumed suits.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(repoRoot, file), "utf-8"));

const SYNDICATES = [
  "EntratiLabSyndicate",
  "ZarimanSyndicate",
  "EntratiSyndicate",
  "NecraloidSyndicate",
  "CetusSyndicate",
  "SolarisSyndicate",
  "HexSyndicate",
  "QuillsSyndicate",
  "VoxSyndicate",
];
const STACKED = ["Recipes", "MiscItems"];
const GEAR = [
  "Suits",
  "LongGuns",
  "Pistols",
  "Melee",
  "SpaceSuits",
  "SpaceGuns",
  "SpaceMelee",
  "MechSuits",
  "Sentinels",
  "SentinelWeapons",
  "MoaPets",
  "KubrowPets",
  "OperatorAmps",
  "Hoverboards",
  "Ships",
  "XPInfo",
];
const FIELDS = ["ItemType", "ItemCount", "XP", "Features", "Polarized"];
// Consumers the wiki lists that the bundled export predates: Nunchasa's limbs
// (Voidplume Pinion, Update 44).
const EXTRA_PRODUCTS = ["/Lotus/Weapons/Tenno/Bows/DuelistBow/DuelistBow"];

const source = process.argv[2];
if (!source) throw new Error("usage: capture-turn-in-slice.mjs <inventory.json>");
const inventory = JSON.parse(fs.readFileSync(source, "utf-8"));

const turnIns = readJson("src/data/syndicateTurnIns.json").syndicates;
// Fish count through the parts they are cut into.
const targets = SYNDICATES.flatMap((tag) =>
  turnIns[tag].turnIns.flatMap((row) => [
    row.itemType,
    ...(row.yields ?? []).map((part) => part.itemType),
  ]),
).filter(Boolean);
const recipes = readJson("node_modules/warframe-public-export-plus/ExportRecipes.json");

const byIngredient = new Map();
const byResult = new Map();
for (const [blueprint, recipe] of Object.entries(recipes)) {
  byResult.set(recipe.resultType, [...(byResult.get(recipe.resultType) ?? []), blueprint]);
  for (const ingredient of recipe.ingredients ?? []) {
    const list = byIngredient.get(ingredient.ItemType) ?? [];
    list.push({ blueprint, result: recipe.resultType });
    byIngredient.set(ingredient.ItemType, list);
  }
}

// Every product downstream of a target, then each product's recipes and their ingredients.
const products = new Set(EXTRA_PRODUCTS);
const queue = [...targets];
while (queue.length > 0) {
  for (const use of byIngredient.get(queue.pop()) ?? []) {
    if (products.has(use.result)) continue;
    products.add(use.result);
    queue.push(use.result);
  }
}
// Every modular part (MR pieces and their companions, built copies held) and
// the Predasite/Vulpaphyla suits: gilding and assembly decide their mastery.
const weapons = readJson("node_modules/warframe-public-export-plus/ExportWeapons.json");
for (const [uniqueName, weapon] of Object.entries(weapons)) {
  if (weapon.partType) products.add(uniqueName);
}
const sentinels = readJson("node_modules/warframe-public-export-plus/ExportSentinels.json");
for (const uniqueName of Object.keys(sentinels)) {
  if (uniqueName.includes("/CreaturePets/")) products.add(uniqueName);
}
const kept = new Set([...targets, ...products]);
for (const product of products) {
  for (const blueprint of byResult.get(product) ?? []) {
    kept.add(blueprint);
    for (const { ItemType } of recipes[blueprint].ingredients ?? []) {
      kept.add(ItemType);
      for (const part of byResult.get(ItemType) ?? []) kept.add(part);
    }
  }
}
for (const offers of Object.values(readJson("src/data/suggest/vendorExchange.json"))) {
  for (const offer of offers?.offers ?? []) {
    kept.add(offer.uniqueName);
    for (const price of offer.prices ?? []) kept.add(price.uniqueName);
  }
}

const pick = (entry) =>
  Object.fromEntries(
    FIELDS.filter((field) => field in entry).map((field) => [field, entry[field]]),
  );
const rows = (key, keep) =>
  (Array.isArray(inventory[key]) ? inventory[key] : [])
    .filter((row) => keep.has(row?.ItemType))
    .map(pick);

const slice = {};
for (const key of STACKED) slice[key] = rows(key, kept);
for (const key of GEAR) slice[key] = rows(key, products);
slice.PendingRecipes = (inventory.PendingRecipes ?? []).map((row) => ({ ItemType: row.ItemType }));
slice.Affiliations = (inventory.Affiliations ?? [])
  .filter((row) => SYNDICATES.includes(row.Tag))
  .map(({ Tag, Standing, Title }) => ({ Tag, Standing, Title }));
slice.InfestedFoundry = {
  ConsumedSuits: (inventory.InfestedFoundry?.ConsumedSuits ?? []).map((row) => ({
    s: row.s ?? row.ItemType,
  })),
};

const out = path.join(repoRoot, "tests/fixtures/safe-to-sell/syndicate-turn-in-slice.json");
fs.writeFileSync(out, `${JSON.stringify(slice, null, 1)}\n`);
console.log(`wrote ${out}`);
