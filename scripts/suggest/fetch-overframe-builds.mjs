// Crawls overframe.gg builds into src/data/suggest/arcanes.json, off the item
// list fetch-overframe-items.mjs wrote. That script runs this crawl too.
// Usage: node scripts/suggest/fetch-overframe-builds.mjs [--limit N]
// --limit caps the requests and writes nothing; the cache makes a run resumable.

import path from "node:path";

import { DATA_DIR, loadLocalizationDict, readJson } from "./io.mjs";
import { arcaneBearingItems, crawlArcaneBuilds, writeArcanes } from "./overframe-builds.mjs";

const ITEMS_FILE = path.join(DATA_DIR, "overframeItems.json");

const limitArg = process.argv.indexOf("--limit");
const limit = limitArg === -1 ? Infinity : Number(process.argv[limitArg + 1]);

const catalog = readJson(ITEMS_FILE);
if (!catalog?.items) {
  console.error(`${ITEMS_FILE} is missing - run fetch-overframe-items.mjs first`);
  process.exit(1);
}

let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});

const items = arcaneBearingItems(catalog.items);
console.log(`${items.length} items can slot arcanes`);
const result = await crawlArcaneBuilds({
  items,
  resolveName: loadLocalizationDict(),
  limit,
  isStopping: () => stopping,
});

if (Number.isFinite(limit)) {
  console.log(`trial run of ${result.requests} requests - not writing arcanes.json`);
  console.log(JSON.stringify(result.arcanes.slice(0, 10), null, 2));
  process.exit(stopping ? 130 : 0);
}
if (stopping) {
  console.error("interrupted - cache saved, refusing to overwrite arcanes.json");
  process.exit(130);
}
if (!(await writeArcanes(result, items))) process.exit(1);
