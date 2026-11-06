// Builds src/data/syndicateTurnIns.json - the items each syndicate takes for
// standing that something else (rank-ups, recipes, vendors) also consumes, with
// the standing per unit and, for fish, what cutting one up yields; plus the shop
// trades that turn those items into a recipe ingredient. Standing and
// yields come from the wiki; uniqueNames from the bundled public export.
// Usage: node scripts/suggest/build-syndicate-turnins.mjs

import path from "node:path";

import { fetchWikiRaw } from "../wiki-raw.mjs";
import { DATA_DIR, loadLocalizationDict, readPublicExport, writeJsonAtomic } from "./io.mjs";

const OUT_FILE = path.join(DATA_DIR, "..", "syndicateTurnIns.json");

// Each page's "Trade-In / Standing gained" table; Universal Medallion is left
// out because standing is its only use.
const TRADE_IN_PAGES = {
  EntratiLabSyndicate: ["Cavia"],
  ZarimanSyndicate: ["The_Holdfasts"],
  HexSyndicate: ["The_Hex_(Syndicate)"],
  EntratiSyndicate: ["Entrati"],
  NecraloidSyndicate: ["Necraloid"],
  VoxSyndicate: ["Vox_Solaris_(Syndicate)"],
  QuillsSyndicate: ["The_Quills"],
  SolarisSyndicate: ["Ticker"],
};
const STANDING_ONLY = new Set(["Universal Medallion"]);

// Mining page gem table: raw gems handed to Old Man Suumbaat and Smokefinger.
const GEM_PAGE = "Mining";
const GEMS = {
  CetusSyndicate: {
    Azurite: 50,
    Devar: 50,
    Veridos: 75,
    Crimzian: 100,
    Sentirum: 400,
    Nyth: 400,
  },
  SolarisSyndicate: {
    Phasmin: 50,
    Noctrul: 50,
    Goblite: 200,
    Amarast: 500,
    Zodian: 1000,
    Thyst: 1000,
  },
};

const FISH_SYNDICATES = new Set(["CetusSyndicate", "SolarisSyndicate"]);
const SIZE_ORDER = ["", "Medium", "Large"];

const resources = readPublicExport("ExportResources.json") ?? {};
const loc = loadLocalizationDict();

function displayName(uniqueName) {
  const tag = resources[uniqueName]?.name;
  return (tag && loc(tag)?.trim()) || null;
}

function normalize(name) {
  return name.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
}

const byName = new Map();
for (const uniqueName of Object.keys(resources)) {
  const name = displayName(uniqueName);
  if (!name) continue;
  const key = normalize(name);
  byName.set(key, [...(byName.get(key) ?? []), uniqueName]);
}

const unresolved = [];

function resolve(name) {
  const matches = byName.get(normalize(name)) ?? [];
  if (matches.length === 1) return matches[0];
  unresolved.push(`${name} (${matches.length} matches)`);
  return null;
}

function parseNumber(text) {
  const match = text.replace(/,/g, "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

/** Rows of a wiki "Trade-In | Standing gained" table, in page order. */
function tradeInRows(wikitext) {
  const start = wikitext.indexOf("Trade-In");
  if (start < 0) throw new Error("no Trade-In table");
  const table = wikitext.slice(start, wikitext.indexOf("|}", start));
  const rows = [];
  for (const row of table.split(/\n\|-/).slice(1)) {
    const name = row.match(/\{\{Resource\|([^}|]+)/)?.[1]?.trim();
    const cells = row.split("\n").filter((line) => line.startsWith("|"));
    const standing = cells.length > 1 ? parseNumber(cells[1].slice(1)) : null;
    if (name && standing) rows.push({ name, standing });
  }
  return rows;
}

/** A fish page's size table: header labels, standing per size, cut yields per size. */
function fishSizes(wikitext) {
  const start = wikitext.search(/\n!(Small|Basic)\s*\n/);
  if (start < 0) return null;
  const table = wikitext.slice(start, wikitext.indexOf("|}", start));
  const [header, standing, yields] = table.split(/\n\|-/);
  const labels = header.match(/^!(.+)$/gm).map((line) => line.slice(1).trim());
  const cells = (block) =>
    block
      .split("\n")
      .filter((line) => line.startsWith("|"))
      .map((line) => line.slice(1));
  return labels.map((label, index) => ({
    label,
    standing: parseNumber(cells(standing)[index]),
    yields: [...cells(yields)[index].matchAll(/\{\{Resource\|([^}|]+)\}\}\s*x(\d+)/g)].map(
      (match) => ({ name: match[1].trim(), count: Number(match[2]) }),
    ),
  }));
}

function sizeOf(uniqueName) {
  const match = uniqueName.match(/(Medium|Large)(Item)?$/);
  return match ? match[1] : "";
}

function speciesOf(uniqueName, entry) {
  return sizeOf(uniqueName) ? entry.parentName : uniqueName;
}

async function fishTurnIns(syndicate, pagesUsed) {
  const species = new Map();
  for (const [uniqueName, entry] of Object.entries(resources)) {
    if (entry.syndicateTag !== syndicate || !entry.standingBonus) continue;
    const key = speciesOf(uniqueName, entry);
    species.set(key, [...(species.get(key) ?? []), uniqueName]);
  }
  const turnIns = [];
  for (const [base, variants] of species) {
    const name = displayName(base);
    const page = name.replace(/ /g, "_");
    const sizes = fishSizes(await fetchWikiRaw(page));
    if (!sizes) throw new Error(`${page}: no size table`);
    pagesUsed.push(page);
    variants.sort((a, b) => SIZE_ORDER.indexOf(sizeOf(a)) - SIZE_ORDER.indexOf(sizeOf(b)));
    variants.forEach((uniqueName, index) => {
      const size = sizes[index];
      const parts = resources[uniqueName].dissectionParts ?? [];
      const yields = size.yields.map((part) => ({
        itemType:
          parts
            .map((p) => p.ItemType)
            .find((type) => normalize(displayName(type) ?? "") === normalize(part.name)) ??
          resolve(part.name),
        name: part.name,
        count: part.count,
      }));
      for (const part of yields) {
        const exported = parts.find((p) => p.ItemType === part.itemType)?.ItemCount;
        if (exported !== part.count)
          console.warn(
            `${name} ${size.label} ${part.name}: wiki ${part.count}, export ${exported}`,
          );
      }
      // DE's own value wins where the wiki disagrees (Norg Medium reads 650 there).
      const standing = resources[uniqueName].standingBonus;
      if (standing !== size.standing)
        console.warn(`${name} ${size.label}: wiki ${size.standing}, export ${standing}`);
      turnIns.push({
        itemType: uniqueName,
        name: `${name} (${size.label})`,
        standing,
        yields,
      });
    });
  }
  return turnIns;
}

const syndicates = {};
const pagesUsed = [];

for (const [syndicate, pages] of Object.entries(TRADE_IN_PAGES)) {
  for (const page of pages) {
    pagesUsed.push(page);
    for (const row of tradeInRows(await fetchWikiRaw(page))) {
      if (STANDING_ONLY.has(row.name)) continue;
      (syndicates[syndicate] ??= { turnIns: [] }).turnIns.push({
        itemType: resolve(row.name),
        name: row.name,
        standing: row.standing,
      });
    }
  }
}

pagesUsed.push(GEM_PAGE);
for (const [syndicate, gems] of Object.entries(GEMS)) {
  for (const [name, standing] of Object.entries(gems))
    (syndicates[syndicate] ??= { turnIns: [] }).turnIns.push({
      itemType: resolve(name),
      name,
      standing,
    });
}

for (const syndicate of FISH_SYNDICATES)
  (syndicates[syndicate] ??= { turnIns: [] }).turnIns.push(
    ...(await fishTurnIns(syndicate, pagesUsed)),
  );

/** Fixed-price shop offers paid in turn-in items whose product a recipe consumes. */
function shopTrades(currencies) {
  const vendors = readPublicExport("ExportVendors.json") ?? {};
  const recipes = readPublicExport("ExportRecipes.json") ?? {};
  const consumed = new Set(
    Object.values(recipes).flatMap((recipe) => (recipe.ingredients ?? []).map((i) => i.ItemType)),
  );
  const trades = [];
  for (const vendor of Object.values(vendors)) {
    for (const offer of vendor.items ?? []) {
      const prices = offer.itemPrices ?? [];
      const itemType = offer.storeItem.replace("/StoreItems/", "/");
      if (!prices.length || !prices.every((price) => currencies.has(price.ItemType))) continue;
      if (!resources[itemType] || !consumed.has(itemType)) continue;
      trades.push({
        itemType,
        name: displayName(itemType),
        quantity: offer.quantity,
        prices: prices.map((price) => ({ itemType: price.ItemType, count: price.ItemCount })),
      });
    }
  }
  return trades;
}

const currencies = new Set(
  Object.values(syndicates).flatMap(({ turnIns }) => turnIns.map((turnIn) => turnIn.itemType)),
);

await writeJsonAtomic(OUT_FILE, {
  source: `wiki.warframe.com ${pagesUsed.join(", ")}; uniqueNames, shop trades from warframe-public-export-plus`,
  syndicates,
  trades: shopTrades(currencies),
});

if (unresolved.length) console.warn(`unresolved: ${unresolved.join("; ")}`);
console.log(`wrote ${OUT_FILE}`);
