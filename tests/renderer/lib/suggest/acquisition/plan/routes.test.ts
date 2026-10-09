import { describe, expect, it } from "vitest";

import { inventory, itemDb } from "./fixtures.js";
import {
  authoredPlan,
  resolvePlan,
  validatePlan,
} from "../../../../../../src/lib/suggest/acquisition/plan/index.js";
import type { AuthoredPlan } from "../../../../../../src/lib/suggest/acquisition/plan/index.js";
import type { ItemDbEntry, RawInventoryData } from "../../../../../../src/types/inventory.js";

const CONSTELLATIONS = "/Lotus/Types/Keys/TestConstellationsQuestKeyChain";
const NOW = Date.parse("2026-01-01T00:00:00Z");

function db(): Record<string, ItemDbEntry> {
  return {
    ...itemDb(),
    [CONSTELLATIONS]: { name: "Jade Shadows: Constellations", category: "Key" },
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

function routesFor(playerInventory: RawInventoryData | null) {
  return resolvePlan(load("Sirius & Orion"), {
    itemDb: db(),
    inventory: playerInventory,
    now: NOW,
  }).routes;
}

describe("the routes overview", () => {
  it("walks the chosen route while the quest is open or unknown", () => {
    for (const playerInventory of [questsDone([]), inventory(), null]) {
      const routes = routesFor(playerInventory);
      expect(routes.map((route) => [route.current, route.ruledOut])).toEqual([
        [true, false],
        [false, false],
      ]);
    }
  });

  it("rules the quest route out and walks the after-quest one once the quest is done", () => {
    const routes = routesFor(questsDone([CONSTELLATIONS]));
    expect(routes[0]).toMatchObject({ current: false, ruledOut: true, effort: 4 });
    expect(routes[1]).toMatchObject({ current: true, ruledOut: false, effort: 5 });
  });

  it("is empty for a plan with no routes", () => {
    const { routes: _routes, ...plan } = load("Sirius & Orion");
    expect(resolvePlan(plan, { itemDb: db(), inventory: null, now: NOW }).routes).toEqual([]);
  });
});

describe("validating routes", () => {
  const base = load("Sirius & Orion");
  const routes = base.routes ?? [];

  it("ties the chosen and after-quest efforts to the plan's ratings", () => {
    const problems = validatePlan({
      ...base,
      routes: [
        { ...routes[0], effort: 7 },
        { ...routes[1], effort: 9 },
      ],
    });
    expect(problems).toContain("the chosen route's effort must match effort");
    expect(problems).toContain("the afterQuest route's effort must match afterQuest.effort");
  });

  it("needs exactly one chosen route and the after-quest route when there is one", () => {
    const problems = validatePlan({ ...base, routes: [{ ...routes[0], role: null }] });
    expect(problems).toContain("routes needs exactly one chosen route");
    expect(problems).toContain("routes needs the afterQuest route");
  });

  it("rejects an after-quest route without afterQuest, and an unknown role", () => {
    const problems = validatePlan({
      ...base,
      afterQuest: null,
      routes: [routes[0], routes[1], { ...routes[0], role: "maybe" }],
    });
    expect(problems).toContain("an afterQuest route needs afterQuest");
    expect(problems).toContain("routes[2].role must be chosen, afterQuest or null");
  });

  it("rejects an empty list", () => {
    expect(validatePlan({ ...base, routes: [] })).toContain("routes must be a non-empty array");
  });
});
