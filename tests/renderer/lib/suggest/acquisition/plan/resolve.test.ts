import { beforeAll, describe, expect, it } from "vitest";

import * as itemDatabase from "../../../../../../services/itemDatabase";
import type { ItemDbEntry, RawInventoryData } from "../../../../../../src/types/inventory.js";

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
  settleRanks,
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
import type { PartPlan } from "../../../../../../src/lib/suggest/acquisition/types.js";
import { buildPartPlans } from "../../../../../../src/lib/suggest/acquisition/parts.js";
import { resourceEntry } from "../../../../../../src/lib/suggest/acquisition/plan/resources.js";
import store from "../../../../../../src/data/suggest/acquisitionPlans/resources.json";

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

function resolveShipped(plan: AuthoredPlan, overrides: Partial<PlanContext> = {}): ResolvedPlan {
  return resolvePlan(plan, { itemDb: itemDb(), inventory: inventory(), now: NOW, ...overrides });
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
    const fossa = byPlace(resolve(rhinoPlan(), { manualDone: ["1:0:neuroptics"] }), "FOSSA, VENUS");
    expect(fossa.rows[0]).toMatchObject({ done: true, source: "manual" });
  });

  it("ignores a stored tick whose row moved or was renamed", () => {
    const stale = ["1:0", "1:0:chassis", "0:0:neuroptics"];
    const fossa = byPlace(resolve(rhinoPlan(), { manualDone: stale }), "FOSSA, VENUS");
    expect(fossa.rows[0]).toMatchObject({ done: false, manual: true });
  });
});

/** Rhino behind a gate group, the shape a gate-sourced plan still ships. */
function gatedPlan(...labels: string[]): AuthoredPlan {
  const base = rhinoPlan();
  const rows = labels.map((label) => ({ qty: null, label, note: null, alt: null, done: false }));
  return { ...base, groups: [planGroup("gate", "QUESTS", rows), ...base.groups] };
}

const HOUND_GATES = gatedPlan("The War Within", "Call of the Tempestarii", "Mastery Rank 5");

describe("quest gates", () => {
  it("settles a finished quest off the inventory", () => {
    const plan = resolve(HOUND_GATES, { inventory: quests({ "The War Within": true }) });
    const row = byLabel(plan, "The War Within");
    expect(row).toMatchObject({ done: true, source: "inventory", manual: false });
    expect(row.qty).toBeNull();
  });

  it("keeps a started quest not done and out of the player's hands", () => {
    const plan = resolve(HOUND_GATES, {
      inventory: quests({ "The War Within": true, "Call of the Tempestarii": false }),
    });
    expect(byLabel(plan, "Call of the Tempestarii")).toMatchObject({
      done: false,
      source: "inventory",
      manual: false,
    });
  });

  it("reads a quest the payload never mentions as unstarted", () => {
    const plan = resolve(HOUND_GATES, { inventory: quests({ "The War Within": true }) });
    expect(byLabel(plan, "Call of the Tempestarii")).toMatchObject({ done: false, manual: false });
  });

  it("matches a label that spells out the word quest", () => {
    const plan = resolve(gatedPlan("The Archwing quest"), {
      inventory: quests({ "The Archwing": true }),
    });
    expect(byLabel(plan, "The Archwing quest")).toMatchObject({ done: true, manual: false });
  });

  it("matches a quest DE names with a leading The", () => {
    const plan = resolve(gatedPlan("Rising Tide"), {
      inventory: quests({ "The Rising Tide": true }),
    });
    expect(byLabel(plan, "Rising Tide")).toMatchObject({ done: true, manual: false });
  });

  it("needs every leg of a chained gate", () => {
    const chained = gatedPlan("Heart of Deimos, then The New War");
    const half = resolve(chained, { inventory: quests({ "Heart of Deimos": true }) });
    expect(byLabel(half, "Heart of Deimos, then The New War")).toMatchObject({
      done: false,
      manual: false,
    });

    const both = resolve(chained, {
      inventory: quests({ "Heart of Deimos": true, "The New War": true }),
    });
    expect(byLabel(both, "Heart of Deimos, then The New War").done).toBe(true);
  });

  it("leaves a gate that names no quest to the player", () => {
    const plan = resolve(HOUND_GATES, { inventory: quests({ "The War Within": true }) });
    const rank = byLabel(plan, "Mastery Rank 5");
    expect(rank).toMatchObject({ done: false, source: "authored", manual: true });

    const ticked = resolve(HOUND_GATES, {
      inventory: quests({ "The War Within": true }),
      manualDone: [rank.id],
    });
    expect(byLabel(ticked, "Mastery Rank 5")).toMatchObject({ done: true, source: "manual" });
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
    const varzia = byPlace(resolve("Venari Prime"), "MAROO'S BAZAAR, MARS");
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
    const plan = resolve("Basmu");
    const tokens = plan.ledger.find((entry) => entry.currency === "Mother Token");
    expect(tokens).toEqual({
      currency: "Mother Token",
      earned: 125,
      spent: 125,
      outstanding: 125,
      paired: true,
    });
    // A row naming the tokens does not stand the flow down: the flow is the count.
    expect(byPlace(plan, "CAMBION DRIFT, DEIMOS").earns).toMatchObject({
      currency: "Mother Token",
      value: 125,
    });
  });

  it("drops what is already bought out of the total still to bank", () => {
    const groups = load("Sheev").groups;
    const vendor = groups.findIndex((group) => group.type === "vendor");
    const label = groups[vendor].rows[0].label.toLowerCase();
    const plan = resolve("Sheev", { manualDone: [`${vendor}:0:${label}`] });
    const tokens = plan.ledger.find((entry) => entry.currency === "Mother Token");
    expect(tokens?.outstanding).toBe(75);
  });

  it("farms a spend nothing earns from the resource store, with no authored earner", () => {
    const hound = structuredClone(load("Hound"));
    hound.groups = hound.groups.filter(
      (group) => !(group.type === "currency" && group.ref === "Entrati Standing"),
    );
    const plan = resolveShipped(hound);
    const entrati = plan.ledger.find((entry) => entry.currency === "Entrati Standing");
    expect(entrati).toMatchObject({ earned: 79000, spent: 79000, paired: true });
    expect(plan.groups.every((group) => group.earns?.currency !== "Entrati Standing")).toBe(true);
    const farm = plan.groups
      .flatMap((group) => group.rows)
      .find((row) => row.label === "Entrati Standing");
    expect(farm?.qty?.required).toBe(79000);
  });

  describe("a spend nothing earns is farmed for every copy the plan builds", () => {
    const sized = (name: string, copies: number): ResolvedPlan =>
      resolvePlan(load(name), { itemDb: itemDb(), inventory: inventory(), now: NOW }, null, {
        uniqueName: name,
        parts: { known: false, copies } as PartPlan,
      });
    const farmed = (plan: ResolvedPlan, currency: string) => ({
      ledger: plan.ledger.find((entry) => entry.currency === currency),
      required: byLabel(plan, currency).qty?.required,
    });

    it.each([
      [1, 19000],
      [2, 22000],
    ])("buys a one-use blueprint again per copy and a reusable one once (%i)", (copies, need) => {
      // Arum Spinosa: Father's barrel blueprints are 3,000 a build; the gem blueprints are 16,000 once.
      const entrati = farmed(sized("Arum Spinosa", copies), "Entrati Standing");
      expect(entrati.ledger).toMatchObject({ earned: need, spent: need, paired: true });
      expect(entrati.required).toBe(need);
    });

    it.each([1, 2])("buys a reusable tool once whatever the copies (%i)", (copies) => {
      const solaris = farmed(sized("Arum Spinosa", copies), "Solaris United Standing");
      expect(solaris.ledger).toMatchObject({ earned: 2500, spent: 2500, paired: true });
      expect(solaris.required).toBe(2500);
    });

    it.each([
      [1, 7500],
      [2, 15000],
    ])("spends a figure the rows do not itemize once per copy (%i)", (copies, need) => {
      const hex = farmed(sized("Coda Hema", copies), "The Hex Standing");
      expect(hex.ledger).toMatchObject({ earned: need, spent: need, paired: true });
      expect(hex.required).toBe(need);
    });
  });

  describe("a material row sized for every copy is paid for once", () => {
    let db: Record<string, ItemDbEntry> = {};

    beforeAll(() => {
      itemDatabase.buildDatabase();
      db = itemDatabase.getRendererLookup() as unknown as Record<string, ItemDbEntry>;
    });

    function carded(name: string, copies: number): ResolvedPlan {
      const uniqueName = Object.keys(db).find((key) => db[key].name === name && db[key].recipe);
      if (!uniqueName) throw new Error(`no ${name} in the item database`);
      const target = { uniqueName, name, entry: db[uniqueName], copies };
      const parts = buildPartPlans([target], db, new Map(), new Map()).get(uniqueName);
      if (!parts?.known) throw new Error(`no part plan for ${name}`);
      return resolvePlan(load(name), { itemDb: db, inventory: {}, now: NOW }, null, {
        uniqueName,
        parts,
      });
    }

    it.each([
      [1, 5, 12500],
      [2, 10, 25000],
    ])("buys Galvacord's Atmo Systems at Little Duck per unit (%i)", (copies, atmo, standing) => {
      const plan = carded("Galvacord", copies);
      const row = byLabel(plan, "Atmo Systems");
      expect(row.qty?.required).toBe(atmo);
      const vox = plan.ledger.find((entry) => entry.currency === "Vox Solaris Standing");
      expect(vox).toMatchObject({ earned: standing, spent: standing, paired: true });
      expect(byLabel(plan, "Vox Solaris Standing").qty?.required).toBe(standing);
      const shop = plan.groups.find((group) => group.rows.includes(row));
      expect(shop?.spends.map((spend) => spend.value)).toEqual([standing]);
    });

    it("marks a bought material blueprint reusable exactly when DE's item data does", () => {
      const reusable = new Map(
        Object.values(db)
          .filter((entry) => entry.name?.endsWith(" Blueprint"))
          .map((entry) => [entry.name, entry.reusableBlueprint === true] as const),
      );
      const disagree = Object.keys(store)
        .map((name) => resourceEntry(name))
        .filter((entry) => entry?.kind === "craft" && entry.best?.buy)
        .filter((entry) => reusable.has(`${entry?.name} Blueprint`))
        .filter(
          (entry) =>
            (entry?.best?.buy?.reusable === true) !== reusable.get(`${entry?.name} Blueprint`),
        )
        .map((entry) => entry?.name);
      expect(disagree).toEqual([]);
    });
  });

  it("pairs a spent currency the plan lists as a material with that material", () => {
    const plan = resolve("Sheev");
    const tokens = plan.ledger.find((entry) => entry.currency === "Mother Token");
    expect(tokens).toMatchObject({ earned: 200, spent: 200, paired: true });
  });

  it("counts a row alt only when that alternative is taken", () => {
    const untaken = resolve("Cyte-09");
    const bounty = untaken.groups.find((group) => group.type === "bounty");
    expect(bounty?.rows[0].alt).toMatchObject({
      text: "or 20,000 standing at Amir",
      taken: false,
    });
    expect(untaken.ledger).toEqual([]);

    const taken = resolve("Cyte-09", { altsTaken: [bounty!.rows[0].id] });
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
    const id = byPlace(resolve("Nekros"), "MARKET").rows[0].id;
    const plan = resolve("Nekros", { altsTaken: [id] });
    expect(byPlace(plan, "MARKET").rows[0].alt).toEqual({
      text: "or Circuit week 5, tier 10",
      spends: [],
      taken: true,
    });
    expect(plan.ledger).toEqual(resolve("Nekros").ledger);
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
  it("marks a map link ready only where a shipped map draws it", () => {
    const plan = resolve("Kullervo");
    const hold = plan.groups.filter((group) => group.map === "kullervos-hold");
    expect(hold.length).toBeGreaterThan(0);
    for (const group of hold) expect(group.mapReady).toBe(true);
    for (const group of plan.groups.filter((entry) => entry.map === null)) {
      expect(group.mapReady).toBe(false);
    }
    for (const group of resolve("AX-52").groups.filter((entry) => entry.map !== null)) {
      expect(group.mapReady).toBe(false);
    }
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
    const resolved = resolveWith(authored(), {
      manualDone: ["2:0:odd foundry part", "m:cetus wisp lens"],
    });
    expect(byLabel(resolved, "Odd Foundry Part")).toMatchObject({
      id: "2:0:odd foundry part",
      done: true,
    });
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
  /** A Hollvania vendor spending Hollars beside a foundry spending Credits, with the
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

/** Fluctus: one part per relay syndicate, each a standing group buying the part and
 *  a rank-up group climbing to rank 3, resolved against the real item database. */
describe("standing purchases", () => {
  const SYNDICATES = {
    "Steel Meridian": { tag: "SteelMeridianSyndicate", part: "Stock" },
    "Red Veil": { tag: "RedVeilSyndicate", part: "Limbs" },
    "Cephalon Suda": { tag: "CephalonSudaSyndicate", part: "Barrel" },
  } as const;
  type Syndicate = keyof typeof SYNDICATES;
  const ALL = Object.keys(SYNDICATES) as Syndicate[];
  let db: Record<string, ItemDbEntry> = {};

  beforeAll(() => {
    itemDatabase.buildDatabase();
    db = itemDatabase.getRendererLookup() as unknown as Record<string, ItemDbEntry>;
  });

  function builtPart(syndicate: Syndicate): string {
    const name = `Fluctus ${SYNDICATES[syndicate].part}`;
    const found = Object.keys(db).find((uniqueName) => db[uniqueName].name === name);
    if (!found) throw new Error(`no ${name} in the item database`);
    return found;
  }

  interface Player {
    titles?: Partial<Record<Syndicate, number>>;
    standing?: Partial<Record<Syndicate, number>>;
    held?: Syndicate[];
  }

  function fluctus({ titles = {}, standing = {}, held = [] }: Player = {}): ResolvedPlan {
    const inventory: RawInventoryData = {
      Affiliations: ALL.map((name) => ({
        Tag: SYNDICATES[name].tag,
        Title: titles[name] ?? 0,
        Standing: standing[name] ?? 0,
      })),
      MiscItems: held.map((name) => ({ ItemType: builtPart(name), ItemCount: 1 })),
    };
    return resolvePlan(load("Fluctus"), { itemDb: db, inventory, now: NOW });
  }

  const earning = (plan: ResolvedPlan, syndicate: Syndicate): ResolvedGroup =>
    plan.groups.find((group) => group.activity === `Earn ${syndicate} Standing`) as ResolvedGroup;
  const ranking = (plan: ResolvedPlan, syndicate: Syndicate): ResolvedGroup =>
    plan.groups.find((group) => group.title === `${syndicate} rank-ups`) as ResolvedGroup;
  const part = (plan: ResolvedPlan, syndicate: Syndicate): ResolvedRow =>
    byLabel(plan, `Fluctus ${SYNDICATES[syndicate].part} Blueprint`);
  const owed = (plan: ResolvedPlan, syndicate: Syndicate): number =>
    plan.ledger.find((entry) => entry.currency === `${syndicate} Standing`)?.outstanding ?? 0;

  it("lists the part each standing group buys", () => {
    const plan = fluctus();
    for (const syndicate of ALL) {
      expect(earning(plan, syndicate).buys).toEqual([part(plan, syndicate).id]);
    }
  });

  it("holds a part behind the top rank its syndicate climbs to while that rank is unmet", () => {
    const plan = fluctus();
    expect(part(plan, "Steel Meridian").purchase).toMatchObject({
      rank: "Defender",
      rankMet: false,
    });
    expect(part(plan, "Cephalon Suda").purchase).toMatchObject({
      rank: "Intelligent",
      rankMet: false,
    });
  });

  it("owes every rank-up and every part while nothing is owned and no rank is met", () => {
    const plan = fluctus();
    for (const syndicate of ALL) {
      expect(ranking(plan, syndicate).done).toBe(false);
      expect(earning(plan, syndicate).done).toBe(false);
      expect(owed(plan, syndicate)).toBe(91_000);
    }
  });

  it("owes only the parts once the ranks are met", () => {
    const plan = fluctus({ titles: { "Steel Meridian": 3, "Red Veil": 3, "Cephalon Suda": 3 } });
    for (const syndicate of ALL) {
      expect(ranking(plan, syndicate).done).toBe(true);
      expect(part(plan, syndicate).purchase?.rankMet).toBe(true);
      expect(earning(plan, syndicate).done).toBe(false);
      expect(owed(plan, syndicate)).toBe(20_000);
    }
  });

  it("settles a syndicate whose part is owned, even hated, and leaves the others open", () => {
    const plan = fluctus({ titles: { "Cephalon Suda": -2 }, held: ["Cephalon Suda"] });
    const suda = ranking(plan, "Cephalon Suda");
    expect(suda.done).toBe(true);
    expect(suda.rows.every((row) => row.done)).toBe(true);
    expect(earning(plan, "Cephalon Suda")).toMatchObject({ done: true, remaining: 0 });
    expect(byLabel(plan, "Initiation").done).toBe(false);
    expect(owed(plan, "Cephalon Suda")).toBe(0);
    expect(owed(plan, "Steel Meridian")).toBe(91_000);
    expect(ranking(plan, "Red Veil").done).toBe(false);
  });

  it("settles every standing group and rank-up once every part is owned", () => {
    const plan = fluctus({ held: ALL });
    for (const syndicate of ALL) {
      expect(ranking(plan, syndicate).done).toBe(true);
      expect(earning(plan, syndicate).done).toBe(true);
      expect(owed(plan, syndicate)).toBe(0);
    }
  });

  it("counts a settled group's unticked rows as done steps", () => {
    const none = fluctus();
    const all = fluctus({ held: ALL });
    expect(all.steps.total).toBe(none.steps.total);
    const open = all.groups.filter((group) => !group.done && group.skip === null);
    const left = open.reduce((sum, group) => sum + group.rows.filter((row) => !row.done).length, 0);
    expect(all.steps.done).toBe(all.steps.total - left);
  });

  it("lists a rank-gated part bought in standing as the standing group's buy", () => {
    const plan = resolvePlan(load("Velocitus"), { itemDb: db, inventory: null, now: NOW });
    const group = earning(plan as ResolvedPlan, "Steel Meridian");
    expect(group.buys).toEqual(["1:3:velocitus receiver blueprint"]);
    expect(group.done).toBe(false);
  });

  it("settles rank-ups listed inside the standing group once the weapon they buy is held", () => {
    const hek = Object.keys(db).find((uniqueName) => db[uniqueName].name === "Vaykor Hek");
    const inventory: RawInventoryData = {
      Affiliations: [{ Tag: "SteelMeridianSyndicate", Title: 0, Standing: 0 }],
      LongGuns: [{ ItemType: hek }],
    } as RawInventoryData;
    const plan = resolvePlan(load("Vaykor Hek"), { itemDb: db, inventory, now: NOW });
    const ranked = plan.groups.flatMap((group) => group.rows).filter((row) => row.unlocks);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.every((row) => row.done)).toBe(true);
    expect(owed(plan, "Steel Meridian")).toBe(0);
  });
});

describe("settling rank-ups", () => {
  const row = (id: string, extra: Partial<ResolvedRow> = {}): ResolvedRow => ({
    id,
    label: id,
    note: null,
    qty: null,
    alt: null,
    done: false,
    source: "authored",
    manual: true,
    ...extra,
  });
  const owned = (id: string, held: boolean): ResolvedRow =>
    row(id, {
      purchase: {
        price: [],
        each: false,
        rank: null,
        rankMet: false,
        blueprint: true,
        reusable: true,
        owned: held,
      },
    });
  const settled = (rows: ResolvedRow[], skip: unknown = null): boolean =>
    settleRanks([
      { skip: null, rows: [row("rank", { unlocks: rows.map((entry) => entry.id) })] },
      { skip, rows },
    ])[0][0].done;

  it("keeps a rank-up open while a purchase it unlocks is neither done nor held", () => {
    expect(settled([owned("a", true), owned("b", false)])).toBe(false);
  });

  it("settles a rank-up once every purchase it unlocks is a held reusable blueprint", () => {
    expect(settled([owned("a", true), owned("b", true)])).toBe(true);
  });

  it("settles a rank-up once every purchase it unlocks is done", () => {
    expect(settled([row("a", { done: true }), owned("b", true)])).toBe(true);
  });

  it("settles a rank-up whose purchases sit in a skipped group", () => {
    expect(settled([owned("a", false)], { reason: "quest done" })).toBe(true);
  });
});
