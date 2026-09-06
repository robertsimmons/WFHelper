import { describe, expect, it } from "vitest";

import {
  ACTIVITY_PREFS,
  MISSION_TYPE_NAMES,
  UNRATED,
  defaultPreferences,
  mergePreferences,
  parseOverrides,
  type SuggestionOverrides,
} from "../../../../src/lib/suggest/preferences.js";

function overrides(partial: Partial<SuggestionOverrides> = {}): SuggestionOverrides {
  return { rewards: {}, missionTypes: {}, activities: {}, ...partial };
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
