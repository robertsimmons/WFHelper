/** One model for "where does this drop": raw drop-table entries in, one place
 *  per mission node, bounty, Circuit mode or enemy out, with every stage, tier
 *  or refinement that pays it listed inside. */

import { canonicalSyndicateKey } from "./bountyRewards.js";
import type { EnemySpawn } from "./enemySpawns.js";
import type { MessageKey, Translator } from "./i18n.js";
import type { DropRow } from "../../config/shared/dropTypes.js";
import type { DropInfo } from "../types/inventory.js";
import type { WorldState } from "../types/world.js";

type DropSourceKind = "node" | "bounty" | "circuit" | "relic" | "enemy" | "other";

type DropStageLabel =
  | { type: "stage"; from: number; to: number }
  | { type: "final" }
  | { type: "firstClear" }
  | { type: "repeat" }
  | { type: "tier"; from: number }
  | { type: "refinement"; name: Refinement };

type Refinement = "intact" | "exceptional" | "flawless" | "radiant";

export interface DropStage {
  /** Null where the table gives a chance but not the stage that rolls it. */
  label: DropStageLabel | null;
  chance: number | null;
  rarity: string | null;
}

export interface DropSource {
  key: string;
  kind: DropSourceKind;
  region: string | null;
  place: string;
  /** The Circuit's mode. */
  variant: "normal" | "steelPath" | null;
  /** A bounty other than the hub's plain one: a vault, a Ghoul hunt, a phase. */
  activity: string | null;
  giver: string | null;
  hub: string | null;
  missionType: string | null;
  levels: [number, number] | null;
  rotations: string[];
  /** The world-state tag whose board carries this bounty. */
  syndicate: string | null;
  /** How a board job is told apart from the hub's other bounties. */
  jobPattern: RegExp | null;
  stages: DropStage[];
  best: number | null;
  /** The drop-table spellings folded in, for a hover. */
  raw: string[];
  /** Where the enemy `place` names is fought. */
  spawn?: EnemySpawn;
}

/** What a drop table hands over: @wfcd `drops` rows, or rows the stage-aware
 *  table has already split out. */
interface DropEntry {
  location: string;
  chance?: number | null | undefined;
  rarity?: string | null | undefined;
  stage?: string | null | undefined;
  kind?: DropSourceKind | undefined;
}

interface BountyInfo {
  match: RegExp;
  region: string | null;
  place: string;
  giver: string | null;
  hub: string | null;
  syndicate: string;
  /** Cetus, Fortuna and the Necralisk share the A/B/C board rotation. */
  rotates: boolean;
  activity?: (match: RegExpExecArray) => string;
  job?: RegExp;
  /** The hub's plain bounty, as the drop tables name it. */
  table?: string;
}

const CETUS = {
  region: "Earth",
  place: "Plains of Eidolon",
  giver: "Konzu",
  hub: "Cetus",
  syndicate: "CetusSyndicate",
  rotates: true,
};
const FORTUNA = {
  region: "Venus",
  place: "Orb Vallis",
  giver: "Eudico",
  hub: "Fortuna",
  syndicate: "SolarisSyndicate",
  rotates: true,
};
const NECRALISK = {
  region: "Deimos",
  place: "Cambion Drift",
  giver: "Mother",
  hub: "Necralisk",
  syndicate: "EntratiSyndicate",
  rotates: true,
};

const PLAIN_JOB = /^(?!.*(?:vault|ghoul|plague|profit)).*$/i;

const BOUNTIES: readonly BountyInfo[] = [
  { match: /^Cetus Bounty$/i, ...CETUS, job: PLAIN_JOB, table: "Cetus Bounty" },
  { match: /^Ghoul Bounty$/i, ...CETUS, activity: () => "Ghoul Bounty", job: /ghoul/i },
  { match: /^Plague Star$/i, ...CETUS, activity: () => "Plague Star", job: /plague/i },
  { match: /^Orb Vallis Bounty$/i, ...FORTUNA, job: PLAIN_JOB, table: "Orb Vallis Bounty" },
  {
    match: /^PROFIT-TAKER\s*-\s*PHASE\s+(\d+)$/i,
    ...FORTUNA,
    activity: (m) => `Profit-Taker ${m[1]}`,
    job: /profit/i,
  },
  {
    match: /^Cambion Drift Bounty$/i,
    ...NECRALISK,
    job: PLAIN_JOB,
    table: "Cambion Drift Bounty",
  },
  {
    match: /^Arcana Isolation Vault$/i,
    ...NECRALISK,
    activity: () => "Arcana Isolation Vault",
    job: /arcana/i,
  },
  {
    match: /^Isolation Vault$/i,
    ...NECRALISK,
    activity: () => "Isolation Vault",
    job: /^(?!.*arcana).*vault/i,
  },
  {
    match: /^Zariman Bounty$/i,
    region: null,
    place: "Zariman Ten Zero",
    giver: "Quinn",
    hub: "Chrysalith",
    syndicate: "ZarimanSyndicate",
    rotates: false,
    table: "Zariman Bounty",
  },
  {
    match: /^Entrati Lab Bounty$/i,
    region: "Deimos",
    place: "Albrecht's Laboratories",
    giver: "Loid",
    hub: "Sanctum Anatomica",
    syndicate: "EntratiLabSyndicate",
    rotates: false,
    table: "Entrati Lab Bounty",
  },
  {
    match: /^WF1999 Bounty$/i,
    region: null,
    place: "Höllvania",
    giver: null,
    hub: null,
    syndicate: "HexSyndicate",
    rotates: false,
    table: "WF1999 Bounty",
  },
];

interface Parsed {
  kind: DropSourceKind;
  region: string | null;
  place: string;
  variant: DropSource["variant"];
  activity: string | null;
  giver: string | null;
  hub: string | null;
  missionType: string | null;
  levels: [number, number] | null;
  rotation: string | null;
  syndicate: string | null;
  jobPattern: RegExp | null;
  label: DropStageLabel | null;
}

const ROTATION_TAIL = /,\s*Rotation\s+([A-Z])\s*$/i;
const RELIC =
  /^(Lith|Meso|Neo|Axi|Requiem)\s+(\S+)\s+Relic(?:\s*\((Intact|Exceptional|Flawless|Radiant)\))?$/i;
const CIRCUIT_TIER = /^(?:Duviri\/)?Endless:\s*Tier\s+(\d+)(?:\s*\(([^)]*)\))?$/i;
const LEVELED = /Level\s+(\d+)\s*-\s*(\d+)\s*([^)]*)/i;
const NODE = /^(.+?)\s*\(([^()]+)\)$/;

/** The drop tables' stage wording: `Stage 2, Stage 3 of 4, and Stage 3 of 5`
 *  is the one middle table every bounty length rolls from. */
export function parseStage(stage: string | null | undefined): DropStageLabel | null {
  const text = stage?.trim() ?? "";
  if (!text) return null;
  if (/final/i.test(text)) return { type: "final" };
  if (/first completion/i.test(text)) return { type: "firstClear" };
  if (/subsequent/i.test(text)) return { type: "repeat" };
  const numbers = [...text.matchAll(/Stage\s+(\d+)/gi)].map((m) => Number(m[1]));
  if (numbers.length === 0) return null;
  return { type: "stage", from: Math.min(...numbers), to: Math.max(...numbers) };
}

function blank(place: string): Parsed {
  return {
    kind: "other",
    region: null,
    place,
    variant: null,
    activity: null,
    giver: null,
    hub: null,
    missionType: null,
    levels: null,
    rotation: null,
    syndicate: null,
    jobPattern: null,
    label: null,
  };
}

function splitRegion(head: string): { region: string | null; rest: string } {
  const slash = head.indexOf("/");
  const paren = head.indexOf("(");
  if (slash < 0 || (paren >= 0 && paren < slash)) return { region: null, rest: head };
  return { region: head.slice(0, slash).trim() || null, rest: head.slice(slash + 1).trim() };
}

function parseLeveled(text: string, levelMatch: RegExpExecArray): Parsed {
  const levels: [number, number] = [Number(levelMatch[1]), Number(levelMatch[2])];
  const name = levelMatch[3].trim();
  const open = text.lastIndexOf("(", levelMatch.index);
  const head = (open >= 0 ? text.slice(0, open) : text.slice(0, levelMatch.index)).trim();
  const { region, rest } = splitRegion(head);
  if (!name) return { ...blank(rest || head), region, levels };
  for (const info of BOUNTIES) {
    const hit = info.match.exec(name);
    if (!hit) continue;
    return {
      ...blank(info.place),
      kind: "bounty",
      region: info.region,
      activity: info.activity ? info.activity(hit) : null,
      giver: info.giver,
      hub: info.hub,
      levels,
      syndicate: info.syndicate,
      jobPattern: info.job ?? null,
      rotation: info.rotates ? null : "",
    };
  }
  return { ...blank(rest || name), kind: "bounty", region, activity: rest ? name : null, levels };
}

function parseText(text: string): Parsed {
  const relic = RELIC.exec(text);
  if (relic) {
    const refinement = (relic[3]?.toLowerCase() ?? "intact") as Refinement;
    return {
      ...blank(`${relic[1]} ${relic[2]}`),
      kind: "relic",
      label: { type: "refinement", name: refinement },
    };
  }
  const tier = CIRCUIT_TIER.exec(text);
  if (tier) {
    const mode = tier[2]?.toLowerCase();
    return {
      ...blank("The Circuit"),
      kind: "circuit",
      region: "Duviri",
      variant: mode === "normal" ? "normal" : mode === "hard" ? "steelPath" : null,
      label: { type: "tier", from: Number(tier[1]) },
    };
  }
  const leveled = LEVELED.exec(text);
  if (leveled) return parseLeveled(text, leveled);
  const { region, rest } = splitRegion(text);
  if (region) {
    const node = NODE.exec(rest);
    const place = node ? node[1].trim() : rest;
    const type = node ? node[2].trim() : null;
    return { ...blank(place), kind: "node", region, missionType: type === place ? null : type };
  }
  const comma = /^(.+?),\s*(.+)$/.exec(text);
  if (comma) return { ...blank(comma[1].trim()), activity: comma[2].trim() };
  return blank(text);
}

function parseEntry(entry: DropEntry): Parsed {
  let text = entry.location.replace(/\s+/g, " ").trim();
  const rotation = ROTATION_TAIL.exec(text);
  if (rotation) text = text.slice(0, rotation.index).trim();
  const parsed = parseText(text);
  // A bounty whose board has no A/B/C cycle is left with "" here: its one
  // table letter says nothing a player can act on.
  if (parsed.rotation === "") parsed.rotation = null;
  else if (rotation) parsed.rotation = rotation[1].toUpperCase();
  if (entry.kind === "enemy" && parsed.kind === "other") parsed.kind = "enemy";
  const stage = parseStage(entry.stage);
  if (stage) parsed.label = stage;
  return parsed;
}

function chanceOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function rarityOf(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

const STAGE_TAIL = /\s*\(([^()]*(?:Stage|Completion)[^()]*)\)\s*$/i;
const MISSION_ROW = /^(.+?)\s*\(([^()]+)\)(,\s*Rotation\s+\S+)?$/;

/** The flattened drop tables: bounty rows carry their stage in a trailing
 *  bracket, mission rows spell `Node (Planet)`. */
function entriesFromDropRows(rows: readonly DropRow[]): DropEntry[] {
  return rows.map((row) => {
    let location = row.place;
    let stage: string | null = null;
    if (row.kind === "bounty") {
      const tail = STAGE_TAIL.exec(location);
      if (tail) {
        stage = tail[1];
        location = location.slice(0, tail.index);
      }
    } else if (row.kind === "mission") {
      const node = MISSION_ROW.exec(location.trim());
      if (node) location = `${node[2]}/${node[1]}${node[3] ?? ""}`;
    }
    return {
      location,
      chance: row.chance,
      rarity: row.rarity,
      stage,
      kind: row.kind === "enemy" ? "enemy" : undefined,
    };
  });
}

function joinKey(parsed: Parsed, chance: number | null): string {
  return [parsed.place, parsed.activity, parsed.levels?.join("-"), parsed.rotation, chance].join(
    "|",
  );
}

/** @wfcd folds a bounty's stages into one location string; the stage-aware
 *  table gives each chance its stage back. A chance no row answers stays
 *  unlabelled rather than guessed. */
function withStages(drops: readonly DropInfo[], rows: readonly DropRow[]): DropEntry[] {
  const stages = new Map<string, string[]>();
  for (const entry of entriesFromDropRows(rows)) {
    if (!entry.stage) continue;
    const key = joinKey(parseEntry(entry), chanceOf(entry.chance));
    stages.set(key, [...(stages.get(key) ?? []), entry.stage]);
  }
  return drops.flatMap((drop): DropEntry[] => {
    const location = typeof drop.location === "string" ? drop.location.trim() : "";
    if (!location) return [];
    const chance = chanceOf(drop.chance);
    const own = typeof drop.stage === "string" ? drop.stage : null;
    const queue = own ? null : stages.get(joinKey(parseEntry({ location }), chance));
    return [
      { location, chance, rarity: rarityOf(drop.rarity), stage: own ?? queue?.shift() ?? null },
    ];
  });
}

/** A board job's reward as a drop entry, so an item opened from the board
 *  reads the same place tile its drop list does. */
export function bountyDrop(
  syndicate: string,
  levels: readonly [number, number],
  rotation: string | null | undefined,
  stage: string,
  chance: number,
  rarity: string,
): DropInfo | null {
  const key = canonicalSyndicateKey(syndicate);
  const info = BOUNTIES.find((bounty) => bounty.syndicate === key && bounty.table);
  if (!info?.table) return null;
  const turn = info.rotates && rotation ? `, Rotation ${rotation.toUpperCase()}` : "";
  return {
    location: `Level ${levels[0]} - ${levels[1]} ${info.table}${turn}`,
    stage,
    chance,
    rarity,
  };
}

const REFINEMENT_ORDER: readonly Refinement[] = ["intact", "exceptional", "flawless", "radiant"];

function stageOrder(label: DropStageLabel | null): number {
  if (!label) return 10_000;
  switch (label.type) {
    case "firstClear":
      return -2;
    case "repeat":
      return -1;
    case "stage":
    case "tier":
      return label.from;
    case "final":
      return 1_000;
    case "refinement":
      return REFINEMENT_ORDER.indexOf(label.name);
  }
}

function labelKey(label: DropStageLabel | null): string {
  return label ? JSON.stringify(label) : "";
}

function stagesKey(stages: readonly DropStage[]): string {
  return stages.map((stage) => `${labelKey(stage.label)}=${stage.chance}`).join(";");
}

/** One stage per label and chance; a bare chance a labelled stage already
 *  names is the same roll seen through the table that lost the label. */
function tidyStages(stages: readonly DropStage[]): DropStage[] {
  const seen = new Set<string>();
  const labelled = new Set(stages.filter((s) => s.label).map((s) => s.chance));
  return stages
    .filter((stage) => {
      if (!stage.label && labelled.has(stage.chance)) return false;
      const key = `${labelKey(stage.label)}=${stage.chance}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => stageOrder(a.label) - stageOrder(b.label) || (b.chance ?? 0) - (a.chance ?? 0));
}

function placeKey(parsed: Parsed | DropSource): string {
  return [
    parsed.kind,
    parsed.region,
    parsed.place,
    parsed.variant,
    parsed.activity,
    parsed.missionType,
    parsed.levels?.join("-"),
  ].join("|");
}

function bestChance(stages: readonly DropStage[]): number | null {
  const chances = stages.map((s) => s.chance).filter((c): c is number => c !== null);
  return chances.length > 0 ? Math.max(...chances) : null;
}

/** Rotations that pay the same stages read as one place: `Rot A/B/C`. */
function foldRotations(sources: DropSource[]): DropSource[] {
  const out = new Map<string, DropSource>();
  for (const source of sources) {
    const key = `${placeKey(source)}#${stagesKey(source.stages)}`;
    const held = out.get(key);
    if (!held) {
      out.set(key, source);
      continue;
    }
    held.rotations = [...new Set([...held.rotations, ...source.rotations])].sort();
    held.raw = [...new Set([...held.raw, ...source.raw])];
  }
  return [...out.values()];
}

/** Best chance first; a place with no chance at all goes last. */
export function buildDropSources(entries: readonly DropEntry[]): DropSource[] {
  const byPlace = new Map<string, DropSource>();
  for (const entry of entries) {
    if (!entry.location?.trim()) continue;
    const parsed = parseEntry(entry);
    const key = `${placeKey(parsed)}|${parsed.rotation ?? ""}`;
    const stage: DropStage = {
      label: parsed.label,
      chance: chanceOf(entry.chance),
      rarity: rarityOf(entry.rarity),
    };
    const held = byPlace.get(key);
    if (held) {
      held.stages.push(stage);
      if (!held.raw.includes(entry.location)) held.raw.push(entry.location);
      continue;
    }
    byPlace.set(key, {
      key,
      kind: parsed.kind,
      region: parsed.region,
      place: parsed.place,
      variant: parsed.variant,
      activity: parsed.activity,
      giver: parsed.giver,
      hub: parsed.hub,
      missionType: parsed.missionType,
      levels: parsed.levels,
      syndicate: parsed.syndicate,
      jobPattern: parsed.jobPattern,
      rotations: parsed.rotation ? [parsed.rotation] : [],
      stages: [stage],
      best: null,
      raw: [entry.location],
    });
  }
  const tidied = [...byPlace.values()].map((source) => ({
    ...source,
    stages: tidyStages(source.stages),
  }));
  return foldRotations(tidied)
    .map((source) => ({ ...source, best: bestChance(source.stages) }))
    .sort(
      (a, b) =>
        (b.best ?? -1) - (a.best ?? -1) ||
        (a.region ?? "").localeCompare(b.region ?? "") ||
        a.place.localeCompare(b.place),
    );
}

export interface DropRowPlace {
  item: string;
  kind: DropRow["kind"];
  source: DropSource;
}

/** A search result as one row per item and place: a bounty's stages, a relic's
 *  refinements and a Circuit's tiers fold into the place that pays them. The
 *  items keep the order the search ranked them in. */
export function dropRowPlaces(rows: readonly DropRow[]): DropRowPlace[] {
  const groups = new Map<string, DropRow[]>();
  for (const row of rows) {
    const key = `${row.item}\u0000${row.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].flatMap((group) =>
    buildDropSources(entriesFromDropRows(group)).map((source) => ({
      item: group[0].item,
      kind: group[0].kind,
      source,
    })),
  );
}

/** Straight off an item's @wfcd drops, with any stage rows it has. */
export function dropSourcesFor(
  drops: readonly DropInfo[] | null | undefined,
  rows: readonly DropRow[] = [],
): DropSource[] {
  return buildDropSources(withStages(drops ?? [], rows));
}

interface DropSourceLive {
  expiry: string;
  /** Set only when the place pays on several rotations, to say which is up. */
  rotation: string | null;
}

/** On the board right now: the hub offers a job at this level range and, for
 *  the A/B/C boards, the current rotation is one this place pays on. */
export function liveDropSource(
  source: DropSource,
  world: WorldState | null | undefined,
): DropSourceLive | null {
  if (source.kind !== "bounty" || !source.syndicate || !source.levels) return null;
  const board = (world?.bounties ?? []).find(
    (group) =>
      canonicalSyndicateKey(group.syndicateKey) === source.syndicate ||
      canonicalSyndicateKey(group.syndicate) === source.syndicate,
  );
  if (!board?.expiry) return null;
  const [min, max] = source.levels;
  const offered = (board.jobs ?? []).some(
    (job) =>
      job.enemyLevels?.[0] === min &&
      job.enemyLevels?.[1] === max &&
      (!source.jobPattern || source.jobPattern.test(job.type ?? "")),
  );
  if (!offered) return null;
  if (source.rotations.length === 0) return { expiry: board.expiry, rotation: null };
  const current = world?.bountyRotation?.trim().toUpperCase();
  if (!current || !source.rotations.includes(current)) return null;
  return { expiry: board.expiry, rotation: source.rotations.length > 1 ? current : null };
}

const REFINEMENT_KEYS: Record<Refinement, [MessageKey, MessageKey]> = {
  intact: ["relics.quality.intact", "relics.qualityShort.intact"],
  exceptional: ["relics.quality.exceptional", "relics.qualityShort.exceptional"],
  flawless: ["relics.quality.flawless", "relics.qualityShort.flawless"],
  radiant: ["relics.quality.radiant", "relics.qualityShort.radiant"],
};

export function stageText(label: DropStageLabel, t: Translator, compact = false): string {
  switch (label.type) {
    case "stage":
      return label.from === label.to
        ? t(compact ? "dropSources.stageShort" : "dropSources.stage", { n: label.from })
        : t(compact ? "dropSources.stageRangeShort" : "dropSources.stageRange", {
            from: label.from,
            to: label.to,
          });
    case "final":
      return t("dropSources.stageFinal");
    case "firstClear":
      return t("dropSources.stageFirstClear");
    case "repeat":
      return t("dropSources.stageRepeat");
    case "tier":
      return t(compact ? "dropSources.tierShort" : "dropSources.tier", { n: label.from });
    case "refinement":
      return t(REFINEMENT_KEYS[label.name][compact ? 1 : 0]);
  }
}

function placeName(source: DropSource, t: Translator): string {
  if (source.kind === "relic") return `${source.place} ${t("drops.relicSuffix")}`;
  if (!source.variant) return source.place;
  const mode = t(source.variant === "normal" ? "common.normal" : "common.steelPath");
  return `${source.place} (${mode})`;
}

/** Region then place, whichever the table names. */
export function dropSourceHeader(source: DropSource, t: Translator): string {
  if (source.spawn) {
    return [source.spawn.region, source.spawn.place].filter(Boolean).join(" · ");
  }
  return [source.region, placeName(source, t)].filter(Boolean).join(" · ");
}

function phaseText(source: DropSource, t: Translator): string | null {
  return source.spawn?.phase?.phase === "night" ? t("world.cycle.night") : null;
}

function levelsText(source: DropSource, t: Translator): string | null {
  return source.levels
    ? t("dropSources.levels", { min: source.levels[0], max: source.levels[1] })
    : null;
}

function rotationText(source: DropSource, t: Translator): string | null {
  return source.rotations.length > 0
    ? t("dropSources.rotation", { rotation: source.rotations.join("/") })
    : null;
}

/** Who hands it out and on what terms: giver, hub, level range, rotation. */
export function dropSourceDetail(source: DropSource, t: Translator): string[] {
  const parts = source.spawn
    ? [
        source.place,
        source.activity,
        ...source.spawn.missions,
        levelsText(source, t),
        phaseText(source, t),
      ]
    : source.kind === "node"
      ? [source.missionType, rotationText(source, t)]
      : [
          source.activity,
          source.giver,
          source.hub,
          source.missionType,
          levelsText(source, t),
          rotationText(source, t),
        ];
  return parts.filter((part): part is string => Boolean(part));
}

function bestStage(source: DropSource): DropStage | null {
  return source.stages.reduce<DropStage | null>(
    (best, stage) => (best === null || (stage.chance ?? -1) > (best.chance ?? -1) ? stage : best),
    null,
  );
}

/** The one-line form a card row has room for, off the same place. */
export function dropSourceLine(
  source: DropSource,
  t: Translator,
): { text: string; chance: number | null } {
  const stage = bestStage(source);
  const stageShort = stage?.label ? stageText(stage.label, t, true) : null;
  if (source.spawn) {
    const where = source.spawn.place ?? source.spawn.region;
    return {
      text: [where, source.place, phaseText(source, t)].filter(Boolean).join(" · "),
      chance: stage?.chance ?? null,
    };
  }
  const parts =
    source.kind === "bounty"
      ? [source.activity ?? source.place, levelsText(source, t), stageShort]
      : source.kind === "node"
        ? [source.place, source.missionType, rotationText(source, t)]
        : source.kind === "circuit" || source.kind === "relic"
          ? [placeName(source, t), stageShort]
          : [source.place, source.activity, levelsText(source, t), rotationText(source, t)];
  return {
    text: parts.filter((part): part is string => Boolean(part)).join(" "),
    chance: stage?.chance ?? null,
  };
}
