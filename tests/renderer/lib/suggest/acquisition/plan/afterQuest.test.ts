import { describe, expect, it } from "vitest";

import { inventory, itemDb } from "./fixtures.js";
import {
  authoredPlan,
  resolvePlan,
  validatePlan,
} from "../../../../../../src/lib/suggest/acquisition/plan/index.js";
import { planRatingFor } from "../../../../../../src/lib/suggest/acquisition/plan/data.js";
import {
  rankMet,
  rankSyndicate,
  topRank,
} from "../../../../../../src/lib/suggest/acquisition/plan/ranks.js";
import { readQuestState } from "../../../../../../src/lib/suggest/acquisition/plan/state.js";
import type {
  AuthoredPlan,
  ResolvedPlan,
} from "../../../../../../src/lib/suggest/acquisition/plan/index.js";
import type { ItemDbEntry, RawInventoryData } from "../../../../../../src/types/inventory.js";

const SANDS = "/Lotus/Types/Keys/MummyQuest/MummyQuestKeyChain";
const CHAINS = "/Lotus/Types/Keys/PriestQuest/PriestQuestKeyChain";
const NOW = Date.parse("2026-01-01T00:00:00Z");

function db(): Record<string, ItemDbEntry> {
  return {
    ...itemDb(),
    [SANDS]: { name: "Sands of Inaros", category: "Key" },
    [CHAINS]: { name: "Chains of Harrow", category: "Key" },
  };
}

function load(name: string): AuthoredPlan {
  const plan = authoredPlan(name);
  if (!plan) throw new Error(`no plan for ${name}`);
  return plan;
}

function questsDone(done: string[]): RawInventoryData {
  return { ...inventory(), QuestKeys: done.map((ItemType) => ({ ItemType, Completed: true })) };
}

function standing(tag: string, title: number): RawInventoryData {
  return { ...inventory(), Affiliations: [{ Tag: tag, Standing: 0, Title: title }] };
}

function resolve(name: string, playerInventory: RawInventoryData | null): ResolvedPlan {
  return resolvePlan(load(name), { itemDb: db(), inventory: playerInventory, now: NOW });
}

function rating(name: string, playerInventory: RawInventoryData | null) {
  return planRatingFor(name, {
    inventory: playerInventory,
    quests: readQuestState(playerInventory, db()),
  });
}

describe("a quest that has paid out", () => {
  it("skips the quest groups and splices the after-quest route in before the build", () => {
    const plan = resolve("Inaros", questsDone([SANDS]));
    const skipped = plan.groups.filter((group) => group.skip !== null);
    expect(skipped.map((group) => group.place)).toEqual([
      "MASTERY RANK",
      "RELAY",
      "BARO KI'TEER",
      "FOUNDRY",
      "ARA, MARS",
    ]);
    for (const group of skipped) expect(group.skip?.reason).toBe("Quest done; it rewards once");
    const places = plan.groups.map((group) => group.place);
    const simaris = places.indexOf("CEPHALON SIMARIS");
    const build = plan.groups.findIndex((group) => group.type === "foundry" && !group.skip);
    expect(simaris).toBeGreaterThan(places.indexOf("ARA, MARS"));
    expect(simaris).toBeLessThan(build);
    expect(plan.groups.filter((group) => group.id.startsWith("q"))).toHaveLength(2);
    expect(plan.afterQuest?.effort).toBe(6);
    expect(plan.afterQuest?.badges[0]?.text).toMatch(/Simaris/);
  });

  it("keeps the authored route while the quest is open or its state unknown", () => {
    for (const playerInventory of [questsDone([]), inventory(), null]) {
      const plan = resolve("Inaros", playerInventory);
      expect(plan.afterQuest).toBeNull();
      expect(plan.groups.some((group) => group.place === "CEPHALON SIMARIS")).toBe(false);
      expect(plan.groups.some((group) => group.skip !== null)).toBe(false);
      expect(rating("Inaros", playerInventory)).toMatchObject({
        effort: 3,
        badge: { text: "Baro visit + MR 5" },
      });
    }
  });

  it("rates the card by the route left", () => {
    expect(rating("Inaros", questsDone([SANDS]))).toMatchObject({
      planned: true,
      effort: 6,
      badge: { text: "Simaris 125,000 standing" },
    });
  });

  it("drops only the quest reward when the plan keeps other groups", () => {
    const plan = resolve("Harrow", questsDone([CHAINS]));
    const skipped = plan.groups.filter((group) => group.skip !== null);
    expect(skipped.map((group) => group.place)).toEqual(["CETUS"]);
    expect(plan.groups.some((group) => group.place === "PAGO, KUVA FORTRESS")).toBe(true);
    expect(plan.groups.filter((group) => group.place === "CEPHALON SIMARIS")).toHaveLength(2);
  });
});

describe("syndicate ranks", () => {
  const hex = rankSyndicate("The Hex");
  if (!hex) throw new Error("no Hex in the rank table");
  const top = topRank(hex);

  it("reads a rank as met at or above it, and always at the top", () => {
    expect(rankMet(standing("HexSyndicate", 4), { syndicate: "The Hex", level: 5 })).toBe(false);
    expect(rankMet(standing("HexSyndicate", 5), { syndicate: "The Hex", level: 5 })).toBe(true);
    expect(rankMet(standing("HexSyndicate", top), { syndicate: "Hex", level: top })).toBe(true);
    expect(rankMet(standing("HexSyndicate", top), { syndicate: "The Hex", level: 99 })).toBe(true);
    expect(rankMet(inventory(), { syndicate: "The Hex", level: 1 })).toBeNull();
  });

  it("stands a rank badge down once the player holds the rank", () => {
    expect(rating("Dual Viciss", standing("HexSyndicate", 4)).badge?.text).toBe("Hex Rank 5");
    expect(rating("Dual Viciss", standing("HexSyndicate", 5)).badge?.text).not.toBe("Hex Rank 5");
    expect(rating("Dual Viciss", standing("HexSyndicate", top)).badge?.text).not.toBe("Hex Rank 5");
    expect(rating("Dual Viciss", inventory()).badge?.text).toBe("Hex Rank 5");
  });

  it("resolves rank rows from the player's rank", () => {
    const plan = resolvePlan(load("Ekhein"), {
      itemDb: db(),
      inventory: standing("EntratiLabSyndicate", 2),
      now: NOW,
    });
    const rows = plan.groups.flatMap((group) => group.rows);
    const row = (label: string) => rows.find((entry) => entry.label === label);
    expect(row("Rank 1, Assistant")).toMatchObject({ done: true, source: "inventory" });
    expect(row("Rank 2, Researcher")).toMatchObject({ done: true, manual: false });
    expect(row("Rank 3, Colleague")).toMatchObject({ done: false, manual: false });
  });
});

describe("validating quest and rank fields", () => {
  const base = load("Inaros");

  it("needs a quest group for an after-quest route", () => {
    const groups = base.groups.map((group) => ({ ...group, quest: null }));
    expect(validatePlan({ ...base, groups })).toContain("afterQuest needs a group with a quest");
  });

  it("rejects a quest inside the after-quest route", () => {
    const after = base.afterQuest;
    if (!after) throw new Error("Inaros has no afterQuest");
    const groups = after.groups.map((group) => ({ ...group, quest: "Sands of Inaros" }));
    expect(validatePlan({ ...base, afterQuest: { ...after, groups } })).toContain(
      "afterQuest.groups[0].quest must be absent: the quest is already done",
    );
  });

  it("rejects a rank on an unknown syndicate or past the top", () => {
    const badges = [
      { text: "x", tone: "warn", rank: { syndicate: "Nobody", level: 1 } },
      { text: "y", tone: "warn", rank: { syndicate: "The Hex", level: 99 } },
    ];
    const problems = validatePlan({ ...base, badges });
    expect(problems).toContain("badges[0].rank.syndicate is not a syndicate in the rank table");
    expect(problems.some((problem) => problem.startsWith("badges[1].rank.level"))).toBe(true);
  });
});
