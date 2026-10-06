// Derives the star-chart nodes an enemy can be scanned at: DE's ExportRegions for
// faction and level, joined to the wiki Module:Missions/data on InternalName for
// the tileset, planet and mission names the enemy modules use.

import { TILE_SET_ALIASES } from "./tileSetPlanets.mjs";

const REGION_FACTION_KEYS = {
  FC_GRINEER: "grineer",
  FC_CORPUS: "corpus",
  FC_INFESTATION: "infestation",
  FC_OROKIN: "orokin",
  FC_SENTIENT: "sentient",
  FC_MITW: "themurmur",
  FC_TECHROT: "techrot",
  FC_SCALDRA: "scaldra",
};
// ExportRegions omits the second side of most crossfire nodes; the wiki names it.
const WIKI_ENEMY_KEYS = {
  Grineer: "grineer",
  Corpus: "corpus",
  Infested: "infestation",
  Orokin: "orokin",
  Corrupted: "orokin",
  Sentient: "sentient",
  "The Murmur": "themurmur",
  Techrot: "techrot",
  Scaldra: "scaldra",
  Anarchs: "anarchs",
};

// nodeType 0 is a mission node and 4 a Dark Sector; the rest are relays, hubs,
// junctions, Conclave, the Index and the Dormizone.
const COMBAT_NODE_TYPES = new Set([0, 4]);
const RAILJACK_MISSION = "MT_RAILJACK";
// Steel Path is a mode over these nodes rather than a node of its own; this only
// guards against DE ever shipping one.
const STEEL_PATH_RE = /steel path/i;

// Enemy modules call the planet by its in-game name, the mission table does not,
// and DE's label for the Descendia's own nodes the wiki has no row for differs too.
const PLANET_NAMES = { Zariman: "Zariman Ten Zero", "Dark Refractory, Deimos": "Dark Refractory" };

const field = (line, name) =>
  new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(line)?.[1]?.trim() ?? "";

function wikiNodes(lua) {
  const start = typeof lua === "string" ? lua.indexOf('["MissionDetails"]') : -1;
  const out = new Map();
  if (start < 0) return out;
  for (const line of lua.slice(start).split(/\r?\n/)) {
    const internal = field(line, "InternalName");
    if (!internal || out.has(internal)) continue;
    const enemy = /\bEnemy\s*=\s*(\{[^}]*\}|"[^"]*")/.exec(line)?.[1] ?? "";
    out.set(internal, {
      name: field(line, "Name"),
      planet: field(line, "Planet"),
      type: field(line, "Type"),
      tileSet: field(line, "Tileset"),
      enemies: [...enemy.matchAll(/"([^"]*)"/g)].flatMap((m) =>
        Object.keys(WIKI_ENEMY_KEYS).filter((name) => m[1].includes(name)),
      ),
    });
  }
  return out;
}

function label(raw, dict) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  if (!raw.startsWith("/")) return raw.trim();
  const text = dict?.[raw];
  return typeof text === "string" && text.trim() ? text.replace(/\s+/g, " ").trim() : null;
}

const titleCase = (text) =>
  text === text.toUpperCase()
    ? text.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase())
    : text;

/** Every name an enemy module may use for a wiki tileset, the wiki's own first. */
function enemyTileSets(wikiTileSet) {
  if (!wikiTileSet) return [];
  const aliases = Object.entries(TILE_SET_ALIASES)
    .filter(([, target]) => target === wikiTileSet)
    .map(([alias]) => alias);
  return [wikiTileSet, ...aliases];
}

/** Combat nodes sorted by planet then name; `skipped` counts what was left out.
 *  Railjack nodes are kept and flagged, since the Simulacrum cannot spawn their
 *  enemies but scanning them still fills the codex. */
export function buildStarChartNodes(regions, dict, missionsLua) {
  const wiki = wikiNodes(missionsLua);
  const nodes = [];
  const skipped = { nonCombat: 0, steelPath: 0, noFaction: 0 };
  for (const [key, region] of Object.entries(regions ?? {})) {
    if (!region || !COMBAT_NODE_TYPES.has(region.nodeType)) {
      skipped.nonCombat += 1;
      continue;
    }
    const railjack = region.missionType === RAILJACK_MISSION;
    const joined = wiki.get(key);
    const name = joined?.name || label(region.name, dict);
    const missionType = joined?.type || titleCase(label(region.missionName, dict) ?? "");
    if (STEEL_PATH_RE.test(`${name} ${missionType}`)) {
      skipped.steelPath += 1;
      continue;
    }
    const factions = new Set(
      [region.faction, region.secondaryFaction]
        .map((code) => REGION_FACTION_KEYS[code])
        .concat((joined?.enemies ?? []).map((enemy) => WIKI_ENEMY_KEYS[enemy]))
        .filter(Boolean),
    );
    const planet = joined?.planet || label(region.systemName, dict);
    if (factions.size === 0 || !name || !planet || !missionType) {
      skipped.noFaction += 1;
      continue;
    }
    nodes.push({
      key,
      name,
      planet: PLANET_NAMES[planet] ?? planet,
      missionType,
      factions: [...factions].sort(),
      tileSets: enemyTileSets(joined?.tileSet),
      minEnemyLevel: region.minEnemyLevel,
      maxEnemyLevel: region.maxEnemyLevel,
      ...(railjack ? { railjack: true } : {}),
      ...(region.hidden ? { hidden: true } : {}),
    });
  }
  nodes.sort((a, b) => a.planet.localeCompare(b.planet) || a.name.localeCompare(b.name));
  return { nodes, skipped };
}
