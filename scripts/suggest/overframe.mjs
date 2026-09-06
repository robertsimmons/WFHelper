// Shared overframe.gg fetching and parsing for the suggest data build.
// Nothing here touches node builtins, so the app can reuse the ranking fetch
// to refresh rankings.json at runtime.

export const USER_AGENT = "WFHelper (Warframe companion app) data build";
export const ITEM_URL = (id, slug) => `https://overframe.gg/items/arsenal/${id}/${slug}/`;
export const SITEMAP_URL = "https://overframe.gg/sitemap.xml";
const TIER_LIST_URL = "https://overframe.gg/api/v1/tierlists/";
const RATE_LIMIT_DELAY_MS = 30_000;
// Cloudflare sprays a 403 over roughly one page request in ten no matter how
// slow the crawl is, and the same url answers moments later, so a 403 gets a
// short backoff and more attempts than the rate-limit statuses do.
const BOT_CHECK_DELAY_MS = 5_000;
const ATTEMPTS = 3;

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelay(res, attempt) {
  if (res.status === 403) return attempt < ATTEMPTS - 1 ? BOT_CHECK_DELAY_MS : null;
  if (res.status !== 429 && res.status !== 503) return null;
  if (attempt > 0) return null;
  const after = Number(res.headers.get("retry-after"));
  return Number.isFinite(after) && after > 0 ? after * 1000 : RATE_LIMIT_DELAY_MS;
}

async function request(url, fetchImpl) {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const res = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.ok) return res;
    const delay = retryDelay(res, attempt);
    if (delay === null)
      throw Object.assign(new Error(`${url}: HTTP ${res.status}`), {
        status: res.status,
      });
    await sleep(delay);
  }
  throw new Error(`${url}: unreachable`);
}

export async function fetchText(url, fetchImpl = fetch) {
  return (await request(url, fetchImpl)).text();
}

export async function fetchJson(url, fetchImpl = fetch) {
  return JSON.parse(await (await request(url, fetchImpl)).text());
}

export function normalizeName(name) {
  return String(name).toLowerCase().replace(/\s+/g, " ").trim();
}

const NEXT_DATA_RE =
  /<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/;

/** Null for a page whose props Next.js leaves to the client; mod pages do that. */
export function extractNextData(html) {
  const match = NEXT_DATA_RE.exec(html);
  if (!match) return null;
  const props = JSON.parse(match[1])?.props?.pageProps;
  if (!props || Object.keys(props).length === 0) return null;
  return props;
}

const ARSENAL_RE = /\/items\/arsenal\/(\d+)\/([a-z0-9-]+)\/$/;

export function parseSitemap(xml) {
  const entries = [];
  const seen = new Set();
  for (const block of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = /<loc>([^<]*)<\/loc>/.exec(block[1])?.[1];
    const arsenal = loc && ARSENAL_RE.exec(loc);
    if (!arsenal) continue;
    const id = Number(arsenal[1]);
    if (seen.has(id)) continue;
    seen.add(id);
    entries.push({
      id,
      slug: arsenal[2],
      lastmod: /<lastmod>([^<]*)<\/lastmod>/.exec(block[1])?.[1] ?? null,
    });
  }
  return entries;
}

/** Ingredient items carry only a DE localization tag, so names need a resolver. */
export function normalizeIngredients(raw, resolveName) {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const locTag = entry?.item?.locTag ?? null;
    return {
      name: (locTag && resolveName?.(locTag)) || null,
      locTag,
      count: entry?.count ?? 1,
      sources: (entry?.sources ?? []).map((source) => ({
        source: source.source ?? null,
        chance: source.chance ?? null,
        rarity: source.rarity ?? null,
      })),
    };
  });
}

export function parseItemPage(html, resolveName) {
  const props = extractNextData(html);
  if (!props?.item?.name) return null;
  return {
    id: props.item.id,
    name: props.item.name,
    uniqueName: props.item.path ?? null,
    tag: props.item.tag ?? null,
    categories: props.item.categories ?? [],
    topMods: (props.topMods ?? []).map((mod) => mod.name).filter(Boolean),
    ingredients: normalizeIngredients(props.blueprintIngredients, resolveName),
  };
}

/** The abilities tier list votes on a separate id space from the arsenal, so
 *  those rows keep an id key and a null name until something can name them. */
export function buildRankings(categories, votesByCategory, describe) {
  const items = {};
  for (const category of categories) {
    for (const vote of votesByCategory[category.id] ?? []) {
      const known = describe?.(vote.item_id) ?? null;
      const key = known?.name ? normalizeName(known.name) : `#${vote.item_id}`;
      const existing = items[key];
      if (existing && existing.votes >= vote.total) continue;
      items[key] = {
        id: vote.item_id,
        name: known?.name ?? null,
        slug: known?.slug ?? null,
        category: category.title,
        categoryId: category.id,
        averageScore: vote.average_score,
        votes: vote.total,
      };
    }
  }
  const sorted = {};
  for (const key of Object.keys(items).sort()) sorted[key] = items[key];
  return sorted;
}

export async function fetchRankings(describe, fetchImpl = fetch) {
  const index = await fetchJson(TIER_LIST_URL, fetchImpl);
  const categories = [...index.results].sort((a, b) => a.id - b.id);
  const votesByCategory = {};
  for (const category of categories) {
    const list = await fetchJson(`${TIER_LIST_URL}${category.id}/`, fetchImpl);
    votesByCategory[category.id] = list.votes ?? [];
  }
  return {
    fetchedAt: new Date().toISOString(),
    categories: Object.fromEntries(categories.map((c) => [c.id, c.title])),
    items: buildRankings(categories, votesByCategory, describe),
  };
}
