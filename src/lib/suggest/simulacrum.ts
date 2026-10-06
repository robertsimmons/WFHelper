import type { CodexStarChartNode } from "../../data/codexScanRequirements.js";
import type { CodexRow } from "../codexScans.js";
import type { CodexRequirement } from "../../../config/shared/codexTypes.js";

/** An unfinished codex entry; finishing it lets the Simulacrum spawn the enemy. */
export interface SimulacrumGap {
  type: string;
  name: string;
  image: string | null;
  scanned: number;
  required: number;
  /** Scans still owed. */
  cost: number;
  eximus: boolean;
  /** Placed by a naming pattern rather than a stated spawn. */
  probable?: boolean;
}

export interface SimulacrumStop {
  node: CodexStarChartNode;
  /** Place-specific gaps this node finishes, cheapest first. */
  gaps: SimulacrumGap[];
  /** Faction-only gaps that also spawn here, cheapest first. */
  regulars: SimulacrumGap[];
  /** Other nodes of the card's place where every one of `gaps` also counts. */
  alternatives: CodexStarChartNode[];
}

/** `regulars` cards hold faction-only gaps no place card's stop reached. A
 *  `railjack` card is one Proxima region: scanning there fills the codex even
 *  though the Simulacrum cannot spawn the enemy. An `activity` card is a game
 *  mode or bounty run from `place` (The Descendia, a Narmer bounty); one with no
 *  node (Archon Hunt, Isleweaver) lists its gaps flat, and a rotating one has no
 *  place. */
export type SimulacrumCardKind =
  | "planet"
  | "tileSet"
  | "railjack"
  | "activity"
  | "regulars"
  | "steelPath"
  | "unplaced";

/** How hard a card is to run, easiest first; cards rank by tier before anything else. */
export const SIMULACRUM_TIERS = [
  "normal",
  "openWorld",
  "archwing",
  "railjack",
  "bountyZone",
  "activity",
  "boss",
  "steelPath",
  "deathMark",
  "regulars",
  "unplaced",
] as const;

export type SimulacrumTier = (typeof SIMULACRUM_TIERS)[number];

type NodeTier = Extract<
  SimulacrumTier,
  "normal" | "openWorld" | "archwing" | "railjack" | "bountyZone" | "boss"
>;

export interface SimulacrumCard {
  key: string;
  kind: SimulacrumCardKind;
  tier: SimulacrumTier;
  /** Planet, tileset or Proxima region; null for Steel Path, unplaced and
   *  rotating activities. */
  place: string | null;
  activity?: string;
  stops: SimulacrumStop[];
  /** Gaps with no node to stop at: Steel Path, nodeless activities, unplaced. */
  gaps: SimulacrumGap[];
  /** Gaps the card decides on, and the scans they cost. */
  unlocks: number;
  scans: number;
}

export const MAX_STOPS = 3;

const LEADER_SUFFIX = "#leader";

// The Simulacrum only spawns enemies; these codex tabs hold animals and objects.
const NON_ENEMY_FACTIONS = new Set(["wildlife", "objects", "lore"]);

// Acolytes roam any Steel Path mission, which is a mode rather than a node, and
// Misery can bring their Shadows.
const STEEL_PATH_RE = /^(Shadow Of )?(Angst|Malice|Mania|Misery|Torment|Violence)$/i;

const DEATH_MARK = "Death Mark";

// Modes no star-chart node holds, and where to start them; a rotating one has
// no fixed place.
const NODELESS: Record<string, { activity: string; place: string | null }> = {
  "archon hunt": { activity: "Archon Hunt", place: null },
  arbitrations: { activity: "Arbitrations", place: null },
  isleweaver: { activity: "Isleweaver", place: "Duviri" },
  "follie's hunt": { activity: "Follie's Hunt", place: "Relays" },
  "death mark": { activity: DEATH_MARK, place: null },
};

// Kinds whose place splits by node tier, so one place can hold several cards.
const SPLIT_KINDS = new Set<SimulacrumCardKind>(["planet", "tileSet", "regulars"]);

type SpawnPatch = Pick<CodexRequirement, "planets" | "tileSets" | "missions">;

// Spawns the enemy modules leave out; null keeps an entry unplaced.
const CURATED: readonly [RegExp, SpawnPatch | null][] = [
  [/^(Protector |Shadow )?Stalker$/i, { missions: ["Death Mark"] }],
  [/^Follie$/i, { missions: ["Follie's Hunt"] }],
  [/^(Lone Guardian|Lua Thrax Legatus)$/i, { missions: ["Circulus", "Yuvarium"] }],
  [/^(Kullervo|Dax (Arcus|Gladius|Herald|Malleus))$/i, { planets: ["Duviri"] }],
  [/^Ally (Bonewidow|Voidrig)$/i, { tileSets: ["Cambion Drift"] }],
  [/^(Captive Virmink|Hostage)$/i, { tileSets: ["Deepmines"] }],
  [/^Solaris Prisoner$/i, { tileSets: ["Orb Vallis"] }],
  [/^Ostron Prisoner$/i, { tileSets: ["Plains of Eidolon"] }],
  [/^The Golden Cradle$/i, { missions: ["Descendia"] }],
  [/^Narmer (Demolisher Expired|Regulator)$/i, { missions: ["Archon Hunt"] }],
  [
    /^Narmer (Observation Drone|Senta Turret)$/i,
    { tileSets: ["Orb Vallis"], missions: ["Narmer Bounty"] },
  ],
  [/^Narmer Coildrive$/i, null],
];

// DE's PNW Narmer units with no wiki row: the open-world roster by its side.
const PNW_NARMER_RE = /\/(Grineer|Corpus)\/Narmer\/(?:.*\/)?PNW[^/]*$/;
const PNW_TILE_SETS: Record<string, string> = {
  Grineer: "Plains of Eidolon",
  Corpus: "Orb Vallis",
};

// Enemy-module mission spellings the star chart writes differently.
const MISSION_ALIASES: Record<string, string> = {
  assasination: "assassination",
  "shrine defence": "shrine defense",
  rathuum: "arena",
  descendia: "the descendia",
};

const normMission = (text: string): string => {
  const key = text
    .toLowerCase()
    .replace(/\s*\((mission|node)\)$/, "")
    .trim();
  return MISSION_ALIASES[key] ?? key;
};

// The Perita Rebellion's recall nodes are boss rematches like The Guilty.
const BOSS_MISSIONS = new Set(["assassination", "the guilty", "the perita rebellion"]);
const ARCHWING_TILE_SET_RE = /^Free Space$|\(Archwing\)$/;
// Free roam in the data, but only its bounties hold enemies.
const BOUNTY_ZONES = new Set(["Deepmines"]);
const BOUNTY = "Bounty";

export function nodeTier(node: CodexStarChartNode): NodeTier {
  if (node.railjack) return "railjack";
  const mission = normMission(node.missionType);
  if (BOSS_MISSIONS.has(mission)) return "boss";
  if (node.tileSets.some((tileSet) => ARCHWING_TILE_SET_RE.test(tileSet))) return "archwing";
  if (node.tileSets.some((tileSet) => BOUNTY_ZONES.has(tileSet))) return "bountyZone";
  return mission === "free roam" ? "openWorld" : "normal";
}

export type MissionGroup = "good" | "tough" | "niche";

const MISSION_GROUPS: Record<string, MissionGroup> = {
  exterminate: "good",
  capture: "good",
  defense: "good",
  "mobile defense": "good",
  sabotage: "good",
  survival: "good",
  spy: "good",
  interception: "tough",
  disruption: "tough",
  rescue: "tough",
};

const GROUP_RANK: Record<MissionGroup, number> = { good: 0, tough: 1, niche: 2 };

/** Exact mission type only: Mirror, Stage and Shrine Defense are modes of their own. */
export const missionGroup = (node: CodexStarChartNode): MissionGroup =>
  MISSION_GROUPS[normMission(node.missionType)] ?? "niche";

type Resolution =
  | { kind: "place"; nodes: CodexStarChartNode[]; places: PlaceRef[] }
  | { kind: "regular"; nodes: CodexStarChartNode[] }
  | { kind: "steelPath" }
  | { kind: "nodeless"; activity: string; place: string | null }
  | { kind: "unplaced" };

interface PlaceRef {
  kind: "planet" | "tileSet" | "railjack" | "activity";
  name: string;
  activity?: string;
}

interface Resolved {
  gap: SimulacrumGap;
  resolution: Resolution;
  activity: string | undefined;
  /** Keys of the nodes the gap counts at. */
  at: Set<string>;
}

function toGap(row: CodexRow): SimulacrumGap | null {
  if (row.complete !== false || row.required === null) return null;
  if (row.faction && NON_ENEMY_FACTIONS.has(row.faction)) return null;
  return {
    type: row.type,
    name: row.name,
    image: row.image,
    scanned: row.scanned,
    required: row.required,
    cost: row.required - row.scanned,
    eximus: row.type.endsWith(LEADER_SUFFIX),
  };
}

interface Chart {
  nodes: readonly CodexStarChartNode[];
  planets: Set<string>;
  missions: Set<string>;
}

// Every Railjack mission is an Empyrean mission, whatever its node type.
const EMPYREAN = "empyrean";

const nodeMissions = (node: CodexStarChartNode): string[] => [
  normMission(node.missionType),
  normMission(node.name),
  ...(node.railjack ? [EMPYREAN] : []),
];

function chartOf(nodes: readonly CodexStarChartNode[]): Chart {
  return {
    nodes,
    planets: new Set(nodes.map((node) => node.planet)),
    missions: new Set(nodes.flatMap(nodeMissions)),
  };
}

/** Mission names the chart knows; a quest or bounty name gates nothing. */
function missionGate(missions: readonly string[] | undefined, chart: Chart): Set<string> | null {
  const known = (missions ?? []).map(normMission).filter((mission) => chart.missions.has(mission));
  return known.length > 0 ? new Set(known) : null;
}

const passesGate = (node: CodexStarChartNode, gate: Set<string> | null): boolean =>
  !gate || nodeMissions(node).some((mission) => gate.has(mission));

const unique = <T>(list: T[]): T[] => [...new Set(list)];

/** A Proxima region or the Empyrean mission marks a Railjack enemy, unless it
 *  also names a ground planet (Eidolon Vomvalyst roams the Plains too). */
function isRailjack(
  requirement: CodexRequirement | undefined,
  ground: Chart,
  rail: Chart,
): boolean {
  if ((requirement?.missions ?? []).some((mission) => normMission(mission) === EMPYREAN)) {
    return true;
  }
  const planets = requirement?.planets ?? [];
  return (
    planets.some((planet) => rail.planets.has(planet)) &&
    !planets.some((planet) => ground.planets.has(planet))
  );
}

/** Tilesets on a Railjack enemy name the ship or Point of Interest boarded
 *  mid-mission, never the node, so only region, mission and faction narrow. */
function resolveRailjack(
  requirement: CodexRequirement | undefined,
  faction: string | null,
  rail: Chart,
): Resolution {
  const gate = missionGate(requirement?.missions, rail);
  // The wiki writes Elite Axio Weaver's region as plain Neptune.
  const regions = (requirement?.planets ?? [])
    .map((planet) => (rail.planets.has(planet) ? planet : `${planet} Proxima`))
    .filter((planet) => rail.planets.has(planet));
  let nodes = rail.nodes.filter(
    (node) => passesGate(node, gate) && (regions.length === 0 || regions.includes(node.planet)),
  );
  const enemyFaction = requirement?.faction ?? faction;
  const own = enemyFaction ? nodes.filter((node) => node.factions.includes(enemyFaction)) : [];
  if (own.length > 0) nodes = own;
  if (nodes.length === 0) return { kind: "unplaced" };
  const places = unique(nodes.map((node) => node.planet)).map(
    (name): PlaceRef => ({ kind: "railjack", name }),
  );
  return { kind: "place", nodes, places };
}

function resolveGround(
  requirement: CodexRequirement | undefined,
  faction: string | null,
  chart: Chart,
): Resolution {
  const planets = requirement?.planets ?? [];
  const known = planets.filter((planet) => chart.planets.has(planet));
  // A "planet" the chart spells as a node or mission (The Descendia) gates instead.
  const named = planets.filter(
    (planet) => !chart.planets.has(planet) && chart.missions.has(normMission(planet)),
  );
  const offChart = planets.length - known.length - named.length;
  const gate = missionGate([...(requirement?.missions ?? []), ...named], chart);
  const tileSets = requirement?.tileSets ?? [];
  const onTileSet = (node: CodexStarChartNode): boolean =>
    node.tileSets.some((tileSet) => tileSets.includes(tileSet));
  const onPlanet = (node: CodexStarChartNode): boolean =>
    known.length === 0 || known.includes(node.planet);
  const gated = chart.nodes.filter((node) => passesGate(node, gate));
  let nodes: CodexStarChartNode[];
  // A planet only the enemy modules know (Perita) names no node. Its tileset
  // stands in only when a known mission confirms it.
  if (offChart > 0 && known.length === 0) {
    if (tileSets.length === 0 || !gate) return { kind: "unplaced" };
    nodes = gated.filter(onTileSet);
  } else {
    nodes = gated.filter((node) => onPlanet(node) && (tileSets.length === 0 || onTileSet(node)));
    // A gate and tileset that share no node disagree: a mission held on one planet
    // (The Descendia) outranks the tileset, a generic mission type does not.
    if (nodes.length === 0 && gate && tileSets.length > 0) {
      const specific = new Set(gated.map((node) => node.planet)).size === 1;
      nodes = specific
        ? gated.filter(onPlanet)
        : chart.nodes.filter((node) => onPlanet(node) && onTileSet(node));
    }
  }
  const enemyFaction = requirement?.faction ?? faction;
  const own = enemyFaction ? nodes.filter((node) => node.factions.includes(enemyFaction)) : [];
  if (known.length === 0 && tileSets.length === 0 && !gate) {
    return own.length > 0 ? { kind: "regular", nodes: own } : { kind: "unplaced" };
  }
  // A place says where the enemy is, so its faction only narrows when a node agrees.
  if (own.length > 0) nodes = own;
  if (nodes.length === 0) return { kind: "unplaced" };
  const modes = nodes.filter(
    (node) => isMode(node, chart) && gate?.has(normMission(node.name)) === true,
  );
  if (modes.length > 0) {
    return {
      kind: "place",
      nodes: modes,
      places: activityPlaces(modes, (n) => [n.planet], modes[0].name),
    };
  }
  const bounty = (requirement?.missions ?? []).some((mission) => NARMER_BOUNTY_RE.test(mission));
  const onTileSets = tileSets.filter((tileSet) =>
    nodes.some((node) => node.tileSets.includes(tileSet)),
  );
  if (bounty) {
    const where = (node: CodexStarChartNode): string[] =>
      onTileSets.length > 0 ? onTileSets.filter((t) => node.tileSets.includes(t)) : [node.planet];
    return { kind: "place", nodes, places: activityPlaces(nodes, where, NARMER_BOUNTY) };
  }
  const places: PlaceRef[] =
    onTileSets.length > 0
      ? onTileSets.map((name) => ({ kind: "tileSet", name }))
      : unique(nodes.map((node) => node.planet)).map((name) => ({ kind: "planet", name }));
  return { kind: "place", nodes, places };
}

// A node named for its own mission type, with variants of that type beside it,
// is a game mode (The Descendia, beside Roathe's Oblivion).
const isMode = (node: CodexStarChartNode, chart: Chart): boolean =>
  normMission(node.missionType) === normMission(node.name) &&
  chart.nodes.some(
    (other) =>
      other.key !== node.key &&
      other.planet === node.planet &&
      normMission(other.missionType) === normMission(node.missionType),
  );

// Break Narmer is the same bounty board's harder tier.
const NARMER_BOUNTY_RE = /\bnarmer bounty$/i;
const NARMER_BOUNTY = "Narmer Bounty";

function activityPlaces(
  nodes: readonly CodexStarChartNode[],
  where: (node: CodexStarChartNode) => string[],
  activity: string,
): PlaceRef[] {
  return unique(nodes.flatMap(where)).map((name) => ({ kind: "activity", name, activity }));
}

/** A nodeless mode the entry names, unless another of its missions has a node. */
function nodeless(requirement: CodexRequirement | undefined, chart: Chart): Resolution | null {
  const missions = requirement?.missions ?? [];
  const mode = missions.map((mission) => NODELESS[normMission(mission)]).find(Boolean);
  if (!mode) return null;
  const rest = missions.filter((mission) => !NODELESS[normMission(mission)]);
  return missionGate(rest, chart) ? null : { kind: "nodeless", ...mode };
}

function resolve(
  gap: SimulacrumGap,
  type: string,
  found: CodexRequirement | undefined,
  faction: string | null,
  ground: Chart,
  rail: Chart,
): Resolution {
  const name = found?.name ?? (gap.eximus ? gap.name.replace(/ Eximus$/, "") : gap.name);
  if (STEEL_PATH_RE.test(name)) return { kind: "steelPath" };
  const base: CodexRequirement = found ?? { name, scans: gap.required, faction: faction ?? "" };
  const curated = CURATED.find(([match]) => match.test(name));
  let requirement = found;
  if (curated) {
    if (!curated[1]) return { kind: "unplaced" };
    requirement = { ...base, ...curated[1] };
  } else if (!found && faction === "narmer") {
    const side = PNW_NARMER_RE.exec(type)?.[1];
    if (side) {
      gap.probable = true;
      requirement = { ...base, tileSets: [PNW_TILE_SETS[side]], missions: [NARMER_BOUNTY] };
    }
  }
  if (isRailjack(requirement, ground, rail)) return resolveRailjack(requirement, faction, rail);
  return nodeless(requirement, ground) ?? resolveGround(requirement, faction, ground);
}

const byCheapest = (a: SimulacrumGap, b: SimulacrumGap): number =>
  a.cost - b.cost || a.name.localeCompare(b.name);

const costOf = (list: readonly Resolved[]): number =>
  list.reduce((sum, entry) => sum + entry.gap.cost, 0);

const byStrength = (a: CodexStarChartNode, b: CodexStarChartNode): number =>
  b.maxEnemyLevel - a.maxEnemyLevel || a.name.localeCompare(b.name);

/** One tier of a place: Mars's archwing node is a different errand from its ground nodes. */
interface Place {
  ref: PlaceRef;
  tier: NodeTier | "activity";
  nodes: CodexStarChartNode[];
}

interface Plan {
  place: Place;
  stops: Array<{ node: CodexStarChartNode; picked: Resolved[] }>;
  unlocks: number;
  scans: number;
}

function indexByNode(entries: readonly Resolved[]): Map<string, Resolved[]> {
  const out = new Map<string, Resolved[]>();
  for (const entry of entries) {
    for (const key of entry.at) {
      const list = out.get(key);
      if (list) list.push(entry);
      else out.set(key, [entry]);
    }
  }
  return out;
}

interface Candidate {
  node: CodexStarChartNode;
  picked: Resolved[];
  scans: number;
  /** GROUP_RANK on normal-tier places, else 0. */
  group: number;
}

const compareCandidates = (a: Candidate, b: Candidate): number =>
  a.group - b.group ||
  b.picked.length - a.picked.length ||
  a.scans - b.scans ||
  Number(a.node.hidden === true) - Number(b.node.hidden === true) ||
  byStrength(a.node, b.node);

/** Up to MAX_STOPS nodes of one place, each taking the most remaining gaps; a
 *  normal-tier place tries its best mission group first. */
function planPlace(place: Place, remaining: Set<Resolved>, gapsAt: Map<string, Resolved[]>): Plan {
  const taken = new Set<Resolved>();
  const stops: Plan["stops"] = [];
  while (stops.length < MAX_STOPS) {
    let best: Candidate | null = null;
    for (const node of place.nodes) {
      const picked = (gapsAt.get(node.key) ?? []).filter(
        (entry) =>
          remaining.has(entry) && !taken.has(entry) && entry.activity === place.ref.activity,
      );
      if (picked.length === 0) continue;
      const group = place.tier === "normal" ? GROUP_RANK[missionGroup(node)] : 0;
      const candidate = { node, picked, scans: costOf(picked), group };
      if (!best || compareCandidates(candidate, best) < 0) best = candidate;
    }
    if (!best) break;
    stops.push({ node: best.node, picked: best.picked });
    for (const entry of best.picked) taken.add(entry);
  }
  const all = stops.flatMap((stop) => stop.picked);
  return { place, stops, unlocks: all.length, scans: costOf(all) };
}

interface Scored {
  tier: SimulacrumTier;
  /** Orders regulars cards by how hard their node is. */
  sub: SimulacrumTier | null;
  /** Unlocks at good-group stops; 0 outside the normal tier. */
  good: number;
  unlocks: number;
  scans: number;
  place: string | null;
}

const rank = (tier: SimulacrumTier | null): number => (tier ? SIMULACRUM_TIERS.indexOf(tier) : -1);

const goodUnlocks = (tier: SimulacrumTier, stops: { node: CodexStarChartNode; n: number }[]) =>
  tier === "normal"
    ? stops.reduce((sum, stop) => sum + (missionGroup(stop.node) === "good" ? stop.n : 0), 0)
    : 0;

const compareScores = (a: Scored, b: Scored): number =>
  rank(a.tier) - rank(b.tier) ||
  rank(a.sub) - rank(b.sub) ||
  b.good - a.good ||
  b.unlocks - a.unlocks ||
  a.scans - b.scans ||
  (a.place ?? "").localeCompare(b.place ?? "");

const cardTier = (place: Place, kind: SimulacrumCardKind): SimulacrumTier =>
  kind === "regulars" ? "regulars" : place.tier;

const scorePlan = (plan: Plan, kind: SimulacrumCardKind): Scored => ({
  tier: cardTier(plan.place, kind),
  sub: kind === "regulars" ? plan.place.tier : null,
  good: goodUnlocks(
    cardTier(plan.place, kind),
    plan.stops.map((stop) => ({ node: stop.node, n: stop.picked.length })),
  ),
  unlocks: plan.unlocks,
  scans: plan.scans,
  place: plan.place.ref.name,
});

const scoreCard = (card: SimulacrumCard): Scored => ({
  tier: card.tier,
  sub: card.tier === "regulars" && card.stops[0] ? nodeTier(card.stops[0].node) : null,
  good: goodUnlocks(
    card.tier,
    card.stops.map((stop) => ({ node: stop.node, n: stop.gaps.length })),
  ),
  unlocks: card.unlocks,
  scans: card.scans,
  place: card.place,
});

const compareCards = (a: SimulacrumCard, b: SimulacrumCard): number =>
  compareScores(scoreCard(a), scoreCard(b));

const inPlace = (node: CodexStarChartNode, ref: PlaceRef): boolean =>
  ref.kind === "railjack"
    ? node.railjack === true && node.planet === ref.name
    : !node.railjack &&
      ((ref.kind !== "tileSet" && node.planet === ref.name) ||
        (ref.kind !== "planet" && node.tileSets.includes(ref.name)));

function placesFor(entries: readonly Resolved[], chart: Chart): Place[] {
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const entry of entries) {
    const { resolution } = entry;
    const refs: PlaceRef[] =
      resolution.kind === "place"
        ? resolution.places
        : resolution.kind === "regular"
          ? unique(resolution.nodes.map((node) => node.planet)).map((name) => ({
              kind: "planet",
              name,
            }))
          : [];
    for (const ref of refs) {
      const key = `${ref.kind}:${ref.name}:${ref.activity ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const nodes = chart.nodes.filter((node) => inPlace(node, ref));
      if (ref.kind === "activity") {
        out.push({ ref, tier: "activity", nodes });
        continue;
      }
      for (const tier of unique(nodes.map(nodeTier))) {
        out.push({ ref, tier, nodes: nodes.filter((node) => nodeTier(node) === tier) });
      }
    }
  }
  return out;
}

function toCard(
  plan: Plan,
  kind: SimulacrumCardKind,
  regularsAt: Map<string, Resolved[]>,
  shown: Set<Resolved>,
): SimulacrumCard {
  const activity = plan.place.ref.activity ?? (plan.place.tier === "bountyZone" ? BOUNTY : null);
  const inCard = new Set(plan.stops.flatMap((stop) => stop.picked));
  const stops = plan.stops.map(({ node, picked }): SimulacrumStop => {
    // An activity card is its own errand, so faction-only gaps stay off it.
    const regulars = plan.place.ref.activity
      ? []
      : (regularsAt.get(node.key) ?? []).filter((entry) => !inCard.has(entry));
    for (const entry of regulars) inCard.add(entry);
    return {
      node,
      gaps: picked.map((entry) => entry.gap).sort(byCheapest),
      regulars: regulars.map((entry) => entry.gap).sort(byCheapest),
      alternatives: plan.place.nodes
        .filter((other) => other.key !== node.key && picked.every((e) => e.at.has(other.key)))
        .sort(byStrength),
    };
  });
  for (const entry of inCard) shown.add(entry);
  return {
    key: "",
    kind,
    tier: cardTier(plan.place, kind),
    place: plan.place.ref.name,
    ...(activity ? { activity } : {}),
    stops,
    gaps: [],
    unlocks: plan.unlocks,
    scans: plan.scans,
  };
}

/** Greedy over places: the best-scoring plan becomes a card, its gaps leave the
 *  pool, and the rest replan, so a place too big for MAX_STOPS gets another card. */
function planCards(
  deciding: readonly Resolved[],
  chart: Chart,
  regularsAt: Map<string, Resolved[]>,
  shown: Set<Resolved>,
  kind?: SimulacrumCardKind,
): SimulacrumCard[] {
  const places = placesFor(deciding, chart);
  const gapsAt = indexByNode(deciding);
  const remaining = new Set(deciding);
  const cards: SimulacrumCard[] = [];
  while (remaining.size > 0) {
    let best: { plan: Plan; kind: SimulacrumCardKind; score: Scored } | null = null;
    for (const place of places) {
      const plan = planPlace(place, remaining, gapsAt);
      if (plan.unlocks === 0) continue;
      const ofKind = kind ?? place.ref.kind;
      const score = scorePlan(plan, ofKind);
      if (!best || compareScores(score, best.score) < 0) best = { plan, kind: ofKind, score };
    }
    if (!best) break;
    for (const stop of best.plan.stops) for (const entry of stop.picked) remaining.delete(entry);
    cards.push(toCard(best.plan, best.kind, regularsAt, shown));
  }
  return cards.sort(compareCards);
}

function flatCard(
  kind: SimulacrumCardKind,
  tier: SimulacrumTier,
  entries: readonly Resolved[],
  place: string | null = null,
  activity?: string,
): SimulacrumCard {
  const gaps = entries.map((entry) => entry.gap).sort(byCheapest);
  return {
    key: "",
    kind,
    tier,
    place,
    ...(activity ? { activity } : {}),
    stops: [],
    gaps,
    unlocks: gaps.length,
    scans: costOf(entries),
  };
}

/** Cards easiest first by tier (SIMULACRUM_TIERS), then most unlocks at good-group
 *  stops (normal tier), then most unlocks, then fewest scans. Gaps go to the
 *  easiest tier that can finish them. */
export function simulacrumCards(
  rows: readonly CodexRow[],
  requirements: Record<string, CodexRequirement>,
  nodes: readonly CodexStarChartNode[],
): SimulacrumCard[] {
  const chart = chartOf(nodes);
  const ground = chartOf(nodes.filter((node) => !node.railjack));
  const rail = chartOf(nodes.filter((node) => node.railjack));
  const resolved: Resolved[] = [];
  for (const row of rows) {
    const gap = toGap(row);
    if (!gap) continue;
    const base = gap.eximus ? row.type.slice(0, -LEADER_SUFFIX.length) : row.type;
    const resolution = resolve(gap, base, requirements[base], row.faction, ground, rail);
    const placed = resolution.kind === "place" || resolution.kind === "regular";
    resolved.push({
      gap,
      resolution,
      activity: resolution.kind === "place" ? resolution.places[0]?.activity : undefined,
      at: new Set(placed ? resolution.nodes.map((node) => node.key) : []),
    });
  }
  const ofKind = (kind: Resolution["kind"]): Resolved[] =>
    resolved.filter((entry) => entry.resolution.kind === kind);

  const regulars = ofKind("regular");
  const shown = new Set<Resolved>();
  const placeCards = planCards(ofKind("place"), chart, indexByNode(regulars), shown);
  const steelPath = ofKind("steelPath");
  if (steelPath.length > 0) placeCards.push(flatCard("steelPath", "steelPath", steelPath));
  const modes = new Map<string, { place: string | null; entries: Resolved[] }>();
  for (const entry of resolved) {
    if (entry.resolution.kind !== "nodeless") continue;
    const { activity, place } = entry.resolution;
    const mode = modes.get(activity) ?? { place, entries: [] };
    mode.entries.push(entry);
    modes.set(activity, mode);
  }
  for (const [activity, { place, entries }] of modes) {
    const tier = activity === DEATH_MARK ? "deathMark" : "activity";
    placeCards.push(flatCard("activity", tier, entries, place, activity));
  }
  placeCards.sort(compareCards);
  const leftover = regulars.filter((entry) => !shown.has(entry));
  const regularCards = planCards(leftover, chart, new Map(), shown, "regulars");
  const unplaced = ofKind("unplaced");
  const cards = [
    ...placeCards,
    ...regularCards,
    ...(unplaced.length > 0 ? [flatCard("unplaced", "unplaced", unplaced)] : []),
  ];

  const seen = new Map<string, number>();
  for (const card of cards) {
    const lead = card.stops[0] ? nodeTier(card.stops[0].node) : "normal";
    const split = lead !== "normal" && SPLIT_KINDS.has(card.kind) ? `@${lead}` : "";
    const base = `${card.kind}:${card.place ?? ""}${split}${card.activity ? `:${card.activity}` : ""}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    card.key = count === 1 ? base : `${base}#${count}`;
  }
  return cards;
}
