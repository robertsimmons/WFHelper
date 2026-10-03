import { describe, expect, it } from "vitest";

import { inventory, itemDb } from "./fixtures.js";
import { resolvePinnedPlans } from "../../../../../../src/components/nextup/plan/planResolution.js";
import {
  planSource,
  resolvePlanFor,
} from "../../../../../../src/lib/suggest/acquisition/plan/index.js";

const context = () => ({ itemDb: itemDb(), inventory: inventory() });

describe("resolvePlanFor", () => {
  it("resolves the authored plan, with the tier off the target", () => {
    const plan = resolvePlanFor({ name: "Rhino", tier: "C" }, context());
    expect(plan?.effort).toBe(3);
    expect(plan?.tier).toBe("C");
    expect(resolvePlanFor({ name: "Rhino", tier: null }, context())?.tier).toBeNull();
  });

  it("lets a handed-in count win over the authored one", () => {
    const progress = { have: 3, need: 4, unit: "parts", ready: false };
    const plan = resolvePlanFor({ name: "Rhino", tier: null }, { ...context(), progress });
    expect(plan?.progress).toEqual({ ...progress, resolved: true });
  });

  it("reads an item nobody has planned as unknown, never as an invented plan", () => {
    expect(resolvePlanFor({ name: "Unplanned Testframe", tier: "A" }, context())).toBeNull();
  });

  it("files an unplanned item under unique for the source filter", () => {
    expect(planSource("Unplanned Testframe")).toBe("unique");
  });
});

describe("resolvePinnedPlans", () => {
  it("keys only the pins that have a plan", () => {
    const plans = resolvePinnedPlans(
      [
        { uniqueName: "/rhino", target: { name: "Rhino", tier: null } },
        { uniqueName: "/unplanned", target: { name: "Unplanned Testframe", tier: null } },
      ],
      context(),
    );
    expect(Object.keys(plans)).toEqual(["/rhino"]);
  });
});
