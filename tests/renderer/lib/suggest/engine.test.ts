import { describe, expect, it } from "vitest";

import { suggestionKey } from "../../../../src/lib/suggest/dismissals.js";
import { buildFeed, collectSuggestions } from "../../../../src/lib/suggest/engine.js";
import { defaultPreferences } from "../../../../src/lib/suggest/preferences.js";
import { rewardValue } from "../../../../src/lib/suggest/rewards.js";
import { clearUnplacedForTest, noteUnplaced } from "../../../../src/lib/suggest/unplaced.js";
import { SUGGESTION_CATEGORIES } from "../../../../src/types/suggest.js";
import type {
  Suggestion,
  SuggestionCategory,
  SuggestionContext,
  SuggestionDraft,
  SuggestionProvider,
} from "../../../../src/types/suggest.js";

const NOW = Date.parse("2026-09-05T12:00:00Z");
const HOUR = 60 * 60_000;
const PREFS = defaultPreferences();

const CTX = { prefs: PREFS, nowMs: NOW } as SuggestionContext;

function worthOf(name: string): number {
  return rewardValue(PREFS, name) ?? 0;
}

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

/** A card carries its window in the details the modal already reads. */
function closing(suggestion: SuggestionDraft, hours: number): SuggestionDraft {
  return { ...suggestion, details: { expiry: new Date(NOW + hours * HOUR).toISOString() } };
}

function provider(drafts: SuggestionDraft[]): SuggestionProvider {
  return { id: "test", collect: () => drafts };
}

function scored(drafts: SuggestionDraft[]): Suggestion[] {
  return collectSuggestions([provider(drafts)], CTX);
}

function order(drafts: SuggestionDraft[]): string[] {
  return scored(drafts).map((suggestion) => suggestion.id);
}

describe("collectSuggestions", () => {
  it("orders by worth, best first", () => {
    expect(
      order([
        draft("filler", "daily", worthOf("Focus Points")),
        draft("must", "daily", worthOf("Umbra Forma")),
        draft("useful", "daily", worthOf("Kuva")),
      ]),
    ).toEqual(["must", "useful", "filler"]);
  });

  it("keeps a turned-down suggestion, ranked below every other one", () => {
    expect(
      order([
        draft("normal", "daily", worthOf("Credits")),
        { ...draft("low", "daily", worthOf("Umbra Forma")), deprioritized: true },
        draft("best", "daily", worthOf("Kuva")),
      ]),
    ).toEqual(["best", "normal", "low"]);
  });

  it("ranks turned-down suggestions among themselves", () => {
    expect(
      order([
        { ...draft("quiet", "daily", worthOf("Credits")), deprioritized: true },
        { ...draft("loud", "daily", worthOf("Umbra Forma")), deprioritized: true },
      ]),
    ).toEqual(["loud", "quiet"]);
  });

  it("merges every provider into one ranking", () => {
    const result = collectSuggestions(
      [
        provider([draft("a", "daily", worthOf("Kuva"))]),
        provider([draft("b", "weekly", worthOf("Forma"))]),
      ],
      CTX,
    );
    expect(result.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("drops anything this player stands to gain nothing from", () => {
    const useless = draft("owned", "daily", worthOf("Umbra Forma"));
    const result = order([
      { ...useless, signals: { ...useless.signals, gain: 0 } },
      draft("wanted", "daily", worthOf("Kuva")),
    ]);
    expect(result).toEqual(["wanted"]);
  });

  it("reads an absent gain as one, and a partial gain as worth less", () => {
    const full = draft("full", "daily", worthOf("Forma"));
    const half = draft("half", "daily", worthOf("Forma"));
    expect(order([{ ...half, signals: { ...half.signals, gain: 0.4 } }, full])).toEqual([
      "full",
      "half",
    ]);
  });
});

describe("band ordering", () => {
  it("puts a closing useful-or-better ahead of a must-have with days left", () => {
    expect(
      order([
        draft("shard", "weekly", worthOf("Umbra Forma")),
        closing(draft("kuva", "daily", worthOf("Kuva")), 2),
      ]),
    ).toEqual(["kuva", "shard"]);
  });

  it("never promotes filler on a closing window", () => {
    expect(
      order([
        closing(draft("standing", "daily", worthOf("Focus Points")), 1),
        draft("shard", "weekly", worthOf("Umbra Forma")),
      ]),
    ).toEqual(["shard", "standing"]);
  });

  it("orders a band by worth before time left", () => {
    expect(
      order([
        closing(draft("kuva", "daily", worthOf("Kuva")), 4),
        closing(draft("shard", "weekly", worthOf("Umbra Forma")), 5),
      ]),
    ).toEqual(["shard", "kuva"]);
  });

  it("breaks a worth tie on time left, and on nothing else after it", () => {
    const soon = closing(draft("soon", "daily", worthOf("Kuva")), 2);
    const later = closing(draft("later", "daily", worthOf("Kuva")), 5);
    expect(order([later, soon])).toEqual(["soon", "later"]);
  });

  it("orders nothing by effort", () => {
    const cheap = closing(draft("b-cheap", "daily", worthOf("Kuva")), 2);
    const costly = {
      ...closing(draft("a-costly", "daily", worthOf("Kuva")), 2),
      signals: { value: worthOf("Kuva"), effort: 1, urgency: 0 },
    };
    // Every ordering term but the id has tied, so the id decides and the
    // costlier one leads.
    expect(order([cheap, costly])).toEqual(["a-costly", "b-cheap"]);
  });
});

describe("buildFeed", () => {
  it("groups suggestions under their own category", () => {
    const feed = buildFeed(
      scored([draft("a", "daily", worthOf("Kuva")), draft("b", "weekly", worthOf("Forma"))]),
      {},
    );
    expect(feed.sections.daily.map((s) => s.id)).toEqual(["a"]);
    expect(feed.sections.weekly.map((s) => s.id)).toEqual(["b"]);
    expect(feed.hiddenCount).toBe(0);
  });

  it("ranks within a section rather than across the feed", () => {
    const feed = buildFeed(
      scored([
        draft("a", "daily", worthOf("Kuva")),
        draft("b", "weekly", worthOf("Umbra Forma")),
        draft("c", "weekly", worthOf("Forma")),
        { ...draft("d", "weekly", worthOf("Umbra Forma")), deprioritized: true },
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

  it("reports how many resolved rewards the ladder could not place", () => {
    clearUnplacedForTest();
    expect(buildFeed([], {}).unplacedCount).toBe(0);
    noteUnplaced("something nobody rated");
    expect(buildFeed([], {}).unplacedCount).toBe(1);
    clearUnplacedForTest();
  });

  it("hides a suggestion dismissed against its current fingerprint", () => {
    const suggestions = scored([
      draft("a", "daily", worthOf("Kuva")),
      draft("b", "daily", worthOf("Endo")),
    ]);
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
