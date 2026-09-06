import { describe, expect, it } from "vitest";

import { categoryKey, suggestionKey } from "../../../../src/lib/suggest/dismissals.js";
import { buildFeed, collectSuggestions } from "../../../../src/lib/suggest/engine.js";
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

  it("merges every provider into one ranking", () => {
    const result = collectSuggestions(
      [provider([draft("a", "daily", 0.3)]), provider([draft("b", "weekly", 0.8)])],
      CTX,
    );
    expect(result.map((s) => s.id)).toEqual(["b", "a"]);
  });
});

describe("buildFeed", () => {
  it("groups by category, best category first", () => {
    const feed = buildFeed(scored([draft("a", "daily", 0.3), draft("b", "weekly", 0.9)]), {});
    expect(feed.groups.map((g) => g.category)).toEqual(["weekly", "daily"]);
    expect(feed.hiddenCount).toBe(0);
  });

  it("hides a category dismissed against its current fingerprint", () => {
    const suggestions = scored([draft("a", "daily", 0.5), draft("b", "daily", 0.4)]);
    const fingerprint = buildFeed(suggestions, {}).groups[0]?.fingerprint ?? "";

    const feed = buildFeed(suggestions, { [categoryKey("daily")]: fingerprint });
    expect(feed.groups).toEqual([]);
    expect(feed.hiddenCount).toBe(2);
  });

  it("brings a dismissed category back once its members change", () => {
    const before = scored([draft("a", "daily", 0.5)]);
    const fingerprint = buildFeed(before, {}).groups[0]?.fingerprint ?? "";
    const dismissals = { [categoryKey("daily")]: fingerprint };

    expect(buildFeed(before, dismissals).groups).toEqual([]);

    const after = scored([draft("a", "daily", 0.5, "rotated")]);
    expect(buildFeed(after, dismissals).groups).toHaveLength(1);
  });

  it("hides a single suggestion without taking its category with it", () => {
    const suggestions = scored([draft("a", "daily", 0.5), draft("b", "daily", 0.4)]);
    const feed = buildFeed(suggestions, { [suggestionKey("a")]: "fp-a" });
    expect(feed.groups[0]?.suggestions.map((s) => s.id)).toEqual(["b"]);
    expect(feed.hiddenCount).toBe(1);
  });

  it("reports the fingerprints a dismissal store can be pruned against", () => {
    const feed = buildFeed(scored([draft("a", "daily", 0.5)]), {});
    expect(feed.fingerprints.get(suggestionKey("a"))).toBe("fp-a");
    expect(feed.fingerprints.get(categoryKey("daily"))).toBe("fp-a");
  });
});
