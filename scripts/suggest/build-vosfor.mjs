// Builds src/data/suggest/vosfor.json - Loid's Arcane Collection pools and the
// Vosfor each arcane dissolves into - from the Warframe wiki.
// Usage: node scripts/suggest/build-vosfor.mjs

import path from "node:path";

import { fetchWikiRaw } from "../wiki-raw.mjs";
import { DATA_DIR, writeJsonAtomic } from "./io.mjs";
import { parseLuaTable } from "./lua.mjs";
import { ARCANE_MODULE, ENHANCEMENT_PAGE, LOID_PAGE, buildVosfor } from "./vosfor.mjs";

const VOSFOR_FILE = path.join(DATA_DIR, "vosfor.json");
const MIN_YIELDS = 100;

const loid = await fetchWikiRaw(encodeURIComponent(LOID_PAGE));
const enhancement = await fetchWikiRaw(ENHANCEMENT_PAGE);
const arcanes = parseLuaTable(await fetchWikiRaw(ARCANE_MODULE));

const { data, warnings } = buildVosfor(loid, enhancement, arcanes);
for (const warning of warnings) console.warn(`odds differ - using Loid's: ${warning}`);

const yieldCount = Object.keys(data.yields).length;
if (data.collections.length === 0 || yieldCount < MIN_YIELDS) {
  console.error(
    `${data.collections.length} collections, ${yieldCount} yields - refusing to overwrite`,
  );
  process.exit(1);
}

await writeJsonAtomic(VOSFOR_FILE, data);
console.log(
  `wrote ${VOSFOR_FILE} with ${data.collections.length} collections, ${yieldCount} yields`,
);
