import { describe, expect, it } from "vitest";

import {
  ACQUISITION_INCLUDES,
  ACQUISITION_NONE,
} from "../../../../src/lib/suggest/acquisition/kinds.js";
import {
  ACTIVITY_PREFS,
  DEFAULT_OPTIONS,
  MISSION_TYPE_NAMES,
  UNRATED,
  WORTH_OVERRIDES,
  canonicalWorth,
  defaultPreferences,
  mergePreferences,
  migrateLegacyOptions,
  parseLadderOrder,
  parseNightwaveStock,
  parseOptions,
  parseOverrides,
  type SuggestionOverrides,
} from "../../../../src/lib/suggest/preferences.js";
import { DEFAULT_NIGHTWAVE_STOCK, NIGHTWAVE_STAPLES } from "../../../../src/types/suggest.js";
import type { ActivityPref } from "../../../../src/types/suggest.js";

function overrides(partial: Partial<SuggestionOverrides> = {}): SuggestionOverrides {
  return {
    rewards: {},
    rewardOrder: {},
    missionTypes: {},
    activities: {},
    acquisitionTiers: {},
    nightwaveStock: {},
    options: {},
    ...partial,
  };
}

describe("defaultPreferences", () => {
  it("keys the curated tables by their normalized names", () => {
    const prefs = defaultPreferences();
    expect(prefs.worth["umbra forma"]).toBe("must");
    expect(prefs.rewards["umbra forma"]).toBe("great");
    expect(prefs.missionTypes["spy"]).toBe("bad");
  });

  it("projects every ladder group onto the four tiers the components draw", () => {
    const prefs = defaultPreferences();
    expect(prefs.rewards["forma"]).toBe("good");
    expect(prefs.rewards["kuva"]).toBe("ok");
    expect(prefs.rewards["focus points"]).toBe("low");
    expect(prefs.rewards["credits"]).toBe("low");
  });

  it("rates no activity, so everything starts normal", () => {
    expect(defaultPreferences().activities).toEqual({});
  });
});

describe("mergePreferences", () => {
  it("lets an override win over the shipped rating", () => {
    const merged = mergePreferences(
      defaultPreferences(),
      overrides({ rewards: { kuva: "must" }, missionTypes: { spy: "good" } }),
    );
    expect(merged.worth["kuva"]).toBe("must");
    expect(merged.rewards["kuva"]).toBe("great");
    expect(merged.missionTypes["spy"]).toBe("good");
  });

  it("reads an override stored on the scale the ladder replaced", () => {
    expect(canonicalWorth("great")).toBe("must");
    expect(canonicalWorth("good")).toBe("want");
    expect(canonicalWorth("ok")).toBe("useful");
    expect(canonicalWorth("low")).toBe("junk");
    expect(canonicalWorth("filler")).toBe("filler");
    expect(canonicalWorth(UNRATED)).toBe(UNRATED);
  });

  it("keeps every stored override, whichever scale it was spelled on", () => {
    const raw = JSON.stringify({ kuva: "great", forma: "junk", endo: "nonsense" });
    const stored = parseOverrides(raw, WORTH_OVERRIDES);
    expect(stored).toEqual({ kuva: "great", forma: "junk" });
    const merged = mergePreferences(
      defaultPreferences(),
      overrides({
        rewards: Object.fromEntries(
          Object.entries(stored).map(([key, value]) => [key, canonicalWorth(value)]),
        ),
      }),
    );
    expect(merged.worth["kuva"]).toBe("must");
    expect(merged.worth["forma"]).toBe("junk");
  });

  it("drops the shipped rating when the override is the unrated sentinel", () => {
    const merged = mergePreferences(
      defaultPreferences(),
      overrides({ rewards: { forma: UNRATED }, missionTypes: { capture: UNRATED } }),
    );
    expect(merged.rewards["forma"]).toBeUndefined();
    expect(merged.missionTypes["capture"]).toBeUndefined();
  });

  it("carries activity preferences through untouched", () => {
    const merged = mergePreferences(
      defaultPreferences(),
      overrides({ activities: { clem: "low" } }),
    );
    expect(merged.activities).toEqual({ clem: "low" });
  });

  it("leaves the defaults it was given alone", () => {
    const defaults = defaultPreferences();
    mergePreferences(defaults, overrides({ rewards: { forma: UNRATED } }));
    expect(defaults.rewards["forma"]).toBe("good");
  });
});

describe("parseOverrides", () => {
  it("keeps only entries whose value the caller allows", () => {
    const raw = JSON.stringify({ sortie: "low", netracells: "sometimes" });
    expect(parseOverrides(raw, ACTIVITY_PREFS)).toEqual({ sortie: "low" });
  });

  it("falls back to nothing for anything that is not an object", () => {
    expect(parseOverrides(null, ACTIVITY_PREFS)).toEqual({});
    expect(parseOverrides("not json", ACTIVITY_PREFS)).toEqual({});
    expect(parseOverrides("[1,2]", ACTIVITY_PREFS)).toEqual({});
    expect(parseOverrides("7", ACTIVITY_PREFS)).toEqual({});
  });
});

describe("MISSION_TYPE_NAMES", () => {
  it("offers a row for every type the curated tables already rate", () => {
    const prefs = defaultPreferences();
    const listed = new Set(MISSION_TYPE_NAMES.map((name) => name.toLowerCase()));
    for (const key of Object.keys(prefs.missionTypes)) expect(listed.has(key)).toBe(true);
  });

  it("lists one row per type, both spellings behind it", () => {
    expect(MISSION_TYPE_NAMES).toContain("Exterminate");
    expect(MISSION_TYPE_NAMES).not.toContain("Extermination");
  });
});

describe("parseOptions", () => {
  it("keeps only fields spelled with the type they carry", () => {
    const raw = JSON.stringify({ relicGoal: "ducats", relicSort: "endo", relicEras: ["Neo", "?"] });
    expect(parseOptions(raw)).toEqual({ relicGoal: "ducats", relicEras: ["Neo"] });
  });

  it("lifts the Forma boolean the kind list replaced onto the list", () => {
    expect(parseOptions(JSON.stringify({ masteryForma: false }))).toEqual({
      masteryKinds: ["frame", "weapon", "companion"],
    });
    expect(parseOptions(JSON.stringify({ masteryForma: true }))).toEqual({});
  });

  it("falls back to nothing for a goal it does not ship", () => {
    expect(parseOptions(JSON.stringify({ relicGoal: "endo" }))).toEqual({});
    expect(parseOptions(null)).toEqual({});
    expect(parseOptions("[1,2]")).toEqual({});
  });

  it("reads an acquisition list that was never narrowed as the empty one", () => {
    const legacy = [
      "warframe",
      "primary",
      "secondary",
      "melee",
      "archwing",
      "archgun",
      "archmelee",
      "companion",
    ];
    expect(parseOptions(JSON.stringify({ acquisitionKinds: legacy }))).toEqual({
      acquisitionKinds: [],
    });
    expect(parseOptions(JSON.stringify({ acquisitionKinds: [...ACQUISITION_INCLUDES] }))).toEqual({
      acquisitionKinds: [],
    });
  });

  it("keeps a narrowed acquisition list exactly as it was picked", () => {
    expect(parseOptions(JSON.stringify({ acquisitionKinds: ["melee", "warframe"] }))).toEqual({
      acquisitionKinds: ["warframe", "melee"],
    });
  });

  it("drops an acquisition kind it does not ship", () => {
    expect(parseOptions(JSON.stringify({ acquisitionKinds: ["warframe", "zaw"] }))).toEqual({
      acquisitionKinds: ["warframe"],
    });
  });

  it("reads back a cleared acquisition row as cleared rather than as every kind", () => {
    expect(parseOptions(JSON.stringify({ acquisitionKinds: [ACQUISITION_NONE] }))).toEqual({
      acquisitionKinds: [ACQUISITION_NONE],
    });
    // The reserved spelling wins: a list holding it was never a narrowing.
    expect(
      parseOptions(JSON.stringify({ acquisitionKinds: [ACQUISITION_NONE, "warframe"] })),
    ).toEqual({ acquisitionKinds: [ACQUISITION_NONE] });
  });
});

describe("migrateLegacyOptions", () => {
  function legacy(activities: Record<string, ActivityPref>) {
    return migrateLegacyOptions(activities, {});
  }

  it("lifts a stored synthetic key onto the typed option", () => {
    expect(legacy({ "mastery:forma": "never" }).options).toEqual({
      masteryKinds: ["frame", "weapon", "companion"],
    });
    expect(legacy({ "mastery:mode": "never" }).options).toEqual({});
  });

  it("reads the relic goal off the key that was not turned off", () => {
    expect(legacy({ "relics:goal:platinum": "never" }).options).toEqual({ relicGoal: "ducats" });
    expect(legacy({ "relics:goal:ducats": "never" }).options).toEqual({ relicGoal: "platinum" });
  });

  it("clears the synthetic keys and leaves real activities alone", () => {
    const { activities } = legacy({
      "mastery:forma": "never",
      "relics:goal:platinum": "never",
      sortie: "low",
    });
    expect(activities).toEqual({ sortie: "low" });
  });

  it("takes nothing from a store that never held one", () => {
    const { options } = legacy({ sortie: "low" });
    expect(options).toEqual({});
    expect(mergePreferences(defaultPreferences(), overrides()).options).toEqual(DEFAULT_OPTIONS);
  });

  it("lets a value already stored under the typed shape win", () => {
    const migrated = migrateLegacyOptions(
      { "mastery:forma": "never" },
      { masteryKinds: ["forma"] },
    );
    expect(migrated.options).toEqual({ masteryKinds: ["forma"] });
  });
});

describe("parseLadderOrder", () => {
  it("keys a stored position the way the ladder keys everything else", () => {
    const raw = JSON.stringify({ "Umbra Forma": 0, "3x Forma": 0.5, "Kuva Blueprint": 1 });
    expect(parseLadderOrder(raw)).toEqual({ "umbra forma": 0, forma: 0.5, kuva: 1 });
  });

  it("pulls a hand-edited position back inside the band", () => {
    expect(parseLadderOrder(JSON.stringify({ kuva: -4, forma: 9 }))).toEqual({
      kuva: 0,
      forma: 1,
    });
  });

  it("drops anything that is not a position", () => {
    const raw = JSON.stringify({ kuva: "top", forma: null, endo: Number.NaN, "": 0.5 });
    expect(parseLadderOrder(raw)).toEqual({});
  });

  it("falls back to no chosen order at all", () => {
    expect(parseLadderOrder(null)).toEqual({});
    expect(parseLadderOrder("not json")).toEqual({});
    expect(parseLadderOrder("[0.5]")).toEqual({});
  });

  it("leaves a store that predates the order untouched rather than resetting it", () => {
    // Everything a pre-ladder store held: worth on the four-tier scale, and no
    // order key at all.
    const stored = parseOverrides(JSON.stringify({ kuva: "great" }), WORTH_OVERRIDES);
    const merged = mergePreferences(
      defaultPreferences(),
      overrides({
        rewards: Object.fromEntries(
          Object.entries(stored).map(([key, value]) => [key, canonicalWorth(value)]),
        ),
        rewardOrder: parseLadderOrder(null),
      }),
    );
    expect(merged.worth["kuva"]).toBe("must");
    expect(merged.worth["umbra forma"]).toBe("must");
    expect(merged.rewards["kuva"]).toBe("great");
  });
});

describe("parseNightwaveStock", () => {
  it("keeps a whole count and renormalizes the key it was stored under", () => {
    const raw = JSON.stringify({ "Orokin  Catalyst": 3, "NITAIN EXTRACT": 0 });
    expect(parseNightwaveStock(raw)).toEqual({ "orokin catalyst": 3, "nitain extract": 0 });
  });

  it("drops anything that is not a count of items", () => {
    const raw = JSON.stringify({
      "orokin catalyst": "3",
      "orokin reactor": -1,
      "nitain extract": 2.5,
      forma: Number.NaN,
      "": 4,
    });
    expect(parseNightwaveStock(raw)).toEqual({});
  });

  it("keeps a level stored for a name that is no longer a staple", () => {
    expect(parseNightwaveStock(JSON.stringify({ forma: 7 }))).toEqual({ forma: 7 });
  });

  it("falls back to no chosen level at all", () => {
    expect(parseNightwaveStock(null)).toEqual({});
    expect(parseNightwaveStock("not json")).toEqual({});
    expect(parseNightwaveStock("[3]")).toEqual({});
  });
});

describe("nightwave keep-on-hand levels", () => {
  it("ships every staple at the default level", () => {
    const stock = defaultPreferences().nightwaveStock;
    for (const name of NIGHTWAVE_STAPLES) expect(stock[name]).toBe(DEFAULT_NIGHTWAVE_STOCK);
  });

  it("lets a chosen level win, staple by staple", () => {
    const merged = mergePreferences(
      defaultPreferences(),
      overrides({ nightwaveStock: { "nitain extract": 0 } }),
    );
    expect(merged.nightwaveStock["nitain extract"]).toBe(0);
    expect(merged.nightwaveStock["orokin catalyst"]).toBe(DEFAULT_NIGHTWAVE_STOCK);
  });

  it("leaves a store that predates the levels on the defaults rather than resetting it", () => {
    const merged = mergePreferences(
      defaultPreferences(),
      overrides({
        rewards: { kuva: "must" },
        nightwaveStock: parseNightwaveStock(null),
      }),
    );
    expect(merged.worth["kuva"]).toBe("must");
    for (const name of NIGHTWAVE_STAPLES) {
      expect(merged.nightwaveStock[name]).toBe(DEFAULT_NIGHTWAVE_STOCK);
    }
  });
});
