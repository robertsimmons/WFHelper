import { describe, expect, it } from "vitest";

import { suggestionKey } from "../../../../src/lib/suggest/dismissals.js";
import {
  buildFeed,
  collectSuggestions,
  filterByCategory,
} from "../../../../src/lib/suggest/engine.js";
import type {
  Suggestion,
  SuggestionCategory,
  SuggestionContext,
  SuggestionDraft,
  SuggestionProvider,
} from "../../../../src/types/suggest.js";

const CTX = {} as SuggestionContext;

function draft(
  id: string,
  category: SuggestionCategory,
  value: number,
  fingerprint = `fp-${id}`,
): SuggestionDraft {
  return {
    id,
    category,
    title: id,
    why: "",
    fingerprint,
    signals: { value, effort: 0, urgency: 0 },
  };
}

function provider(drafts: SuggestionDraft[]): SuggestionProvider {
  return { id: "test", collect: () => drafts };
}

function scored(drafts: SuggestionDraft[]): Suggestion[] {
  return collectSuggestions([provider(drafts)], CTX);
}

describe("collectSuggestions", () => {
  it("scores drafts and returns them best first", () => {
    const result = scored([
      draft("low", "daily", 0.2),
      draft("high", "daily", 0.9),
      draft("mid", "daily", 0.5),
    ]);
    expect(result.map((s) => s.id)).toEqual(["high", "mid", "low"]);
    expect(result[0]?.score).toBeGreaterThan(result[1]?.score ?? 0);
  });

  it("keeps a turned-down suggestion, ranked below every other one", () => {
    const result = scored([
      draft("normal", "daily", 0.1),
      { ...draft("low", "daily", 0.9), deprioritized: true },
      draft("best", "daily", 0.5),
    ]);
    expect(result.map((s) => s.id)).toEqual(["best", "normal", "low"]);
  });

  it("ranks turned-down suggestions among themselves by score", () => {
    const result = scored([
      { ...draft("quiet", "daily", 0.2), deprioritized: true },
      { ...draft("loud", "daily", 0.8), deprioritized: true },
    ]);
    expect(result.map((s) => s.id)).toEqual(["loud", "quiet"]);
  });

  it("merges every provider into one ranking", () => {
    const result = collectSuggestions(
      [provider([draft("a", "daily", 0.3)]), provider([draft("b", "weekly", 0.8)])],
      CTX,
    );
    expect(result.map((s) => s.id)).toEqual(["b", "a"]);
  });
});

describe("buildFeed", () => {
  it("keeps one ranked list across categories", () => {
    const feed = buildFeed(scored([draft("a", "daily", 0.3), draft("b", "weekly", 0.9)]), {});
    expect(feed.suggestions.map((s) => s.id)).toEqual(["b", "a"]);
    expect(feed.hiddenCount).toBe(0);
  });

  it("counts each category for the filters", () => {
    const feed = buildFeed(
      scored([draft("a", "daily", 0.3), draft("b", "weekly", 0.9), draft("c", "weekly", 0.5)]),
      {},
    );
    expect(feed.counts).toEqual({ daily: 1, weekly: 2, nightwave: 0 });
  });

  it("hides a suggestion dismissed against its current fingerprint", () => {
    const suggestions = scored([draft("a", "daily", 0.5), draft("b", "daily", 0.4)]);
    const feed = buildFeed(suggestions, { [suggestionKey("a")]: "fp-a" });
    expect(feed.suggestions.map((s) => s.id)).toEqual(["b"]);
    expect(feed.hiddenCount).toBe(1);
    expect(feed.counts.daily).toBe(1);
  });

  it("brings a dismissed suggestion back once its fingerprint changes", () => {
    const dismissals = { [suggestionKey("a")]: "fp-a" };
    expect(buildFeed(scored([draft("a", "daily", 0.5)]), dismissals).suggestions).toEqual([]);

    const after = scored([draft("a", "daily", 0.5, "rotated")]);
    expect(buildFeed(after, dismissals).suggestions).toHaveLength(1);
  });

  it("reports the fingerprints a dismissal store can be pruned against", () => {
    const feed = buildFeed(scored([draft("a", "daily", 0.5)]), {});
    expect(feed.fingerprints.get(suggestionKey("a"))).toBe("fp-a");
  });
});

describe("filterByCategory", () => {
  const suggestions = scored([
    draft("a", "daily", 0.9),
    draft("b", "weekly", 0.5),
    draft("c", "nightwave", 0.3),
  ]);

  it("narrows to the picked categories without reordering", () => {
    expect(filterByCategory(suggestions, ["nightwave", "daily"]).map((s) => s.id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("treats every category and none alike, since neither narrows anything", () => {
    expect(filterByCategory(suggestions, []).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(
      filterByCategory(suggestions, ["daily", "weekly", "nightwave"]).map((s) => s.id),
    ).toEqual(["a", "b", "c"]);
  });
});
