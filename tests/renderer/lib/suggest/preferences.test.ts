import { describe, expect, it } from "vitest";

import {
  ACTIVITY_PREFS,
  DEFAULT_OPTIONS,
  MISSION_TYPE_NAMES,
  UNRATED,
  defaultPreferences,
  mergePreferences,
  migrateLegacyOptions,
  parseOptions,
  parseOverrides,
  type SuggestionOverrides,
} from "../../../../src/lib/suggest/preferences.js";
import type { ActivityPref } from "../../../../src/types/suggest.js";

function overrides(partial: Partial<SuggestionOverrides> = {}): SuggestionOverrides {
  return {
    rewards: {},
    missionTypes: {},
    activities: {},
    acquisitionTiers: {},
    acquisitionDifficulty: {},
    options: {},
    weights: {},
    ...partial,
  };
}

describe("defaultPreferences", () => {
  it("keys the curated tables by their normalized names", () => {
    const prefs = defaultPreferences();
    expect(prefs.rewards["umbra forma"]).toBe("great");
    expect(prefs.missionTypes["spy"]).toBe("bad");
  });

  it("rates no activity, so everything starts normal", () => {
    expect(defaultPreferences().activities).toEqual({});
  });
});

describe("mergePreferences", () => {
  it("lets an override win over the shipped rating", () => {
    const merged = mergePreferences(
      defaultPreferences(),
      overrides({ rewards: { kuva: "great" }, missionTypes: { spy: "good" } }),
    );
    expect(merged.rewards["kuva"]).toBe("great");
    expect(merged.missionTypes["spy"]).toBe("good");
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
