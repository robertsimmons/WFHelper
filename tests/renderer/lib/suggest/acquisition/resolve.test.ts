import { describe, expect, it } from "vitest";

import { resolveAcquisition } from "../../../../../src/lib/suggest/acquisition/index.js";
import {
  inventory,
  itemDb,
  LITH_M1,
  MAG,
  MAG_BP,
  MAG_CHASSIS,
  MAG_NEURO,
  MAG_SYSTEMS,
  MAGP_NEURO,
  OROKIN_CELL,
  relicDb,
} from "./fixtures.js";
import type {
  AcquisitionContext,
  AcquisitionTarget,
} from "../../../../../src/lib/suggest/acquisition/types.js";

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

  it("surfaces a supplied power rank over the shipped overframe tier", () => {
    const targets = resolveAcquisition(context({ ratings: { Volt: { rank: "Z" } } }));
    expect(find(targets, "Volt").rank).toBe("Z");
    expect(find(targets, "Mag").rank).toMatch(/^[SABCD]$/);
    expect(find(targets, "Mag Prime").rank).toBe(find(targets, "Mag").rank);
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
