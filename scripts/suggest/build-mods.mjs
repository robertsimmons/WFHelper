// Builds src/data/suggest/mods.json from popularMods.json, without refetching.
// Usage: node scripts/suggest/build-mods.mjs

import path from "node:path";

import { DATA_DIR, readJson, writeJsonAtomic } from "./io.mjs";
import { foldPopularMods } from "./mods.mjs";

const POPULAR_FILE = path.join(DATA_DIR, "popularMods.json");
const MODS_FILE = path.join(DATA_DIR, "mods.json");

const popularMods = readJson(POPULAR_FILE);
if (!popularMods) {
  console.error(`${POPULAR_FILE} is missing or unreadable`);
  process.exit(1);
}

const mods = foldPopularMods(popularMods);
await writeJsonAtomic(MODS_FILE, mods);
console.log(`wrote ${MODS_FILE} with ${mods.length} mods`);
