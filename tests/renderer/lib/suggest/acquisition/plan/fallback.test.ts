import { describe, expect, it } from "vitest";

import { inventory, itemDb } from "./fixtures.js";
import {
  fallbackPlan,
  resolvePlanFor,
  validatePlan,
} from "../../../../../../src/lib/suggest/acquisition/plan/index.js";
import type { FallbackSource } from "../../../../../../src/lib/suggest/acquisition/plan/index.js";

function source(overrides: Partial<FallbackSource> = {}): FallbackSource {
  return {
    name: "Volt",
    kind: "warframe",
    tier: null,
    effort: 0.4,
    parts: {
      known: true,
      main: { name: "Volt Blueprint", required: 1, owned: 0, missing: 1 },
      components: [
        { name: "Volt Neuroptics", required: 1, owned: 0, missing: 1 },
        { name: "Volt Chassis", required: 1, owned: 1, missing: 0 },
      ],
      missing: [{ name: "Volt Neuroptics", required: 1, owned: 0, missing: 1 }],
      materials: [
        { name: "Alloy Plate", required: 150, owned: 100, missing: 50 },
        { name: "Rubedo", required: 1200, owned: 0, missing: 1200 },
      ],
      credits: 25000,
    },
    paths: [
      {
        kind: "quest",
        covers: ["Volt Neuroptics"],
        steps: [{ kind: "quest", where: "the Vor's Prize quest", parts: [] }],
      },
    ],
    ...overrides,
  };
}

describe("fallbackPlan", () => {
  it("satisfies the same schema as an authored plan", () => {
    expect(validatePlan(fallbackPlan(source()))).toEqual([]);
  });

  it("groups materials under the mission the resource table names", () => {
    const plan = fallbackPlan(source());
    const gabii = plan.groups.find((group) => group.place === "GABII, CERES");
    expect(gabii?.rows.map((row) => row.label)).toEqual(["Alloy Plate"]);
    expect(plan.groups.some((group) => group.rows.some((row) => row.label === "Rubedo"))).toBe(
      true,
    );
  });

  it("turns each path step into its own group", () => {
    const plan = fallbackPlan(source());
    expect(plan.groups[0]).toMatchObject({ type: "gate", place: "THE VOR'S PRIZE QUEST" });
    expect(plan.groups[0].rows[0].label).toBe("Volt");
  });

  it("says it has no community notes rather than reading as bad", () => {
    const plan = fallbackPlan(source());
    expect(plan.badges).toEqual([{ text: "no community notes yet", tone: "info" }]);
  });

  it("stays sparse when there is nothing to say", () => {
    const bare = source({
      parts: { known: false, main: null, components: [], missing: [], materials: [], credits: 0 },
      paths: [],
    });
    const plan = fallbackPlan(bare);
    expect(plan.groups).toHaveLength(1);
    expect(plan.prices).toEqual([]);
  });
});

describe("resolvePlanFor", () => {
  it("uses the authored plan when there is one", () => {
    const plan = resolvePlanFor(source({ name: "Rhino" }), {
      itemDb: itemDb(),
      inventory: inventory(),
    });
    expect(plan.authored).toBe(true);
    expect(plan.effort).toBe(3);
  });

  it("marks a derived plan as not authored", () => {
    const plan = resolvePlanFor(source(), { itemDb: itemDb(), inventory: inventory() });
    expect(plan.authored).toBe(false);
    expect(plan.effort).toBe(4);
    const gabii = plan.groups.find((group) => group.place === "GABII, CERES");
    expect(gabii?.rows[0].qty).toMatchObject({ required: 150, owned: 100, text: "50" });
  });

  it("takes the tier off the target, authored plan or not", () => {
    const context = { itemDb: itemDb(), inventory: inventory() };
    expect(resolvePlanFor(source({ name: "Rhino", tier: "C" }), context).tier).toBe("C");
    expect(resolvePlanFor(source({ tier: "C" }), context).tier).toBe("C");
    expect(resolvePlanFor(source({ name: "Rhino" }), context).tier).toBeNull();
  });

  it("lets a handed-in count win on a derived plan too", () => {
    const progress = { have: 3, need: 4, unit: "parts", ready: false };
    const plan = resolvePlanFor(source(), { itemDb: itemDb(), inventory: inventory(), progress });
    expect(plan.progress).toEqual({ ...progress, resolved: true });
  });
});
