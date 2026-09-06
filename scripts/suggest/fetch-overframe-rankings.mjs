// Builds src/data/suggest/rankings.json from the overframe.gg tier list votes.
// Names and slugs come from overframeItems.json, so run fetch-overframe-items
// first; the app refreshes this file at runtime against the same shipped map.

import path from "node:path";

import { DATA_DIR, readJson, writeJsonAtomic } from "./io.mjs";
import { fetchRankings } from "./overframe.mjs";

const ITEMS_FILE = path.join(DATA_DIR, "overframeItems.json");
const OUT_FILE = path.join(DATA_DIR, "rankings.json");
const MIN_NAMED = 400;

const itemData = readJson(ITEMS_FILE);
if (!itemData?.items) {
  console.error(`${ITEMS_FILE} is missing - run fetch-overframe-items.mjs first`);
  process.exit(1);
}

const describe = (id) => itemData.items[String(id)] ?? null;
const rankings = await fetchRankings(describe);

const entries = Object.values(rankings.items);
const named = entries.filter((entry) => entry.name).length;
if (named < MIN_NAMED) {
  console.error(`only ${named} named rankings - refusing to overwrite`);
  process.exit(1);
}

writeJsonAtomic(OUT_FILE, rankings);
const perCategory = new Map();
for (const entry of entries) {
  perCategory.set(entry.category, (perCategory.get(entry.category) ?? 0) + 1);
}
console.log(`wrote ${OUT_FILE} with ${entries.length} ranked items (${named} named)`);
for (const [category, count] of perCategory) console.log(`  ${category}: ${count}`);
