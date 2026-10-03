// Builds src/data/suggest/relicPacks.json - every relic a relic pack can roll -
// from the Warframe wiki.
// Usage: node scripts/suggest/build-relic-packs.mjs

import path from "node:path";

import { fetchWikiRaw } from "../wiki-raw.mjs";
import { DATA_DIR, writeJsonAtomic } from "./io.mjs";
import { VOID_DATA_MODULE, VOID_MODULE, buildRelicPacks } from "./relicPacks.mjs";

const RELIC_PACKS_FILE = path.join(DATA_DIR, "relicPacks.json");
const MIN_POOL = 20;

const voidText = await fetchWikiRaw(VOID_MODULE);
const voidData = await fetchWikiRaw(VOID_DATA_MODULE);

const data = buildRelicPacks(voidText, voidData);
if (data.pool.length < MIN_POOL) {
  console.error(`${data.pool.length} pool relics - refusing to overwrite`);
  process.exit(1);
}

await writeJsonAtomic(RELIC_PACKS_FILE, data);
console.log(`wrote ${RELIC_PACKS_FILE} with ${data.pool.length} pool relics`);
