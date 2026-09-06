import { describe, expect, it } from "vitest";

import { suggestionKey } from "../../../../src/lib/suggest/dismissals.js";
import { buildFeed, collectSuggestions } from "../../../../src/lib/suggest/engine.js";
import { defaultPreferences } from "../../../../src/lib/suggest/preferences.js";
import { SUGGESTION_CATEGORIES } from "../../../../src/types/suggest.js";
import type {
  ScoreWeights,
  Suggestion,
  SuggestionCategory,
  SuggestionContext,
  SuggestionDraft,
  SuggestionProvider,
} from "../../../../src/types/suggest.js";

function ctx(weights: Partial<ScoreWeights> = {}): SuggestionContext {
  const prefs = defaultPreferences();
  return { prefs: { ...prefs, weights: { ...prefs.weights, ...weights } } } as SuggestionContext;
}

const CTX = ctx();

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
  it("groups suggestions under their own category", () => {
    const feed = buildFeed(scored([draft("a", "daily", 0.3), draft("b", "weekly", 0.9)]), {});
    expect(feed.sections.daily.map((s) => s.id)).toEqual(["a"]);
    expect(feed.sections.weekly.map((s) => s.id)).toEqual(["b"]);
    expect(feed.hiddenCount).toBe(0);
  });

  it("ranks within a section rather than across the feed", () => {
    const feed = buildFeed(
      scored([
        draft("a", "daily", 0.3),
        draft("b", "weekly", 0.9),
        draft("c", "weekly", 0.5),
        { ...draft("d", "weekly", 0.95), deprioritized: true },
      ]),
      {},
    );
    expect(feed.sections.weekly.map((s) => s.id)).toEqual(["b", "c", "d"]);
  });

  it("gives every declared category a section, empty or not", () => {
    const feed = buildFeed(scored([draft("a", "daily", 0.3)]), {});
    expect(Object.keys(feed.sections).sort()).toEqual([...SUGGESTION_CATEGORIES].sort());
    expect(feed.sections.mastery).toEqual([]);
  });

  it("hides a suggestion dismissed against its current fingerprint", () => {
    const suggestions = scored([draft("a", "daily", 0.5), draft("b", "daily", 0.4)]);
    const feed = buildFeed(suggestions, { [suggestionKey("a")]: "fp-a" });
    expect(feed.sections.daily.map((s) => s.id)).toEqual(["b"]);
    expect(feed.hiddenCount).toBe(1);
  });

  it("brings a dismissed suggestion back once its fingerprint changes", () => {
    const dismissals = { [suggestionKey("a")]: "fp-a" };
    expect(buildFeed(scored([draft("a", "daily", 0.5)]), dismissals).sections.daily).toEqual([]);

    const after = scored([draft("a", "daily", 0.5, "rotated")]);
    expect(buildFeed(after, dismissals).sections.daily).toHaveLength(1);
  });

  it("reports the fingerprints a dismissal store can be pruned against", () => {
    const feed = buildFeed(scored([draft("a", "daily", 0.5)]), {});
    expect(feed.fingerprints.get(suggestionKey("a"))).toBe("fp-a");
  });
});

describe("scoring weights", () => {
  function signals(id: string, value: number, urgency: number, effort: number): SuggestionDraft {
    return { ...draft(id, "daily", value), signals: { value, urgency, effort } };
  }

  const PAYOFF = signals("payoff", 0.9, 0, 0);
  const DEADLINE = signals("deadline", 0.3, 1, 0);
  const COSTLY = signals("costly", 0.9, 0, 1);
  const MIDDLING = signals("middling", 0.5, 0, 0);

  function order(drafts: SuggestionDraft[], weights: Partial<ScoreWeights> = {}): string[] {
    return collectSuggestions([provider(drafts)], ctx(weights)).map((s) => s.id);
  }

  it("scores on the shipped weights when the user has changed nothing", () => {
    const [deadline, payoff] = collectSuggestions([provider([PAYOFF, DEADLINE])], CTX);
    expect(deadline?.score).toBeCloseTo(0.3 * 1 + 1 * 0.8, 10);
    expect(payoff?.score).toBeCloseTo(0.9 * 1, 10);
  });

  it("reorders the feed once a weight moves", () => {
    expect(order([PAYOFF, DEADLINE])).toEqual(["deadline", "payoff"]);
    expect(order([PAYOFF, DEADLINE], { urgency: 0 })).toEqual(["payoff", "deadline"]);
  });

  it("stops charging for effort once its weight is zero", () => {
    expect(order([COSTLY, MIDDLING])).toEqual(["middling", "costly"]);
    expect(order([COSTLY, MIDDLING], { effort: 0 })).toEqual(["costly", "middling"]);
  });
});
