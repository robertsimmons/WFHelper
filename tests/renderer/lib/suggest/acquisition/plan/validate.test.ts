import { describe, expect, it } from "vitest";

import { resources, rhinoPlan } from "./fixtures.js";
import { planGroup } from "../../../../../../src/lib/suggest/acquisition/plan/materials.js";
import {
  authoredPlan,
  authoredPlans,
  planRating,
  planSource,
  validatePlan,
  validateResources,
} from "../../../../../../src/lib/suggest/acquisition/plan/index.js";
import shippedResources from "../../../../../../src/data/suggest/acquisitionPlans/resources.json";
import type { AuthoredPlan } from "../../../../../../src/lib/suggest/acquisition/plan/index.js";
import type {
  PlanGroup,
  PlanRow,
} from "../../../../../../src/lib/suggest/acquisition/plan/schema.js";

describe("validatePlan", () => {
  it("accepts every plan that ships with the app", () => {
    const failures = authoredPlans()
      .map((plan) => [plan.name, validatePlan(plan)] as const)
      .filter(([, problems]) => problems.length > 0);
    expect(failures).toEqual([]);
  });

  it("accepts every resource store entry that ships with the app", () => {
    expect(validateResources(shippedResources)).toEqual([]);
  });

  it("takes only a listed map key, and none on a vendor or gate group", () => {
    const plan = rhinoPlan();
    plan.groups[1].map = "cetus";
    plan.groups[2].map = "cambion-drift";
    plan.groups[2].type = "vendor";
    expect(validatePlan(plan, resources())).toEqual([
      "groups[1].map must be a map key or null",
      "groups[2].map must be null on a vendor group",
    ]);
  });

  it("names the field that is wrong", () => {
    const plan = rhinoPlan();
    (plan.groups[1] as { type: string }).type = "shopping";
    expect(validatePlan(plan, resources())).toEqual(["groups[1].type is not a plan group type"]);
  });

  it("requires a source from the shipped list", () => {
    const missing: Partial<AuthoredPlan> = rhinoPlan();
    delete missing.source;
    expect(validatePlan(missing, resources())).toEqual(["source is not a plan source"]);
    const unknown = { ...rhinoPlan(), source: "farming" };
    expect(validatePlan(unknown, resources())).toEqual(["source is not a plan source"]);
  });

  it("rejects two sets on a route that read the same title, until one has a title", () => {
    const ranks = (title?: string): PlanGroup => ({
      ...rhinoPlan().groups[0],
      place: "RELAY",
      rows: ["Rank 1", "Rank 2"].map((label) => ({
        qty: null,
        label,
        note: null,
        alt: null,
        done: false,
      })),
      ...(title ? { title } : {}),
    });
    const plan = { ...rhinoPlan(), groups: [ranks(), ranks(), ...rhinoPlan().groups] };
    expect(validatePlan(plan, resources())).toEqual([
      "groups[1] reads the same set title as groups[0]; give one a title",
    ]);
    const titled = {
      ...plan,
      groups: [ranks(), ranks("Red Veil rank-ups"), ...rhinoPlan().groups],
    };
    expect(validatePlan(titled, resources())).toEqual([]);
  });

  it("takes sequence only as a boolean", () => {
    expect(validatePlan({ ...rhinoPlan(), sequence: true }, resources())).toEqual([]);
    expect(validatePlan({ ...rhinoPlan(), sequence: "yes" }, resources())).toEqual([
      "sequence must be a boolean",
    ]);
  });

  it("reads an item with no plan as unique", () => {
    expect(planSource("Rhino")).toBe(authoredPlan("Rhino")?.source);
    expect(planSource("Not A Real Item")).toBe("unique");
  });

  it("rejects a quantity that is not a number string", () => {
    const plan = rhinoPlan();
    plan.groups[2].rows[0].qty = "a few";
    expect(validatePlan(plan, resources())).toContain(
      "groups[2].rows[0].qty must be a grouped number string or null",
    );
  });

  it("takes both alt forms", () => {
    const cyte = authoredPlan("Cyte-09");
    const bounty = cyte?.groups.find((group) => group.type === "bounty");
    expect(bounty?.rows[0].alt).toEqual({
      text: "or 20,000 standing at Amir",
      spends: [{ currency: "The Hex Standing", amount: "20,000" }],
    });
    const nekros = authoredPlan("Nekros");
    const market = nekros?.groups.find((group) => group.place === "MARKET");
    expect(market?.rows[0].alt).toBe("or Circuit week 5, tier 10");
  });

  it("rejects an offer alt with a broken amount", () => {
    const plan = structuredClone(authoredPlan("Cyte-09"));
    if (!plan) return;
    const index = plan.groups.findIndex((group) => group.type === "bounty");
    plan.groups[index].rows[0].alt = {
      text: "or 20,000 standing at Amir",
      spends: [{ currency: "The Hex Standing", amount: "twenty thousand" }],
    };
    expect(validatePlan(plan)).toEqual([
      `groups[${index}].rows[0].alt.spends[0].amount must be a grouped number string`,
    ]);
  });

  it("rates only the items it has a plan for", () => {
    expect(planRating("Rhino")).toEqual({
      planned: true,
      effort: 3,
      badge: { text: "Circuit week 2", tone: "circuit" },
    });
    expect(planRating("hound")).toMatchObject({ planned: true, effort: 8 });
    expect(planRating("Not A Real Item")).toEqual({ planned: false, effort: null, badge: null });
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

  it("rejects a price or a syndicate rank written into a note, meta or activity", () => {
    const plan = rhino();
    plan.groups[0].rows[0].note = "reactor, 5,000 standing";
    plan.groups[0].meta = "Solaris United Outworlder";
    plan.groups[1].activity = "buy it for 20 platinum";
    plan.groups[1].rows[1].note = "Doer";
    expect(validatePlan(plan, resources())).toEqual([
      'groups[0].meta writes "Solaris United Outworlder" as text; use the structured fields',
      'groups[0].rows[0].note writes "5,000 standing" as text; use the structured fields',
      'groups[1].activity writes "20 platinum" as text; use the structured fields',
      'groups[1].rows[1].note writes "Doer" as text; use the structured fields',
    ]);
  });

  it("lets a foundry line name its credits and a step name a rank a row carries", () => {
    const plan = rhino();
    plan.groups[3].meta = "12h, 25,000 cr";
    plan.groups[3].rows[0].note = "25,000 cr, the three parts";
    plan.groups[0].activity = "rank Ostron to Rank 2";
    plan.groups[0].rows[0].buy = {
      price: [{ currency: "Credits", amount: "25,000" }],
      rank: { syndicate: "Ostron", level: 2 },
    };
    expect(validatePlan(plan, resources())).toEqual([]);
    plan.groups[0].rows[0].buy.rank = { syndicate: "Ostron", level: 3 };
    expect(validatePlan(plan, resources())).toEqual([
      'groups[0].activity writes "Rank 2" as text; use the structured fields',
    ]);
  });

  it("checks a row's purchase like any other spend", () => {
    const plan = rhino();
    plan.groups[0].rows[0].buy = { price: [{ currency: "Nobody Standing", amount: "1,0" }] };
    plan.groups[1].rows[0].buy = { price: [], reusable: true };
    expect(validatePlan(plan, resources())).toEqual([
      "groups[0].rows[0].buy.price[0].amount must be a grouped number string",
      'groups[0].rows[0].buy.price[0].currency "Nobody Standing" is not in the resource store',
      "groups[1].rows[0].buy needs a price or a rank",
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

describe("validateResources", () => {
  const recipe = [{ qty: 10, label: "Veridos" }];

  it("requires a listed map key on a harvestable entry", () => {
    expect(
      validateResources({
        coverage: {},
        Veridos: { kind: "farm", harvestable: true, map: "plains-of-eidolon" },
        Ferrite: { kind: "farm", harvestable: true, map: null },
        Argon: { kind: "farm", harvestable: false, map: "void" },
        Ghost: { alias: "Veridos" },
      }),
    ).toEqual([
      "Ferrite.map must name a map key when harvestable",
      "Argon.map must be a map key or null",
    ]);
  });

  it("keeps a craft unharvestable and requires its recipe", () => {
    expect(
      validateResources({
        "Marquise Veridos": { kind: "craft", harvestable: false, map: null, recipe },
        "Pyrotic Alloy": { kind: "craft", harvestable: true, map: "orb-vallis", recipe },
        "Esher Devar": { kind: "craft", harvestable: false, map: null, recipe: [] },
      }),
    ).toEqual([
      "Pyrotic Alloy.harvestable must be false on a craft",
      "Esher Devar.recipe must be a non-empty array on a craft",
    ]);
  });

  it("keeps prices and ranks out of a source's text, except a craft's foundry credits", () => {
    const source = { place: "FORTUNA, VENUS", sub: "Smokefinger", how: null };
    expect(
      validateResources({
        Credits: { kind: "currency", harvestable: false, map: null },
        "Solaris United Standing": { kind: "standing", harvestable: false, map: null },
        "Venerdo Alloy": {
          kind: "craft",
          harvestable: false,
          map: null,
          recipe,
          best: {
            ...source,
            activity: "buy the blueprint",
            meta: "20 per craft, 1 minute, 1,000 credits",
            buy: {
              price: [{ currency: "Solaris United Standing", amount: "2,000" }],
              rank: { syndicate: "Solaris United", level: 1 },
              reusable: true,
            },
          },
        },
        "Atmo Systems": {
          kind: "farm",
          harvestable: false,
          map: null,
          best: { ...source, activity: "Buy at Rank 2, Agent", meta: "2,500 standing each" },
          alternates: [
            {
              ...source,
              activity: "buy",
              meta: null,
              buy: { price: [{ currency: "Credit", amount: "1" }] },
            },
          ],
        },
      }),
    ).toEqual([
      'Atmo Systems.best.activity writes "Rank 2" as text; use the structured fields',
      'Atmo Systems.best.meta writes "2,500 standing" as text; use the structured fields',
      'Atmo Systems.alternates[0].buy.price[0].currency "Credit" is not a store spelling',
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
