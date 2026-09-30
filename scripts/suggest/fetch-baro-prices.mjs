// Builds src/data/suggest/baroPrices.json - ducat and credit cost of everything
// Baro Ki'Teer has sold - from the Warframe wiki.
// Usage: node scripts/suggest/fetch-baro-prices.mjs

import path from "node:path";

import { fetchWikiRaw } from "../wiki-raw.mjs";
import { BARO_MODULE, parseBaroPrices } from "./baro.mjs";
import { DATA_DIR, writeJsonAtomic } from "./io.mjs";

const OUT_FILE = path.join(DATA_DIR, "baroPrices.json");
const MIN_ITEMS = 300;

const prices = parseBaroPrices(await fetchWikiRaw(encodeURIComponent(BARO_MODULE)));
const count = Object.keys(prices).length;
if (count < MIN_ITEMS) {
  console.error(`only ${count} priced items - refusing to overwrite`);
  process.exit(1);
}

await writeJsonAtomic(OUT_FILE, prices);
console.log(`wrote ${OUT_FILE} with ${count} items`);
