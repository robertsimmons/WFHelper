import { describe, expect, it } from "vitest";

import { STAR_CHART_PLANET_ART, TILE_SET_ART } from "../../../../src/lib/assetUrls.js";
import {
  cardArt,
  cardTitle,
  enemiesLeft,
  isProbable,
  regularsByFaction,
  simulacrumSuggestions,
  stopLabel,
  stopProgress,
} from "../../../../src/lib/suggest/simulacrumView.js";
import type {
  SimulacrumCard,
  SimulacrumGap,
  SimulacrumStop,
} from "../../../../src/lib/suggest/simulacrum.js";
import type { CodexStarChartNode } from "../../../../src/data/codexScanRequirements.js";
import type { Translator } from "../../../../src/lib/i18n.js";

function node(name: string, planet: string, missionType = "Defense"): CodexStarChartNode {
  return {
    key: `${planet}:${name}`,
    name,
    planet,
    missionType,
    factions: ["corpus"],
    tileSets: [],
    minEnemyLevel: 1,
    maxEnemyLevel: 10,
  };
}

function gap(type: string, image: string | null = `${type}.png`): SimulacrumGap {
  return { type, name: type, image, scanned: 1, required: 3, cost: 2, eximus: false };
}

function stop(at: CodexStarChartNode, gaps: SimulacrumGap[], regulars: SimulacrumGap[] = []) {
  return { node: at, gaps, regulars, alternatives: [] } satisfies SimulacrumStop;
}

function card(overrides: Partial<SimulacrumCard>): SimulacrumCard {
  return {
    key: "planet:Jupiter",
    kind: "planet",
    tier: "normal",
    place: "Jupiter",
    stops: [],
    gaps: [],
    unlocks: 1,
    scans: 2,
    ...overrides,
  };
}

const enemyArt = (image: string | null): string | null => (image ? `enemy/${image}` : null);

describe("cardArt", () => {
  it("prefers the planet's art over the lead enemy's", () => {
    const earth = card({ place: "Earth", stops: [stop(node("E Prime", "Earth"), [gap("a")])] });
    expect(cardArt(earth, enemyArt)).toBe(STAR_CHART_PLANET_ART.Earth);
  });

  it("reads a tileset card's planet off its first stop", () => {
    const vallis = card({
      kind: "tileSet",
      place: "Orb Vallis",
      stops: [stop(node("Orb Vallis", "Venus", "Free Roam"), [gap("a")])],
    });
    expect(cardArt(vallis, enemyArt)).toBe(STAR_CHART_PLANET_ART.Venus);
  });

  it("falls back to the lead enemy, then the tileset, then nothing", () => {
    const jupiter = card({ stops: [stop(node("Io", "Jupiter"), [gap("osprey")])] });
    expect(cardArt(jupiter, enemyArt)).toBe("enemy/osprey.png");

    const plains = card({ kind: "tileSet", place: "Plains of Eidolon", gaps: [gap("x", null)] });
    expect(cardArt(plains, enemyArt)).toBe(TILE_SET_ART["Plains of Eidolon"]);

    expect(cardArt(card({ kind: "unplaced", place: null }), enemyArt)).toBeNull();
  });

  it("uses a flat card's first gap", () => {
    const steel = card({ kind: "steelPath", place: null, gaps: [gap("angst")] });
    expect(cardArt(steel, enemyArt)).toBe("enemy/angst.png");
  });
});

describe("cardTitle", () => {
  const t = ((key: string) => (key === "nextUp.kindArchwing" ? "Archwing" : key)) as Translator;
  const titleOf = (over: Partial<SimulacrumCard>, at?: CodexStarChartNode) =>
    cardTitle(card({ ...over, stops: at ? [stop(at, [gap("a")])] : [] }), t);

  it("heads an archwing card Archwing, never its tileset, and names the planet", () => {
    const pandora = { ...node("Pandora", "Saturn", "Pursuit"), tileSets: ["Free Space"] };
    expect(titleOf({ kind: "tileSet", tier: "archwing", place: "Free Space" }, pandora)).toEqual([
      "Archwing",
      "Saturn",
    ]);
    const kepler = { ...node("Kepler", "Phobos", "Rush"), tileSets: ["Corpus Ship (Archwing)"] };
    expect(titleOf({ tier: "archwing", place: "Phobos" }, kepler)).toEqual(["Archwing", "Phobos"]);
  });

  it("names a tileset card's planet, and nothing more on a planet card", () => {
    const magna = node("Magnacidium", "Deimos", "Assassination");
    expect(titleOf({ kind: "tileSet", tier: "boss", place: "Orokin Derelict" }, magna)).toEqual([
      "Orokin Derelict",
      "Deimos",
    ]);
    expect(titleOf({}, node("Io", "Jupiter"))).toEqual(["Jupiter", ""]);
    const arc = node("Everview Arc", "Zariman Ten Zero", "Void Flood");
    expect(titleOf({ kind: "tileSet", place: "Zariman (Tileset)" }, arc)).toEqual([
      "Zariman",
      "Zariman Ten Zero",
    ]);
  });

  it("lists every planet a tileset card's stops span, in stop order", () => {
    const ship = card({
      kind: "tileSet",
      place: "Corpus Ship",
      stops: [
        stop(node("Cytherean", "Venus"), [gap("a")]),
        stop(node("Laomedeia", "Neptune", "Disruption"), [gap("b")]),
        stop(node("Ludi", "Ceres"), [gap("c")]),
      ],
    });
    expect(cardTitle(ship, t)).toEqual(["Corpus Ship", "Venus, Neptune, Ceres"]);
  });

  it("labels Deepmines a bounty on Venus, with no free roam wording", () => {
    const mines = { ...node("Deepmines", "Venus", "Free Roam"), tileSets: ["Deepmines"] };
    const deep = card({
      kind: "tileSet",
      tier: "bountyZone",
      place: "Deepmines",
      activity: "Bounty",
      stops: [stop(mines, [gap("a")])],
    });
    expect(cardTitle(deep, t)).toEqual(["Deepmines", "Bounty, Venus"]);
    expect(stopLabel(deep, deep.stops[0])).toEqual(["Deepmines", "Bounty"]);
  });

  it("names an activity under its place, and a rotating one alone", () => {
    const vallis = node("Orb Vallis", "Venus", "Free Roam");
    const bounty = { kind: "activity", tier: "activity", activity: "Narmer Bounty" } as const;
    expect(titleOf({ ...bounty, place: "Orb Vallis" }, vallis)).toEqual([
      "Orb Vallis",
      "Narmer Bounty, Venus",
    ]);
    expect(titleOf({ ...bounty, place: null, activity: "Archon Hunt" })).toEqual([
      "Archon Hunt",
      "",
    ]);
  });
});

describe("stopLabel", () => {
  it("names the node, its planet and its mission", () => {
    const io = stop(node("Laomedeia", "Neptune", "Disruption"), [gap("a")]);
    expect(stopLabel(card({}), io)).toEqual(["Laomedeia, Neptune", "Disruption"]);
  });

  it("names a node once when it shares its planet's name", () => {
    const vallis = stop(node("Orb Vallis", "Orb Vallis", "Free Roam"), [gap("a")]);
    expect(stopLabel(card({}), vallis)).toEqual(["Orb Vallis", "Free Roam"]);
  });

  it("names an activity's place and activity", () => {
    const at = stop(node("Cambion Drift", "Deimos", "Bounty"), [gap("a")]);
    const bounty = card({ kind: "activity", place: "Cambion Drift", activity: "Narmer Bounty" });
    expect(stopLabel(bounty, at)).toEqual(["Cambion Drift", "Narmer Bounty"]);
  });
});

describe("regularsByFaction", () => {
  it("counts each regular once per card, biggest faction first", () => {
    const factions: Record<string, string> = { a: "Corpus", b: "Corpus", c: "Grineer" };
    const shared = card({
      stops: [
        stop(node("Io", "Jupiter"), [gap("x")], [gap("a"), gap("c")]),
        stop(node("Europa", "Jupiter"), [gap("y")], [gap("a"), gap("b")]),
      ],
    });
    expect(regularsByFaction(shared, (type) => factions[type] ?? null)).toEqual([
      { faction: "Corpus", count: 2 },
      { faction: "Grineer", count: 1 },
    ]);
  });
});

describe("progress numbers", () => {
  it("counts the card's own gaps, leaving regulars out", () => {
    const io = node("Io", "Jupiter");
    const mixed = card({ stops: [stop(io, [gap("a"), gap("b")], [gap("r")])] });
    expect(enemiesLeft(mixed)).toBe(2);
    expect(enemiesLeft(card({ kind: "steelPath", gaps: [gap("x")] }))).toBe(1);
  });

  it("counts regulars once when a card has nothing else", () => {
    const only = card({
      stops: [
        stop(node("Io", "Jupiter"), [], [gap("r"), gap("s")]),
        stop(node("Europa", "Jupiter"), [], [gap("r")]),
      ],
    });
    expect(enemiesLeft(only)).toBe(2);
  });

  it("sums every enemy a stop lists, regulars included, and their remaining scans", () => {
    const io = stop(node("Io", "Jupiter"), [gap("a"), { ...gap("b"), cost: 5 }], [gap("r")]);
    expect(stopProgress(io)).toEqual({ enemies: 3, scans: 9 });
  });
});

describe("simulacrumSuggestions", () => {
  it("keeps the engine's order and carries the card", () => {
    const first = card({ key: "planet:Jupiter" });
    const second = card({ key: "steelPath:", kind: "steelPath", place: null });
    const rows = simulacrumSuggestions([first, second]);
    expect(rows.map((row) => row.order)).toEqual([0, 1]);
    expect(rows.map((row) => row.id)).toEqual([
      "simulacrum:planet:Jupiter",
      "simulacrum:steelPath:",
    ]);
    expect(rows[1]!.details?.simulacrum).toBe(second);
    expect(rows.every((row) => row.category === "simulacrum")).toBe(true);
  });
});

describe("isProbable", () => {
  it("reads only an explicit flag", () => {
    expect(isProbable(gap("a"))).toBe(false);
    expect(isProbable({ ...gap("a"), probable: true })).toBe(true);
  });
});
