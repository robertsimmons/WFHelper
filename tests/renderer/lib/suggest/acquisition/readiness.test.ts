import { describe, expect, it } from "vitest";

import { resolveAcquisition } from "../../../../../src/lib/suggest/acquisition/index.js";
import {
  compareAcquisition,
  readyBand,
  sortRow,
} from "../../../../../src/lib/suggest/acquisition/sort.js";
import { partsRead } from "../../../../../src/lib/suggest/providers/acquisition.js";
import {
  AKBOLTOP_BARREL,
  AKBOLTOP_BP,
  AKBOLTOP_LINK,
  AKBOLTOP_RECEIVER,
  blueprintOf,
  companionDb,
  DORRCLAVE_BLADE,
  DORRCLAVE_BP,
  DORRCLAVE_HILT,
  DORRCLAVE_HOOK,
  DORRCLAVE_STRING,
  inventory,
  itemDb,
  KUVA_BRAMMA,
  MAG_BP,
  MAG_CHASSIS,
  MAG_NEURO,
  MAG_SYSTEMS,
  OLORO_MOA,
  SPINNEREX,
  SPINNEREX_BLADE,
  SPINNEREX_BP,
  SPINNEREX_HANDLE,
  SPINNEREX_STRING,
  techrotDb,
  weaponDb,
} from "./fixtures.js";
import type {
  AcquisitionContext,
  AcquisitionTarget,
} from "../../../../../src/lib/suggest/acquisition/types.js";

function find(targets: AcquisitionTarget[], name: string): AcquisitionTarget {
  const match = targets.find((target) => target.name === name);
  if (!match) throw new Error(`no target for ${name}`);
  return match;
}

function techrot(overrides: Partial<AcquisitionContext> = {}): AcquisitionTarget[] {
  return resolveAcquisition({ itemDb: techrotDb(), inventory: null, ...overrides });
}

/** What the card draws and what the Recommended order reads, in one line. */
function readiness(target: AcquisitionTarget): { ready: boolean; band: number } {
  return { ready: partsRead(target)?.ready ?? false, band: readyBand(target) };
}

function missingNames(target: AcquisitionTarget): string[] {
  return target.parts.missing.map((row) => row.name);
}

const SPINNEREX_MATERIALS = {
  "/Lotus/Types/Gameplay/DuviriMITW/Resources/DuviriMurmurItemA": 5_000,
  "/Lotus/Types/Gameplay/EntratiLab/Resources/EntratiLabMiscItemA": 50_000,
};

const SPINNEREX_PART_BPS = {
  [blueprintOf(SPINNEREX_BLADE)]: 1,
  [blueprintOf(SPINNEREX_STRING)]: 1,
  [blueprintOf(SPINNEREX_HANDLE)]: 1,
};

describe("a build is ready only when the foundry could start it now", () => {
  it("asks for the blueprint and every part when the account is empty", () => {
    const spinnerex = find(techrot(), "Spinnerex");
    expect(spinnerex.parts.known).toBe(true);
    expect(spinnerex.parts.main?.name).toBe("Spinnerex Blueprint");
    expect(missingNames(spinnerex)).toEqual([
      "Spinnerex Blueprint",
      "Spinnerex Blade",
      "Spinnerex String",
      "Spinnerex Handle",
    ]);
    expect(readiness(spinnerex)).toEqual({ ready: false, band: 5 });
  });

  it("calls a build ready when every part is built and in hand", () => {
    const ctx = {
      inventory: inventory({
        recipes: { [SPINNEREX_BP]: 1 },
        misc: { [SPINNEREX_BLADE]: 1, [SPINNEREX_STRING]: 1, [SPINNEREX_HANDLE]: 1 },
      }),
    };
    const spinnerex = find(techrot(ctx), "Spinnerex");
    expect(missingNames(spinnerex)).toEqual([]);
    expect(spinnerex.parts.buildable).toBe(true);
    expect(readiness(spinnerex)).toEqual({ ready: true, band: 0 });
  });

  it("holds a build back for a raw material even with every part in hand", () => {
    const ctx: Partial<AcquisitionContext> = {
      itemDb: itemDb(),
      inventory: inventory({
        recipes: { [MAG_BP]: 1 },
        misc: { [MAG_NEURO]: 1, [MAG_CHASSIS]: 1, [MAG_SYSTEMS]: 1 },
      }),
    };
    const mag = find(resolveAcquisition({ inventory: null, ...ctx } as AcquisitionContext), "Mag");
    expect(missingNames(mag)).toEqual([]);
    expect(mag.parts.buildable).toBe(false);
    expect(mag.parts.materials).toEqual([
      expect.objectContaining({ name: "Orokin Cell", required: 1, owned: 0, missing: 1 }),
    ]);
    expect(readiness(mag)).toEqual({ ready: false, band: 1 });
  });
});

describe("a component blueprint is not the component", () => {
  it("never calls Spinnerex ready off the part blueprints alone", () => {
    const ctx = {
      inventory: inventory({
        recipes: { [SPINNEREX_BP]: 1, ...SPINNEREX_PART_BPS },
        misc: SPINNEREX_MATERIALS,
      }),
    };
    const spinnerex = find(techrot(ctx), "Spinnerex");
    expect(spinnerex.parts.main?.owned).toBe(1);
    expect(missingNames(spinnerex)).toEqual([
      "Spinnerex Blade",
      "Spinnerex String",
      "Spinnerex Handle",
    ]);
    expect(spinnerex.parts.components.every((row) => row.owned === 0)).toBe(true);
    expect(readiness(spinnerex)).toEqual({ ready: false, band: 4 });
  });

  it("never calls Dorrclave ready off the part blueprints alone", () => {
    const ctx = {
      inventory: inventory({
        recipes: {
          [DORRCLAVE_BP]: 1,
          [blueprintOf(DORRCLAVE_BLADE)]: 1,
          [blueprintOf(DORRCLAVE_HILT)]: 1,
          [blueprintOf(DORRCLAVE_STRING)]: 1,
          [blueprintOf(DORRCLAVE_HOOK)]: 1,
        },
      }),
    };
    const dorrclave = find(techrot(ctx), "Dorrclave");
    expect(missingNames(dorrclave)).toEqual([
      "Dorrclave Blade",
      "Dorrclave Hilt",
      "Dorrclave String",
      "Dorrclave Hook",
    ]);
    expect(readiness(dorrclave)).toEqual({ ready: false, band: 5 });
  });

  it("names only the parts still unbuilt when some are built and some are not", () => {
    const ctx = {
      inventory: inventory({
        recipes: { [SPINNEREX_BP]: 1, ...SPINNEREX_PART_BPS },
        misc: { [SPINNEREX_BLADE]: 1, ...SPINNEREX_MATERIALS },
      }),
    };
    const spinnerex = find(techrot(ctx), "Spinnerex");
    expect(missingNames(spinnerex)).toEqual(["Spinnerex String", "Spinnerex Handle"]);
    expect(spinnerex.parts.components[0]).toMatchObject({ name: "Spinnerex Blade", owned: 1 });
    expect(readiness(spinnerex)).toEqual({ ready: false, band: 3 });
  });

  it("still reads a Prime part the inventory spells as a blueprint as the part", () => {
    const ctx = {
      inventory: inventory({
        recipes: {
          [blueprintOf(AKBOLTOP_BARREL)]: 2,
          [blueprintOf(AKBOLTOP_RECEIVER)]: 2,
          [blueprintOf(AKBOLTOP_LINK)]: 1,
          [AKBOLTOP_BP]: 1,
        },
      }),
    };
    const akbolto = find(techrot(ctx), "Akbolto Prime");
    expect(missingNames(akbolto)).toEqual([]);
    expect(readiness(akbolto)).toEqual({ ready: true, band: 0 });
  });

  it("counts every copy a recipe asks for, not just the first", () => {
    const ctx = {
      inventory: inventory({
        recipes: { "/Lotus/Types/Recipes/Weapons/AkboltoPrimeBlueprint": 1 },
        misc: { [AKBOLTOP_BARREL]: 1, [AKBOLTOP_RECEIVER]: 2, [AKBOLTOP_LINK]: 1 },
      }),
    };
    const akbolto = find(techrot(ctx), "Akbolto Prime");
    expect(missingNames(akbolto)).toEqual(["Akbolto Prime Barrel"]);
    expect(akbolto.parts.components[0]).toMatchObject({ required: 2, owned: 1, missing: 1 });
    expect(readiness(akbolto)).toEqual({ ready: false, band: 2 });
  });
});

describe("what the foundry is already holding", () => {
  it("stops counting a part blueprint the foundry is cooking", () => {
    const ctx = {
      inventory: inventory({
        recipes: { [SPINNEREX_BP]: 1, ...SPINNEREX_PART_BPS },
        pending: [blueprintOf(SPINNEREX_BLADE)],
        misc: SPINNEREX_MATERIALS,
      }),
    };
    const spinnerex = find(techrot(ctx), "Spinnerex");
    expect(spinnerex.parts.components[0]).toMatchObject({
      name: "Spinnerex Blade",
      owned: 0,
      missing: 1,
    });
    expect(readiness(spinnerex)).toEqual({ ready: false, band: 4 });
  });

  it("banks a claimed part while the next one is still cooking", () => {
    const ctx = {
      inventory: inventory({
        recipes: { [SPINNEREX_BP]: 1, [blueprintOf(SPINNEREX_STRING)]: 1 },
        pending: [blueprintOf(SPINNEREX_STRING)],
        misc: { [SPINNEREX_BLADE]: 1, ...SPINNEREX_MATERIALS },
      }),
    };
    const spinnerex = find(techrot(ctx), "Spinnerex");
    expect(spinnerex.parts.components[0]).toMatchObject({ name: "Spinnerex Blade", owned: 1 });
    expect(missingNames(spinnerex)).toEqual(["Spinnerex String", "Spinnerex Handle"]);
    expect(readiness(spinnerex)).toEqual({ ready: false, band: 3 });
  });

  it("spends a one-shot main blueprint the foundry is cooking", () => {
    const ctx = {
      inventory: inventory({
        recipes: { [SPINNEREX_BP]: 1 },
        pending: [SPINNEREX_BP],
        misc: { [SPINNEREX_BLADE]: 1, [SPINNEREX_STRING]: 1, [SPINNEREX_HANDLE]: 1 },
      }),
    };
    const spinnerex = find(techrot(ctx), "Spinnerex");
    expect(missingNames(spinnerex)).toEqual(["Spinnerex Blueprint"]);
    expect(readiness(spinnerex)).toEqual({ ready: false, band: 2 });
  });

  it("keeps a reusable main blueprint the foundry is cooking", () => {
    const db = techrotDb();
    db[SPINNEREX_BP].reusableBlueprint = true;
    const spinnerexRecipe = db[SPINNEREX].recipe;
    if (spinnerexRecipe) spinnerexRecipe.reusableBlueprint = true;
    const ctx = {
      itemDb: db,
      inventory: inventory({
        recipes: { [SPINNEREX_BP]: 1 },
        pending: [SPINNEREX_BP],
        misc: { [SPINNEREX_BLADE]: 1, [SPINNEREX_STRING]: 1, [SPINNEREX_HANDLE]: 1 },
      }),
    };
    const spinnerex = find(techrot(ctx), "Spinnerex");
    expect(spinnerex.parts.main).toMatchObject({ required: 1, owned: 1, missing: 0 });
    expect(readiness(spinnerex)).toEqual({ ready: true, band: 0 });
  });
});

describe("what readiness means where there is no recipe to read", () => {
  it("never calls an item the database has no recipe for ready", () => {
    const bramma = find(
      resolveAcquisition({ itemDb: weaponDb(), inventory: null }),
      "Kuva Bramma",
    );
    expect(bramma.parts.known).toBe(false);
    expect(partsRead(bramma)).toBeNull();
    expect(readyBand(bramma)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("never calls modular gear ready, and still banks a head part fitted to a build", () => {
    const targets = resolveAcquisition({
      itemDb: companionDb(),
      inventory: inventory({ modularParts: [OLORO_MOA] }),
    });
    const moa = find(targets, "Moa");
    expect(moa.modular?.owned).toBe(1);
    expect(partsRead(moa)).toMatchObject({ have: 1, need: 2, ready: false });
    expect(readyBand(moa)).toBe(2);
  });

  it("never offers gear the account already holds", () => {
    const names = techrot({ inventory: inventory({ melee: [SPINNEREX] }) }).map(
      (target) => target.name,
    );
    expect(names).not.toContain("Spinnerex");
    expect(names).toContain("Dorrclave");
  });
});

describe("the Recommended order reads the same flags the card does", () => {
  function order(overrides: Partial<AcquisitionContext>): string[] {
    return [...techrot(overrides)]
      .map((target) => sortRow(target, target.effort, "recommended"))
      .sort(compareAcquisition())
      .map((row) => row.target.name);
  }

  it("sorts a build the foundry would take now ahead of one still owed parts", () => {
    const names = order({
      inventory: inventory({
        recipes: { [SPINNEREX_BP]: 1, [DORRCLAVE_BP]: 1, [blueprintOf(DORRCLAVE_BLADE)]: 1 },
        misc: {
          [SPINNEREX_BLADE]: 1,
          [SPINNEREX_STRING]: 1,
          [SPINNEREX_HANDLE]: 1,
          ...SPINNEREX_MATERIALS,
        },
      }),
    });
    expect(names.indexOf("Spinnerex")).toBeLessThan(names.indexOf("Dorrclave"));
  });

  it("never lets part blueprints alone promote a build to the top", () => {
    const names = order({
      inventory: inventory({
        recipes: {
          [SPINNEREX_BP]: 1,
          ...SPINNEREX_PART_BPS,
          [AKBOLTOP_BP]: 1,
        },
        misc: {
          [AKBOLTOP_BARREL]: 2,
          [AKBOLTOP_RECEIVER]: 2,
          [AKBOLTOP_LINK]: 1,
        },
      }),
    });
    expect(names[0]).toBe("Akbolto Prime");
    expect(names.indexOf("Akbolto Prime")).toBeLessThan(names.indexOf("Spinnerex"));
  });
});
