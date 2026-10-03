import { describe, expect, it } from "vitest";

import { resources, rhinoPlan } from "./fixtures.js";
import { planGroup } from "../../../../../../src/lib/suggest/acquisition/plan/materials.js";
import {
  authoredPlan,
  authoredPlans,
  planRating,
  validatePlan,
} from "../../../../../../src/lib/suggest/acquisition/plan/index.js";
import type { AuthoredPlan } from "../../../../../../src/lib/suggest/acquisition/plan/index.js";
import type {
  PlanGroup,
  PlanRow,
} from "../../../../../../src/lib/suggest/acquisition/plan/schema.js";

describe("validatePlan", () => {
  it("accepts every plan that ships with the app", () => {
    const plans = authoredPlans();
    for (const plan of plans) expect([plan.name, validatePlan(plan)]).toEqual([plan.name, []]);
  });

  it("names the field that is wrong", () => {
    const plan = rhinoPlan();
    (plan.groups[1] as { type: string }).type = "shopping";
    expect(validatePlan(plan, resources())).toEqual(["groups[1].type is not a plan group type"]);
  });

  it("rejects a quantity that is not a number string", () => {
    const plan = rhinoPlan();
    plan.groups[2].rows[0].qty = "a few";
    expect(validatePlan(plan, resources())).toContain(
      "groups[2].rows[0].qty must be a grouped number string or null",
    );
  });

  it("takes both alt forms", () => {
    expect(authoredPlan("Cyte-09")?.groups[1].rows[0].alt).toEqual({
      text: "or 20,000 standing at Amir",
      spends: [{ currency: "The Hex Standing", amount: "20,000" }],
    });
    expect(authoredPlan("Artax")?.groups[1].rows[0].alt).toBe(
      "free from the Venus Junction task Upgrade Dreamer's Bond Mod",
    );
  });

  it("rejects an offer alt with a broken amount", () => {
    const plan = structuredClone(authoredPlan("Cyte-09"));
    if (!plan) return;
    plan.groups[1].rows[0].alt = {
      text: "or 20,000 standing at Amir",
      spends: [{ currency: "The Hex Standing", amount: "twenty thousand" }],
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
    expect(planRating("Not A Real Item")).toEqual({ effort: null, badge: null });
  });
});

describe("validatePlan against the resource store", () => {
  /** Rhino with one farm group, holding a row the fixture store does not name. */
  function rhino(): AuthoredPlan {
    const plan = rhinoPlan();
    delete plan.materials;
    const neurodes = { qty: "2", label: "Neurodes", note: null, alt: null, done: false };
    plan.groups.splice(2, 0, planGroup("farm", "SEDNA", [neurodes]));
    return plan;
  }

  function farmIndex(plan: AuthoredPlan): number {
    return plan.groups.findIndex((group) => group.type === "farm");
  }

  it("accepts materials the store names", () => {
    const plan = rhino();
    plan.materials = [{ qty: "1,200", label: "Polymer Bundle", note: null }];
    expect(validatePlan(plan, resources())).toEqual([]);
  });

  it("rejects a material the store does not name", () => {
    const plan = rhino();
    plan.materials = [{ qty: "5", label: "Mystery Goo", note: null }];
    expect(validatePlan(plan, resources())).toEqual([
      'materials[0].label "Mystery Goo" is not in the resource store',
    ]);
  });

  it("rejects a hand-written farm row for a curated resource", () => {
    const plan = rhino();
    const index = farmIndex(plan);
    plan.groups[index].rows[0].label = "Rubedo";
    expect(validatePlan(plan, resources())).toEqual([
      `groups[${index}].rows[0] "Rubedo" is a curated resource; list it in materials`,
    ]);
  });

  it("leaves a farm row for an uncurated entry alone", () => {
    const plan = rhino();
    plan.groups[farmIndex(plan)].rows[0].label = "Polymer Bundle";
    expect(validatePlan(plan, resources())).toEqual([]);
  });

  it("rejects a ref the store does not name", () => {
    const plan = rhino();
    plan.groups[0].ref = "Simaris Standing";
    expect(validatePlan(plan, resources())).toEqual([]);
    plan.groups[0].ref = "Nobody Standing";
    expect(validatePlan(plan, resources())).toEqual([
      'groups[0].ref "Nobody Standing" is not in the resource store',
    ]);
  });

  it("rejects a curated row in every material group type, plurals included", () => {
    const plan = rhino();
    plan.groups[1].rows[0].label = "Rubedo";
    plan.groups[0].rows.push(row("Alloy Plates"));
    plan.groups.push(planGroup("craft", "FOUNDRY", [row("Cetus Wisp Lens", "2")]));
    expect(validatePlan(plan, resources())).toEqual([
      'groups[0].rows[1] "Alloy Plates" is a curated resource; list it in materials',
      'groups[1].rows[0] "Rubedo" is a curated resource; list it in materials',
      'groups[4].rows[0] "Cetus Wisp Lens" is a curated resource; list it in materials',
    ]);
  });

  it("keeps a row naming the item itself or one of its parts", () => {
    const plan = rhino();
    plan.name = "Veridos";
    plan.groups[3].rows[0].label = "Veridos";
    plan.groups[1].rows[0].label = "Veridos Lens";
    expect(validatePlan(plan, resources())).toEqual([]);
  });

  it("keeps a rank-up sacrifice row in a currency group", () => {
    const plan = rhino();
    plan.groups.push(currencyGroup([row("Rubedo", "500")], "Simaris Standing"));
    expect(validatePlan(plan, resources())).toEqual([]);
  });

  it("requires a ref on a currency group", () => {
    const plan = rhino();
    plan.groups.push(currencyGroup([row("Rank 1")], null));
    expect(validatePlan(plan, resources())).toEqual([
      "groups[4].ref must name the store entry for its currency",
    ]);
  });

  it("requires every earned and spent currency to be a store key spelled as stored", () => {
    const plan = rhino();
    const group = currencyGroup([row("Rank 1")], "Simaris Standing");
    group.earns = { currency: "simaris standing", amount: "5,000" };
    group.spends = [
      { currency: "Nobody Standing", amount: "1" },
      { currency: "Höllars", amount: "10,000" },
    ];
    group.rows[0].alt = { text: "or buy it", spends: [{ currency: "Platinum", amount: "20" }] };
    plan.groups.push(group);
    expect(validatePlan(plan, resources())).toEqual([
      'groups[4].earns.currency "simaris standing" must be spelled "Simaris Standing"',
      'groups[4].spends[0].currency "Nobody Standing" is not in the resource store',
      'groups[4].rows[0].alt.spends[0].currency "Platinum" is not in the resource store',
    ]);
  });

  it("accepts an alias spelled as its own key and a material naming it", () => {
    const plan = rhino();
    plan.materials = [{ qty: "10,000", label: "Höllars", note: null }];
    const group = currencyGroup([row("Rank 1")], "Höllars");
    group.spends = [
      { currency: "Höllars", amount: "10,000" },
      { currency: "höllars", amount: "1" },
    ];
    plan.groups.push(group);
    expect(validatePlan(plan, resources())).toEqual([
      'groups[4].spends[1].currency "höllars" must be spelled "Höllars"',
    ]);
  });

  it("rejects an alias whose target is missing", () => {
    const plan = rhino();
    plan.materials = [{ qty: "1", label: "Ghost", note: null }];
    expect(validatePlan(plan, resources())).toEqual([
      'materials[0].label "Ghost" is not in the resource store',
    ]);
  });
});

function row(label: string, qty: string | null = null): PlanRow {
  return { qty, label, note: null, alt: null, done: false };
}

function currencyGroup(rows: PlanRow[], ref: string | null): PlanGroup {
  return planGroup("currency", "SANCTUARY, RELAY", rows, {
    earns: { currency: "Simaris Standing", amount: "5,000" },
    ref,
  });
}
