import { describe, expect, it } from "vitest";

import { collectSuggestions } from "../../../../src/lib/suggest/engine.js";
import { defaultPreferences } from "../../../../src/lib/suggest/preferences.js";
import { dailiesProvider } from "../../../../src/lib/suggest/providers/dailies.js";
import { vendorsProvider } from "../../../../src/lib/suggest/providers/vendors.js";
import { rewardValue, taskWorth } from "../../../../src/lib/suggest/rewards.js";
import { worthGroup } from "../../../../src/lib/suggest/rewards.js";
import { groupForWorth, groupRank } from "../../../../src/lib/suggest/worthLadder.js";
import type { Translator } from "../../../../src/lib/i18n.js";
import type { TrackerState } from "../../../../src/lib/world/dailies.js";
import type { SuggestionContext } from "../../../../src/types/suggest.js";
import type { WorldState } from "../../../../src/types/world.js";

const NOW = Date.parse("2026-09-05T12:00:00Z");
const HOUR = 60 * 60_000;
const t = ((key: string) => key) as unknown as Translator;

/** The standing chores Baro used to sort below when nothing he sells was placed. */
const CHORES = ["dailies:kahl", "dailies:simaris", "dailies:syndicateStanding"];

function tracker(): TrackerState {
  return { progress: {}, hidden: [], periods: {}, custom: [], seq: 0 };
}

function context(world: WorldState | null): SuggestionContext {
  return {
    world,
    inventory: null,
    itemDb: {},
    inventoryModifiedAt: null,
    mastery: null,
    relicDb: null,
    plat: null,
    tracker: tracker(),
    prefs: defaultPreferences(),
    dropPools: {},
    nowMs: NOW,
    t,
  };
}

/** Baro in the relay with the two slots that are the reason to visit him. */
function baroWorld(): WorldState {
  return {
    voidTrader: {
      activation: new Date(NOW - 4 * HOUR).toISOString(),
      expiry: new Date(NOW + 40 * HOUR).toISOString(),
      location: "Larunda Relay (Mercury)",
      inventory: [
        { uniqueName: "/Lotus/Upgrades/Mods/Primed1", item: "Primed Continuity", ducats: 350 },
        { uniqueName: "/Lotus/Weapons/Prisma1", item: "Prisma Gorgon", ducats: 300 },
      ],
    },
  } as unknown as WorldState;
}

describe("worth ladder coverage", () => {
  it("places what Baro actually sells", () => {
    const prefs = defaultPreferences();
    expect(worthGroup(prefs, "Primed Continuity")).toBe("want");
    expect(worthGroup(prefs, "Prisma Gorgon")).toBe("useful");
  });

  it("places Varzia's currency and the Cred shop's gear", () => {
    const prefs = defaultPreferences();
    expect(worthGroup(prefs, "Aya")).toBe("filler");
    expect(worthGroup(prefs, "Vauban parts")).toBe("filler");
    expect(worthGroup(prefs, "Nightwave landing craft parts")).toBe("filler");
  });

  it("rates a primed mod above every standing chore", () => {
    const prefs = defaultPreferences();
    const mod = rewardValue(prefs, "Primed Continuity") ?? 0;
    for (const chore of ["Kahl's Stock", "Simaris Standing", "Syndicate Standing"]) {
      expect(mod).toBeGreaterThan(rewardValue(prefs, chore) ?? 0);
    }
  });

  it("keeps a count from lifting a mod out of its group", () => {
    const prefs = defaultPreferences();
    expect(rewardValue(prefs, "3x Primed Continuity")).toBeLessThan(
      rewardValue(prefs, "Orokin Reactor") ?? 0,
    );
  });
});

describe("Descendia against the standing chores", () => {
  it("never sorts below them, and pays useful or better", () => {
    const prefs = defaultPreferences();
    for (const id of ["descendiaNormal", "descendiaSteelPath"]) {
      expect(groupRank(groupForWorth(taskWorth(prefs, id) ?? 0))).toBeLessThanOrEqual(
        groupRank("useful"),
      );
    }

    const ordered = collectSuggestions([dailiesProvider], context(null)).map(
      (suggestion) => suggestion.id,
    );
    for (const id of ["dailies:descendiaNormal", "dailies:descendiaSteelPath"]) {
      expect(ordered).toContain(id);
      for (const chore of CHORES) {
        expect(ordered).toContain(chore);
        expect(ordered.indexOf(id)).toBeLessThan(ordered.indexOf(chore));
      }
    }
  });
});

describe("Baro against the standing chores", () => {
  it("no longer sorts below them", () => {
    const ordered = collectSuggestions(
      [dailiesProvider, vendorsProvider],
      context(baroWorld()),
    ).map((suggestion) => suggestion.id);
    expect(ordered).toContain("vendors:baro");
    const baro = ordered.indexOf("vendors:baro");
    for (const chore of CHORES) {
      expect(ordered).toContain(chore);
      expect(baro).toBeLessThan(ordered.indexOf(chore));
    }
  });
});
