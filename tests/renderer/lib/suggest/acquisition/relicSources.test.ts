import { describe, expect, it } from "vitest";

import {
  aabcRound,
  neededRelics,
  rankSources,
} from "../../../../../src/lib/suggest/acquisition/relicSources.js";
import { defaultPreferences } from "../../../../../src/lib/suggest/preferences.js";
import type { PartState } from "../../../../../src/lib/suggest/acquisition/types.js";
import type { RelicDatabase, RelicGroup, RelicSource } from "../../../../../src/types/relics.js";
import type { WorldState } from "../../../../../src/types/world.js";

const PREFS = defaultPreferences();
const NOW = Date.parse("2026-10-10T00:00:00Z");
const NEURO = "/Lotus/Types/Recipes/WarframeRecipes/TestframePrimeHelmetComponent";
const SYS = "/Lotus/Types/Recipes/WarframeRecipes/TestframePrimeSystemsComponent";

function source(over: Partial<RelicSource>): RelicSource {
  return {
    place: "Hydron (Sedna)",
    kind: "mission",
    missionType: "Defense",
    rotation: null,
    stage: null,
    refinement: null,
    chance: 10,
    ...over,
  };
}

function group(name: string, paid: [string, string][], sources: RelicSource[] | null): RelicGroup {
  const [tier = "", code = ""] = name.split(" ");
  return {
    key: name,
    name,
    tier,
    code,
    imageUrl: null,
    sources,
    qualities: {
      intact: {
        uniqueName: null,
        rewards: paid.map(([reward, uniqueName]) => ({
          name: reward,
          uniqueName,
          rarity: "Rare",
          chance: 2,
          urlName: null,
          ducats: null,
        })),
      },
    },
  };
}

function part(name: string, uniqueName: string, missing = 1): PartState {
  return {
    uniqueName,
    name,
    role: "component",
    required: 1,
    owned: 1 - missing,
    building: 0,
    held: 0,
    missing,
  };
}

describe("aabcRound", () => {
  it("names the round only for an endless mode's rotation", () => {
    expect(aabcRound(source({ rotation: "A", missionType: "Survival" }))).toBe("A");
    expect(aabcRound(source({ rotation: "C", missionType: "Void Cascade" }))).toBe("C");
    expect(aabcRound(source({ rotation: "B", missionType: "Spy" }))).toBeNull();
    expect(aabcRound(source({ rotation: "B", missionType: "Mobile Defense" }))).toBeNull();
    expect(
      aabcRound(source({ rotation: "A", kind: "caches", missionType: "Skirmish" })),
    ).toBeNull();
    expect(aabcRound(source({ rotation: null, missionType: "Survival" }))).toBeNull();
    expect(aabcRound(source({ rotation: "A", missionType: null }))).toBeNull();
    expect(aabcRound(source({ rotation: "A", kind: "bounty", missionType: null }))).toBeNull();
  });
});

describe("rankSources", () => {
  it("puts liked modes first and disliked last, then the better odds", () => {
    const ranked = rankSources(PREFS, [
      source({ place: "Spy node", missionType: "Spy", chance: 40 }),
      source({ place: "Survival low", missionType: "Survival", chance: 5 }),
      source({ place: "Capture node", missionType: "Capture", chance: 1 }),
      source({ place: "Survival high", missionType: "Survival", chance: 20 }),
    ]);
    expect(ranked.map((row) => row.place)).toEqual([
      "Capture node",
      "Survival high",
      "Survival low",
      "Spy node",
    ]);
    expect(ranked.map((row) => row.opinion)).toEqual(["good", null, null, "bad"]);
  });

  it("rates a bounty as an open-world run", () => {
    const prefs = {
      ...PREFS,
      missionTypes: { ...PREFS.missionTypes, "open world": "bad" as const },
    };
    const [row] = rankSources(prefs, [source({ kind: "bounty", missionType: null })]);
    expect(row?.opinion).toBe("bad");
  });
});

describe("neededRelics", () => {
  const db: RelicDatabase = {
    groups: {
      "Lith T1": group(
        "Lith T1",
        [["Testframe Prime Neuroptics Blueprint", NEURO]],
        [source({ missionType: "Spy", chance: 30 })],
      ),
      "Meso T2": group(
        "Meso T2",
        [
          ["Testframe Prime Neuroptics Blueprint", NEURO],
          ["Testframe Prime Systems Blueprint", SYS],
        ],
        [source({ missionType: "Capture", chance: 2 })],
      ),
      "Neo T3": group("Neo T3", [["Testframe Prime Systems Blueprint", SYS]], []),
      "Axi T4": group("Axi T4", [["Testframe Prime Systems Blueprint", SYS]], null),
    },
    byUniqueName: {},
  };
  const missing = [
    part("Testframe Prime Neuroptics", NEURO),
    part("Testframe Prime Systems", SYS),
    part("Testframe Prime Chassis", "/Owned/Chassis", 0),
  ];

  it("lists every relic paying a missing part, best source first", () => {
    const rows = neededRelics(missing, db, PREFS, null, NOW, []);
    expect(rows.map((row) => row.group.name)).toEqual(["Meso T2", "Lith T1", "Axi T4", "Neo T3"]);
    expect(rows[0]?.parts).toEqual(["Testframe Prime Neuroptics", "Testframe Prime Systems"]);
    expect(rows.find((row) => row.group.name === "Axi T4")?.sources).toBeNull();
    expect(rows.every((row) => row.vendors === null)).toBe(true);
  });

  it("reads Varzia's shelf and the pack pool", () => {
    const world = {
      vaultTrader: {
        activation: "2026-10-01T00:00:00Z",
        expiry: "2026-10-20T00:00:00Z",
        inventory: [{ uniqueName: "/Lotus/Types/Game/Projections/NeoT3", item: "Neo T3", aya: 3 }],
      },
    } as unknown as WorldState;
    const rows = neededRelics(missing, db, PREFS, world, NOW, ["Axi T4"]);
    const neo = rows.find((row) => row.group.name === "Neo T3");
    expect(neo?.vendors).toEqual([{ trader: "varzia", aya: 3, ducats: null, credits: null }]);
    expect(rows.find((row) => row.group.name === "Axi T4")?.pack).toBe(true);
    // Sold reads as unrated: ahead of a disliked mode and of no source at all.
    expect(rows.map((row) => row.group.name)).toEqual(["Meso T2", "Axi T4", "Neo T3", "Lith T1"]);
  });
});
