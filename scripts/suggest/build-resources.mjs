// Builds C:/src/personal/wfhelper-research/resources-draft.json - a farming-
// location draft for every wiki resource, for later agents to fold into
// src/data/suggest/acquisitionPlans/resources.json by hand.
// Usage: node scripts/suggest/build-resources.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fetchWikiRaw } from "../wiki-raw.mjs";
import { DATA_DIR } from "./io.mjs";
import { parseLuaLocal } from "./lua.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RESEARCH_DIR = "C:/src/personal/wfhelper-research";
const DRAFT_FILE = path.join(RESEARCH_DIR, "resources-draft.json");
const MISSING_FILE = path.join(RESEARCH_DIR, "resources-missing.md");
const PLANS_DIR = path.join(DATA_DIR, "acquisitionPlans");
const WFCD_JSON_DIR = path.join(REPO_ROOT, "node_modules", "@wfcd", "items", "data", "json");

const MAX_DROPS = 8;
const SOURCE_LABEL = /\b(?:Location|Source):\s*/i;

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

function extractSource(description) {
  const text = typeof description === "string" ? description : "";
  const match = text.match(SOURCE_LABEL);
  const body = match ? text.slice(match.index + match[0].length) : text;
  return body.replace(/\s+/g, " ").trim();
}

function buildPlanetIndex(regionResources) {
  const byResource = new Map();
  for (const [planet, names] of Object.entries(regionResources ?? {})) {
    for (const name of names ?? []) {
      if (!byResource.has(name)) byResource.set(name, []);
      byResource.get(name).push(planet);
    }
  }
  return byResource;
}

/** Enemy/mission drop tables for resources, keyed lowercase since wiki and
 *  WFCD casing occasionally drift. */
function buildDropIndex() {
  const byName = new Map();
  for (const file of ["Resources.json", "Misc.json", "Fish.json"]) {
    const items = readJsonFile(path.join(WFCD_JSON_DIR, file));
    for (const item of items) {
      if (!Array.isArray(item.drops) || item.drops.length === 0) continue;
      const key = item.name.toLowerCase();
      const existing = byName.get(key) ?? [];
      byName.set(key, existing.concat(item.drops));
    }
  }
  return byName;
}

function topDrops(dropIndex, name) {
  const drops = dropIndex.get(name.toLowerCase());
  if (!drops) return [];
  return drops
    .slice()
    .sort((a, b) => b.chance - a.chance)
    .slice(0, MAX_DROPS)
    .map((drop) => ({ location: drop.location, chance: drop.chance }));
}

function collectPlanRowLabels() {
  const labels = new Set();
  for (const file of fs.readdirSync(PLANS_DIR)) {
    if (!file.startsWith("plan-") || !file.endsWith(".json")) continue;
    const plan = readJsonFile(path.join(PLANS_DIR, file));
    for (const group of plan.groups ?? []) {
      for (const row of group.rows ?? []) {
        if (typeof row.label === "string" && row.label) labels.add(row.label);
      }
    }
  }
  return labels;
}

const resourcesText = await fetchWikiRaw("Module:Resources/data");
const resourceData = parseLuaLocal(resourcesText, "ResourceData");

const missionsText = await fetchWikiRaw("Module:Missions/data");
let planetIndex = new Map();
try {
  const missionData = parseLuaLocal(missionsText, "MissionData");
  planetIndex = buildPlanetIndex(missionData.RegionResources);
  console.log(`found structured planet data: ${planetIndex.size} resources across regions`);
} catch (error) {
  console.log(`no structured planet data: ${error.message}`);
}

const dropIndex = buildDropIndex();

const draft = {};
for (const [name, entry] of Object.entries(resourceData)) {
  draft[name] = {
    type: entry.Type ?? null,
    source: extractSource(entry.Description),
    planets: planetIndex.get(name) ?? [],
    drops: topDrops(dropIndex, name),
    boosters: {
      resourceBooster: entry.ResourceBoostAble === true,
      dropChanceBooster: entry.ResourceDropChanceBoostAble === true,
      retriever: entry.RetrieverModAble === true,
    },
  };
}

const sortedDraft = {};
for (const name of Object.keys(draft).sort((a, b) => a.localeCompare(b))) sortedDraft[name] = draft[name];

fs.mkdirSync(RESEARCH_DIR, { recursive: true });
fs.writeFileSync(DRAFT_FILE, JSON.stringify(sortedDraft, null, 2));
console.log(`wrote ${DRAFT_FILE} with ${Object.keys(sortedDraft).length} resources`);

const shipped = readJsonFile(path.join(PLANS_DIR, "resources.json"));
const shippedKeys = new Set(Object.keys(shipped).map((key) => key.toLowerCase()));
const wikiNames = new Map(Object.keys(resourceData).map((name) => [name.toLowerCase(), name]));

const missing = new Set();
for (const label of collectPlanRowLabels()) {
  const wikiName = wikiNames.get(label.toLowerCase());
  if (wikiName && !shippedKeys.has(wikiName.toLowerCase())) missing.add(wikiName);
}
const sortedMissing = [...missing].sort((a, b) => a.localeCompare(b));

const heading = "Materials referenced by plans with no entry in acquisitionPlans/resources.json";
fs.writeFileSync(MISSING_FILE, `${heading}\n${sortedMissing.join("\n")}\n`);
console.log(`wrote ${MISSING_FILE} with ${sortedMissing.length} names`);
