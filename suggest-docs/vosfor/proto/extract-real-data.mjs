import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const userData = path.join(process.env.APPDATA, "WFHelper");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf-8"));

const inventory = readJson(path.join(userData, "api-helper", "inventory.json"));
const snapshot = readJson(path.join(userData, "snapshot-cache.json"));
const pepDir = path.join(repo, "node_modules", "warframe-public-export-plus");
const dict = readJson(path.join(pepDir, "dict.en.json"));
const exportArcanes = readJson(path.join(pepDir, "ExportArcanes.json"));
const wfcdArcanes = readJson(path.join(repo, "node_modules", "@wfcd", "items", "data", "json", "Arcanes.json"));

const ICON_MIRROR = "https://assets.wfhelper.com";
const WFCD_CDN = "https://cdn.warframestat.us/img/";
const BROWSE_WF = "https://browse.wf";

function parseTsMap(source, exportName) {
  const start = source.indexOf(`export const ${exportName}`);
  const open = source.indexOf("({", start);
  const close = source.indexOf("});", open);
  const map = {};
  for (const m of source.slice(open, close).matchAll(/"((?:[^"\\]|\\.)*)":\s*"((?:[^"\\]|\\.)*)"/g)) {
    map[JSON.parse(`"${m[1]}"`)] = JSON.parse(`"${m[2]}"`);
  }
  return map;
}
const artSource = fs.readFileSync(path.join(repo, "config", "shared", "wikiModArt.ts"), "utf-8");
const WIKI_MOD_ART = parseTsMap(artSource, "WIKI_MOD_ART");
const WIKI_MOD_ART_BY_NAME = parseTsMap(artSource, "WIKI_MOD_ART_BY_NAME");

function toIconMirrorUrl(src) {
  const trimmed = typeof src === "string" ? src.trim() : "";
  if (!trimmed) return null;
  const parsed = new URL(trimmed);
  const ext = path.extname(parsed.pathname).toLowerCase();
  const hash = crypto.createHash("sha256").update(trimmed).digest("hex").slice(0, 24);
  return `${ICON_MIRROR}/icons/${hash}${ext && ext.length <= 8 ? ext : ".png"}`;
}

function normalizeForSlug(value) {
  return value.trim().toLowerCase().replace(/['’‘]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

const copiesAtRank = (r) => ((Math.max(0, Math.floor(r)) + 1) * (Math.max(0, Math.floor(r)) + 2)) / 2;

// Arcane catalog keyed by uniqueName, merged the way itemDatabase does (pep name, wfcd facts).
const wfcdByUnique = new Map(wfcdArcanes.map((a) => [a.uniqueName, a]));
const catalog = new Map();
for (const uniqueName of new Set([...Object.keys(exportArcanes), ...wfcdByUnique.keys()])) {
  const pep = exportArcanes[uniqueName];
  const wfcd = wfcdByUnique.get(uniqueName);
  const pepName = pep?.name ? dict[pep.name] : null;
  const name = (pepName || wfcd?.name || "").trim();
  if (!name) continue;
  const levels = Array.isArray(wfcd?.levelStats) ? wfcd.levelStats : [];
  const slot = (wfcd?.type ?? "").replace(/\s*Arcane$/i, "").trim() || null;
  const wikiStem = WIKI_MOD_ART[uniqueName] ?? WIKI_MOD_ART_BY_NAME[name];
  const imageSources = [
    wikiStem ? `${ICON_MIRROR}/mod-art/${encodeURIComponent(wikiStem)}.webp` : null,
    pep?.icon ? BROWSE_WF + pep.icon : null,
    wfcd?.wikiaThumbnail,
    wfcd?.imageName ? WFCD_CDN + wfcd.imageName : null,
  ];
  const first = imageSources.find((u) => typeof u === "string" && u.trim());
  catalog.set(uniqueName, {
    name,
    slot,
    rarity: wfcd?.rarity ?? null,
    maxRank: levels.length > 1 ? levels.length - 1 : 5,
    imageUrl: first ? (first.startsWith(`${ICON_MIRROR}/`) ? first : toIconMirrorUrl(first)) : null,
    tradable: wfcd?.tradable ?? null,
  });
}

const RANK_KEYS = ["lvl", "level", "rank", "ModRank", "FusionLevel", "UpgradeLevel", "CurrentLevel",
  "CurrentRank", "ArcaneRank", "ItemLevel", "ItemRank", "UpgradeRank"];
function fingerprintRank(row) {
  let raw = row.UpgradeFingerprint ?? row.upgradeFingerprint;
  if (raw == null) return 0;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { return 0; }
  }
  for (const k of RANK_KEYS) if (Number.isFinite(Number(raw?.[k]))) return Number(raw[k]);
  return 0;
}
function amount(row) {
  const n = Number(row.ItemCount ?? row.Count ?? row.StackCount ?? row.Quantity ?? 1);
  return n > 0 ? Math.floor(n) : 1;
}

const heldByName = new Map();
for (const key of ["Upgrades", "RawUpgrades", "Arcanes"]) {
  for (const row of Array.isArray(inventory[key]) ? inventory[key] : []) {
    const entry = row?.ItemType ? catalog.get(row.ItemType) : undefined;
    if (!entry) continue;
    const prev = heldByName.get(entry.name) ?? { entry, copies: 0 };
    prev.copies += amount(row) * copiesAtRank(fingerprintRank(row));
    heldByName.set(entry.name, prev);
  }
}
const held = [...heldByName.values()]
  .map(({ entry, copies }) => ({
    name: entry.name,
    copies,
    max: copiesAtRank(entry.maxRank),
    rarity: entry.rarity,
    slot: entry.slot,
    imageUrl: entry.imageUrl,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const vosforRow = (inventory.MiscItems ?? []).find((r) => r.ItemType === "/Lotus/Types/Items/MiscItems/DistillPoints");
const vosfor = vosforRow ? amount(vosforRow) : 0;

const WFM_HEADERS = { Accept: "application/json", Language: "en", Platform: "pc", "User-Agent": "wfhelper-proto/1.0" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url) {
  const res = await fetch(url, { headers: WFM_HEADERS });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// Every arcane warframe.market lists; its tag set is the authority on "an arcane".
const wfmItems = (await getJson("https://api.warframe.market/v2/items")).data;
const wfmArcanes = wfmItems.filter((i) => (i.tags ?? []).includes("arcane_enhancement"));

// Same order as upgradePlatinum(): rank-0 snapshot price, then the bare slug.
function snapshotPrice(slug) {
  for (const key of [`${slug}:rank-v3:r0`, slug]) {
    const e = snapshot.prices?.[key];
    if (e?.status === "ok" && Number.isFinite(e.median)) return { platinum: e.median, source: "snapshot" };
  }
  return null;
}

// Fallback mirrors the worker's closed-volume-average-48h basis on WFM's own statistics.
async function statisticsPrice(slug) {
  const stats = await getJson(`https://api.warframe.market/v1/items/${slug}/statistics`);
  for (const window of ["48hours", "90days"]) {
    const rows = (stats.payload?.statistics_closed?.[window] ?? []).filter((r) => (r.mod_rank ?? 0) === 0);
    const volume = rows.reduce((s, r) => s + (r.volume ?? 0), 0);
    if (!volume) continue;
    const avg = rows.reduce((s, r) => s + (r.avg_price ?? 0) * (r.volume ?? 0), 0) / volume;
    return { platinum: Math.round(avg * 10) / 10, source: `wfm-statistics-${window}` };
  }
  return null;
}

const prices = [];
const unpriced = [];
let fetched = 0;
for (const item of wfmArcanes) {
  const name = item.i18n?.en?.name ?? item.slug;
  let hit = snapshotPrice(item.slug);
  if (!hit) {
    if (fetched++) await sleep(350);
    try { hit = await statisticsPrice(item.slug); } catch (err) { console.warn(String(err)); }
  }
  if (hit) prices.push({ name, slug: item.slug, platinum: hit.platinum, source: hit.source });
  else unpriced.push(name);
}
prices.sort((a, b) => a.name.localeCompare(b.name));

const out = { vosfor, held, prices, unpriced, generatedAt: new Date().toISOString() };
fs.writeFileSync(path.join(here, "real-data.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  vosfor,
  held: held.length,
  wfmArcanes: wfmArcanes.length,
  priced: prices.length,
  fromSnapshot: prices.filter((p) => p.source === "snapshot").length,
  fetched,
  unpriced,
  heldWithoutImage: held.filter((h) => !h.imageUrl).map((h) => h.name),
}, null, 2));
