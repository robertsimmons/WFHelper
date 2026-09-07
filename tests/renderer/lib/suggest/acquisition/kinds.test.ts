import { describe, expect, it } from "vitest";

import {
  ACQUISITION_INCLUDES,
  includeOf,
  includesTarget,
  type AcquisitionInclude,
} from "../../../../../src/lib/suggest/acquisition/kinds.js";
import type {
  AcquisitionKind,
  AcquisitionTarget,
  WeaponClass,
} from "../../../../../src/lib/suggest/acquisition/types.js";

function target(kind: AcquisitionKind, weaponClass: WeaponClass | null): AcquisitionTarget {
  return { name: "Thing", kind, weaponClass } as AcquisitionTarget;
}

const FRAME = target("warframe", null);
const RIFLE = target("weapon", "primary");
const BLADE = target("weapon", "melee");

describe("includeOf", () => {
  it("reads a frame as a frame and a weapon as its class", () => {
    expect(includeOf(FRAME)).toBe("warframe");
    expect(includeOf(RIFLE)).toBe("primary");
    expect(includeOf(BLADE)).toBe("melee");
  });

  it("covers every weapon class the resolver can return", () => {
    const classes: WeaponClass[] = ["primary", "secondary", "melee", "archwing", "companion"];
    for (const weapon of classes) expect(includeOf(target("weapon", weapon))).toBe(weapon);
    expect(new Set<string>(ACQUISITION_INCLUDES)).toEqual(new Set(["warframe", ...classes]));
  });

  it("reports no kind for a weapon nothing classed", () => {
    expect(includeOf(target("weapon", null))).toBeNull();
  });
});

describe("includesTarget", () => {
  it("keeps only the kinds ticked", () => {
    const picked: AcquisitionInclude[] = ["warframe"];
    expect(includesTarget(picked, FRAME)).toBe(true);
    expect(includesTarget(picked, RIFLE)).toBe(false);
  });

  it("keeps several kinds at once", () => {
    const picked: AcquisitionInclude[] = ["primary", "melee"];
    expect(includesTarget(picked, RIFLE)).toBe(true);
    expect(includesTarget(picked, BLADE)).toBe(true);
    expect(includesTarget(picked, FRAME)).toBe(false);
  });

  it("reads an empty selection as every kind", () => {
    for (const item of [FRAME, RIFLE, BLADE]) expect(includesTarget([], item)).toBe(true);
  });

  it("never hides a target it cannot class", () => {
    expect(includesTarget(["warframe"], target("weapon", null))).toBe(true);
  });
});
