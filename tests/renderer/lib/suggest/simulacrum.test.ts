import { describe, expect, it } from "vitest";

import {
  CODEX_SCAN_AVATARS,
  CODEX_SCAN_REQUIREMENTS,
  CODEX_STAR_CHART_NODES,
  type CodexStarChartNode,
} from "../../../../src/data/codexScanRequirements.js";
import { buildCodexRows } from "../../../../src/lib/codexScans.js";
import { MAX_STOPS, simulacrumCards } from "../../../../src/lib/suggest/simulacrum.js";
import type { CodexRequirement } from "../../../../config/shared/codexTypes.js";
import type { CodexRow } from "../../../../src/lib/codexScans.js";
import type { SimulacrumCard } from "../../../../src/lib/suggest/simulacrum.js";

function node(key: string, over: Partial<CodexStarChartNode> = {}): CodexStarChartNode {
  return {
    key,
    name: key,
    planet: "Earth",
    missionType: "Exterminate",
    factions: ["grineer"],
    tileSets: [],
    minEnemyLevel: 1,
    maxEnemyLevel: 10,
    ...over,
  };
}

function row(
  type: string,
  scanned: number,
  required: number | null,
  faction = "grineer",
): CodexRow {
  return {
    type,
    name: type,
    scanned,
    required,
    complete: required === null ? null : scanned >= required,
    faction,
    image: null,
  };
}

const req = (name: string, over: Partial<CodexRequirement> = {}): CodexRequirement => ({
  name,
  scans: 3,
  faction: "grineer",
  ...over,
});

const onEarth = (name: string): CodexRequirement => req(name, { planets: ["Earth"] });

const stopKeys = (card: SimulacrumCard): string[] => card.stops.map((stop) => stop.node.key);
const stopGaps = (card: SimulacrumCard, index = 0): string[] =>
  card.stops[index].gaps.map((gap) => gap.type);

/** Every gap a card shows, wherever on the card it sits. */
const shownTypes = (cards: SimulacrumCard[]): Set<string> =>
  new Set(
    cards.flatMap((card) => [
      ...card.gaps.map((gap) => gap.type),
      ...card.stops.flatMap((stop) => [...stop.gaps, ...stop.regulars].map((gap) => gap.type)),
    ]),
  );

describe("simulacrumCards gaps", () => {
  it("skips complete rows and rows with no known requirement", () => {
    const cards = simulacrumCards(
      [row("A", 3, 3), row("B", 0, null), row("C", 1, 3)],
      { A: onEarth("A"), B: onEarth("B"), C: onEarth("C") },
      [node("E1")],
    );
    expect(shownTypes(cards)).toEqual(new Set(["C"]));
    expect(cards[0].stops[0].gaps[0]).toMatchObject({ cost: 2, eximus: false });
  });

  it("yields no cards for a fully complete profile", () => {
    const cards = simulacrumCards(
      [row("A", 3, 3), row("B", 5, 3)],
      { A: onEarth("A"), B: req("B") },
      [node("E1")],
    );
    expect(cards).toEqual([]);
  });

  it("counts Eximus rows against the base entry's place and flags them", () => {
    const cards = simulacrumCards(
      [row("A#leader", 0, 3)],
      { A: req("A", { tileSets: ["Grineer Forest"] }) },
      [node("E1"), node("E2", { tileSets: ["Grineer Forest"] })],
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ kind: "tileSet", place: "Grineer Forest" });
    expect(stopKeys(cards[0])).toEqual(["E2"]);
    expect(cards[0].stops[0].gaps[0].eximus).toBe(true);
  });

  it("leaves wildlife, objects and lore out", () => {
    const cards = simulacrumCards(
      [row("W", 0, 20, "wildlife"), row("O", 0, 1, "objects"), row("L", 0, 1, "lore")],
      {},
      [node("E1")],
    );
    expect(cards).toEqual([]);
  });
});

describe("simulacrumCards stops", () => {
  it("lists a stop's gaps cheapest first", () => {
    const cards = simulacrumCards(
      [row("Dear", 0, 5), row("Cheap", 2, 3), row("Mid", 1, 3)],
      { Dear: onEarth("Dear"), Cheap: onEarth("Cheap"), Mid: onEarth("Mid") },
      [node("E1")],
    );
    expect(stopGaps(cards[0])).toEqual(["Cheap", "Mid", "Dear"]);
  });

  it("stops first at the node covering the most gaps, then covers the rest", () => {
    const mission = (name: string, missions: string[]) =>
      req(name, { planets: ["Earth"], missions });
    const cards = simulacrumCards(
      [row("A", 0, 3), row("B", 0, 3), row("C", 0, 3), row("D", 0, 3)],
      {
        A: mission("A", ["Defense"]),
        B: mission("B", ["Defense"]),
        C: mission("C", ["Spy"]),
        D: onEarth("D"),
      },
      [node("Ext"), node("Def", { missionType: "Defense" }), node("Spy", { missionType: "Spy" })],
    );
    expect(cards).toHaveLength(1);
    expect(stopKeys(cards[0])).toEqual(["Def", "Spy"]);
    expect(stopGaps(cards[0], 0)).toEqual(["A", "B", "D"]);
    expect(stopGaps(cards[0], 1)).toEqual(["C"]);
  });

  it("caps a card at MAX_STOPS and carries the rest to another card", () => {
    const names = ["A", "B", "C", "D"];
    const missions = ["Defense", "Spy", "Capture", "Rescue"];
    const requirements = Object.fromEntries(
      names.map((name, i) => [name, req(name, { planets: ["Earth"], missions: [missions[i]] })]),
    );
    const cards = simulacrumCards(
      names.map((name, i) => row(name, 0, 3 + i)),
      requirements,
      missions.map((missionType) => node(missionType, { missionType })),
    );
    expect(MAX_STOPS).toBe(3);
    expect(cards.map((card) => card.key)).toEqual(["planet:Earth", "planet:Earth#2"]);
    expect(stopKeys(cards[0])).toEqual(["Defense", "Spy", "Capture"]);
    expect(stopKeys(cards[1])).toEqual(["Rescue"]);
  });

  it("breaks a tie on gaps and scans toward the higher-level node", () => {
    const cards = simulacrumCards([row("A", 0, 3)], { A: onEarth("A") }, [
      node("Low", { maxEnemyLevel: 10 }),
      node("High", { maxEnemyLevel: 30 }),
    ]);
    expect(stopKeys(cards[0])).toEqual(["High"]);
    expect(cards[0].stops[0].alternatives.map((alt) => alt.key)).toEqual(["Low"]);
  });

  it("prefers the node whose gaps need fewer scans when counts tie", () => {
    const cards = simulacrumCards(
      [row("A", 0, 10), row("B", 0, 2)],
      {
        A: req("A", { planets: ["Earth"], missions: ["Defense"] }),
        B: req("B", { planets: ["Earth"], missions: ["Spy"] }),
      },
      [
        node("Def", { missionType: "Defense", maxEnemyLevel: 50 }),
        node("Spy", { missionType: "Spy" }),
      ],
    );
    expect(stopKeys(cards[0])).toEqual(["Spy", "Def"]);
  });
});

describe("simulacrumCards mission preference", () => {
  const gated = (name: string, missions: string[], planet = "Earth") =>
    req(name, { planets: [planet], missions });

  it("stops at a good node before a tough node that covers more gaps", () => {
    const cards = simulacrumCards(
      [row("A", 0, 3), row("B", 0, 3), row("C", 0, 3)],
      { A: gated("A", ["Interception"]), B: gated("B", ["Interception"]), C: onEarth("C") },
      [node("Ext"), node("Int", { missionType: "Interception", maxEnemyLevel: 99 })],
    );
    expect(stopKeys(cards[0])).toEqual(["Ext", "Int"]);
    expect(stopGaps(cards[0], 0)).toEqual(["C"]);
    expect(stopGaps(cards[0], 1)).toEqual(["A", "B"]);
  });

  it("still gives an interception-only gap a stop", () => {
    const cards = simulacrumCards([row("A", 0, 3)], { A: gated("A", ["Interception"]) }, [
      node("Ext"),
      node("Int", { missionType: "Interception" }),
    ]);
    expect(stopKeys(cards[0])).toEqual(["Int"]);
  });

  it("reads a defense variant as niche, after tough", () => {
    const cards = simulacrumCards(
      [row("A", 0, 3), row("B", 0, 3)],
      { A: onEarth("A"), B: gated("B", ["Mirror Defense"]) },
      [
        node("Mirror", { missionType: "Mirror Defense", maxEnemyLevel: 99 }),
        node("Res", { missionType: "Rescue" }),
      ],
    );
    expect(stopKeys(cards[0])).toEqual(["Res", "Mirror"]);
  });

  it("ranks cards by what their good-group stops finish, then total unlocks", () => {
    const cards = simulacrumCards(
      [row("I1", 0, 1), row("I2", 0, 1), row("I3", 0, 1), row("M", 0, 9), row("V", 0, 1)],
      {
        I1: gated("I1", ["Interception"]),
        I2: gated("I2", ["Interception"]),
        I3: gated("I3", ["Interception"]),
        M: req("M", { planets: ["Mars"] }),
        V: req("V", { planets: ["Venus"], missions: ["Disruption"] }),
      },
      [
        node("Int", { missionType: "Interception" }),
        node("MarsExt", { planet: "Mars" }),
        node("VenusDis", { planet: "Venus", missionType: "Disruption" }),
      ],
    );
    expect(cards.map((card) => card.place)).toEqual(["Mars", "Earth", "Venus"]);
  });

  it("keeps assassination in the boss tier", () => {
    const cards = simulacrumCards(
      [row("Boss", 0, 1), row("Grunt", 0, 1)],
      { Boss: gated("Boss", ["Assassination"]), Grunt: onEarth("Grunt") },
      [node("Ext"), node("War", { missionType: "Assassination" })],
    );
    expect(cards.map((card) => card.tier)).toEqual(["normal", "boss"]);
  });
});

describe("simulacrumCards places", () => {
  it("never counts a tileset enemy at another tileset on the same planet", () => {
    const cards = simulacrumCards(
      [row("Forest", 0, 3)],
      { Forest: req("Forest", { tileSets: ["Grineer Forest"] }) },
      [
        node("Galleon", { tileSets: ["Grineer Galleon"], maxEnemyLevel: 99 }),
        node("Woods", { tileSets: ["Grineer Forest"] }),
      ],
    );
    expect(stopKeys(cards[0])).toEqual(["Woods"]);
    expect(cards[0].stops[0].alternatives).toEqual([]);
  });

  it("counts a mission-gated enemy only at that mission type", () => {
    const cards = simulacrumCards(
      [row("Boss", 0, 3)],
      { Boss: req("Boss", { planets: ["Earth"], missions: ["Assassination", "The Guilty"] }) },
      [node("Ext", { maxEnemyLevel: 99 }), node("Lephantis", { missionType: "Assassination" })],
    );
    expect(stopKeys(cards[0])).toEqual(["Lephantis"]);
  });

  it("gates on a node name an entry lists as its mission", () => {
    const cards = simulacrumCards(
      [row("Vor", 0, 3)],
      { Vor: req("Vor", { missions: ["Tolstoj"] }) },
      [node("Tolstoj", { planet: "Mercury", missionType: "Assassination" }), node("Elion")],
    );
    expect(cards[0]).toMatchObject({ kind: "planet", place: "Mercury" });
    expect(stopKeys(cards[0])).toEqual(["Tolstoj"]);
  });
});

describe("simulacrumCards regulars", () => {
  const nodes = [
    node("Def", { missionType: "Defense" }),
    node("Ext", { maxEnemyLevel: 99 }),
    node("Mars", { planet: "Mars" }),
  ];
  const regulars = ["R1", "R2", "R3", "R4", "R5"];
  const cards = simulacrumCards(
    [row("X", 0, 2), row("Y", 0, 1), ...regulars.map((type) => row(type, 0, 1))],
    {
      X: req("X", { planets: ["Earth"], missions: ["Defense"] }),
      Y: req("Y", { planets: ["Mars"] }),
      ...Object.fromEntries(regulars.map((type) => [type, req(type)])),
    },
    nodes,
  );

  it("shows faction-only gaps at the stops they spawn at", () => {
    expect(cards[0].stops[0].regulars.map((gap) => gap.type)).toEqual(regulars);
    expect(cards.some((card) => card.kind === "regulars")).toBe(false);
  });

  it("never lets them decide the ranking or the stop", () => {
    expect(cards.map((card) => card.place)).toEqual(["Mars", "Earth"]);
    expect(stopKeys(cards[1])).toEqual(["Def"]);
    expect(cards[1]).toMatchObject({ unlocks: 1, scans: 2 });
  });

  it("gives a faction-only gap no place card reached a card of its own, after them", () => {
    const more = simulacrumCards(
      [row("Y", 0, 1), row("Crewman", 0, 3, "corpus")],
      { Y: req("Y", { planets: ["Mars"] }), Crewman: req("Crewman", { faction: "corpus" }) },
      [...nodes, node("Venus", { planet: "Venus", factions: ["corpus"] })],
    );
    expect(more.map((card) => [card.kind, card.place])).toEqual([
      ["planet", "Mars"],
      ["regulars", "Venus"],
    ]);
    expect(stopGaps(more[1])).toEqual(["Crewman"]);
  });
});

describe("simulacrumCards ranking", () => {
  it("orders a tier by unlocks, then fewer scans, then name", () => {
    const placed = (planet: string) => req(planet, { planets: [planet.replace(/\d$/, "")] });
    const cards = simulacrumCards(
      [
        row("Earth1", 0, 1),
        row("Earth2", 0, 1),
        row("Mars", 0, 1),
        row("Ceres", 0, 1),
        row("Venus", 0, 2),
      ],
      {
        Earth1: placed("Earth1"),
        Earth2: placed("Earth2"),
        Mars: placed("Mars"),
        Ceres: placed("Ceres"),
        Venus: placed("Venus"),
      },
      ["Earth", "Mars", "Ceres", "Venus"].map((planet) => node(planet, { planet })),
    );
    expect(cards.map((card) => card.place)).toEqual(["Earth", "Ceres", "Mars", "Venus"]);
  });

  it("puts Acolytes on a Steel Path card with no node to stop at, after node cards", () => {
    const cards = simulacrumCards(
      [row("Angst", 0, 3, "stalker"), row("Misery", 1, 3, "stalker"), row("A", 0, 30)],
      {
        Angst: req("Angst", { faction: "stalker" }),
        Misery: req("Misery", { faction: "stalker" }),
        A: onEarth("A"),
      },
      [node("E1")],
    );
    const steel = cards.find((card) => card.kind === "steelPath");
    expect(steel).toMatchObject({ place: null, stops: [], unlocks: 2, scans: 5 });
    expect(steel?.gaps.map((gap) => gap.type)).toEqual(["Misery", "Angst"]);
    expect(cards[1]).toBe(steel);
    expect(cards[0].stops.flatMap((stop) => stop.gaps).map((gap) => gap.type)).toEqual(["A"]);
  });

  const tierNodes = [
    node("Ext", { planet: "Mars" }),
    node("War", { planet: "Mars", missionType: "Assassination", maxEnemyLevel: 99 }),
    node("Syrtis", { planet: "Mars", tileSets: ["Free Space"] }),
    node("Kepler", { planet: "Phobos", tileSets: ["Corpus Ship (Archwing)"] }),
    node("Vallis", { planet: "Venus", missionType: "Free Roam", tileSets: ["Orb Vallis"] }),
    node("Mines", { planet: "Venus", missionType: "Free Roam", tileSets: ["Deepmines"] }),
    node("Proxima", { planet: "Venus Proxima", railjack: true, tileSets: ["Free Space"] }),
  ];

  it("ranks easy tiers first, whatever the harder ones unlock", () => {
    const cheap = (name: string, over: Partial<CodexRequirement>) => [name, req(name, over)];
    const requirements = Object.fromEntries([
      ...["B1", "B2", "B3"].map((name) => cheap(name, { missions: ["Assassination"] })),
      ...["W1", "W2", "W3"].map((name) => cheap(name, { tileSets: ["Free Space"] })),
      ...["K1", "K2"].map((name) => cheap(name, { tileSets: ["Corpus Ship (Archwing)"] })),
      ...["V1", "V2"].map((name) => cheap(name, { tileSets: ["Orb Vallis"] })),
      cheap("Hostage", { tileSets: ["Deepmines"] }),
      cheap("Rail", { planets: ["Venus Proxima"], missions: ["Empyrean"] }),
      cheap("Hunt", { faction: "narmer", missions: ["Archon Hunt"] }),
      cheap("Stalker", { faction: "stalker" }),
      cheap("Angst", { faction: "stalker" }),
      cheap("Ground", { planets: ["Mars"], missions: ["Exterminate"] }),
    ]);
    const rows = Object.keys(requirements).map((type) =>
      row(type, 0, type === "Ground" ? 20 : 1, requirements[type].faction),
    );
    const cards = simulacrumCards(rows, requirements, tierNodes);
    expect(cards.map((card) => [card.key, card.tier])).toEqual([
      ["planet:Mars", "normal"],
      ["tileSet:Orb Vallis@openWorld", "openWorld"],
      ["tileSet:Free Space@archwing", "archwing"],
      ["tileSet:Corpus Ship (Archwing)@archwing", "archwing"],
      ["railjack:Venus Proxima", "railjack"],
      ["tileSet:Deepmines@bountyZone:Bounty", "bountyZone"],
      ["activity::Archon Hunt", "activity"],
      ["planet:Mars@boss", "boss"],
      ["steelPath:", "steelPath"],
      ["activity::Death Mark", "deathMark"],
    ]);
  });

  it("splits a planet by tier, so a boss or archwing node never takes a normal card's stop", () => {
    const cards = simulacrumCards(
      [row("Grunt", 0, 9), row("Boss", 0, 1), row("Ace", 0, 1), row("Pilot", 0, 1)],
      {
        Grunt: req("Grunt", { planets: ["Mars"] }),
        Boss: req("Boss", { planets: ["Mars"], missions: ["Assassination"] }),
        Ace: req("Ace", { planets: ["Mars"], missions: ["Assassination", "Exterminate"] }),
        Pilot: req("Pilot", { planets: ["Mars"], tileSets: ["Free Space"] }),
      },
      tierNodes,
    );
    expect(cards.map((card) => [card.key, stopKeys(card)])).toEqual([
      ["planet:Mars", ["Ext"]],
      ["tileSet:Free Space@archwing", ["Syrtis"]],
      ["planet:Mars@boss", ["War"]],
    ]);
    expect(stopGaps(cards[0])).toEqual(["Ace", "Grunt"]);
    expect(stopGaps(cards[2])).toEqual(["Boss"]);
  });

  it("runs Deepmines as a bounty, never free roam", () => {
    const cards = simulacrumCards(
      [row("Hostage", 0, 1, "corpus")],
      { Hostage: req("Hostage", { faction: "corpus", tileSets: ["Deepmines"] }) },
      tierNodes,
    );
    expect(cards[0]).toMatchObject({ tier: "bountyZone", place: "Deepmines", activity: "Bounty" });
  });
});

describe("simulacrumCards coverage", () => {
  const nodes = [
    node("Def", { missionType: "Defense" }),
    node("Woods", { tileSets: ["Grineer Forest"] }),
    node("Mars", { planet: "Mars", factions: ["grineer", "infestation"] }),
    node("Venus", { planet: "Venus", factions: ["corpus"], missionType: "Spy" }),
    node("Rebellion", {
      planet: "Dark Refractory",
      factions: ["anarchs"],
      tileSets: ["Perita"],
      missionType: "The Perita Rebellion",
    }),
  ];
  const requirements: Record<string, CodexRequirement> = {
    Planet: onEarth("Planet"),
    Forest: req("Forest", { planets: ["Earth"], tileSets: ["Grineer Forest"] }),
    Gated: req("Gated", { missions: ["Defense"] }),
    Regular: req("Regular"),
    Corpus: req("Corpus", { faction: "corpus" }),
    Narmer: req("Narmer", { faction: "narmer" }),
    Railjack: req("Railjack", {
      planets: ["Veil Proxima"],
      tileSets: ["Free Space"],
      missions: ["Empyrean"],
    }),
    Anarch: req("Anarch", {
      faction: "anarchs",
      planets: ["Perita"],
      tileSets: ["Perita"],
      missions: ["The Perita Rebellion"],
    }),
    Murex: req("Murex", { tileSets: ["Murex"] }),
    Angst: req("Angst", { faction: "stalker" }),
  };
  const rows = [
    ...Object.keys(requirements).map((type, i) =>
      row(type, 0, 1 + (i % 4), requirements[type].faction),
    ),
    row("Planet#leader", 0, 2),
    row("/Unknown/InfestedThing", 0, 3, "infestation"),
    row("/Unknown/Drifter", 0, 3, "unaffiliated"),
    row("Done", 3, 3),
  ];
  const cards = simulacrumCards(rows, requirements, nodes);

  it("shows every gap on some card", () => {
    const owed = rows.filter((entry) => entry.complete === false).map((entry) => entry.type);
    expect(shownTypes(cards)).toEqual(new Set(owed));
  });

  it("files gaps with no node to run on a last, unplaced card", () => {
    const last = cards[cards.length - 1];
    expect(last.kind).toBe("unplaced");
    expect(new Set(last.gaps.map((gap) => gap.type))).toEqual(
      new Set(["Narmer", "Railjack", "Murex", "/Unknown/Drifter"]),
    );
    expect(cards.filter((card) => card.kind === "unplaced")).toHaveLength(1);
  });

  it("places an off-chart planet by its tileset when a known mission confirms it", () => {
    const perita = cards.find((card) => card.place === "Perita");
    expect(perita?.kind).toBe("tileSet");
    expect(stopKeys(perita!)).toEqual(["Rebellion"]);
  });

  it("gives an entry missing from the table a place through its faction", () => {
    const mars = cards.find((card) => card.place === "Mars");
    expect(mars?.kind).toBe("regulars");
    expect(stopGaps(mars!)).toEqual(["/Unknown/InfestedThing"]);
  });
});

describe("simulacrumCards railjack", () => {
  const rail = (key: string, planet: string, over: Partial<CodexStarChartNode> = {}) =>
    node(key, {
      planet,
      railjack: true,
      tileSets: ["Free Space"],
      missionType: "Skirmish",
      maxEnemyLevel: 90,
      ...over,
    });
  const nodes = [
    node("Archwing", { planet: "Neptune", tileSets: ["Free Space"], factions: ["corpus"] }),
    node("Ground", { factions: ["corpus", "grineer"], maxEnemyLevel: 99 }),
    rail("Venus1", "Venus Proxima", { factions: ["corpus"] }),
    rail("Veil1", "Veil Proxima", { factions: ["grineer"] }),
    rail("Veil2", "Veil Proxima", { factions: ["corpus"], missionType: "Volatile" }),
  ];
  const empyrean = (name: string, over: Partial<CodexRequirement> = {}) =>
    req(name, { faction: "corpus", missions: ["Empyrean"], ...over });

  it("keeps Railjack enemies off ground and archwing nodes", () => {
    const cards = simulacrumCards(
      [row("Fighter", 0, 3, "corpus"), row("Boarder", 0, 3, "corpus")],
      {
        Fighter: empyrean("Fighter", { planets: ["Venus Proxima"], tileSets: ["Free Space"] }),
        Boarder: req("Boarder", { faction: "corpus", planets: ["Venus Proxima"] }),
      },
      nodes,
    );
    expect(cards.map((card) => [card.kind, card.place])).toEqual([["railjack", "Venus Proxima"]]);
    expect(stopKeys(cards[0])).toEqual(["Venus1"]);
    expect(cards[0].stops[0].alternatives).toEqual([]);
  });

  it("keeps ground enemies off Railjack nodes", () => {
    const cards = simulacrumCards(
      [row("Dargyn", 0, 3), row("Lancer", 0, 3)],
      {
        Dargyn: req("Dargyn", { tileSets: ["Free Space"] }),
        Lancer: req("Lancer", { missions: ["Skirmish", "Exterminate"] }),
      },
      [...nodes, node("Skiff", { planet: "Neptune", tileSets: ["Free Space"] })],
    );
    const keys = cards.flatMap((card) => [
      ...stopKeys(card),
      ...card.stops.flatMap((s) => s.alternatives.map((a) => a.key)),
    ]);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some((key) => /^(Venus|Veil)/.test(key))).toBe(false);
    expect(cards.some((card) => card.kind === "railjack")).toBe(false);
  });

  it("gives each Proxima region its own card, ranked after ground nodes", () => {
    const cards = simulacrumCards(
      [
        row("Taro", 0, 1, "corpus"),
        row("Orm", 0, 4, "corpus"),
        row("Exo", 0, 4),
        row("Mine", 0, 2),
      ],
      {
        Taro: empyrean("Taro", { planets: ["Venus Proxima"] }),
        Orm: empyrean("Orm", { planets: ["Veil Proxima"], missions: ["Empyrean", "Volatile"] }),
        Exo: req("Exo", { planets: ["Veil Proxima"] }),
        Mine: onEarth("Mine"),
      },
      nodes,
    );
    expect(cards.map((card) => card.key)).toEqual([
      "planet:Earth",
      "railjack:Veil Proxima",
      "railjack:Venus Proxima",
    ]);
    expect(stopKeys(cards[1]).sort()).toEqual(["Veil1", "Veil2"]);
  });

  it("reads a plain planet on an Empyrean enemy as its Proxima region", () => {
    const cards = simulacrumCards(
      [row("Weaver", 0, 3, "corpus")],
      { Weaver: empyrean("Weaver", { planets: ["Venus"], tileSets: ["Free Space"] }) },
      [...nodes, rail("Veil3", "Veil Proxima", { factions: ["corpus"], maxEnemyLevel: 99 })],
    );
    expect(cards.map((card) => card.place)).toEqual(["Venus Proxima"]);
  });

  it("stops at a hidden node only when nothing visible does as well", () => {
    const cards = simulacrumCards(
      [row("Crew", 0, 3, "corpus"), row("Coda", 0, 3, "corpus")],
      {
        Crew: empyrean("Crew", { planets: ["Venus Proxima"] }),
        Coda: empyrean("Coda", { planets: ["Venus Proxima"], missions: ["Coda Concert"] }),
      },
      [
        ...nodes,
        rail("Showdown", "Venus Proxima", {
          factions: ["corpus"],
          hidden: true,
          maxEnemyLevel: 99,
        }),
        rail("Coda Concert", "Venus Proxima", { factions: ["corpus"], hidden: true }),
      ],
    );
    expect(stopKeys(cards[0])).toEqual(["Coda Concert"]);
    expect(stopGaps(cards[0])).toEqual(["Coda", "Crew"]);
    const solo = simulacrumCards(
      [row("Crew", 0, 3, "corpus")],
      { Crew: empyrean("Crew", { planets: ["Venus Proxima"] }) },
      [
        ...nodes,
        rail("Showdown", "Venus Proxima", {
          factions: ["corpus"],
          hidden: true,
          maxEnemyLevel: 99,
        }),
      ],
    );
    expect(stopKeys(solo[0])).toEqual(["Venus1"]);
  });
});

describe("simulacrumCards Descendia and Narmer", () => {
  const nodes = [
    node("The Descendia", {
      planet: "Dark Refractory",
      missionType: "The Descendia",
      factions: ["orokin"],
      tileSets: ["Descendia"],
    }),
    node("Roathe's Oblivion", {
      planet: "Dark Refractory",
      missionType: "The Descendia",
      factions: ["orokin"],
      maxEnemyLevel: 90,
    }),
    node("Guilty", { planet: "Dark Refractory", factions: ["orokin"], maxEnemyLevel: 99 }),
    node("Drift", {
      planet: "Deimos",
      missionType: "Free Roam",
      factions: ["infestation"],
      tileSets: ["Cambion Drift"],
    }),
    node("Dig", { planet: "Deimos", missionType: "Excavation", factions: ["infestation"] }),
    node("Plains", {
      missionType: "Free Roam",
      factions: ["grineer"],
      tileSets: ["Plains of Eidolon"],
    }),
    node("Vallis", {
      planet: "Venus",
      missionType: "Free Roam",
      factions: ["corpus"],
      tileSets: ["Orb Vallis"],
    }),
  ];

  it("lets a one-planet mission outrank a tileset it shares no node with", () => {
    const cards = simulacrumCards(
      [row("Rogue", 0, 3, "themurmur")],
      {
        Rogue: req("Rogue", {
          faction: "themurmur",
          tileSets: ["Cambion Drift"],
          missions: ["Descendia"],
        }),
      },
      nodes,
    );
    expect(cards.map((card) => [card.key, card.activity])).toEqual([
      ["activity:Dark Refractory:The Descendia", "The Descendia"],
    ]);
    expect(stopKeys(cards[0])).toEqual(["The Descendia"]);
  });

  it("lets a tileset outrank a generic mission type it shares no node with", () => {
    const cards = simulacrumCards(
      [row("Carrier", 0, 3, "infestation")],
      {
        Carrier: req("Carrier", {
          faction: "infestation",
          planets: ["Deimos"],
          tileSets: ["Cambion Drift"],
          missions: ["Excavation"],
        }),
      },
      [...nodes, node("Dig2", { planet: "Mars", missionType: "Excavation" })],
    );
    expect(stopKeys(cards[0])).toEqual(["Drift"]);
  });

  it("reads a planet the chart spells as a node as that node", () => {
    const cards = simulacrumCards(
      [row("Kullervo (Descendia)", 0, 3, "unaffiliated")],
      {
        "Kullervo (Descendia)": req("Kullervo (Descendia)", {
          faction: "unaffiliated",
          planets: ["The Descendia"],
        }),
      },
      nodes,
    );
    expect(cards[0]).toMatchObject({ kind: "activity", activity: "The Descendia" });
    expect(stopKeys(cards[0])).toEqual(["The Descendia"]);
  });

  it("gives Narmer bounty units an open-world bounty card of their own", () => {
    const bounty = (name: string, tileSet: string, mission = "Narmer Bounty") =>
      req(name, { faction: "narmer", tileSets: [tileSet], missions: [mission] });
    const cards = simulacrumCards(
      [
        row("Lancer", 0, 1, "narmer"),
        row("Carrier", 0, 1, "narmer"),
        row("Crewman", 0, 2, "narmer"),
        row("Plainsman", 0, 1),
        row("Grunt", 0, 1),
      ],
      {
        Lancer: bounty("Lancer", "Plains of Eidolon"),
        Carrier: bounty("Carrier", "Plains of Eidolon", "Break Narmer Bounty"),
        Crewman: bounty("Crewman", "Orb Vallis"),
        Plainsman: req("Plainsman", { tileSets: ["Plains of Eidolon"] }),
        Grunt: req("Grunt"),
      },
      nodes,
    );
    expect(cards.map((card) => card.key)).toEqual([
      "tileSet:Plains of Eidolon@openWorld",
      "activity:Plains of Eidolon:Narmer Bounty",
      "activity:Orb Vallis:Narmer Bounty",
    ]);
    expect(stopKeys(cards[1])).toEqual(["Plains"]);
    expect(stopGaps(cards[1])).toEqual(["Carrier", "Lancer"]);
    expect(cards[1].stops[0].regulars).toEqual([]);
    expect(stopGaps(cards[0])).toEqual(["Plainsman"]);
    expect(cards[0].stops[0].regulars.map((gap) => gap.type)).toEqual(["Grunt"]);
  });

  it("puts PNW Narmer units with no wiki row on their side's bounty, flagged probable", () => {
    const pnw = (side: string, name: string, suffix = ""): CodexRow => ({
      ...row(
        `/Lotus/Types/Enemies/${side}/Narmer/Avatars/PNWNarmerAvatar${suffix}`,
        0,
        3,
        "narmer",
      ),
      name,
    });
    const cards = simulacrumCards(
      [
        pnw("Grineer", "Narmer Butcher"),
        pnw("Corpus", "Narmer Elite Ranger Eximus", "#leader"),
        row("Lancer", 0, 1, "narmer"),
        row("/Lotus/Types/Enemies/Narmer/NarmerDefenseDroneAvatar", 0, 3, "narmer"),
      ],
      {
        Lancer: req("Lancer", {
          faction: "narmer",
          tileSets: ["Plains of Eidolon"],
          missions: ["Narmer Bounty"],
        }),
      },
      nodes,
    );
    const plains = cards.find((card) => card.key === "activity:Plains of Eidolon:Narmer Bounty");
    const vallis = cards.find((card) => card.key === "activity:Orb Vallis:Narmer Bounty");
    expect(plains?.stops[0].gaps.map((gap) => [gap.name, gap.probable])).toEqual([
      ["Lancer", undefined],
      ["Narmer Butcher", true],
    ]);
    expect(vallis?.stops[0].gaps.map((gap) => gap.probable)).toEqual([true]);
    expect(cards.find((card) => card.kind === "unplaced")?.gaps.map((gap) => gap.type)).toEqual([
      "/Lotus/Types/Enemies/Narmer/NarmerDefenseDroneAvatar",
    ]);
  });
});

describe("simulacrumCards nodeless activities", () => {
  const nodes = [
    node("Ext", { planet: "Mars", maxEnemyLevel: 99 }),
    node("Orphix", { planet: "Mars", missionType: "Orphix" }),
    node("Circulus", { planet: "Lua", missionType: "Survival", factions: ["orokin"] }),
    node("Circuit", { planet: "Duviri", missionType: "Free Roam", factions: ["orokin"] }),
  ];
  const keysOf = (cards: SimulacrumCard[]) => cards.map((card) => card.key);

  it("gathers Archon Hunt units on one card with no place or stop", () => {
    const cards = simulacrumCards(
      [row("Amar", 0, 1, "narmer"), row("Deacon", 0, 3, "narmer"), row("Aero", 0, 3, "sentient")],
      {
        Amar: req("Amar", { faction: "narmer", planets: ["Mars"], missions: ["Archon Hunt"] }),
        Deacon: req("Deacon", { faction: "narmer", missions: ["Archon Hunt"] }),
        Aero: req("Aero", { faction: "sentient", missions: ["Orphix", "Archon Hunt"] }),
      },
      nodes,
    );
    const hunt = cards.find((card) => card.activity === "Archon Hunt");
    expect(hunt).toMatchObject({ key: "activity::Archon Hunt", kind: "activity", place: null });
    expect(hunt?.stops).toEqual([]);
    expect(hunt?.gaps.map((gap) => gap.type)).toEqual(["Amar", "Deacon"]);
    expect(stopKeys(cards.find((card) => card.place === "Mars")!)).toEqual(["Orphix"]);
  });

  it("gives Isleweaver units a Duviri card and Follie a relay card", () => {
    const cards = simulacrumCards(
      [row("Oraxia", 0, 3, "unaffiliated"), row("Follie", 0, 3, "unaffiliated")],
      {
        Oraxia: req("Oraxia", { faction: "unaffiliated", missions: ["Isleweaver"] }),
        Follie: req("Follie", { faction: "unaffiliated", planets: ["Venus"], tileSets: ["Relay"] }),
      },
      nodes,
    );
    expect(keysOf(cards).sort()).toEqual([
      "activity:Duviri:Isleweaver",
      "activity:Relays:Follie's Hunt",
    ]);
  });

  it("sends every Stalker form to his Death Mark and his Acolytes' Shadows to Steel Path", () => {
    const cards = simulacrumCards(
      [
        row("Stalker", 0, 1, "stalker"),
        row("Shadow Stalker", 0, 1, "stalker"),
        row("Protector Stalker", 0, 1, "stalker"),
        row("Shadow Of Angst", 0, 3, "stalker"),
      ],
      { Stalker: req("Stalker", { faction: "stalker" }) },
      nodes,
    );
    const mark = cards.find((card) => card.activity === "Death Mark");
    expect(mark?.gaps.map((gap) => gap.type)).toEqual([
      "Protector Stalker",
      "Shadow Stalker",
      "Stalker",
    ]);
    expect(cards.find((card) => card.kind === "steelPath")?.gaps.map((g) => g.type)).toEqual([
      "Shadow Of Angst",
    ]);
  });

  it("ranks a nodeless activity after the node cards", () => {
    const cards = simulacrumCards(
      [row("Cheap", 0, 1, "narmer"), row("Dear", 0, 9)],
      {
        Cheap: req("Cheap", { faction: "narmer", missions: ["Archon Hunt"] }),
        Dear: req("Dear", { planets: ["Mars"] }),
      },
      nodes,
    );
    expect(keysOf(cards)).toEqual(["planet:Mars", "activity::Archon Hunt"]);
  });

  it("places curated one-offs the enemy modules leave out, and keeps a no-codex unit unplaced", () => {
    const cards = simulacrumCards(
      [
        row("Lua Thrax Legatus", 0, 3, "unaffiliated"),
        { ...row("Dax Arcus#leader", 0, 3, "unaffiliated"), name: "Dax Arcus Eximus" },
        row("Narmer Coildrive", 0, 3, "narmer"),
      ],
      {
        "Lua Thrax Legatus": req("Lua Thrax Legatus", {
          faction: "unaffiliated",
          missions: ["Conjunction Survival"],
        }),
        "Narmer Coildrive": req("Narmer Coildrive", {
          faction: "narmer",
          tileSets: ["Orb Vallis"],
          missions: ["Narmer Bounty"],
        }),
      },
      nodes,
    );
    expect(stopKeys(cards.find((card) => card.place === "Lua")!)).toEqual(["Circulus"]);
    expect(stopKeys(cards.find((card) => card.place === "Duviri")!)).toEqual(["Circuit"]);
    expect(cards.find((card) => card.kind === "unplaced")?.gaps.map((g) => g.type)).toEqual([
      "Narmer Coildrive",
    ]);
  });
});

describe("generated star-chart nodes", () => {
  // Murex has no star-chart node, and the relay tileset only hosts Follie's Hunt,
  // which ExportRegions gives no faction.
  const TOLERATED_UNMAPPED = ["Murex", "Relay"];

  it("holds no hub, relay, junction, Conclave or Steel Path node", () => {
    expect(CODEX_STAR_CHART_NODES.length).toBeGreaterThan(200);
    for (const entry of CODEX_STAR_CHART_NODES) {
      expect(entry.key).not.toMatch(/HUB|Hub|Junction|PvpNode/);
      expect(entry.missionType).not.toMatch(/^(Hub|Relay|Conclave|Solar Rail Junction)$/);
      expect(`${entry.name} ${entry.missionType}`).not.toMatch(/steel path/i);
      expect(entry.factions.length).toBeGreaterThan(0);
    }
  });

  it("flags exactly the Proxima nodes as Railjack", () => {
    const railjack = CODEX_STAR_CHART_NODES.filter((entry) => entry.railjack);
    expect(railjack.length).toBeGreaterThan(30);
    for (const entry of CODEX_STAR_CHART_NODES) {
      expect(entry.railjack === true).toBe(/Proxima$/.test(entry.planet));
    }
  });

  it("places every Railjack, Narmer bounty and Descendia gap of a zero-scan profile", () => {
    const rows = buildCodexRows([]);
    const cards = simulacrumCards(rows, CODEX_SCAN_REQUIREMENTS, CODEX_STAR_CHART_NODES);
    const unplaced = cards.find((card) => card.kind === "unplaced")?.gaps ?? [];
    const base = (type: string) => CODEX_SCAN_REQUIREMENTS[type.replace(/#leader$/, "")];
    const stuck = unplaced.filter((gap) => {
      const entry = base(gap.type);
      return (
        entry?.faction === "narmer" ||
        /Descendia/.test(gap.name) ||
        (entry?.planets ?? []).some((planet) => /Proxima$/.test(planet)) ||
        (entry?.missions ?? []).includes("Empyrean")
      );
    });
    // The wiki says the Coildrive has no codex entry despite being scannable.
    expect(stuck.map((gap) => gap.name)).toEqual(["Narmer Coildrive"]);
    expect(cards.filter((card) => card.kind === "railjack").length).toBeGreaterThanOrEqual(5);
    expect(cards.map((card) => card.key)).toEqual(
      expect.arrayContaining([
        "activity:Dark Refractory:The Descendia",
        "activity:Plains of Eidolon:Narmer Bounty",
        "activity:Orb Vallis:Narmer Bounty",
        "activity::Archon Hunt",
        "activity:Duviri:Isleweaver",
        "activity:Relays:Follie's Hunt",
        "activity::Death Mark",
      ]),
    );
  });

  it("keys a wiki row with no InternalName by the DE avatars sharing its name", () => {
    const keysNamed = (name: string) =>
      Object.keys(CODEX_SCAN_REQUIREMENTS).filter(
        (key) => CODEX_SCAN_REQUIREMENTS[key].name === name,
      );
    const [ballista] = keysNamed("Narmer Ballista");
    const [scorch] = keysNamed("Narmer Scorch");
    expect(keysNamed("Narmer Ballista")).toHaveLength(1);
    expect(ballista).not.toBe(scorch);
    expect(CODEX_SCAN_REQUIREMENTS[ballista]).toMatchObject({
      faction: "narmer",
      tileSets: ["Plains of Eidolon"],
      missions: ["Narmer Bounty"],
    });
    const avatars = Object.entries(CODEX_SCAN_AVATARS)
      .filter(([, owner]) => owner.key === ballista)
      .map(([path]) => path);
    expect(avatars).toEqual(
      expect.arrayContaining([
        ballista.toLowerCase(),
        "/lotus/types/enemies/grineer/narmer/avatars/pnwnarmerfemalegrineeravatar",
      ]),
    );
  });

  it("maps every tileset an entry names to a node, bar the listed few", () => {
    const covered = new Set(CODEX_STAR_CHART_NODES.flatMap((entry) => entry.tileSets));
    const named = new Set(
      Object.values(CODEX_SCAN_REQUIREMENTS).flatMap((entry) => entry.tileSets ?? []),
    );
    const unmapped = [...named].filter((tileSet) => !covered.has(tileSet)).sort();
    expect(unmapped).toEqual(TOLERATED_UNMAPPED);
  });
});
