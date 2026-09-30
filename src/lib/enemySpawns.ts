/** Where an enemy a drop table names is fought: a planet, the tileset or hub on
 *  it, the modes it shows up in, and the other planets behind a disclosure. */

import type { DropSource } from "./dropSources.js";
import type { EnemyInfo } from "./enemies/enemyInfo.js";
import type { WorldState } from "../types/world.js";

export interface EnemySpawnPhase {
  cycle: "cetus";
  phase: "night";
}

export interface EnemySpawn {
  region: string | null;
  place: string | null;
  missions: string[];
  /** Further planets, first one aside. */
  more: string[];
  phase: EnemySpawnPhase | null;
}

/** Name to spawn data, off the codex table. */
export type EnemyLookup = (name: string) => EnemySpawn | null;

interface EnemyInfoModule {
  findEnemyByName(name: string): EnemyInfo | null;
  findEnemiesByName(name: string): EnemyInfo[];
  factionSpawnPlanets(info: EnemyInfo | null): string[];
  tileSetSpawnPlanets(info: EnemyInfo | null): string[];
}

const NIGHT: EnemySpawnPhase = { cycle: "cetus", phase: "night" };

function spawn(region: string | null, place: string | null, missions: string[] = []): EnemySpawn {
  return { region, place, missions, more: [], phase: null };
}

/** Only what the codex table cannot say: enemies and spots it states no planet
 *  for, and the Eidolons' night. Ascension's node is ExportRegions'. */
const CURATED: readonly [RegExp, EnemySpawn][] = [
  [
    /^Eidolon (Teralyst|Gantulyst|Hydrolyst)$/i,
    { ...spawn("Earth", "Plains of Eidolon"), phase: NIGHT },
  ],
  [/^(Angst|Malice|Mania|Misery|Torment|Violence)$/i, spawn(null, "Steel Path", ["Acolyte"])],
  [/^Thrax (Centurion|Legatus)$/i, spawn("Duviri", "Undercroft")],
  [/^(Ravenous )?Void Angel$/i, spawn(null, "Zariman Ten Zero")],
  [/^Sister of Parvos \(Ascension Mode( Steel Path)?\)$/i, spawn("Uranus", "Brutus")],
  [/^Profit-Taker$/i, spawn("Venus", "Orb Vallis", ["Heist"])],
  [/^Orb Vallis - .+ Enemies$/i, spawn("Venus", "Orb Vallis")],
  [/^Duviri Static Undercroft Portal$/i, spawn("Duviri", "Undercroft")],
  [/^Derelict Vault$/i, spawn("Deimos", "Orokin Derelict")],
];

function curated(name: string): EnemySpawn | null {
  for (const [match, found] of CURATED) {
    if (match.test(name)) return { ...found, missions: [...found.missions], more: [] };
  }
  return null;
}

/** The codex's own planets win; its tilesets' planets next; the faction's
 *  star-chart planets last. */
export function codexEnemyLookup(module: EnemyInfoModule): EnemyLookup {
  return (name) => {
    const one = module.findEnemyByName(name);
    const infos = one ? [one] : module.findEnemiesByName(name);
    if (infos.length === 0) return null;
    const unique = (list: string[]) => [...new Set(list)];
    const planets = unique(
      infos.flatMap((info) =>
        info.planets.length > 0
          ? info.planets
          : [...module.tileSetSpawnPlanets(info), ...module.factionSpawnPlanets(info)],
      ),
    );
    const tileSets = unique(infos.flatMap((info) => info.tileSets));
    const missions = unique(infos.flatMap((info) => info.missions));
    if (planets.length === 0 && tileSets.length === 0 && missions.length === 0) return null;
    // Only a mode to go on: it heads the tile the way a place would.
    const place = tileSets[0] ?? (planets.length === 0 ? (missions.shift() ?? null) : null);
    return { region: planets[0] ?? null, place, missions, more: planets.slice(1), phase: null };
  };
}

/** `Eidolon Teralyst (Capture)` is the Teralyst, captured. */
function splitMode(place: string): { name: string; mode: string | null } {
  const paren = /^(.+?)\s*\(([^()]+)\)$/.exec(place.trim());
  return paren ? { name: paren[1].trim(), mode: paren[2].trim() } : { name: place.trim(), mode: null };
}

export function isUnplacedDrop(source: DropSource): boolean {
  return (source.kind === "other" || source.kind === "enemy") && !source.region && !source.spawn;
}

/** A drop at a bare enemy name gains the place that enemy is fought in. */
export function withEnemySpawns(
  sources: readonly DropSource[],
  lookup: EnemyLookup | null,
): DropSource[] {
  return sources.map((source) => {
    if (!isUnplacedDrop(source)) return source;
    const { name, mode } = splitMode(source.place);
    const found = curated(source.place) ?? curated(name) ?? lookup?.(name) ?? null;
    if (!found) return source;
    return {
      ...source,
      kind: "enemy",
      place: name,
      activity: [mode, source.activity].filter(Boolean).join(" · ") || null,
      spawn: found,
    };
  });
}

export interface LiveSpawn {
  expiry: string;
  phase: EnemySpawnPhase["phase"];
}

/** Out right now: the cycle the enemy needs is the one running. */
export function liveEnemySpawn(
  source: DropSource,
  world: WorldState | null | undefined,
): LiveSpawn | null {
  const phase = source.spawn?.phase;
  if (!phase) return null;
  const cycle = world?.cetusCycle;
  if (cycle?.isDay !== false || typeof cycle.expiry !== "string") return null;
  return { expiry: cycle.expiry, phase: phase.phase };
}
