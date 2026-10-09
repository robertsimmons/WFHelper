// Regenerates user-inventory-slice.json from the api-helper's inventory.json:
//   node tests/fixtures/safe-to-sell/captureInventorySlice.mjs <path-to-inventory.json>
// Keeps only Prime-pathed rows of the collections the safe-to-sell pipeline
// reads, and only the fields it reads from them.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const COLLECTIONS = [
  "Recipes",
  "MiscItems",
  "Suits",
  "LongGuns",
  "Pistols",
  "Melee",
  "Sentinels",
  "SentinelWeapons",
  "SpaceSuits",
  "SpaceGuns",
  "SpaceMelee",
  "KubrowPets",
  "XPInfo",
];
const FIELDS = ["ItemType", "ItemCount", "XP", "Features", "Polarized"];

const source = process.argv[2];
if (!source) throw new Error("usage: captureInventorySlice.mjs <inventory.json>");
const inventory = JSON.parse(fs.readFileSync(source, "utf-8"));

const pick = (entry) =>
  Object.fromEntries(
    FIELDS.filter((field) => field in entry).map((field) => [field, entry[field]]),
  );

const slice = {};
for (const key of COLLECTIONS) {
  const rows = Array.isArray(inventory[key]) ? inventory[key] : [];
  slice[key] = rows.filter((row) => /prime/i.test(row?.ItemType ?? "")).map(pick);
}
// Foundry builds can spend any blueprint, so every pending build is kept.
slice.PendingRecipes = (inventory.PendingRecipes ?? []).map((row) => ({ ItemType: row.ItemType }));

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "user-inventory-slice.json");
fs.writeFileSync(out, `${JSON.stringify(slice, null, 1)}\n`);
console.log(`wrote ${out}`);
