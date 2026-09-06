import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_OPTIONS, defaultPreferences } from "../../../../src/lib/suggest/preferences.js";
import {
  MASTERY_ACTIVITY,
  masteryProvider,
} from "../../../../src/lib/suggest/providers/mastery.js";
import { masteryData } from "../../../../src/stores/mastery.js";
import type { Translator } from "../../../../src/lib/i18n.js";
import type { MasteryData, ParsedItem } from "../../../../src/types/inventory.js";
import type {
  ActivityPref,
  SuggestionContext,
  SuggestionOptions,
} from "../../../../src/types/suggest.js";
import type { TrackerState } from "../../../../src/lib/world/dailies.js";

const NOW = Date.parse("2026-09-05T12:00:00Z");
const t = ((key: string) => key) as unknown as Translator;

function tracker(): TrackerState {
  return { progress: {}, hidden: [], periods: {}, custom: [], seq: 0 };
}

let mastery: MasteryData | null = null;

function context(
  activities: Record<string, ActivityPref> = {},
  options: Partial<SuggestionOptions> = {},
): SuggestionContext {
  return {
    world: null,
    inventory: null,
    itemDb: {},
    inventoryModifiedAt: null,
    mastery,
    relicDb: null,
    plat: null,
    tracker: tracker(),
    prefs: { ...defaultPreferences(), activities, options: { ...DEFAULT_OPTIONS, ...options } },
    dropPools: {},
    nowMs: NOW,
    t,
  };
}

function item(overrides: Partial<ParsedItem>): ParsedItem {
  return {
    name: "Braton",
    internalName: "/Braton",
    uniqueName: "/Braton",
    imageUrl: null,
    category: "Primary",
    categoryLabel: "Primary",
    status: "progress",
    rank: 0,
    maxRank: 30,
    isPrime: false,
    masteryReq: 0,
    vaulted: false,
    tradable: true,
    description: "",
    masteryXpRemaining: 3_000,
    currentlyOwned: true,
    components: [],
    drops: [],
    wikiaUrl: null,
    ...overrides,
  };
}

function loadMastery(items: ParsedItem[]): void {
  mastery = {
    items,
    stats: {
      total: items.length,
      mastered: 0,
      inProgress: items.length,
      missing: 0,
      byCategory: {},
    },
  } as MasteryData;
}

function ids(
  activities: Record<string, ActivityPref> = {},
  options: Partial<SuggestionOptions> = {},
): string[] {
  return masteryProvider.collect(context(activities, options)).map((draft) => draft.id);
}

afterEach(() => {
  mastery = null;
  masteryData.set(null);
});

describe("masteryProvider", () => {
  it("takes its gear from the context, not the store behind it", () => {
    masteryData.set({ items: [item({})], stats: {} } as unknown as MasteryData);
    expect(ids()).toEqual([]);
    loadMastery([item({})]);
    expect(ids()).toEqual(["mastery:/Braton"]);
  });

  it("suggests nothing when there is nothing left to level", () => {
    loadMastery([
      item({ name: "Maxed", uniqueName: "/Maxed", status: "mastered", rank: 30 }),
      item({ name: "Spent", uniqueName: "/Spent", rank: 30, masteryXpRemaining: 0 }),
    ]);
    expect(ids()).toEqual([]);
  });

  it("leaves gear the player does not own to the acquisition providers", () => {
    loadMastery([item({ name: "Wanted", uniqueName: "/Wanted", currentlyOwned: false })]);
    expect(ids()).toEqual([]);
  });

  it("puts the shortest grind first", () => {
    loadMastery([
      item({ name: "Fresh", uniqueName: "/Fresh", rank: 0 }),
      item({ name: "Nearly", uniqueName: "/Nearly", rank: 28, masteryXpRemaining: 200 }),
      item({ name: "Halfway", uniqueName: "/Halfway", rank: 15, masteryXpRemaining: 1_500 }),
    ]);
    expect(ids()).toEqual(["mastery:/Nearly", "mastery:/Halfway", "mastery:/Fresh"]);
  });

  it("keeps Forma dumps until the player turns them off", () => {
    loadMastery([
      item({ name: "Kuva Bramma", uniqueName: "/Bramma", rank: 30, maxRank: 40 }),
      item({ name: "Braton", uniqueName: "/Braton", rank: 20 }),
    ]);
    expect(ids()).toContain("mastery:/Bramma");
    expect(ids({}, { masteryForma: false })).toEqual(["mastery:/Braton"]);
  });

  it("counts a lich weapon short of rank 30 as an ordinary grind", () => {
    loadMastery([item({ name: "Kuva Bramma", uniqueName: "/Bramma", rank: 12, maxRank: 40 })]);
    expect(ids({}, { masteryForma: false })).toEqual(["mastery:/Bramma"]);
  });

  it("hides gear that only levels in its own mode when asked", () => {
    loadMastery([
      item({ name: "Odonata", uniqueName: "/Odonata", category: "Archwing" }),
      item({ name: "Braton", uniqueName: "/Braton" }),
    ]);
    expect(ids({}, { masteryOwnMode: false })).toEqual(["mastery:/Braton"]);
  });

  it("carries the rank as progress and fingerprints on it", () => {
    loadMastery([item({ rank: 12 })]);
    const draft = masteryProvider.collect(context())[0];
    expect(draft?.progress).toEqual({ current: 12, required: 30 });
    expect(draft?.fingerprint).toBe("/Braton|12");
  });

  it("keeps a turned-down domain below everything else rather than dropping it", () => {
    loadMastery([item({})]);
    expect(masteryProvider.collect(context({ [MASTERY_ACTIVITY]: "low" }))[0]?.deprioritized).toBe(
      true,
    );
    expect(ids({ [MASTERY_ACTIVITY]: "never" })).toEqual([]);
  });
});
