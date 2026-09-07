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
const SUIT = target("archwing", null);
const RIFLE = target("weapon", "primary");
const BLADE = target("weapon", "melee");
const ARCH_GUN = target("weapon", "archgun");
const ARCH_BLADE = target("weapon", "archmelee");

describe("includeOf", () => {
  it("reads a frame as a frame and a weapon as its class", () => {
    expect(includeOf(FRAME)).toBe("warframe");
    expect(includeOf(RIFLE)).toBe("primary");
    expect(includeOf(BLADE)).toBe("melee");
  });

  it("keeps the archwing suit apart from the guns and melee it carries", () => {
    expect(includeOf(SUIT)).toBe("archwing");
    expect(includeOf(ARCH_GUN)).toBe("archgun");
    expect(includeOf(ARCH_BLADE)).toBe("archmelee");
  });

  it("covers every weapon class the resolver can return", () => {
    const classes: WeaponClass[] = [
      "primary",
      "secondary",
      "melee",
      "archgun",
      "archmelee",
      "companion",
    ];
    for (const weapon of classes) expect(includeOf(target("weapon", weapon))).toBe(weapon);
    expect(new Set<string>(ACQUISITION_INCLUDES)).toEqual(
      new Set(["warframe", "archwing", ...classes]),
    );
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

  it("ticking the suit does not tick its guns", () => {
    const picked: AcquisitionInclude[] = ["archwing"];
    expect(includesTarget(picked, SUIT)).toBe(true);
    expect(includesTarget(picked, ARCH_GUN)).toBe(false);
    expect(includesTarget(picked, ARCH_BLADE)).toBe(false);
    expect(includesTarget(["archgun"], ARCH_BLADE)).toBe(false);
  });

  it("reads an empty selection as every kind", () => {
    for (const item of [FRAME, SUIT, RIFLE, BLADE, ARCH_GUN, ARCH_BLADE]) {
      expect(includesTarget([], item)).toBe(true);
    }
  });

  it("never hides a target it cannot class", () => {
    expect(includesTarget(["warframe"], target("weapon", null))).toBe(true);
  });
});
