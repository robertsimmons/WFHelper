import { describe, expect, it } from "vitest";

import { resolveAcquisition } from "../../../../../src/lib/suggest/acquisition/index.js";
import {
  CARRIER,
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

  it("bills the foundry credits and the raw materials the build still needs", () => {
    const mag = find(resolveAcquisition(context()), "Mag");
    expect(mag.parts.credits).toBe(25_000);
    expect(mag.parts.materials.map((row) => row.name)).toEqual(["Orokin Cell"]);
    expect(mag.parts.materials[0]).toMatchObject({ required: 1, owned: 0, missing: 1 });
  });

  it("keeps owned parts out of the missing list", () => {
    const ctx = context({
      inventory: inventory({ recipes: { [MAG_BP]: 1 }, misc: { [MAG_NEURO]: 1 } }),
    });
    const mag = find(resolveAcquisition(ctx), "Mag");
    expect(mag.parts.main?.owned).toBe(1);
    expect(mag.parts.missing.map((part) => part.name)).toEqual(["Mag Chassis", "Mag Systems"]);
  });

  it("reports a build that is ready for the foundry", () => {
    const ctx = context({
      inventory: inventory({
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
    expect(targets[0].name).toBe("Mag");
    expect(targets[0].paths[0].kind).toBe("market");
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
    const hound = find(companions(), "Hound");
    expect(hound.kind).toBe("modular");
    expect(companions().map((target) => target.name)).not.toContain("Dorma Hound");
  });

  it("returns one target per modular gear type, not one per head part", () => {
    const names = companions().map((target) => target.name);
    expect(names).toContain("Moa");
    expect(names).toContain("Hound");
    expect(names).toContain("Amp");
    expect(names).toContain("K-Drive");
    expect(names).not.toContain("Oloro Moa");
    expect(names).not.toContain("Runway");
  });

  it("counts the head parts a card reads its progress off", () => {
    const moa = find(companions(), "Moa");
    expect(moa.modular?.gear).toBe("moa");
    expect(moa.modular?.heads.map((head) => head.name)).toEqual(["Oloro Moa", "Para Moa"]);
    expect(moa.modular?.owned).toBe(0);
    expect(moa.modular?.headLabelKey).toBe("nextUp.modularHeadModels");
  });

  it("leaves the parts that are only stats and looks out of the count", () => {
    const targets = companions();
    expect(find(targets, "Amp").modular?.heads.map((head) => head.name)).toEqual(["Raplak Prism"]);
    expect(find(targets, "Moa").modular?.heads).toHaveLength(2);
  });

  it("classes an amp prism the item database never flagged masterable", () => {
    const amp = find(companions(), "Amp");
    expect(amp.kind).toBe("modular");
    expect(amp.modular?.gear).toBe("amp");
  });

  it("gilds everything but the K-Drive", () => {
    const targets = companions();
    expect(find(targets, "Moa").modular?.requiresGilding).toBe(true);
    expect(find(targets, "Hound").modular?.requiresGilding).toBe(true);
    expect(find(targets, "Amp").modular?.requiresGilding).toBe(true);
    expect(find(targets, "K-Drive").modular?.requiresGilding).toBe(false);
  });

  it("banks the mastery of a head part fitted to a build", () => {
    const ctx = { inventory: inventory({ modularParts: [OLORO_MOA] }) };
    const moa = find(companions(ctx), "Moa");
    expect(moa.modular?.owned).toBe(1);
    expect(moa.modular?.heads.find((head) => head.name === "Oloro Moa")?.owned).toBe(true);
  });

  it("keeps banked mastery after the build is gone", () => {
    const mastery = { items: [{ name: "Oloro Moa", status: "mastered" }] } as MasteryData;
    const moa = find(companions({ mastery }), "Moa");
    expect(moa.modular?.owned).toBe(1);
  });

  it("drops a gear type whose every head part is banked", () => {
    const ctx = { inventory: inventory({ modularParts: [OLORO_MOA, PARA_MOA, DORMA_HOUND] }) };
    const names = companions(ctx).map((target) => target.name);
    expect(names).not.toContain("Moa");
    expect(names).not.toContain("Hound");
    expect(names).toContain("Amp");
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
});
