// Real-data snapshot of missing non-Simulacrum scannables, via the app's own TS modules.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const appData = path.join(process.env.APPDATA, "WFHelper");
const SCANS_FILE = path.join(appData, "codex-scans.json");
const INVENTORY_FILE = path.join(appData, "api-helper", "inventory.json");

const jiti = createJiti(import.meta.url);
const data = await jiti.import(path.join(repo, "src/data/codexScanRequirements.ts"));
const { buildCodexRows } = await jiti.import(path.join(repo, "src/lib/codexScans.ts"));
const { missingScannables, loreFragmentScans } = await jiti.import(
  path.join(repo, "src/lib/suggest/scannables.ts"),
);

const scansCache = JSON.parse(fs.readFileSync(SCANS_FILE, "utf8"));
const inventory = JSON.parse(fs.readFileSync(INVENTORY_FILE, "utf8"));
const extras = data.CODEX_EXTRA_INFO;
const planets = new Set(data.CODEX_STAR_CHART_NODES.map((n) => n.planet));
const rows = buildCodexRows(scansCache.scans);
const lore = loreFragmentScans(inventory);
const missing = missingScannables(rows, extras, lore, planets);

const BY_SECTION = {
  objects: "objects",
  plants: "objects",
  songs: "somachords",
  loreFragments: "fragments",
  fighterFrames: "frameFighter",
};
const LORE_CATS = new Set(["somachords", "fragments", "frameFighter"]);
const loreByType = new Map(lore.map((s) => [s.type.toLowerCase(), s]));

const SUBSET_BY_DIR = {
  Fragments: "Cephalon fragments (classic, one per planet/topic)",
  GlassFragments: "Glass (Glassmaker)",
  EidolonFragments: "Eidolon (Plains of Eidolon)",
  RevenantFragments: "Revenant",
  SolarisFragments: "Fortuna (Orb Vallis Solaris)",
  GrineerGhoulFragments: "Ghoul (Grineer Ghoul)",
  AlbrectFragments: "Albrecht (Entrati)",
  DuviriFragments: "Duviri",
  DuviriMITWFragments: "Duviri (Man in the Wall)",
  CorpusReliefFragments: "Corpus Relief",
  LoreCardFragments: "Prex cards (frame lore cards)",
  GasCityFragments: "Gas City (Jupiter)",
};
function subsetOf(type) {
  const dir = type.split("/").slice(0, -1).pop() || "?";
  return SUBSET_BY_DIR[dir] ?? `other:${dir}`;
}

const regionDist = {};
for (const s of lore) regionDist[s.region ?? "(none)"] = (regionDist[s.region ?? "(none)"] ?? 0) + 1;

const groups = {};
for (const row of rows) {
  const extra = extras[row.type];
  const cat = extra?.section ? BY_SECTION[extra.section] : undefined;
  if (!cat) continue;
  const scan = LORE_CATS.has(cat) ? loreByType.get(row.type.toLowerCase()) : undefined;
  const scanned = Math.max(row.scanned, scan?.progress ?? 0);
  const done = row.required !== null ? scanned >= row.required : scanned > 0;
  const g = (groups[cat] ??= { total: 0, completed: 0, unknownRequired: 0, location: {}, subsets: {} });
  g.total++;
  if (done) g.completed++;
  if (row.required === null) g.unknownRequired++;
  const loc = [];
  if (extra.planet) loc.push("wikiPlanet");
  if (scan?.region) loc.push("inventoryRegion");
  const locKey = loc.length ? loc.join("+") : "nothing";
  g.location[locKey] = (g.location[locKey] ?? 0) + 1;
  if (cat === "fragments") {
    const sub = subsetOf(row.type);
    const s = (g.subsets[sub] ??= { total: 0, completed: 0, missing: [] });
    s.total++;
    if (done) s.completed++;
  }
}

const enrich = (cat) => (e) => {
  const scan = loreByType.get(e.type.toLowerCase());
  const extra = extras[e.type] ?? {};
  return {
    ...e,
    section: extra.section ?? null,
    subset: cat === "fragments" ? subsetOf(e.type) : undefined,
    region: scan?.region ?? null,
    wikiPlanet: extra.planet ?? null,
  };
};
const out = {
  generatedFrom: { scans: SCANS_FILE, scansFetchedAt: new Date(scansCache.fetchedAt).toISOString(), inventory: INVENTORY_FILE },
  loreScanRows: lore.length,
  loreRegionDistribution: regionDist,
  groups: {},
};
for (const cat of ["objects", "somachords", "fragments", "frameFighter"]) {
  const g = groups[cat] ?? { total: 0, completed: 0, location: {}, subsets: {} };
  const list = missing[cat].map(enrich(cat));
  if (cat === "fragments") for (const e of list) g.subsets[e.subset].missing.push(e);
  g.missingWithoutImage = list.filter((e) => !e.image).length;
  g.missingWithWiki = list.filter((e) => e.wiki).length;
  g.missingLocation = {};
  for (const e of list) {
    const k = e.wikiPlanet ? "wikiPlanet" : e.region ? "inventoryRegion" : "nothing";
    g.missingLocation[k] = (g.missingLocation[k] ?? 0) + 1;
  }
  out.groups[cat] = { ...g, missingCount: list.length, missing: cat === "fragments" ? undefined : list };
}
fs.writeFileSync(path.join(here, "snapshot.json"), JSON.stringify(out, null, 2));
for (const [cat, g] of Object.entries(out.groups)) {
  console.log(`${cat}: missing ${g.missingCount}/${g.total} completed ${g.completed} unknownReq ${g.unknownRequired} loc ${JSON.stringify(g.location)} missingLoc ${JSON.stringify(g.missingLocation)} noImg ${g.missingWithoutImage} wiki ${g.missingWithWiki}`);
  for (const [s, v] of Object.entries(g.subsets)) console.log(`  ${s}: missing ${v.missing.length}/${v.total}`);
}
console.log("regions", JSON.stringify(regionDist));
