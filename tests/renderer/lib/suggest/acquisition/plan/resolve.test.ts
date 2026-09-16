import { describe, expect, it } from "vitest";

import { building, duviri, inventory, itemDb } from "./fixtures.js";
import {
  authoredPlan,
  resolvePlan,
} from "../../../../../../src/lib/suggest/acquisition/plan/index.js";
import type {
  AuthoredPlan,
  PlanContext,
  ResolvedGroup,
  ResolvedPlan,
} from "../../../../../../src/lib/suggest/acquisition/plan/index.js";

const NOW = Date.parse("2026-01-01T00:00:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function load(name: string): AuthoredPlan {
  const plan = authoredPlan(name);
  if (!plan) throw new Error(`no plan for ${name}`);
  return plan;
}

function resolve(name: string, overrides: Partial<PlanContext> = {}): ResolvedPlan {
  return resolvePlan(load(name), {
    itemDb: itemDb(),
    inventory: inventory(),
    now: NOW,
    ...overrides,
  });
}

function byPlace(plan: ResolvedPlan, place: string): ResolvedGroup {
  const group = plan.groups.find((entry) => entry.place === place);
  if (!group) throw new Error(`no group at ${place}`);
  return group;
}

function byMap(plan: ResolvedPlan, map: string): ResolvedGroup {
  const group = plan.groups.find((entry) => entry.map === map);
  if (!group) throw new Error(`no group on ${map}`);
  return group;
}

describe("quantities", () => {
  it("renders what is left, not what the recipe asks for", () => {
    const gabii = byPlace(resolve("Rhino"), "GABII, CERES");
    const alloy = gabii.rows[0];
    expect(alloy.label).toBe("Alloy Plate");
    expect(alloy.qty).toMatchObject({ required: 150, owned: 100, remaining: 50, text: "50" });
    expect(alloy.done).toBe(false);
  });

  it("keeps the full requirement on a row inventory already covers", () => {
    const gabii = byPlace(resolve("Rhino"), "GABII, CERES");
    const circuits = gabii.rows[1];
    expect(circuits.done).toBe(true);
    expect(circuits.source).toBe("inventory");
    expect(circuits.qty).toMatchObject({ remaining: 0, text: "700", requiredText: "700" });
  });

  it("leaves a partly satisfied group outstanding", () => {
    const gabii = byPlace(resolve("Rhino"), "GABII, CERES");
    expect(gabii.done).toBe(false);
    expect(gabii.remaining).toBe(1);
  });
});

describe("done", () => {
  it("recomputes against inventory rather than trusting the file", () => {
    const market = byPlace(resolve("Rhino"), "MARKET");
    const authored = load("Rhino").groups[0].rows[0];
    expect(authored.done).toBe(true);
    expect(market.rows[0]).toMatchObject({ done: false, source: "inventory", manual: false });
  });

  it("falls back to the authored flag for a row inventory cannot see", () => {
    const fossa = byPlace(resolve("Rhino"), "FOSSA, VENUS");
    expect(fossa.rows[0]).toMatchObject({ label: "Neuroptics", done: false, manual: true });
    expect(fossa.rows[1]).toMatchObject({ label: "Chassis", done: true, source: "authored" });
  });

  it("takes a manual tick on a row inventory cannot see", () => {
    const fossa = byPlace(resolve("Rhino", { manualDone: ["1:0"] }), "FOSSA, VENUS");
    expect(fossa.rows[0]).toMatchObject({ done: true, source: "manual" });
  });
});

describe("live state", () => {
  it("gives a foundry group no live block until a build is started", () => {
    const plan = resolve("Rhino");
    for (const group of plan.groups.filter((entry) => entry.type === "foundry")) {
      expect(group.live).toBeNull();
    }
  });

  it("waits only on a build that is actually in the queue", () => {
    const plan = resolve("Rhino", { inventory: building(NOW + 3 * HOUR) });
    const foundry = plan.groups.find(
      (group) => group.type === "foundry" && group.rows.some((row) => row.label === "Rhino"),
    );
    expect(foundry?.live).toEqual({
      state: "waiting",
      text: "building, 3h 0m left",
      resolved: true,
    });
    expect(foundry?.facts).toContainEqual({
      kind: "foundry",
      text: "Rhino building, 3h 0m left",
      resolved: true,
    });
  });

  it("treats a vendor rotation as waiting whatever the player did", () => {
    const varzia = byMap(resolve("Mesa Prime"), "maroos-bazaar");
    expect(varzia.live?.state).toBe("waiting");
  });

  it("splits two groups on the same spiral mood", () => {
    const plan = resolve("Kullervo", { world: duviri("anger", NOW + 47 * MINUTE) });
    expect(byMap(plan, "kullervos-hold").live).toEqual({
      state: "open",
      text: "Anger now, 47m left",
      resolved: true,
    });
    expect(byMap(plan, "archarbor").live).toEqual({
      state: "blocked",
      text: "Envy in 47m",
      resolved: true,
    });
  });

  it("keeps the authored text when no world state answers the group", () => {
    const hold = byMap(resolve("Kullervo"), "kullervos-hold");
    expect(hold.live).toEqual({ state: "open", text: "Anger now, 47m left", resolved: false });
  });
});

describe("currency ledger", () => {
  it("pairs the farm that banks with the vendor that spends", () => {
    const plan = resolve("Kullervo");
    const bane = plan.ledger.find((entry) => entry.currency === "Kullervo's Bane");
    expect(bane).toEqual({
      currency: "Kullervo's Bane",
      earned: 42,
      spent: 42,
      outstanding: 42,
      paired: true,
    });
    // The group's own rows name the Bane, so its header does not restate it.
    expect(byMap(plan, "kullervos-hold").earns).toBeNull();
  });

  it("drops what is already bought out of the total still to bank", () => {
    const plan = resolve("Kullervo", { manualDone: ["8:0"] });
    const bane = plan.ledger.find((entry) => entry.currency === "Kullervo's Bane");
    expect(bane?.outstanding).toBe(27);
  });

  it("renders an unpaired spend as an ordinary cost with no phantom earner", () => {
    const plan = resolve("Hound");
    const entrati = plan.ledger.find((entry) => entry.currency === "Entrati standing");
    expect(entrati).toMatchObject({ earned: null, spent: 8000, paired: false });
    expect(plan.groups.every((group) => group.earns?.currency !== "Entrati standing")).toBe(true);
  });

  it("counts a row alt only when that alternative is taken", () => {
    const untaken = resolve("Cyte-09");
    expect(untaken.groups[1].rows[0].alt).toMatchObject({
      text: "or 20,000 standing at Amir",
      taken: false,
    });
    expect(untaken.ledger).toEqual([]);

    const taken = resolve("Cyte-09", { altsTaken: ["1:0"] });
    expect(taken.ledger).toEqual([
      {
        currency: "The Hex standing",
        earned: null,
        spent: 20000,
        outstanding: 20000,
        paired: false,
      },
    ]);
  });

  it("leaves a plain string alt alone", () => {
    const plan = resolve("Kullervo", { altsTaken: ["1:2"] });
    expect(plan.groups[1].rows[2].alt).toEqual({
      text: "or 1 per Undercroft side portal",
      spends: [],
      taken: true,
    });
    expect(plan.ledger.map((entry) => entry.currency)).toEqual(["Kullervo's Bane"]);
  });
});

describe("skipped groups", () => {
  it("counts as done and stays out of the step count", () => {
    const plan = resolve("Helios");
    const skipped = plan.groups.filter((group) => group.skip !== null);
    expect(skipped.length).toBeGreaterThan(0);
    for (const group of skipped) {
      expect(group.done).toBe(true);
      expect(group.remaining).toBe(0);
    }
    const counted = plan.groups
      .filter((group) => group.skip === null)
      .reduce((total, group) => total + group.rows.length, 0);
    expect(plan.steps.total).toBe(counted);
  });
});

describe("progress", () => {
  it("keeps the authored figures when nobody hands in a real count", () => {
    expect(resolve("Rhino").progress).toEqual({
      have: 2,
      need: 4,
      unit: "parts",
      ready: false,
      resolved: false,
    });
  });

  it("takes the real count over the authored one", () => {
    const progress = { have: 1, need: 4, unit: "parts", ready: false };
    expect(resolve("Rhino", { progress }).progress).toEqual({ ...progress, resolved: true });
  });
});

describe("maps", () => {
  it("marks every map link as not ready yet", () => {
    const plan = resolve("Kullervo");
    for (const group of plan.groups) expect(group.mapReady).toBe(false);
  });
});
