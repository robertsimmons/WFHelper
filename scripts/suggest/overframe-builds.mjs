// Crawls overframe.gg builds for which arcanes players slot, and writes
// src/data/suggest/arcanes.json. The build API carries the same build record
// the build page's __NEXT_DATA__ does, without the page around it.

import fs from "node:fs";
import path from "node:path";

import {
  countedBuilds,
  foldArcaneBuilds,
  modDbChunkUrl,
  needsNextPage,
  parseModDb,
  slottedArcanes,
  webpackRuntimeUrl,
} from "./arcanes.mjs";
import { curlFetch } from "./curl-fetch.mjs";
import { CACHE_DIR, DATA_DIR, readJson, readPublicExport, writeJsonAtomic } from "./io.mjs";
import { ITEM_URL, fetchJson, fetchText, sleep } from "./overframe.mjs";

const BUILDS_API = "https://overframe.gg/api/v1/builds/";
const CACHE_FILE = path.join(CACHE_DIR, "overframe-builds-cache.json");
export const ARCANES_FILE = path.join(DATA_DIR, "arcanes.json");
const THROTTLE_MS = 1100;
const FLUSH_EVERY = 25;
const LIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 25;
// Only these carry arcane slots; companions, archwing and mechs never do.
const ARCANE_CATEGORIES = new Set(["warframe", "primary", "secondary", "melee"]);
const MIN_ARCANE_IDS = 100;
const MIN_BUILDS = 300;
const MAX_FAILED = 25;

/** Overframe items that can slot an arcane, from the arsenal crawl's output. */
export function arcaneBearingItems(items) {
  return Object.entries(items ?? {})
    .filter(([, item]) => (item.categories ?? []).some((c) => ARCANE_CATEGORIES.has(c)))
    .map(([id, item]) => ({ id: Number(id), slug: item.slug, name: item.name }));
}

function arcaneNames(resolveName) {
  const exported = readPublicExport("ExportArcanes.json") ?? {};
  const names = new Map();
  for (const [uniqueName, arcane] of Object.entries(exported)) {
    const name = arcane?.name ? resolveName(arcane.name)?.trim() : null;
    if (name) names.set(uniqueName, name);
  }
  return names;
}

export async function crawlArcaneBuilds({ items, resolveName, limit = Infinity, isStopping }) {
  const started = Date.now();
  const cache = readJson(CACHE_FILE, {}) ?? {};
  cache.lists ??= {};
  cache.builds ??= {};
  let dirty = false;
  let lastRequest = 0;

  function flush() {
    if (!dirty) return;
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(`${CACHE_FILE}.tmp`, JSON.stringify(cache));
    fs.renameSync(`${CACHE_FILE}.tmp`, CACHE_FILE);
    dirty = false;
  }

  async function polite(fetcher) {
    const wait = lastRequest + THROTTLE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await fetcher();
    } finally {
      lastRequest = Date.now();
    }
  }

  const names = arcaneNames(resolveName);
  const [first] = items;
  if (!first) throw new Error("no items to crawl builds for");
  const html = await polite(() => fetchText(ITEM_URL(first.id, first.slug), curlFetch));
  const runtimeUrl = webpackRuntimeUrl(html);
  if (!runtimeUrl) throw new Error("no webpack runtime on the item page");
  const runtime = await polite(() => fetchText(runtimeUrl, curlFetch));
  const chunkUrl = modDbChunkUrl(runtime, runtimeUrl);
  if (!chunkUrl) throw new Error("no mod database chunk in the webpack runtime");
  if (cache.modDb?.url !== chunkUrl) {
    const modDb = parseModDb(await polite(() => fetchText(chunkUrl, curlFetch)));
    const ids = {};
    for (const [id, uniqueName] of modDb) if (names.has(uniqueName)) ids[id] = uniqueName;
    cache.modDb = { url: chunkUrl, ids };
    dirty = true;
  }
  const arcaneById = new Map(Object.entries(cache.modDb.ids).map(([id, u]) => [Number(id), u]));
  if (arcaneById.size < MIN_ARCANE_IDS) {
    throw new Error(`only ${arcaneById.size} arcanes in Overframe's mod database`);
  }

  let requests = 0;
  let failed = 0;
  let visited = 0;
  const buildArcanes = [];

  async function buildList(item) {
    const held = cache.lists[item.id];
    if (held && Date.now() - held.fetchedAt < LIST_MAX_AGE_MS) return held.builds;
    const builds = [];
    let url = `${BUILDS_API}?item_id=${item.id}&ordering=-score&limit=${PAGE_SIZE}`;
    while (url) {
      const page = await polite(() => fetchJson(url));
      requests++;
      for (const build of page.results ?? []) {
        builds.push({ id: build.id, score: build.score ?? 0, updated: build.updated ?? null });
      }
      url = needsNextPage(page) ? page.next : null;
    }
    cache.lists[item.id] = { fetchedAt: Date.now(), builds };
    dirty = true;
    return builds;
  }

  async function arcanesOf(build) {
    const held = cache.builds[build.id];
    if (held && held.updated === build.updated) return held.arcanes;
    const record = await polite(() => fetchJson(`${BUILDS_API}${build.id}/`));
    requests++;
    const arcanes = slottedArcanes(record, arcaneById);
    cache.builds[build.id] = { updated: build.updated, arcanes };
    dirty = true;
    return arcanes;
  }

  for (const [index, item] of items.entries()) {
    if (isStopping?.() || requests >= limit) break;
    try {
      for (const build of countedBuilds(await buildList(item))) {
        buildArcanes.push(await arcanesOf(build));
      }
      visited++;
    } catch (error) {
      failed++;
      console.warn(`${item.slug}: ${error.message}`);
    }
    if ((index + 1) % FLUSH_EVERY === 0) {
      flush();
      console.log(`  ${index + 1}/${items.length} items, ${requests} requests`);
    }
  }
  flush();

  const arcanes = foldArcaneBuilds(buildArcanes, names);
  return {
    arcanes,
    items: visited,
    builds: buildArcanes.length,
    slotted: arcanes.filter((arcane) => arcane.count > 0).length,
    requests,
    failed,
    seconds: Math.round((Date.now() - started) / 1000),
  };
}

/** Writes arcanes.json unless the crawl came back too thin to trust. */
export async function writeArcanes(result, items) {
  const summary =
    `${result.items}/${items.length} items, ${result.builds} builds, ` +
    `${result.slotted} arcanes slotted, ${result.requests} requests, ` +
    `${result.failed} failed, ${result.seconds}s`;
  console.log(summary);
  const unvisited = items.length - result.items - result.failed;
  if (result.builds < MIN_BUILDS || result.failed > MAX_FAILED || unvisited > 0) {
    console.error("build crawl incomplete - refusing to overwrite arcanes.json");
    return false;
  }
  await writeJsonAtomic(ARCANES_FILE, result.arcanes);
  console.log(`wrote ${ARCANES_FILE} with ${result.arcanes.length} arcanes`);
  return true;
}
