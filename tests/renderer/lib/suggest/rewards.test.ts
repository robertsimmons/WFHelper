import { describe, expect, it } from "vitest";

import { defaultPreferences } from "../../../../src/lib/suggest/preferences.js";
import {
  bestWorth,
  rewardValue,
  rewardWorth,
  taskWorth,
  worthGroup,
} from "../../../../src/lib/suggest/rewards.js";
import { clearUnplacedForTest, unplacedNames } from "../../../../src/lib/suggest/unplaced.js";
import { groupForWorth } from "../../../../src/lib/suggest/worthLadder.js";
import type { WorthGroup } from "../../../../src/types/suggest.js";

const PREFS = defaultPreferences();

function worth(name: string, count?: number): number {
  return rewardValue(PREFS, name, count) ?? -1;
}

describe("rewardValue", () => {
  it("orders one group above the next", () => {
    expect(worth("Umbra Forma")).toBeGreaterThan(worth("Forma"));
    expect(worth("Forma")).toBeGreaterThan(worth("Kuva"));
    expect(worth("Kuva")).toBeGreaterThan(worth("Ducats"));
    expect(worth("Ducats")).toBeGreaterThan(worth("Credits"));
  });

  it("nudges an entry by where it sits inside its own group", () => {
    expect(worth("Tauforged Azure Archon Shard")).toBeGreaterThan(worth("Azure Archon Shard"));
    expect(groupForWorth(worth("Tauforged Azure Archon Shard"))).toBe("must");
    expect(groupForWorth(worth("Azure Archon Shard"))).toBe("must");
  });

  it("scales with quantity without leaving the entry's group", () => {
    expect(worth("3x Forma")).toBeGreaterThan(worth("1x Forma"));
    expect(worth("1x Forma")).toBe(worth("Forma"));
    expect(worth("50,000 Kuva")).toBeGreaterThan(worth("Kuva"));
    expect(worth("10k Kuva")).toBeGreaterThan(worth("Kuva"));
    expect(groupForWorth(worth("3x Forma"))).toBe("want");
  });

  it("keeps a bigger count from overtaking the entry above it", () => {
    expect(worth("999x Orokin Reactor")).toBeLessThan(worth("Exilus Weapon Adapter"));
    expect(worth("999x Forma")).toBeLessThan(worth("Amp Arcane Adapter"));
  });

  it("treats a blueprint as the item it builds", () => {
    expect(worth("Umbra Forma Blueprint")).toBe(worth("Umbra Forma"));
    expect(worth("Exilus Weapon Adapter Blueprint")).toBe(worth("Exilus Weapon Adapter"));
  });

  it("ignores case and stray spacing", () => {
    expect(worth("  orokin   REACTOR ")).toBe(worth("Orokin Reactor"));
  });

  it("takes the player's placement over the shipped one", () => {
    const prefs = { ...PREFS, worth: { ...PREFS.worth, kuva: "must" as WorthGroup } };
    expect(rewardValue(prefs, "Kuva") ?? 0).toBeGreaterThan(worth("Kuva"));
    expect(groupForWorth(rewardValue(prefs, "Kuva") ?? 0)).toBe("must");
  });

  it("leaves a name the ladder does not place unplaced, and says so", () => {
    clearUnplacedForTest();
    expect(rewardValue(PREFS, "Somachord Tone Of Nowhere")).toBeNull();
    expect(rewardValue(PREFS, "")).toBeNull();
    expect(rewardValue(PREFS, null)).toBeNull();
    expect(unplacedNames()).toEqual(["somachord tone of nowhere"]);
    clearUnplacedForTest();
  });
});

describe("worthGroup", () => {
  it("names the group a reward ships in", () => {
    expect(worthGroup(PREFS, "Umbra Forma")).toBe("must");
    expect(worthGroup(PREFS, "Forma")).toBe("want");
    expect(worthGroup(PREFS, "Kuva")).toBe("useful");
    expect(worthGroup(PREFS, "Focus Points")).toBe("filler");
    expect(worthGroup(PREFS, "Credits")).toBe("junk");
    expect(worthGroup(PREFS, "Nothing In Particular")).toBeNull();
  });

  it("projects onto the four tiers the components still draw", () => {
    expect(rewardWorth(PREFS, "Umbra Forma")).toBe("great");
    expect(rewardWorth(PREFS, "Forma")).toBe("good");
    expect(rewardWorth(PREFS, "Kuva")).toBe("ok");
    expect(rewardWorth(PREFS, "Credits")).toBe("low");
  });
});

describe("bestWorth", () => {
  it("is worth the best thing in the set", () => {
    expect(bestWorth(PREFS, ["Kuva", "Umbra Forma", "Credits"])).toBe(worth("Umbra Forma"));
  });

  it("counts an unplaced name as resolved, at zero", () => {
    expect(bestWorth(PREFS, ["Unheard Of Widget"])).toBe(0);
    expect(bestWorth(PREFS, [])).toBeNull();
    expect(bestWorth(PREFS, [null, undefined])).toBeNull();
  });
});

describe("taskWorth", () => {
  it("rates a task whose reward the world state never names", () => {
    expect(taskWorth(PREFS, "archonHunt") ?? 0).toBeGreaterThan(taskWorth(PREFS, "sortie") ?? 0);
    expect(taskWorth(PREFS, "sortie") ?? 0).toBeGreaterThan(taskWorth(PREFS, "kahl") ?? 0);
    expect(taskWorth(PREFS, "kahl") ?? 0).toBeGreaterThan(taskWorth(PREFS, "clem") ?? 0);
  });

  it("pays a currency task off a currency entry rather than a category default", () => {
    expect(groupForWorth(taskWorth(PREFS, "dailyFocus") ?? 0)).toBe("filler");
    expect(groupForWorth(taskWorth(PREFS, "simaris") ?? 0)).toBe("filler");
    expect(groupForWorth(taskWorth(PREFS, "syndicateStanding") ?? 0)).toBe("filler");
    expect(groupForWorth(taskWorth(PREFS, "kahl") ?? 0)).toBe("filler");
  });

  it("has nothing to say about a task nobody curated", () => {
    expect(taskWorth(PREFS, "palladino")).toBeNull();
    expect(taskWorth(PREFS, "circuitNormal")).toBeNull();
  });
});
