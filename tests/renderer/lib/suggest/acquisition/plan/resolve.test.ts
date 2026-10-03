import { describe, expect, it } from "vitest";

import {
  building,
  duviri,
  inventory,
  itemDb,
  quests,
  resources,
  rhinoPlan,
  skippedPlan,
} from "./fixtures.js";
import {
  authoredPlan,
  resolvePlan,
} from "../../../../../../src/lib/suggest/acquisition/plan/index.js";
import type {
  AuthoredPlan,
  PlanContext,
  ResolvedGroup,
  ResolvedPlan,
  ResolvedRow,
} from "../../../../../../src/lib/suggest/acquisition/plan/index.js";
import { planGroup } from "../../../../../../src/lib/suggest/acquisition/plan/materials.js";
import type { PlanGroup } from "../../../../../../src/lib/suggest/acquisition/plan/schema.js";

const NOW = Date.parse("2026-01-01T00:00:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function load(name: string): AuthoredPlan {
  const plan = authoredPlan(name);
  if (!plan) throw new Error(`no plan for ${name}`);
  return plan;
}

/** A fixture plan resolves against the fixture store; a shipped one against the
 *  shipped store. */
function resolve(plan: string | AuthoredPlan, overrides: Partial<PlanContext> = {}): ResolvedPlan {
  const fixture = typeof plan !== "string";
  return resolvePlan(fixture ? plan : load(plan), {
    itemDb: itemDb(),
    inventory: inventory(),
    now: NOW,
    ...(fixture ? { resources: resources() } : {}),
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

function byLabel(plan: ResolvedPlan, label: string): ResolvedRow {
  for (const group of plan.groups) {
    const row = group.rows.find((entry) => entry.label === label);
    if (row) return row;
  }
  throw new Error(`no row labelled ${label}`);
}

describe("quantities", () => {
  it("renders what is left, not what the recipe asks for", () => {
    const gabii = byPlace(resolve(rhinoPlan()), "GABII, CERES");
    const alloy = gabii.rows[0];
    expect(alloy.label).toBe("Alloy Plate");
    expect(alloy.qty).toMatchObject({ required: 150, owned: 100, remaining: 50, text: "50" });
    expect(alloy.done).toBe(false);
  });

  it("keeps the full requirement on a row inventory already covers", () => {
    const gabii = byPlace(resolve(rhinoPlan()), "GABII, CERES");
    const circuits = gabii.rows[1];
    expect(circuits.done).toBe(true);
    expect(circuits.source).toBe("inventory");
    expect(circuits.qty).toMatchObject({ remaining: 0, text: "700", requiredText: "700" });
  });

  it("leaves a partly satisfied group outstanding", () => {
    const gabii = byPlace(resolve(rhinoPlan()), "GABII, CERES");
    expect(gabii.done).toBe(false);
    expect(gabii.remaining).toBe(1);
  });
});

describe("done", () => {
  it("recomputes against inventory rather than trusting the file", () => {
    const market = byPlace(resolve(rhinoPlan()), "MARKET");
    const authored = rhinoPlan().groups[0].rows[0];
    expect(authored.done).toBe(true);
    expect(market.rows[0]).toMatchObject({ done: false, source: "inventory", manual: false });
  });

  it("falls back to the authored flag for a row inventory cannot see", () => {
    const fossa = byPlace(resolve(rhinoPlan()), "FOSSA, VENUS");
    expect(fossa.rows[0]).toMatchObject({ label: "Neuroptics", done: false, manual: true });
    expect(fossa.rows[1]).toMatchObject({ label: "Chassis", done: true, source: "authored" });
  });

  it("takes a manual tick on a row inventory cannot see", () => {
    const fossa = byPlace(resolve(rhinoPlan(), { manualDone: ["1:0"] }), "FOSSA, VENUS");
    expect(fossa.rows[0]).toMatchObject({ done: true, source: "manual" });
  });
});

describe("quest gates", () => {
  it("settles a finished quest off the inventory", () => {
    const plan = resolve("Hound", { inventory: quests({ "The War Within": true }) });
    const row = byLabel(plan, "The War Within");
    expect(row).toMatchObject({ done: true, source: "inventory", manual: false });
    expect(row.qty).toBeNull();
  });

  it("keeps a started quest not done and out of the player's hands", () => {
    const plan = resolve("Hound", {
      inventory: quests({ "The War Within": true, "Call of the Tempestarii": false }),
    });
    expect(byLabel(plan, "Call of the Tempestarii")).toMatchObject({
      done: false,
      source: "inventory",
      manual: false,
    });
  });

  it("reads a quest the payload never mentions as unstarted", () => {
    const plan = resolve("Hound", { inventory: quests({ "The War Within": true }) });
    expect(byLabel(plan, "Call of the Tempestarii")).toMatchObject({ done: false, manual: false });
  });

  it("matches a label that spells out the word quest", () => {
    const plan = resolve("Amesha", { inventory: quests({ "The Archwing": true }) });
    expect(byLabel(plan, "The Archwing quest")).toMatchObject({ done: true, manual: false });
  });

  it("matches a quest DE names with a leading The", () => {
    const plan = resolve("Nautilus", { inventory: quests({ "The Rising Tide": true }) });
    expect(byLabel(plan, "Rising Tide")).toMatchObject({ done: true, manual: false });
  });

  it("needs every leg of a chained gate", () => {
    const half = resolve("Qorvex", { inventory: quests({ "Heart of Deimos": true }) });
    expect(byLabel(half, "Heart of Deimos, then The New War")).toMatchObject({
      done: false,
      manual: false,
    });

    const both = resolve("Qorvex", {
      inventory: quests({ "Heart of Deimos": true, "The New War": true }),
    });
    expect(byLabel(both, "Heart of Deimos, then The New War").done).toBe(true);
  });

  it("leaves a gate that names no quest to the player", () => {
    const plan = resolve("Hound", { inventory: quests({ "The War Within": true }) });
    const rank = byLabel(plan, "Mastery Rank 5");
    expect(rank).toMatchObject({ done: true, source: "authored", manual: true });

    const cleared = resolve("Hound", {
      inventory: quests({ "The War Within": true }),
      manualCleared: [rank.id],
    });
    expect(byLabel(cleared, "Mastery Rank 5")).toMatchObject({ done: false, source: "manual" });
  });
});

describe("live state", () => {
  it("gives a foundry group no live block until a build is started", () => {
    const plan = resolve(rhinoPlan());
    for (const group of plan.groups.filter((entry) => entry.type === "foundry")) {
      expect(group.live).toBeNull();
    }
  });

  it("waits only on a build that is actually in the queue", () => {
    const plan = resolve(rhinoPlan(), { inventory: building(NOW + 3 * HOUR) });
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
    const kullervo = structuredClone(load("Kullervo"));
    kullervo.groups.push(
      planGroup(
        "farm",
        "DUVIRI",
        [{ qty: "100", label: "Eevani", note: null, alt: null, done: false }],
        {
          map: "archarbor",
          live: { state: "blocked", text: "Sorrow in 2h 47m" },
        },
      ),
    );
    const plan = resolve(kullervo, { world: duviri("anger", NOW + 47 * MINUTE) });
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
    const vendor = load("Kullervo").groups.findIndex((group) => group.type === "vendor");
    const plan = resolve("Kullervo", { manualDone: [`${vendor}:0`] });
    const bane = plan.ledger.find((entry) => entry.currency === "Kullervo's Bane");
    expect(bane?.outstanding).toBe(27);
  });

  it("renders an unpaired spend as an ordinary cost with no phantom earner", () => {
    const plan = resolve("Hound");
    const entrati = plan.ledger.find((entry) => entry.currency === "Entrati Standing");
    expect(entrati).toMatchObject({ earned: null, spent: 8000, paired: false });
    expect(plan.groups.every((group) => group.earns?.currency !== "Entrati Standing")).toBe(true);
  });

  it("pairs a spent currency the plan lists as a material with that material", () => {
    const plan = resolve("Rauta");
    const bane = plan.ledger.find((entry) => entry.currency === "Kullervo's Bane");
    expect(bane).toMatchObject({ earned: 30, spent: 30, paired: true });
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
        currency: "The Hex Standing",
        earned: null,
        spent: 20000,
        outstanding: 20000,
        paired: false,
      },
    ]);
  });

  it("leaves a plain string alt alone", () => {
    const plan = resolve("Afuris", { altsTaken: ["0:1"] });
    expect(plan.groups[0].rows[1].alt).toEqual({
      text: "one free from the Earth to Venus Junction",
      spends: [],
      taken: true,
    });
    expect(plan.ledger).toEqual([]);
  });
});

describe("skipped groups", () => {
  it("counts as done and stays out of the step count", () => {
    const plan = resolve(skippedPlan());
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
    expect(resolve(rhinoPlan()).progress).toEqual({
      have: 2,
      need: 4,
      unit: "parts",
      ready: false,
      resolved: false,
    });
  });

  it("takes the real count over the authored one", () => {
    const progress = { have: 1, need: 4, unit: "parts", ready: false };
    expect(resolve(rhinoPlan(), { progress }).progress).toEqual({ ...progress, resolved: true });
  });
});

describe("maps", () => {
  it("marks every map link as not ready yet", () => {
    const plan = resolve("Kullervo");
    for (const group of plan.groups) expect(group.mapReady).toBe(false);
  });
});

describe("plan materials", () => {
  function group(type: PlanGroup["type"], place: string, labels: string[]): PlanGroup {
    return {
      type,
      place,
      sub: null,
      activity: null,
      meta: null,
      mode: null,
      live: null,
      skip: null,
      earns: null,
      spends: [],
      map: null,
      rows: labels.map((label) => ({ qty: null, label, note: null, alt: null, done: false })),
      conditions: [],
      bonuses: [],
      disclosures: [],
    };
  }

  function plan(groups: PlanGroup[]): AuthoredPlan {
    return {
      name: "Test Frame",
      kind: "warframe",
      source: "repeat",
      effort: 4,
      tradeable: false,
      progress: { have: 0, need: 4, unit: "parts" },
      badges: [],
      prices: [],
      groups,
      materials: [
        { qty: "150", label: "Alloy Plate", note: null },
        { qty: "2", label: "Cetus Wisp Lens", note: null },
      ],
    };
  }

  function resolveWith(authored: AuthoredPlan, overrides: Partial<PlanContext> = {}): ResolvedPlan {
    return resolvePlan(authored, {
      itemDb: itemDb(),
      inventory: inventory(),
      now: NOW,
      resources: resources(),
      ...overrides,
    });
  }

  const authored = (): AuthoredPlan =>
    plan([
      group("gate", "VOR'S PRIZE", ["Odd Gate Part"]),
      {
        ...group("farm", "SANCTUARY", ["Odd Scan Part"]),
        bonuses: ["Bring a Helios"],
        ref: "Simaris Standing",
      },
      group("foundry", "FOUNDRY", ["Odd Foundry Part"]),
    ]);

  it("carries the plan's source through", () => {
    expect(resolveWith(authored()).source).toBe("repeat");
  });

  it("lands the material groups just ahead of the first build group", () => {
    const resolved = resolveWith(authored());
    expect(resolved.groups.map((entry) => [entry.id, entry.type, entry.place])).toEqual([
      ["0", "gate", "VOR'S PRIZE"],
      ["1", "farm", "SANCTUARY"],
      ["m0", "farm", "GABII, CERES"],
      ["m1", "farm", "ASSUR, URANUS"],
      ["m2", "craft", "CETUS"],
      ["2", "foundry", "FOUNDRY"],
    ]);
  });

  it("appends them when nothing is built", () => {
    const resolved = resolveWith(plan([group("gate", "VOR'S PRIZE", ["Odd Gate Part"])]));
    expect(resolved.groups.map((entry) => entry.id)).toEqual(["0", "m0", "m1", "m2"]);
  });

  it("resolves material rows against inventory like any other row", () => {
    const alloy = byLabel(resolveWith(authored()), "Alloy Plate");
    expect(alloy.qty).toMatchObject({ required: 150, owned: 100, remaining: 50 });
  });

  it("keeps authored row ids where the file put them and keys material rows by label", () => {
    const resolved = resolveWith(authored(), { manualDone: ["2:0", "m:cetus wisp lens"] });
    expect(byLabel(resolved, "Odd Foundry Part")).toMatchObject({ id: "2:0", done: true });
    expect(byLabel(resolved, "Cetus Wisp Lens")).toMatchObject({
      id: "m:cetus wisp lens",
      done: true,
    });
  });

  it("adds the referenced entry's tips to the group's bonuses", () => {
    const sanctuary = byPlace(resolveWith(authored()), "SANCTUARY");
    expect(sanctuary.bonuses).toEqual(["Bring a Helios", "Scan with a Synthesis Scanner"]);
  });
});

describe("credits", () => {
  /** A Höllvania vendor spending Höllars beside a foundry spending Credits, with the
   *  total listed once as a Credits material. */
  function creditsPlan(): AuthoredPlan {
    return {
      name: "Test Gun",
      kind: "primary",
      source: "shop",
      effort: 3,
      tradeable: false,
      progress: { have: 0, need: 1, unit: "blueprint" },
      badges: [],
      prices: [],
      groups: [
        planGroup("vendor", "HÖLLVANIA", [row("Test Gun Blueprint")], {
          spends: [{ currency: "Höllars", amount: "10,000" }],
        }),
        planGroup("foundry", "FOUNDRY", [row("Test Gun")], {
          spends: [{ currency: "Credits", amount: "25,000" }],
        }),
      ],
      materials: [{ qty: "35,000", label: "Credits", note: null }],
    };
  }

  function row(label: string) {
    return { qty: null, label, note: null, alt: null, done: false };
  }

  it("books an alias under its target so the material pairs every spend", () => {
    const plan = resolve(creditsPlan());
    expect(plan.ledger).toEqual([
      { currency: "Credits", earned: 35000, spent: 35000, outstanding: 35000, paired: true },
    ]);
    expect(byPlace(plan, "HÖLLVANIA").spends[0].currency).toBe("Höllars");
  });

  it("ticks the Credits row off the player's balance", () => {
    const short = byLabel(
      resolve(creditsPlan(), { inventory: inventory({ RegularCredits: 20000 }) }),
      "Credits",
    );
    expect(short).toMatchObject({ done: false, source: "inventory" });
    expect(short.qty).toMatchObject({ owned: 20000, remaining: 15000, tracked: true });

    const rich = byLabel(
      resolve(creditsPlan(), { inventory: inventory({ RegularCredits: 50000 }) }),
      "Credits",
    );
    expect(rich).toMatchObject({ done: true, source: "inventory" });
  });

  it("leaves the Credits row to the player when the payload has no balance", () => {
    const row = byLabel(resolve(creditsPlan()), "Credits");
    expect(row).toMatchObject({ done: false, manual: true });
    expect(row.qty?.tracked).toBe(false);
  });
});
