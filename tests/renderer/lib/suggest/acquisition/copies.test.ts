// How many builds a frame's plan is sized for. The item database is the real
// one, built from the bundled exports, and the plan page reads the shipped plan
// files, so every recipe, uniqueName and row label is the game's own.
import { beforeAll, describe, expect, it } from "vitest";

import * as itemDatabase from "../../../../../services/itemDatabase";
import {
  visibleRows,
  withRowOverrides,
} from "../../../../../src/components/nextup/plan/planResolution.js";
import { resolveAcquisition } from "../../../../../src/lib/suggest/acquisition/index.js";
import { resolvePlanFor } from "../../../../../src/lib/suggest/acquisition/plan/index.js";
import {
  acquisitionStatuses,
  partsRead,
} from "../../../../../src/lib/suggest/providers/acquisition.js";
import type {
  AcquisitionTarget,
  PartState,
} from "../../../../../src/lib/suggest/acquisition/types.js";
import type {
  ResolvedPlan,
  ResolvedRow,
} from "../../../../../src/lib/suggest/acquisition/plan/index.js";
import type {
  ItemDbEntry,
  MasteryData,
  RawInventoryData,
} from "../../../../../src/types/inventory.js";
import type { ResolvedLedgerEntry } from "../../../../../src/lib/suggest/acquisition/plan/types.js";

const WR = "/Lotus/Types/Recipes/WarframeRecipes";
const NEKROS = "/Lotus/Powersuits/Necro/Necro";
const NEKROS_BP = `${WR}/NecroBlueprint`;
const NEKROS_NEURO = `${WR}/NecroHelmetComponent`;
const NEKROS_NEURO_BP = `${WR}/NecroHelmetBlueprint`;
const NEKROS_CHASSIS = `${WR}/NecroChassisComponent`;
const NEKROS_SYSTEMS = `${WR}/NecroSystemsComponent`;
const NEKROS_PRIME = "/Lotus/Powersuits/Necro/NekrosPrime";
const ODONATA = "/Lotus/Powersuits/Archwing/StandardJetPack/StandardJetPack";
const ODONATA_WINGS =
  "/Lotus/Types/Recipes/ArchwingRecipes/StandardArchwing/StandardArchwingWingsComponent";
const ODONATA_WINGS_BP =
  "/Lotus/Types/Recipes/ArchwingRecipes/StandardArchwing/StandardArchwingWingsBlueprint";
const OROKIN_CELL = "/Lotus/Types/Items/MiscItems/OrokinCell";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 3);

let itemDb: Record<string, ItemDbEntry>;

beforeAll(() => {
  itemDatabase.buildDatabase();
  itemDb = itemDatabase.getRendererLookup() as unknown as Record<string, ItemDbEntry>;
});

interface Held {
  suits?: string[];
  spaceSuits?: string[];
  recipes?: Record<string, number>;
  misc?: Record<string, number>;
  /** Blueprint -> hours until the build is done; a negative number is a build
   *  finished and waiting to be claimed. */
  foundry?: Record<string, number>;
  credits?: number;
}

/** Shaped like the game's inventory.json. A started build keeps its blueprint in
 *  Recipes until it is claimed, and the game has already taken the parts. */
function inventory(held: Held = {}): RawInventoryData {
  const foundry = Object.entries(held.foundry ?? {});
  const recipes = { ...held.recipes };
  for (const [blueprint] of foundry) recipes[blueprint] = (recipes[blueprint] ?? 0) + 1;
  return {
    Suits: (held.suits ?? []).map((ItemType) => ({ ItemType })),
    SpaceSuits: (held.spaceSuits ?? []).map((ItemType) => ({ ItemType })),
    Recipes: Object.entries(recipes).map(([ItemType, ItemCount]) => ({ ItemType, ItemCount })),
    MiscItems: Object.entries(held.misc ?? {}).map(([ItemType, ItemCount]) => ({
      ItemType,
      ItemCount,
    })),
    ...(held.credits === undefined ? {} : { RegularCredits: held.credits }),
    PendingRecipes: foundry.map(([ItemType, hours]) => ({
      ItemType,
      CompletionDate: { $date: { $numberLong: String(NOW + hours * HOUR) } },
    })),
  } as unknown as RawInventoryData;
}

function mastered(...names: string[]): MasteryData {
  const items = names.map((name) => ({ name, status: "mastered" }));
  return { items, stats: {} } as unknown as MasteryData;
}

function target(
  name: string,
  held: RawInventoryData,
  mastery: MasteryData | null = null,
): AcquisitionTarget {
  const match = resolveAcquisition({ itemDb, inventory: held, mastery, only: [name] })[0];
  if (!match) throw new Error(`no target for ${name}`);
  return match;
}

function part(target: AcquisitionTarget, uniqueName: string): PartState {
  const rows = [...(target.parts.main ? [target.parts.main] : []), ...target.parts.components];
  const match = rows.find((row) => row.uniqueName === uniqueName);
  if (!match) throw new Error(`${target.name} has no part ${uniqueName}`);
  return match;
}

/** A row of the shipped plan for the target, resolved the way the pinned plan page does. */
function planRow(target: AcquisitionTarget, held: RawInventoryData, label: string): ResolvedRow {
  const plan = resolvePlanFor(target, { itemDb, inventory: held, now: NOW });
  const row = plan?.groups.flatMap((group) => group.rows).find((entry) => entry.label === label);
  if (!row) throw new Error(`the ${target.name} plan has no row ${label}`);
  return row;
}

function shownOnPlan(target: AcquisitionTarget, held: RawInventoryData, label: string): boolean {
  const plan = resolvePlanFor(target, { itemDb, inventory: held, now: NOW });
  const group = plan?.groups.find((entry) => entry.rows.some((row) => row.label === label));
  return group ? visibleRows(group, false).some((row) => row.label === label) : false;
}

/** One build's worth of everything the Nekros recipe asks for. */
const ONE_SET = {
  recipes: { [NEKROS_BP]: 1 },
  misc: { [NEKROS_NEURO]: 1, [NEKROS_CHASSIS]: 1, [NEKROS_SYSTEMS]: 1, [OROKIN_CELL]: 10 },
};

describe("a frame owing its mastery and its subsume is two builds", () => {
  it("asks for two of every part when the account holds nothing", () => {
    const nekros = target("Nekros", inventory());
    expect(nekros.needs).toEqual(["mastery", "subsume"]);
    expect(nekros.parts.copies).toBe(2);
    for (const uniqueName of [NEKROS_BP, NEKROS_NEURO, NEKROS_CHASSIS, NEKROS_SYSTEMS]) {
      expect(part(nekros, uniqueName)).toMatchObject({ required: 2, owned: 0, missing: 2 });
    }
    expect(partsRead(nekros)).toEqual({ have: 0, need: 8, unitKey: null, ready: false });
    expect(planRow(nekros, inventory(), "Neuroptics Blueprint").qty).toMatchObject({
      required: 2,
      owned: 0,
    });
  });

  it("bills the foundry and the raw materials for both builds", () => {
    const two = target("Nekros", inventory());
    const one = target("Nekros", inventory({ suits: [NEKROS] }));
    expect(two.parts.credits).toBe(one.parts.credits * 2);
    for (const material of one.parts.materials) {
      const doubled = two.parts.materials.find((row) => row.uniqueName === material.uniqueName);
      expect(doubled?.required).toBe(material.required * 2);
    }
  });

  it("still asks for a second set once one full set is held, and calls the first ready", () => {
    const held = inventory(ONE_SET);
    const nekros = target("Nekros", held);
    expect(nekros.parts.missing.map((row) => row.uniqueName)).toEqual([
      NEKROS_BP,
      NEKROS_NEURO,
      NEKROS_CHASSIS,
      NEKROS_SYSTEMS,
    ]);
    expect(part(nekros, NEKROS_NEURO)).toMatchObject({ required: 2, owned: 1, missing: 1 });
    expect(partsRead(nekros)).toEqual({ have: 4, need: 8, unitKey: null, ready: true });
  });

  it("keeps a part row and its drop source on the plan at one of two", () => {
    const held = inventory(ONE_SET);
    const nekros = target("Nekros", held);
    const row = planRow(nekros, held, "Neuroptics Blueprint");
    expect(row.qty).toMatchObject({ required: 2, owned: 1, remaining: 1 });
    expect(row.done).toBe(false);
    expect(shownOnPlan(nekros, held, "Neuroptics Blueprint")).toBe(true);
  });

  it("leaves the mastery and subsume chips meaning what they meant", () => {
    expect(acquisitionStatuses(target("Nekros", inventory(ONE_SET)))).toEqual([
      { win: "mastery", done: false },
      { win: "subsume", done: false },
    ]);
  });
});

describe("a frame already in the foundry has claimed one of the builds", () => {
  it("plans one more build while the frame is still building", () => {
    const held = inventory({ foundry: { [NEKROS_BP]: 20 } });
    const nekros = target("Nekros", held);
    expect(nekros.needs).toEqual(["mastery", "subsume"]);
    expect(nekros.parts.copies).toBe(1);
    expect(part(nekros, NEKROS_BP)).toMatchObject({ required: 1, owned: 0, missing: 1 });
    expect(part(nekros, NEKROS_NEURO)).toMatchObject({ required: 1, owned: 0, missing: 1 });
    expect(partsRead(nekros)).toMatchObject({ have: 0, need: 4 });
    // One build reads as the authored row, with no count beside it.
    expect(planRow(nekros, held, "Neuroptics Blueprint")).toMatchObject({ qty: null, done: false });
  });

  it("plans one more build while the finished frame waits to be claimed", () => {
    const held = inventory({ foundry: { [NEKROS_BP]: -5 } });
    const nekros = target("Nekros", held);
    expect(nekros.parts.copies).toBe(1);
    expect(part(nekros, NEKROS_CHASSIS)).toMatchObject({ required: 1, owned: 0, missing: 1 });
    expect(partsRead(nekros)).toMatchObject({ have: 0, need: 4 });
  });

  it("does not count the blueprint the running build spent as one still held", () => {
    const held = inventory({ recipes: { [NEKROS_BP]: 1 }, foundry: { [NEKROS_BP]: 20 } });
    const nekros = target("Nekros", held);
    expect(part(nekros, NEKROS_BP)).toMatchObject({ required: 1, owned: 1, missing: 0 });
  });

  it("sizes the plan at one build, as before, when nothing is left to build", () => {
    // Mastered and sold, so only the subsume is open, and the foundry already has it.
    const held = inventory({ foundry: { [NEKROS_BP]: 20, [NEKROS_NEURO_BP]: 5 } });
    const nekros = target("Nekros", held, mastered("Nekros"));
    expect(nekros.needs).toEqual(["subsume"]);
    expect(nekros.parts.copies).toBe(1);
    expect(part(nekros, NEKROS_NEURO)).toMatchObject({ required: 1, owned: 0, building: 0 });
  });
});

describe("a frame owing only one of its two wins is one build", () => {
  it("plans one build for the subsume of a frame the player owns", () => {
    const nekros = target("Nekros", inventory({ suits: [NEKROS] }));
    expect(nekros.needs).toEqual(["subsume"]);
    expect(nekros.parts.copies).toBe(1);
    expect(part(nekros, NEKROS_NEURO)).toMatchObject({ required: 1, missing: 1 });
    expect(partsRead(nekros)).toMatchObject({ have: 0, need: 4 });
  });

  it("plans one build for the subsume of a frame mastered and since sold", () => {
    const nekros = target("Nekros", inventory(), mastered("Nekros"));
    expect(nekros.needs).toEqual(["subsume"]);
    expect(nekros.parts.copies).toBe(1);
  });

  it("hides a part row once the one build has the part", () => {
    const held = inventory({ suits: [NEKROS], misc: { [NEKROS_NEURO]: 1 } });
    const nekros = target("Nekros", held);
    expect(planRow(nekros, held, "Neuroptics Blueprint")).toMatchObject({ done: true });
    expect(shownOnPlan(nekros, held, "Neuroptics Blueprint")).toBe(false);
  });

  it("never leaves mastery open on a subsumed frame, since the Helminth takes only a mastered one", () => {
    const held = { ...inventory(), InfestedFoundry: { ConsumedSuits: [{ s: NEKROS }] } };
    const targets = resolveAcquisition({ itemDb, inventory: held, only: ["Nekros"] });
    expect(targets).toEqual([]);
  });
});

describe("a part in the foundry is held toward the plan, but not in hand for a build", () => {
  it("counts a Neuroptics still building as one of the two the plan needs", () => {
    const held = inventory({
      misc: { [NEKROS_NEURO]: 1 },
      foundry: { [NEKROS_NEURO_BP]: 6 },
    });
    const nekros = target("Nekros", held);
    expect(part(nekros, NEKROS_NEURO)).toMatchObject({
      required: 2,
      owned: 2,
      building: 1,
      missing: 0,
    });
    expect(planRow(nekros, held, "Neuroptics Blueprint")).toMatchObject({
      qty: expect.objectContaining({ required: 2, owned: 2 }),
      done: true,
    });
  });

  it("does not call a build ready while its only Neuroptics is still in the foundry", () => {
    const held = inventory({
      recipes: { [NEKROS_BP]: 1 },
      misc: { [NEKROS_CHASSIS]: 1, [NEKROS_SYSTEMS]: 1, [OROKIN_CELL]: 10 },
      foundry: { [NEKROS_NEURO_BP]: 6 },
    });
    const nekros = target("Nekros", held);
    expect(part(nekros, NEKROS_NEURO)).toMatchObject({ owned: 1, building: 1 });
    expect(nekros.parts.buildable).toBe(false);
    expect(partsRead(nekros)?.ready).toBe(false);
  });

  it("calls the build ready again once the Neuroptics is claimed", () => {
    const held = inventory({
      recipes: { [NEKROS_BP]: 1 },
      misc: { [NEKROS_NEURO]: 1, [NEKROS_CHASSIS]: 1, [NEKROS_SYSTEMS]: 1, [OROKIN_CELL]: 10 },
    });
    expect(partsRead(target("Nekros", held))?.ready).toBe(true);
  });
});

describe("gear the Helminth never takes stays one build", () => {
  it("plans one build of a Prime frame", () => {
    const prime = target("Nekros Prime", inventory());
    expect(prime.needs).toEqual(["mastery"]);
    expect(prime.parts.copies).toBe(1);
    expect(prime.parts.components.every((row) => row.required === 1)).toBe(true);
    expect(partsRead(prime)).toMatchObject({ have: 0, need: 4 });
    expect(prime.uniqueName).toBe(NEKROS_PRIME);
  });

  it("plans one build of an Archwing and leaves its foundry out of the count", () => {
    const held = inventory({ foundry: { [ODONATA_WINGS_BP]: 6 } });
    const odonata = target("Odonata", held);
    expect(odonata.uniqueName).toBe(ODONATA);
    expect(odonata.parts.copies).toBe(1);
    expect(part(odonata, ODONATA_WINGS)).toMatchObject({ required: 1, owned: 0, building: 0 });
  });
});

const NEURAL_SENSOR = "/Lotus/Types/Items/MiscItems/NeuralSensor";

const PLASTIDS = "/Lotus/Types/Items/MiscItems/Plastids";
const RHINO_NEURO = `${WR}/RhinoHelmetComponent`;
/** The blueprint the inventory holds for each of a target's built parts. */
function partBlueprints(target: AcquisitionTarget): string[] {
  return target.parts.components.flatMap((part) =>
    Object.keys(itemDb).filter(
      (uniqueName) => itemDb[uniqueName]?.buildsProduct === part.uniqueName,
    ),
  );
}
const DILUTED_THERMIA = "Diluted Thermia";
const LAZULITE_TOROID = "Lazulite Toroid";

function cardMaterial(target: AcquisitionTarget, uniqueName: string): number {
  return target.parts.materials.find((row) => row.uniqueName === uniqueName)?.required ?? 0;
}

function resolved(target: AcquisitionTarget, held: RawInventoryData): ResolvedPlan {
  const plan = resolvePlanFor(target, { itemDb, inventory: held, now: NOW });
  if (!plan) throw new Error(`no plan for ${target.name}`);
  return plan;
}

function ledger(plan: ResolvedPlan, currency: string): ResolvedLedgerEntry {
  const entry = plan.ledger.find((row) => row.currency === currency);
  if (!entry) throw new Error(`the ${plan.name} ledger has no ${currency}`);
  return entry;
}

describe("the plan's material rows say what the card says", () => {
  it("asks for each material the card counts across both builds", () => {
    const nekros = target("Nekros", inventory());
    const one = target("Nekros", inventory({ suits: [NEKROS] }));
    for (const [label, uniqueName] of [
      ["Neural Sensors", NEURAL_SENSOR],
      ["Plastids", PLASTIDS],
      ["Orokin Cell", OROKIN_CELL],
    ] as const) {
      const required = cardMaterial(nekros, uniqueName);
      expect(required).toBe(cardMaterial(one, uniqueName) * 2);
      expect(planRow(nekros, inventory(), label).qty).toMatchObject({ required, owned: 0 });
    }
  });

  it("asks for the card's figure at one build too, not the authored one", () => {
    const held = inventory({ suits: [NEKROS] });
    const nekros = target("Nekros", held);
    expect(planRow(nekros, held, "Plastids").qty).toMatchObject({
      required: cardMaterial(nekros, PLASTIDS),
    });
  });

  it("drops the materials a built part already used", () => {
    const held = inventory({ misc: { [NEKROS_NEURO]: 1 } });
    const nekros = target("Nekros", held);
    const required = cardMaterial(nekros, NEURAL_SENSOR);
    expect(required).toBe(cardMaterial(target("Nekros", inventory()), NEURAL_SENSOR) / 2);
    expect(planRow(nekros, held, "Neural Sensors").qty).toMatchObject({ required });
  });

  it("drops a material row once every part that used it is built or building", () => {
    const held = inventory({ misc: { [NEKROS_NEURO]: 1 }, foundry: { [NEKROS_NEURO_BP]: 6 } });
    const nekros = target("Nekros", held);
    expect(cardMaterial(nekros, NEURAL_SENSOR)).toBe(0);
    const labels = resolved(nekros, held).groups.flatMap((group) => group.rows.map((r) => r.label));
    expect(labels).not.toContain("Neural Sensors");
  });

  it("counts a held material against the two-build requirement", () => {
    const held = inventory({ misc: { [NEURAL_SENSOR]: 1 } });
    const nekros = target("Nekros", held);
    const row = planRow(nekros, held, "Neural Sensors");
    expect(row.qty).toMatchObject({ required: 2, owned: 1, remaining: 1 });
    expect(row.done).toBe(false);
    expect(shownOnPlan(nekros, held, "Neural Sensors")).toBe(true);
  });

  it("doubles the Credits row with two builds", () => {
    const held = inventory({ credits: 150_000 });
    const rhino = target("Rhino", held);
    expect(rhino.parts.copies).toBe(2);
    expect(planRow(rhino, held, "Credits")).toMatchObject({
      qty: expect.objectContaining({ required: 210_000, owned: 150_000, remaining: 60_000 }),
      done: false,
    });
  });

  it("takes the foundry fee of a built part off the Credits row, as the card does", () => {
    const empty = target("Rhino", inventory({ credits: 0 }));
    const held = inventory({ credits: 0, misc: { [RHINO_NEURO]: 1 } });
    const rhino = target("Rhino", held);
    const paid = empty.parts.credits - rhino.parts.credits;
    expect(paid).toBeGreaterThan(0);
    expect(planRow(rhino, held, "Credits").qty).toMatchObject({ required: 210_000 - paid });
  });
});

describe("the plan's currency ledger is sized for every build", () => {
  it("doubles a farm's spend and what it banks with two builds", () => {
    const hildryn = target("Hildryn", inventory());
    expect(hildryn.parts.copies).toBe(2);
    const plan = resolved(hildryn, inventory());
    expect(ledger(plan, DILUTED_THERMIA)).toMatchObject({ spent: 12, outstanding: 12 });
    const boss = plan.groups.find((group) => group.earns?.currency === LAZULITE_TOROID);
    expect(boss?.spends[0]).toMatchObject({ currency: DILUTED_THERMIA, value: 12 });
    expect(boss?.earns).toMatchObject({ value: 12 });
  });

  it("owes one build's spend once one set of drops is in", () => {
    const blueprints = partBlueprints(target("Hildryn", inventory()));
    expect(blueprints).toHaveLength(3);
    const held = inventory({
      recipes: Object.fromEntries(blueprints.map((uniqueName) => [uniqueName, 1])),
    });
    const plan = resolved(target("Hildryn", held), held);
    expect(ledger(plan, DILUTED_THERMIA)).toMatchObject({ spent: 12, outstanding: 6 });
  });

  it("leaves a one-build ledger at the authored figures", () => {
    const held = inventory({ suits: [target("Hildryn", inventory()).uniqueName] });
    const plan = resolved(target("Hildryn", held), held);
    expect(ledger(plan, DILUTED_THERMIA)).toMatchObject({ spent: 6, outstanding: 6 });
  });
});

describe("a row ticked for this visit settles its share of the ledger", () => {
  it("clears the outstanding spend once every drop row of the farm is ticked", () => {
    const hildryn = target("Hildryn", inventory());
    const plan = resolved(hildryn, inventory());
    const boss = plan.groups.find((group) => group.earns?.currency === LAZULITE_TOROID);
    const ticks = Object.fromEntries((boss?.rows ?? []).map((row) => [row.id, true]));
    const ticked = withRowOverrides(plan, ticks);
    expect(ledger(ticked, DILUTED_THERMIA)).toMatchObject({ spent: 12, outstanding: 0 });
  });

  it("owes the spend again when a ticked row is unticked", () => {
    const hildryn = target("Hildryn", inventory());
    const plan = resolved(hildryn, inventory());
    const boss = plan.groups.find((group) => group.earns?.currency === LAZULITE_TOROID);
    const ids = (boss?.rows ?? []).map((row) => row.id);
    const ticked = withRowOverrides(plan, Object.fromEntries(ids.map((id) => [id, true])));
    const unticked = withRowOverrides(ticked, { [ids[0]]: false });
    expect(ledger(unticked, DILUTED_THERMIA).outstanding).toBe(12);
  });
});

/** The foundry group's own row for a part, as against the source row that drops it. */
function foundryRow(target: AcquisitionTarget, held: RawInventoryData, label: string): ResolvedRow {
  const plan = resolvePlanFor(target, { itemDb, inventory: held, now: NOW });
  const group = plan?.groups.find((entry) => entry.type === "foundry");
  const row = group?.rows.find((entry) => entry.label === label);
  if (!row) throw new Error(`the ${target.name} foundry group has no row ${label}`);
  return row;
}

describe("a foundry row naming a bare part tracks the built part", () => {
  it("ticks the Neuroptics foundry row off a built Neuroptics in the inventory", () => {
    const held = inventory({ suits: [NEKROS], misc: { [NEKROS_NEURO]: 1 } });
    expect(foundryRow(target("Nekros", held), held, "Neuroptics")).toMatchObject({
      manual: false,
      source: "inventory",
      done: true,
    });
  });

  it("leaves the Neuroptics foundry row open while only its blueprint is held", () => {
    const held = inventory({ suits: [NEKROS], recipes: { [NEKROS_NEURO_BP]: 1 } });
    expect(foundryRow(target("Nekros", held), held, "Neuroptics")).toMatchObject({
      manual: false,
      done: false,
    });
  });

  it("asks the Neuroptics foundry row for one per build", () => {
    const held = inventory({ misc: { [NEKROS_NEURO]: 1 } });
    const row = foundryRow(target("Nekros", held), held, "Neuroptics");
    expect(row.qty).toMatchObject({ required: 2, owned: 1, remaining: 1 });
    expect(row.done).toBe(false);
  });

  it("counts a Neuroptics still in the foundry toward its foundry row", () => {
    const held = inventory({ misc: { [NEKROS_NEURO]: 1 }, foundry: { [NEKROS_NEURO_BP]: 6 } });
    const row = foundryRow(target("Nekros", held), held, "Neuroptics");
    expect(row.qty).toMatchObject({ required: 2, owned: 2, remaining: 0 });
    expect(row.done).toBe(true);
  });
});

const EQUINOX = "/Lotus/Powersuits/YinYang/YinYang";
const NIGHT_ASPECT = `${WR}/AnimaComponent`;
const NIGHT_ASPECT_BP = `${WR}/AnimaBlueprint`;
const NIGHT_NEURO = `${WR}/AnimaHelmetComponent`;
const NIGHT_NEURO_BP = `${WR}/AnimaHelmetBlueprint`;

describe("a part inside an Equinox Aspect is sized from the Aspects still to build", () => {
  it("reads one Night Neuroptics Blueprint as one of two on a two-build plan", () => {
    const held = inventory({ recipes: { [NIGHT_NEURO_BP]: 1 } });
    const equinox = target("Equinox", held);
    expect(equinox.uniqueName).toBe(EQUINOX);
    expect(equinox.parts.copies).toBe(2);
    const row = planRow(equinox, held, "Night Neuroptics Blueprint");
    expect(row.qty).toMatchObject({ required: 2, owned: 1, remaining: 1 });
    expect(row.done).toBe(false);
    expect(shownOnPlan(equinox, held, "Night Neuroptics Blueprint")).toBe(true);
    expect(foundryRow(equinox, held, "Night Neuroptics").qty).toMatchObject({
      required: 2,
      owned: 0,
    });
  });

  it("counts a built Night Neuroptics toward its blueprint row", () => {
    const held = inventory({ recipes: { [NIGHT_NEURO_BP]: 1 }, misc: { [NIGHT_NEURO]: 1 } });
    const row = planRow(target("Equinox", held), held, "Night Neuroptics Blueprint");
    expect(row.qty).toMatchObject({ required: 2, owned: 2 });
    expect(row.done).toBe(true);
  });

  it("needs the Night Aspect's parts only for the Aspect still to build once one is built", () => {
    const held = inventory({ misc: { [NIGHT_ASPECT]: 1 } });
    const equinox = target("Equinox", held);
    expect(part(equinox, NIGHT_ASPECT)).toMatchObject({ required: 2, owned: 1, missing: 1 });
    expect(planRow(equinox, held, "Night Neuroptics Blueprint").qty).toMatchObject({
      required: 1,
      owned: 0,
    });
    expect(foundryRow(equinox, held, "Night Neuroptics").qty).toMatchObject({ required: 1 });
    expect(foundryRow(equinox, held, "Night Aspect").qty).toMatchObject({ required: 2, owned: 1 });
  });

  it("needs the Night Aspect's parts only for the Aspect still to build while one is building", () => {
    const held = inventory({ foundry: { [NIGHT_ASPECT_BP]: 10 } });
    const equinox = target("Equinox", held);
    expect(part(equinox, NIGHT_ASPECT)).toMatchObject({ required: 2, owned: 1, building: 1 });
    expect(planRow(equinox, held, "Night Neuroptics Blueprint").qty).toMatchObject({
      required: 1,
      owned: 0,
    });
    expect(foundryRow(equinox, held, "Night Neuroptics").qty).toMatchObject({ required: 1 });
  });

  it("settles every Night Aspect part once both Night Aspects are built", () => {
    const held = inventory({ misc: { [NIGHT_ASPECT]: 2 } });
    const equinox = target("Equinox", held);
    expect(planRow(equinox, held, "Night Neuroptics Blueprint")).toMatchObject({ done: true });
    expect(shownOnPlan(equinox, held, "Night Neuroptics Blueprint")).toBe(false);
  });
});
