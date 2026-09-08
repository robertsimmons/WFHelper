import { describe, expect, it } from "vitest";

import { curated } from "../../../../src/lib/suggest/acquisition/curated.js";
import { resolveAcquisition } from "../../../../src/lib/suggest/acquisition/index.js";
import { createRatings } from "../../../../src/lib/suggest/acquisition/ratings.js";
import { defaultPreferences } from "../../../../src/lib/suggest/preferences.js";
import { acquisitionRatings } from "../../../../src/lib/suggest/providers/acquisition.js";
import { itemDb } from "./acquisition/fixtures.js";
import type { SuggestionPreferences } from "../../../../src/types/suggest.js";

function prefs(
  tiers: Record<string, string> = {},
  difficulty: Record<string, string> = {},
): SuggestionPreferences {
  return { ...defaultPreferences(), acquisitionTiers: tiers, acquisitionEffort: difficulty };
}

function target(name: string, preferences: SuggestionPreferences) {
  const match = resolveAcquisition({
    itemDb: itemDb(),
    inventory: null,
    ratings: acquisitionRatings(preferences),
    only: [name],
  })[0];
  if (!match) throw new Error(`no target for ${name}`);
  return match;
}

describe("acquisitionRatings", () => {
  it("carries both overrides for one item under a single entry", () => {
    expect(acquisitionRatings(prefs({ mag: "S" }, { mag: "trivial" }))).toEqual({
      mag: { rank: "S", difficulty: "trivial" },
    });
  });

  it("carries an override of one kind on its own", () => {
    expect(acquisitionRatings(prefs({ mag: "S" }))).toEqual({ mag: { rank: "S" } });
    expect(acquisitionRatings(prefs({}, { mag: "hard" }))).toEqual({ mag: { difficulty: "hard" } });
  });

  it("supplies nothing when the player has overruled nothing", () => {
    expect(acquisitionRatings(prefs())).toEqual({});
  });
});

describe("a player's own rating", () => {
  it("beats the overframe tier the sweep would otherwise read", () => {
    expect(target("Volt", prefs()).tier).not.toBe("S");
    expect(target("Volt", prefs({ volt: "S" })).tier).toBe("S");
  });

  it("beats the shipped difficulty word", () => {
    expect(target("Volt", prefs()).difficulty).toBe("easy");
    expect(target("Volt", prefs({}, { volt: "brutal" })).difficulty).toBe("brutal");
  });

  it("rates an item the shipped tables say nothing about", () => {
    expect(target("Mag", prefs()).tier).not.toBe("D");
    const rated = target("Mag", prefs({ mag: "D" }, { mag: "hard" }));
    expect(rated.tier).toBe("D");
    expect(rated.difficulty).toBe("hard");
  });

  it("survives a regeneration of the tier and difficulty tables", () => {
    const source = acquisitionRatings(prefs({ volt: "S" }, { volt: "brutal" }));
    for (const regenerated of ["A", "D"]) {
      const ratings = createRatings(
        source,
        () => ({
          difficulty: "trivial",
          circuit: false,
          sources: [],
          nemesis: null,
        }),
        () => regenerated,
      );
      expect(ratings.tier("Volt")).toBe("S");
      expect(ratings.effortLabel("Volt")).toBe("brutal");
    }
  });

  it("leaves an item the player has not touched on the shipped rating", () => {
    const ratings = createRatings(acquisitionRatings(prefs({ volt: "S" })), curated, () => "C");
    expect(ratings.tier("Mag")).toBe("C");
    expect(ratings.effortLabel("Volt")).toBe("easy");
  });
});
