import { describe, expect, it } from "vitest";

import {
  bountyDrop,
  buildDropSources,
  dropRowPlaces,
  dropSourceDetail,
  dropSourceHeader,
  dropSourceLine,
  dropSourcesFor,
  liveDropSource,
  parseStage,
  stageText,
  type DropSource,
} from "../../../src/lib/dropSources.js";
import { en } from "../../../src/i18n/en.js";
import type { Translator } from "../../../src/lib/i18n.js";
import type { DropRow } from "../../../config/shared/dropTypes.js";
import type { DropInfo } from "../../../src/types/inventory.js";
import type { WorldState } from "../../../src/types/world.js";

const t: Translator = (key, params = {}) =>
  en[key].replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ""));

const CAMBION = "Deimos/Cambion Drift (Level 15 - 25 Cambion Drift Bounty), Rotation A";

// Weeping Wounds as @wfcd ships it: three chances, one location, no stages.
const WEEPING_WOUNDS: DropInfo[] = [
  { location: "Duviri/Endless: Tier 1 (Normal)", type: "Weeping Wounds", chance: 0.67, rarity: "Legendary" },
  { location: "Duviri/Endless: Tier 3 (Normal)", type: "Weeping Wounds", chance: 0.67, rarity: "Legendary" },
  { location: CAMBION, type: "Weeping Wounds", chance: 10.29, rarity: "Uncommon" },
  { location: CAMBION, type: "Weeping Wounds", chance: 14, rarity: "Uncommon" },
  { location: CAMBION, type: "Weeping Wounds", chance: 7.95, rarity: "Rare" },
];

// The same drops as the stage-aware table spells them.
const WEEPING_WOUNDS_ROWS: DropRow[] = [
  {
    item: "Weeping Wounds",
    place:
      "Level 15 - 25 Cambion Drift Bounty, Rotation A (Stage 2, Stage 3 of 4, and Stage 3 of 5)",
    rarity: "Uncommon",
    chance: 10.29,
    kind: "bounty",
  },
  {
    item: "Weeping Wounds",
    place: "Level 15 - 25 Cambion Drift Bounty, Rotation A (Stage 4 of 5)",
    rarity: "Rare",
    chance: 7.95,
    kind: "bounty",
  },
  {
    item: "Weeping Wounds",
    place: "Level 15 - 25 Cambion Drift Bounty, Rotation A (Final Stage)",
    rarity: "Uncommon",
    chance: 14,
    kind: "bounty",
  },
];

function labels(source: DropSource): string[] {
  return source.stages.map((stage) => (stage.label ? stageText(stage.label, t) : ""));
}

describe("bounty stages", () => {
  const sources = dropSourcesFor(WEEPING_WOUNDS, WEEPING_WOUNDS_ROWS);
  const bounty = sources.find((source) => source.kind === "bounty")!;

  it("folds the three stages of one bounty into one place", () => {
    expect(sources.filter((source) => source.kind === "bounty")).toHaveLength(1);
    expect(bounty.stages.map((stage) => stage.chance)).toEqual([10.29, 7.95, 14]);
    expect(labels(bounty)).toEqual(["Stage 2-3", "Stage 4", "Final"]);
  });

  it("names the planet, the zone, the giver and the hub", () => {
    expect(dropSourceHeader(bounty, t)).toBe("Deimos · Cambion Drift");
    expect(dropSourceDetail(bounty, t)).toEqual(["Mother", "Necralisk", "L15-25", "Rot A"]);
  });

  it("lists the chances unlabelled where no stage row answers", () => {
    const bare = dropSourcesFor(WEEPING_WOUNDS).find((source) => source.kind === "bounty")!;
    expect(bare.stages.map((stage) => stage.label)).toEqual([null, null, null]);
    expect(bare.stages.map((stage) => stage.chance).sort()).toEqual([10.29, 14, 7.95].sort());
  });

  it("reads the table's stage wording", () => {
    expect(parseStage("Stage 1")).toEqual({ type: "stage", from: 1, to: 1 });
    expect(parseStage("Final stage")).toEqual({ type: "final" });
    expect(parseStage("First Completion")).toEqual({ type: "firstClear" });
    expect(parseStage("Subsequent Completions")).toEqual({ type: "repeat" });
    expect(parseStage("")).toBeNull();
  });
});

describe("Duviri Circuit tiers", () => {
  it("fold into one Circuit place per mode", () => {
    const circuit = dropSourcesFor(WEEPING_WOUNDS).filter((source) => source.kind === "circuit");
    expect(circuit).toHaveLength(1);
    expect(dropSourceHeader(circuit[0], t)).toBe("Duviri · The Circuit (Normal)");
    expect(labels(circuit[0])).toEqual(["Tier 1", "Tier 3"]);
  });

  it("keeps Steel Path apart from normal", () => {
    const sources = buildDropSources([
      { location: "Duviri/Endless: Tier 1 (Normal)", chance: 1 },
      { location: "Duviri/Endless: Tier 1 (Hard)", chance: 2 },
    ]);
    expect(sources.map((source) => dropSourceHeader(source, t))).toEqual([
      "Duviri · The Circuit (Steel Path)",
      "Duviri · The Circuit (Normal)",
    ]);
  });
});

describe("mission nodes", () => {
  it("carry their planet and mission type from @wfcd", () => {
    const [node] = buildDropSources([{ location: "Lua/Pavlov (Spy), Rotation A", chance: 12.2 }]);
    expect(node.kind).toBe("node");
    expect(dropSourceHeader(node, t)).toBe("Lua · Pavlov");
    expect(dropSourceDetail(node, t)).toEqual(["Spy", "Rot A"]);
  });

  it("carry their planet from a drop-table row", () => {
    const [place] = dropRowPlaces([
      { item: "Vitus Essence", place: "Pavlov (Lua), Rotation A", rarity: "Rare", chance: 12.2, kind: "mission" },
    ]);
    expect(dropSourceHeader(place.source, t)).toBe("Lua · Pavlov");
  });

  it("read rotations that pay the same as one place", () => {
    const sources = buildDropSources(
      ["A", "B", "C"].map((rotation) => ({
        location: `Deimos/Cambion Drift (Level 15 - 25 Cambion Drift Bounty), Rotation ${rotation}`,
        chance: 12,
      })),
    );
    expect(sources).toHaveLength(1);
    expect(sources[0].rotations).toEqual(["A", "B", "C"]);
  });

  it("fold a relic's refinements into one relic", () => {
    const [relic] = buildDropSources([
      { location: "Axi A1 Relic", chance: 25.33 },
      { location: "Axi A1 Relic (Radiant)", chance: 16.67 },
    ]);
    expect(dropSourceHeader(relic, t)).toBe("Axi A1 Relic");
    expect(labels(relic)).toEqual(["Intact", "Radiant"]);
  });
});

describe("ordering and the compact line", () => {
  it("sorts places by their best chance", () => {
    const sources = dropSourcesFor(WEEPING_WOUNDS, WEEPING_WOUNDS_ROWS);
    expect(sources.map((source) => source.kind)).toEqual(["bounty", "circuit"]);
    expect(sources.map((source) => source.best)).toEqual([14, 0.67]);
  });

  it("derives the card line from the same place", () => {
    const [bounty, circuit] = dropSourcesFor(WEEPING_WOUNDS, WEEPING_WOUNDS_ROWS);
    expect(dropSourceLine(bounty, t)).toEqual({ text: "Cambion Drift L15-25 Final", chance: 14 });
    expect(dropSourceLine(circuit, t).text).toBe("The Circuit (Normal) T1");
    const [node] = buildDropSources([{ location: "Lua/Pavlov (Spy), Rotation A", chance: 12.2 }]);
    expect(dropSourceLine(node, t)).toEqual({ text: "Pavlov Spy Rot A", chance: 12.2 });
  });
});

describe("live availability", () => {
  const [bounty] = dropSourcesFor(WEEPING_WOUNDS, WEEPING_WOUNDS_ROWS);
  const board = (rotation: string, levels: [number, number]): WorldState => ({
    bountyRotation: rotation,
    bounties: [
      {
        syndicate: "Entrati",
        syndicateKey: "EntratiSyndicate",
        expiry: "2026-09-29T12:00:00.000Z",
        jobs: [{ type: "Assassinate", enemyLevels: levels, standingStages: [] }],
      },
    ],
  });

  it("is on the board when the job and the rotation are both up", () => {
    expect(liveDropSource(bounty, board("A", [15, 25]))).toEqual({
      expiry: "2026-09-29T12:00:00.000Z",
      rotation: null,
    });
  });

  it("is off the board on another rotation or level range", () => {
    expect(liveDropSource(bounty, board("B", [15, 25]))).toBeNull();
    expect(liveDropSource(bounty, board("A", [5, 15]))).toBeNull();
    expect(liveDropSource(bounty, null)).toBeNull();
  });

  it("merges a board reward into the place its drop list already has", () => {
    const drop = bountyDrop("EntratiSyndicate", [15, 25], "A", "Final Stage", 14, "Uncommon");
    const sources = dropSourcesFor([...WEEPING_WOUNDS, drop!]);
    const merged = sources.filter((source) => source.kind === "bounty");
    expect(merged).toHaveLength(1);
    expect(merged[0].stages.filter((stage) => stage.chance === 14)).toHaveLength(1);
  });
});
