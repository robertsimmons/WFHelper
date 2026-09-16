import { describe, expect, it } from "vitest";

import {
  authoredPlan,
  authoredPlans,
  planRating,
  validatePlan,
} from "../../../../../../src/lib/suggest/acquisition/plan/index.js";

describe("validatePlan", () => {
  it("accepts every plan that ships with the app", () => {
    const plans = authoredPlans();
    expect(plans).toHaveLength(7);
    for (const plan of plans) expect([plan.name, validatePlan(plan)]).toEqual([plan.name, []]);
  });

  it("names the field that is wrong", () => {
    const plan = structuredClone(authoredPlan("Rhino"));
    expect(plan).not.toBeNull();
    if (!plan) return;
    (plan.groups[1] as { type: string }).type = "shopping";
    expect(validatePlan(plan)).toEqual(["groups[1].type is not a plan group type"]);
  });

  it("rejects a quantity that is not a number string", () => {
    const plan = structuredClone(authoredPlan("Rhino"));
    if (!plan) return;
    plan.groups[2].rows[0].qty = "a few";
    expect(validatePlan(plan)).toContain(
      "groups[2].rows[0].qty must be a grouped number string or null",
    );
  });

  it("takes both alt forms", () => {
    expect(authoredPlan("Cyte-09")?.groups[1].rows[0].alt).toEqual({
      text: "or 20,000 standing at Amir",
      spends: [{ currency: "The Hex standing", amount: "20,000" }],
    });
    expect(authoredPlan("Kullervo")?.groups[1].rows[2].alt).toBe("or 1 per Undercroft side portal");
  });

  it("rejects an offer alt with a broken amount", () => {
    const plan = structuredClone(authoredPlan("Cyte-09"));
    if (!plan) return;
    plan.groups[1].rows[0].alt = {
      text: "or 20,000 standing at Amir",
      spends: [{ currency: "The Hex standing", amount: "twenty thousand" }],
    };
    expect(validatePlan(plan)).toEqual([
      "groups[1].rows[0].alt.spends[0].amount must be a grouped number string",
    ]);
  });

  it("rates only the items it has a plan for", () => {
    expect(planRating("Rhino")).toEqual({
      effort: 3,
      badge: { text: "Circuit in 3w", tone: "circuit" },
    });
    expect(planRating("hound")).toMatchObject({ effort: 8 });
    expect(planRating("Excalibur")).toEqual({ effort: null, badge: null });
  });
});
