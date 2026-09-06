import { describe, expect, it } from "vitest";

import { defaultPreferences } from "../../../../src/lib/suggest/preferences.js";
import { rewardValue, taskRewardValue } from "../../../../src/lib/suggest/rewards.js";

const PREFS = defaultPreferences();

describe("rewardValue", () => {
  it("rates a curated item", () => {
    expect(rewardValue(PREFS, "Umbra Forma")).toBeGreaterThan(rewardValue(PREFS, "Forma") ?? 0);
    expect(rewardValue(PREFS, "Forma")).toBeGreaterThan(rewardValue(PREFS, "Kuva") ?? 0);
  });

  it("ranks a tauforged shard above the plain one", () => {
    expect(rewardValue(PREFS, "Tauforged Azure Archon Shard")).toBeGreaterThan(
      rewardValue(PREFS, "Azure Archon Shard") ?? 0,
    );
  });

  it("returns null for an item nobody has rated", () => {
    expect(rewardValue(PREFS, "Somachord Tone")).toBeNull();
    expect(rewardValue(PREFS, "")).toBeNull();
    expect(rewardValue(PREFS, null)).toBeNull();
  });

  it("matches a reward however the game counts it", () => {
    const forma = rewardValue(PREFS, "Forma");
    expect(rewardValue(PREFS, "3x Forma")).toBe(forma);
    const kuva = rewardValue(PREFS, "Kuva");
    expect(rewardValue(PREFS, "50,000 Kuva")).toBe(kuva);
    expect(rewardValue(PREFS, "10k Kuva")).toBe(kuva);
  });

  it("treats a blueprint as the item it builds", () => {
    expect(rewardValue(PREFS, "Umbra Forma Blueprint")).toBe(rewardValue(PREFS, "Umbra Forma"));
    expect(rewardValue(PREFS, "Exilus Weapon Adapter Blueprint")).toBe(
      rewardValue(PREFS, "Exilus Weapon Adapter"),
    );
  });

  it("ignores case and stray spacing", () => {
    expect(rewardValue(PREFS, "  orokin   REACTOR ")).toBe(rewardValue(PREFS, "Orokin Reactor"));
  });

  it("takes the user's tier over the shipped one", () => {
    const prefs = { ...PREFS, rewards: { ...PREFS.rewards, kuva: "great" as const } };
    expect(rewardValue(prefs, "Kuva")).toBeGreaterThan(rewardValue(PREFS, "Kuva") ?? 0);
  });
});

describe("taskRewardValue", () => {
  it("rates a task whose reward the world state never names", () => {
    expect(taskRewardValue("archonHunt")).toBeGreaterThan(taskRewardValue("sortie") ?? 0);
    expect(taskRewardValue("sortie")).toBeGreaterThan(taskRewardValue("clem") ?? 0);
  });

  it("returns null for a task nobody has rated", () => {
    expect(taskRewardValue("descendiaNormal")).toBeNull();
  });
});
