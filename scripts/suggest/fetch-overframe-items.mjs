// Crawls the overframe.gg arsenal pages named by its sitemap and builds
// src/data/suggest/overframeItems.json and popularMods.json.
// Usage: node scripts/suggest/fetch-overframe-items.mjs [--limit N] [--retry-empty]
// A cold run is ~2400 requests at one per second; the cache makes it resumable.

import fs from "node:fs";
import path from "node:path";

import { curlFetch } from "./curl-fetch.mjs";
import { CACHE_DIR, DATA_DIR, loadLocalizationDict, readJson, writeJsonAtomic } from "./io.mjs";
import {
  ITEM_URL,
  SITEMAP_URL,
  fetchText,
  normalizeName,
  parseItemPage,
  parseSitemap,
  sleep,
} from "./overframe.mjs";

const CACHE_FILE = path.join(CACHE_DIR, "overframe-items-cache.json");
const ITEMS_FILE = path.join(DATA_DIR, "overframeItems.json");
const MODS_FILE = path.join(DATA_DIR, "popularMods.json");
const THROTTLE_MS = 1100;
const FLUSH_EVERY = 25;
const MIN_ITEMS = 500;
const MIN_WITH_MODS = 300;
const MAX_UNVISITED = 25;

const limitArg = process.argv.indexOf("--limit");
const limit = limitArg === -1 ? Infinity : Number(process.argv[limitArg + 1]);
// Next.js serves some arsenal pages without server props; they cache as misses
// so a rerun skips them, and this forces another look when that changes.
const retryEmpty = process.argv.includes("--retry-empty");

const resolveName = loadLocalizationDict();
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

const sitemap = parseSitemap(await fetchText(SITEMAP_URL, curlFetch));
if (sitemap.length < 1000) throw new Error(`sitemap has ${sitemap.length} arsenal urls`);
const stale = sitemap.filter((entry) => {
  const cached = cache[entry.id];
  if (!cached || cached.lastmod !== entry.lastmod) return true;
  return retryEmpty && !cached.item;
});
console.log(`${sitemap.length} arsenal urls, ${stale.length} to fetch`);

let fetched = 0;
let failed = 0;
for (const entry of stale) {
  if (stopping || fetched >= limit) break;
  if (fetched > 0) await sleep(THROTTLE_MS);
  try {
    const html = await fetchText(ITEM_URL(entry.id, entry.slug), curlFetch);
    cache[entry.id] = {
      lastmod: entry.lastmod,
      slug: entry.slug,
      item: parseItemPage(html, resolveName),
    };
    dirty = true;
  } catch (error) {
    // The sitemap still lists a few pages the site has dropped; cache the miss
    // so a rerun is not stuck refetching them.
    if (error.status === 404) {
      cache[entry.id] = { lastmod: entry.lastmod, slug: entry.slug, item: null };
      dirty = true;
    } else {
      failed++;
    }
    console.warn(`${entry.slug}: ${error.message}`);
  }
  fetched++;
  if (fetched % FLUSH_EVERY === 0) {
    flushCache();
    console.log(`  ${fetched}/${Math.min(stale.length, limit)}`);
  }
}
flushCache();
console.log(`fetched ${fetched}, failed ${failed}`);

const parsed = sitemap
  .map((entry) => ({ entry, cached: cache[entry.id] }))
  .filter(({ cached }) => cached?.item);

if (Number.isFinite(limit)) {
  console.log(`trial run of ${fetched} pages - not writing outputs`);
  for (const { cached } of parsed.slice(0, 3)) console.log(JSON.stringify(cached.item, null, 2));
  process.exit(stopping ? 130 : 0);
}

if (stopping) {
  console.error("interrupted - cache saved, refusing to overwrite outputs");
  process.exit(130);
}

const items = {};
const popularMods = {};
for (const { entry, cached } of parsed) {
  const item = cached.item;
  items[entry.id] = {
    slug: entry.slug,
    name: item.name,
    uniqueName: item.uniqueName,
    tag: item.tag,
    categories: item.categories,
    ingredients: item.ingredients,
  };
  if (item.topMods.length > 0) popularMods[normalizeName(item.name)] = item.topMods;
}

const withMods = Object.keys(popularMods).length;
const unvisited = sitemap.filter((entry) => !cache[entry.id]).length;
if (Object.keys(items).length < MIN_ITEMS || withMods < MIN_WITH_MODS) {
  console.error(
    `only ${Object.keys(items).length} items and ${withMods} mod lists - refusing to overwrite`,
  );
  process.exit(1);
}
if (unvisited > MAX_UNVISITED) {
  console.error(`${unvisited} urls never fetched - rerun to finish, refusing to overwrite`);
  process.exit(1);
}

await writeJsonAtomic(ITEMS_FILE, { items });
await writeJsonAtomic(MODS_FILE, popularMods);
console.log(`wrote ${ITEMS_FILE} with ${Object.keys(items).length} items`);
console.log(`wrote ${MODS_FILE} with ${withMods} mod lists`);
