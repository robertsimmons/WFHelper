// Builds src/data/suggest/weapons.json - the curated weapon acquisition table -
// and src/data/suggest/progenitors.json from the Warframe wiki.
// Usage: node scripts/suggest/build-weapons.mjs [--limit N] [--refetch]
// A cold run is ~710 requests at one per second; the cache makes it resumable.

import fs from "node:fs";
import path from "node:path";

import { fetchWikiRaw } from "../wiki-raw.mjs";
import { CACHE_DIR, DATA_DIR, readJson, writeJsonAtomic } from "./io.mjs";
import { sleep } from "./overframe.mjs";
import { parseLuaTable } from "./lua.mjs";
import {
  ADVERSARY_PAGES,
  WEAPON_MODULES,
  buildProgenitors,
  buildTable,
  listWeapons,
} from "./weapons.mjs";

const CACHE_FILE = path.join(CACHE_DIR, "weapon-articles-cache.json");
const WEAPONS_FILE = path.join(DATA_DIR, "weapons.json");
const PROGENITORS_FILE = path.join(DATA_DIR, "progenitors.json");
const THROTTLE_MS = 1100;
const FLUSH_EVERY = 25;
const MIN_WEAPONS = 400;

const limitArg = process.argv.indexOf("--limit");
const limit = limitArg === -1 ? Infinity : Number(process.argv[limitArg + 1]);
const refetch = process.argv.includes("--refetch");

const cache = readJson(CACHE_FILE, {}) ?? {};
let dirty = false;

function flushCache() {
  if (!dirty) return;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(`${CACHE_FILE}.tmp`, JSON.stringify(cache));
  fs.renameSync(`${CACHE_FILE}.tmp`, CACHE_FILE);
  dirty = false;
}

let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});

let fetched = 0;
async function page(name) {
  if (!refetch && typeof cache[name] === "string") return cache[name];
  if (fetched > 0) await sleep(THROTTLE_MS);
  fetched++;
  const text = await fetchWikiRaw(encodeURIComponent(name.replace(/ /g, "_")));
  cache[name] = text;
  dirty = true;
  if (fetched % FLUSH_EVERY === 0) flushCache();
  return text;
}

const modules = {};
for (const name of WEAPON_MODULES) {
  modules[name] = parseLuaTable(await page(`Module:Weapons/data/${name}`));
}
const weapons = listWeapons(modules);
console.log(`${weapons.length} weapons, ${new Set(weapons.map((w) => w.link)).size} articles`);

const support = {};
for (const name of ADVERSARY_PAGES) support[name] = await page(name);

const articles = {};
const links = [...new Set(weapons.map((w) => w.link))];
for (const link of links) {
  if (stopping || fetched >= limit) break;
  try {
    articles[link] = await page(link);
  } catch (error) {
    console.warn(`${link}: ${error.message}`);
  }
}
flushCache();
console.log(`fetched ${fetched} pages`);

if (stopping || fetched >= limit) {
  console.error("stopped early - cache saved, refusing to overwrite outputs");
  process.exit(130);
}

for (const link of links) articles[link] ??= cache[link];

const table = buildTable(weapons, articles, support);
const progenitors = buildProgenitors(parseLuaTable(await page("Module:Warframes/data")));

const covered = Object.keys(table).length;
if (covered < MIN_WEAPONS) {
  console.error(`only ${covered} weapons resolved - refusing to overwrite`);
  process.exit(1);
}
if (Object.keys(progenitors).length < 40) {
  console.error(`only ${Object.keys(progenitors).length} progenitors - refusing to overwrite`);
  process.exit(1);
}

await writeJsonAtomic(WEAPONS_FILE, table);
await writeJsonAtomic(PROGENITORS_FILE, progenitors);
console.log(`wrote ${WEAPONS_FILE} with ${covered} of ${weapons.length} weapons`);
console.log(`wrote ${PROGENITORS_FILE} with ${Object.keys(progenitors).length} frames`);
