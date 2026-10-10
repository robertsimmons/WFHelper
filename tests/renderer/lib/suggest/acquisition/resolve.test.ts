import { describe, expect, it } from "vitest";

import { resolveAcquisition } from "../../../../../src/lib/suggest/acquisition/index.js";
import { remainingEffort, sortKeys } from "../../../../../src/lib/suggest/acquisition/sort.js";
import {
  BALLA,
  CARRIER,
  CATCHMOON,
  companionDb,
  DORMA_HOUND,
  inventory,
  itemDb,
  LITH_M1,
  MAG,
  MAG_BP,
  MAG_CHASSIS,
  MAG_NEURO,
  MAG_SYSTEMS,
  MAGP_NEURO,
  OLORO_MOA,
  OROKIN_CELL,
  PANZER,
  PARA_MOA,
  RAPLAK_PRISM,
  relicDb,
  RUNWAY,
  SAHASA,
  VOIDRIG,
} from "./fixtures.js";
import type {
  AcquisitionContext,
  AcquisitionTarget,
} from "../../../../../src/lib/suggest/acquisition/types.js";
import type { MasteryData } from "../../../../../src/types/inventory.js";

function context(overrides: Partial<AcquisitionContext> = {}): AcquisitionContext {
  return { itemDb: itemDb(), inventory: null, ...overrides };
}

function find(targets: AcquisitionTarget[], name: string): AcquisitionTarget {
  const match = targets.find((target) => target.name === name);
  if (!match) throw new Error(`no target for ${name}`);
  return match;
}

describe("resolveAcquisition", () => {
  it("wants every frame when nothing is owned", () => {
    const targets = resolveAcquisition(context());
    expect(targets.map((target) => target.name).sort()).toEqual(["Mag", "Mag Prime", "Volt"]);
    for (const target of targets) expect(target.needs).toContain("mastery");
  });

  it("skips exalted rows that share the powersuit path", () => {
    const names = resolveAcquisition(context()).map((target) => target.name);
    expect(names).not.toContain("Exalted Blade");
  });

  it("counts the main blueprint apart from the component blueprints", () => {
    const mag = find(resolveAcquisition(context()), "Mag");
    expect(mag.parts.known).toBe(true);
    expect(mag.parts.main?.name).toBe("Mag Blueprint");
    expect(mag.parts.main?.role).toBe("main");
    expect(mag.parts.components.map((part) => part.name)).toEqual([
      "Mag Neuroptics",
      "Mag Chassis",
      "Mag Systems",
    ]);
    expect(mag.parts.missing).toHaveLength(4);
    expect(mag.parts.buildable).toBe(false);
  });

  it("bills the foundry credits and the raw materials of every build still owed", () => {
    const mag = find(resolveAcquisition(context()), "Mag");
    expect(mag.parts.copies).toBe(2);
    expect(mag.parts.credits).toBe(50_000);
    expect(mag.parts.materials.map((row) => row.name)).toEqual(["Orokin Cell"]);
    expect(mag.parts.materials[0]).toMatchObject({ required: 2, owned: 0, missing: 2 });
  });

  // An owned Mag owes only its subsume, so these plans are one build.
  it("keeps owned parts out of the missing list", () => {
    const ctx = context({
      inventory: inventory({ suits: [MAG], recipes: { [MAG_BP]: 1 }, misc: { [MAG_NEURO]: 1 } }),
    });
    const mag = find(resolveAcquisition(ctx), "Mag");
    expect(mag.parts.main?.owned).toBe(1);
    expect(mag.parts.missing.map((part) => part.name)).toEqual(["Mag Chassis", "Mag Systems"]);
  });

  it("reports a build that is ready for the foundry", () => {
    const ctx = context({
      inventory: inventory({
        suits: [MAG],
        recipes: { [MAG_BP]: 1 },
        misc: { [MAG_NEURO]: 1, [MAG_CHASSIS]: 1, [MAG_SYSTEMS]: 1, [OROKIN_CELL]: 5 },
      }),
    });
    const mag = find(resolveAcquisition(ctx), "Mag");
    expect(mag.parts.missing).toHaveLength(0);
    expect(mag.parts.buildable).toBe(true);
    expect(mag.paths).toHaveLength(0);
    expect(mag.effort).toBe(1);
  });

  it("keeps farming a frame that is owned but not yet subsumed", () => {
    const targets = resolveAcquisition(context({ inventory: inventory({ suits: [MAG] }) }));
    const mag = find(targets, "Mag");
    expect(mag.needs).toEqual(["subsume"]);
    expect(mag.parts.missing).toHaveLength(4);
    expect(mag.paths.length).toBeGreaterThan(0);
  });

  it("drops a frame that is both owned and subsumed", () => {
    const ctx = context({ inventory: inventory({ suits: [MAG], subsumed: [MAG] }) });
    expect(resolveAcquisition(ctx).map((target) => target.name)).not.toContain("Mag");
  });

  it("treats a subsumed frame as owned even though the game consumed it", () => {
    const ctx = context({ inventory: inventory({ subsumed: [MAG] }) });
    expect(resolveAcquisition(ctx).map((target) => target.name)).not.toContain("Mag");
  });

  it("never asks a Prime for a subsume", () => {
    const ctx = context({ inventory: inventory({ suits: ["/Lotus/Powersuits/Mag/MagPrime"] }) });
    expect(resolveAcquisition(ctx).map((target) => target.name)).not.toContain("Mag Prime");
  });

  it("narrows the sweep to the named frames", () => {
    const targets = resolveAcquisition(context({ only: ["Volt"] }));
    expect(targets.map((target) => target.name)).toEqual(["Volt"]);
  });

  it("spends one spare part on one frame only", () => {
    const ctx = context({ inventory: inventory({ misc: { [MAGP_NEURO]: 1 } }) });
    const prime = find(resolveAcquisition(ctx), "Mag Prime");
    expect(prime.parts.components[0]).toMatchObject({ owned: 1, missing: 0 });
  });

  it("carries the curated difficulty word and the item DB wiki link", () => {
    const targets = resolveAcquisition(context());
    expect(find(targets, "Volt").difficulty).toBe("easy");
    expect(find(targets, "Mag").difficulty).toBe("normal");
    expect(find(targets, "Mag").wiki).toBe("https://wiki.test/Mag");
    expect(find(targets, "Mag Prime").difficulty).toBeNull();
  });

  it("surfaces a supplied power tier over the shipped overframe tier", () => {
    const targets = resolveAcquisition(context({ ratings: { Volt: { rank: "Z" } } }));
    expect(find(targets, "Volt").tier).toBe("Z");
    expect(find(targets, "Mag").tier).toMatch(/^[SABCD]$/);
    expect(find(targets, "Mag Prime").tier).toBe(find(targets, "Mag").tier);
  });

  it("counts the relics the player already holds for a Prime", () => {
    const ctx = context({
      inventory: inventory({ misc: { [LITH_M1]: 3 } }),
      relicDb: relicDb(),
    });
    const relics = find(resolveAcquisition(ctx), "Mag Prime").paths.find(
      (path) => path.kind === "relics",
    );
    expect(relics?.cost.relics).toMatchObject({ known: true, held: 3, needed: 2 });
    expect(relics?.cost.relics?.rows).toEqual([
      { relic: "Lith M1", part: "Mag Prime Neuroptics", held: 3 },
    ]);
  });

  it("still offers the relic path with no relics held", () => {
    const ctx = context({ relicDb: relicDb() });
    const relics = find(resolveAcquisition(ctx), "Mag Prime").paths.find(
      (path) => path.kind === "relics",
    );
    expect(relics?.cost.relics).toMatchObject({ known: true, held: 0 });
  });

  it("marks relic counts unknown when no relic database was handed over", () => {
    const relics = find(resolveAcquisition(context()), "Mag Prime").paths.find(
      (path) => path.kind === "relics",
    );
    expect(relics?.cost.relics).toMatchObject({ known: false, held: 0, needed: 2 });
  });

  it("offers no relic path for a non-Prime", () => {
    const mag = find(resolveAcquisition(context({ relicDb: relicDb() })), "Mag");
    expect(mag.paths.some((path) => path.kind === "relics")).toBe(false);
  });

  it("ranks the easiest frame first", () => {
    const targets = resolveAcquisition(context());
    expect(targets[0].name).toBe("Volt");
    expect(targets[0].paths[0].kind).toBe("lab");
    expect(find(targets, "Mag").paths[0].kind).toBe("boss");
  });

  it("leaves the augment mods parked under a frame's path out of it", () => {
    const db = itemDb();
    db["/Lotus/Powersuits/Trinity/LinkAugmentCard"] = { name: "Abating Link", category: "Mod" };
    expect(resolveAcquisition(context({ itemDb: db })).map((target) => target.name)).not.toContain(
      "Abating Link",
    );
  });

  it("survives an empty item database", () => {
    expect(resolveAcquisition({ itemDb: {}, inventory: null })).toEqual([]);
  });

  it("survives an inventory the reader never filled in", () => {
    const ctx = context({ inventory: {} as never, ratings: undefined, relicDb: null, plat: null });
    expect(resolveAcquisition(ctx)).toHaveLength(3);
  });
});

describe("resolveAcquisition beyond frames and weapons", () => {
  function companions(overrides: Partial<AcquisitionContext> = {}): AcquisitionTarget[] {
    return resolveAcquisition({ itemDb: companionDb(), inventory: null, ...overrides });
  }

  function kindOf(targets: AcquisitionTarget[], name: string): string {
    return find(targets, name).kind;
  }

  it("classes the sentinel, the beasts and the Necramech apart", () => {
    const targets = companions();
    expect(kindOf(targets, "Carrier")).toBe("sentinel");
    expect(kindOf(targets, "Sahasa Kubrow")).toBe("beast");
    expect(kindOf(targets, "Panzer Vulpaphyla")).toBe("beast");
    expect(kindOf(targets, "Voidrig")).toBe("necramech");
    for (const name of ["Carrier", "Sahasa Kubrow", "Voidrig"]) {
      expect(find(targets, name).needs).toEqual(["mastery"]);
    }
  });

  it("walks the recipe of a sentinel the same way it walks a frame's", () => {
    const carrier = find(companions(), "Carrier");
    expect(carrier.parts.known).toBe(true);
    expect(carrier.parts.main?.name).toBe("Carrier Blueprint");
    expect(carrier.weaponClass).toBeNull();
    expect(carrier.modular).toBeNull();
  });

  it("drops a sentinel, a beast or a Necramech already in the account", () => {
    const ctx = {
      inventory: inventory({
        sentinels: [CARRIER],
        kubrowPets: [SAHASA],
        mechSuits: [VOIDRIG],
      }),
    };
    const names = companions(ctx).map((target) => target.name);
    expect(names).not.toContain("Carrier");
    expect(names).not.toContain("Sahasa Kubrow");
    expect(names).not.toContain("Voidrig");
    expect(names).toContain("Panzer Vulpaphyla");
  });

  it("reads a subspecies fitted to a build as owned", () => {
    const ctx = { inventory: inventory({ modularParts: [PANZER] }) };
    expect(companions(ctx).map((target) => target.name)).not.toContain("Panzer Vulpaphyla");
  });

  it("never returns a Hound model as a secondary weapon", () => {
    const hound = find(companions(), "Dorma Hound");
    expect(hound.kind).toBe("modular");
    expect(hound.weaponClass).toBeNull();
  });

  it("returns one target per Moa and Hound model, and one per other modular gear type", () => {
    const names = companions().map((target) => target.name);
    expect(names).toEqual(expect.arrayContaining(["Oloro Moa", "Para Moa", "Dorma Hound"]));
    expect(names).toContain("Amp");
    expect(names).toContain("K-Drive");
    expect(names).not.toContain("Moa");
    expect(names).not.toContain("Hound");
    expect(names).not.toContain("Runway");
  });

  it("gives an unmastered Moa model its own card off its own plan", () => {
    const lambeo = "/Lotus/Types/Friendly/Pets/MoaPets/MoaPetParts/MoaPetHeadLambeo";
    const db = { ...companionDb(), [lambeo]: { name: "Lambeo Moa", masterable: true } };
    const card = find(resolveAcquisition({ itemDb: db, inventory: null }), "Lambeo Moa");
    expect(card.uniqueName).toBe(lambeo);
    expect(card.modular?.gear).toBe("moa");
    expect(card.modular?.heads.map((head) => head.uniqueName)).toEqual([lambeo]);
    expect(card.modular?.owned).toBe(0);
    expect(card.modular?.headLabelKey).toBe("nextUp.modularHeadModels");
    expect(card.rating).toMatchObject({ planned: true, effort: 4 });
    expect(card.paths[0]).toMatchObject({ id: "plan" });
  });

  it("leaves the parts that are only stats and looks out of the count", () => {
    const targets = companions();
    expect(find(targets, "Amp").modular?.heads.map((head) => head.name)).toEqual(["Raplak Prism"]);
    expect(find(targets, "Oloro Moa").modular?.heads).toHaveLength(1);
    expect(find(targets, "Oloro Moa").modular?.slots.flat()).not.toHaveLength(0);
  });

  it("classes an amp prism the item database never flagged masterable", () => {
    const amp = find(companions(), "Amp");
    expect(amp.kind).toBe("modular");
    expect(amp.modular?.gear).toBe("amp");
  });

  it("gilds everything but the K-Drive", () => {
    const targets = companions();
    expect(find(targets, "Oloro Moa").modular?.requiresGilding).toBe(true);
    expect(find(targets, "Dorma Hound").modular?.requiresGilding).toBe(true);
    expect(find(targets, "Amp").modular?.requiresGilding).toBe(true);
    expect(find(targets, "K-Drive").modular?.requiresGilding).toBe(false);
  });

  it("drops a Moa model whose head part is fitted to a build", () => {
    const ctx = { inventory: inventory({ modularParts: [OLORO_MOA] }) };
    const names = companions(ctx).map((target) => target.name);
    expect(names).not.toContain("Oloro Moa");
    expect(names).toContain("Para Moa");
  });

  it("gives a mastered model no card, even after the build is gone", () => {
    const mastery = { items: [{ name: "Oloro Moa", status: "mastered" }] } as MasteryData;
    const names = companions({ mastery }).map((target) => target.name);
    expect(names).not.toContain("Oloro Moa");
    expect(names).toContain("Para Moa");
  });

  it("drops every model once each head part is banked", () => {
    const ctx = { inventory: inventory({ modularParts: [OLORO_MOA, PARA_MOA, DORMA_HOUND] }) };
    const targets = companions(ctx);
    const gears = targets.map((target) => target.modular?.gear);
    expect(gears).not.toContain("moa");
    expect(gears).not.toContain("hound");
    expect(targets.map((target) => target.name)).toContain("Amp");
  });

  it("narrows the sweep to a single kind", () => {
    const targets = companions({ kinds: ["necramech"] });
    expect(targets.map((target) => target.name)).toEqual(["Voidrig"]);
  });

  it("returns no modular gear at all from an item database that holds none", () => {
    expect(resolveAcquisition({ itemDb: itemDb(), inventory: null }).map((t) => t.modular)).toEqual(
      [null, null, null],
    );
  });

  it("still names the head parts a K-Drive needs no gilding for", () => {
    const board = find(companions(), "K-Drive");
    expect(board.modular?.heads.map((head) => head.uniqueName)).toEqual([RUNWAY]);
    expect(board.modular?.headLabelKey).toBe("nextUp.modularHeadBoards");
    expect(find(companions(), "Amp").modular?.heads[0].uniqueName).toBe(RAPLAK_PRISM);
  });

  it("counts Kitgun chambers from every vendor, and never a grip", () => {
    const kitgun = find(companions(), "Kitgun");
    expect(kitgun.kind).toBe("modular");
    expect(kitgun.modular?.heads.map((head) => head.name)).toEqual(["Catchmoon", "Sporelacer"]);
    expect(kitgun.modular?.headLabelKey).toBe("nextUp.modularHeadChambers");
    expect(kitgun.modular?.requiresGilding).toBe(true);
    expect(companions().map((target) => target.name)).not.toContain("Lovetap");
  });

  it("counts Zaw strikes, never a grip or link, and never a Conclave copy", () => {
    const zaw = find(companions(), "Zaw");
    expect(zaw.modular?.heads.map((head) => head.uniqueName)).toEqual([
      BALLA,
      expect.stringContaining("InfestedTipTwo"),
    ]);
    expect(zaw.modular?.slots.map((slot) => slot.length)).toEqual([1, 1]);
    expect(zaw.modular?.headLabelKey).toBe("nextUp.modularHeadStrikes");
    const names = companions().map((target) => target.name);
    expect(names).not.toContain("Balla");
    expect(names).not.toContain("Peye");
  });

  it("routes a companion no table sources through its plan", () => {
    const carrier = find(companions(), "Carrier");
    expect(carrier.paths[0]).toMatchObject({
      id: "plan",
      kind: "market",
      effort: 0.2,
      steps: [{ kind: "market", where: "MARKET - buy blueprint" }],
    });
    expect(carrier.effort).toBe(0.2);
    expect(find(companions(), "Oloro Moa").paths[0]).toMatchObject({ id: "plan", kind: "vendor" });
  });

  it("sorts a plan with no route by the plan's effort, never as unknown", () => {
    const sahasa = find(companions(), "Sahasa Kubrow");
    expect(sahasa.paths.some((path) => path.id === "plan")).toBe(false);
    expect(remainingEffort(sahasa)).toBe(0.5);
    expect(sortKeys(sahasa, "difficulty")).toEqual([0.5]);
  });

  it("leads a plan's route with its first group that names a grind", () => {
    expect(find(companions(), "Voidrig").paths[0]).toMatchObject({
      id: "plan",
      kind: "mission",
      effort: 0.5,
      steps: [{ where: "CODEX - Heart of Deimos quest" }],
    });
  });

  it("reads a gate-only plan's route off the plan's source", () => {
    const db = companionDb();
    db["/Lotus/Weapons/Tenno/LongGuns/TestZenith/TestZenith"] = {
      name: "Zenith",
      masterable: true,
      productCategory: "LongGuns",
    };
    expect(find(companions({ itemDb: db }), "Zenith").paths[0]).toMatchObject({
      id: "plan",
      kind: "vendor",
      steps: [{ where: "DAILY TRIBUTE, ORBITER - log in until a weapon milestone, then pick it" }],
    });
  });

  it("sweeps Venari, which the item database exports unmasterable", () => {
    const db = companionDb();
    db["/Lotus/Powersuits/Khora/Kavat/KhoraKavatPowerSuit"] = {
      name: "Venari",
      masterable: false,
      productCategory: "SpecialItems",
    };
    db["/Lotus/Powersuits/Khora/Kavat/KhoraPrimeKavatPowerSuit"] = {
      name: "Venari Prime",
      masterable: false,
      productCategory: "SpecialItems",
      isPrime: true,
    };
    const targets = companions({ itemDb: db });
    expect(find(targets, "Venari").kind).toBe("beast");
    expect(find(targets, "Venari").paths[0]?.id).toBe("plan");
    expect(find(targets, "Venari Prime").paths[0]?.id).toBe("plan");
  });

  it("sweeps the Plexus only while the mastery roster lists it unmastered", () => {
    const plexus = { name: "Plexus", uniqueName: "/Lotus/Types/Game/CrewShip/RailjackHarness" };
    const names = (status: string | null): string[] =>
      companions(status ? { mastery: { items: [{ ...plexus, status }] } as MasteryData } : {}).map(
        (target) => target.name,
      );
    expect(names(null)).not.toContain("Plexus");
    expect(names("mastered")).not.toContain("Plexus");
    expect(names("unranked")).toContain("Plexus");
  });

  it("keeps a curated frame's routes off the plan, and sets a vaulted Prime's Varzia route beside its relics", () => {
    const targets = resolveAcquisition(context());
    expect(find(targets, "Mag").paths.some((path) => path.id === "plan")).toBe(false);
    expect(find(targets, "Mag").paths[0].kind).toBe("boss");
    const prime = find(targets, "Mag Prime").paths;
    expect(prime.map((path) => path.id)).toEqual(["relics", "plan"]);
    expect(prime[1].kind).toBe("vendor");
  });

  it("banks a chamber or strike fitted to a built weapon", () => {
    const ctx = { inventory: inventory({ modularParts: [CATCHMOON, BALLA] }) };
    expect(find(companions(ctx), "Kitgun").modular?.owned).toBe(1);
    expect(find(companions(ctx), "Zaw").modular?.owned).toBe(1);
  });
});
