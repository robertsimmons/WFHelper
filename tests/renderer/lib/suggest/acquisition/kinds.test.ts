import { describe, expect, it } from "vitest";

import {
  ACQUISITION_INCLUDE_GROUPS,
  ACQUISITION_INCLUDES,
  ACQUISITION_NONE,
  includeOf,
  includesTarget,
  type AcquisitionInclude,
} from "../../../../../src/lib/suggest/acquisition/kinds.js";
import type {
  AcquisitionKind,
  AcquisitionTarget,
  ModularGear,
  WeaponClass,
} from "../../../../../src/lib/suggest/acquisition/types.js";

function target(kind: AcquisitionKind, weaponClass: WeaponClass | null): AcquisitionTarget {
  return { name: "Thing", kind, weaponClass } as AcquisitionTarget;
}

function modular(gear: ModularGear): AcquisitionTarget {
  return { name: "Thing", kind: "modular", modular: { gear } } as AcquisitionTarget;
}

const FRAME = target("warframe", null);
const SUIT = target("archwing", null);
const RIFLE = target("weapon", "primary");
const BLADE = target("weapon", "melee");
const ARCH_GUN = target("weapon", "archgun");
const ARCH_BLADE = target("weapon", "archmelee");
const SENTINEL = target("sentinel", null);
const SENTINEL_GUN = target("weapon", "companion");
const BEAST = target("beast", null);
const MECH = target("necramech", null);

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

  it("reads each companion kind as its own box", () => {
    expect(includeOf(SENTINEL)).toBe("sentinel");
    expect(includeOf(SENTINEL_GUN)).toBe("companion");
    expect(includeOf(BEAST)).toBe("beast");
  });

  it("folds both robot pets into one box and keeps the rest apart", () => {
    expect(includeOf(modular("moa"))).toBe("robotic");
    expect(includeOf(modular("hound"))).toBe("robotic");
    expect(includeOf(modular("amp"))).toBe("amp");
    expect(includeOf(modular("kdrive"))).toBe("kdrive");
    expect(includeOf(MECH)).toBe("necramech");
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
  });

  it("reports no kind for gear nothing classed", () => {
    expect(includeOf(target("weapon", null))).toBeNull();
    expect(includeOf(target("modular", null))).toBeNull();
  });
});

describe("ACQUISITION_INCLUDE_GROUPS", () => {
  const members = (id: string): readonly AcquisitionInclude[] =>
    ACQUISITION_INCLUDE_GROUPS.find((group) => group.id === id)?.members.map(
      (member) => member.include,
    ) ?? [];

  it("draws the five groups the filter row reads", () => {
    expect(ACQUISITION_INCLUDE_GROUPS.map((group) => group.id)).toEqual([
      "warframes",
      "weapons",
      "companions",
      "archwing",
      "other",
    ]);
  });

  it("makes Warframes a plain toggle and every other group a dropdown", () => {
    for (const group of ACQUISITION_INCLUDE_GROUPS) {
      const toggle = group.id === "warframes";
      expect(group.include === null).toBe(!toggle);
      expect(group.members.length === 0).toBe(toggle);
    }
  });

  it("farms a sentinel's gun with the pet rather than with the weapons", () => {
    expect(members("weapons")).toEqual(["primary", "secondary", "melee"]);
    expect(members("companions")).toEqual(["sentinel", "companion", "beast", "robotic"]);
    expect(members("archwing")).toEqual(["archwing", "archgun", "archmelee"]);
    expect(members("other")).toEqual(["necramech", "amp", "kdrive"]);
  });

  it("is the only source the flat include list is built from", () => {
    expect([...ACQUISITION_INCLUDES]).toEqual(
      ACQUISITION_INCLUDE_GROUPS.flatMap((group) =>
        group.include ? [group.include] : group.members.map((member) => member.include),
      ),
    );
  });

  it("keeps every kind the resolver can class inside a group", () => {
    const boxes = new Set<string>(ACQUISITION_INCLUDES);
    const every = [
      FRAME,
      SUIT,
      RIFLE,
      BLADE,
      ARCH_GUN,
      ARCH_BLADE,
      SENTINEL,
      SENTINEL_GUN,
      BEAST,
      MECH,
      target("weapon", "secondary"),
      modular("moa"),
      modular("hound"),
      modular("amp"),
      modular("kdrive"),
    ];
    for (const item of every) expect(boxes).toContain(includeOf(item));
  });

  it("gives every box and every group a label of its own", () => {
    const keys = ACQUISITION_INCLUDE_GROUPS.flatMap((group) => [
      group.labelKey,
      ...group.members.map((member) => member.labelKey),
    ]);
    expect(new Set(keys).size).toBe(keys.length);
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

  it("ticking the sentinel does not tick the gun it carries", () => {
    expect(includesTarget(["sentinel"], SENTINEL)).toBe(true);
    expect(includesTarget(["sentinel"], SENTINEL_GUN)).toBe(false);
    expect(includesTarget(["robotic"], modular("hound"))).toBe(true);
    expect(includesTarget(["robotic"], BEAST)).toBe(false);
  });

  it("reads an empty selection as every kind", () => {
    for (const item of [FRAME, SUIT, RIFLE, SENTINEL, BEAST, MECH, modular("amp")]) {
      expect(includesTarget([], item)).toBe(true);
    }
  });

  it("hides every target, classed or not, on the reserved empty selection", () => {
    for (const item of [FRAME, SUIT, RIFLE, SENTINEL, BEAST, MECH, modular("amp")]) {
      expect(includesTarget([ACQUISITION_NONE], item)).toBe(false);
    }
    expect(includesTarget([ACQUISITION_NONE], target("weapon", null))).toBe(false);
  });

  it("never offers the reserved empty selection as a box", () => {
    expect(ACQUISITION_INCLUDES).not.toContain(ACQUISITION_NONE);
    for (const item of [FRAME, RIFLE, SENTINEL, MECH, modular("amp")]) {
      expect(includeOf(item)).not.toBe(ACQUISITION_NONE);
    }
  });

  it("never hides a target it cannot class", () => {
    expect(includesTarget(["warframe"], target("weapon", null))).toBe(true);
    expect(includesTarget(["warframe"], target("modular", null))).toBe(true);
  });

  it("still reads a selection stored before the groups existed", () => {
    const stored = ["warframe", "primary", "secondary", "melee", "archwing", "companion"];
    const picked = ACQUISITION_INCLUDES.filter((kind) => stored.includes(kind));
    expect(picked).toHaveLength(stored.length);
    expect(includesTarget(picked, FRAME)).toBe(true);
    expect(includesTarget(picked, SENTINEL_GUN)).toBe(true);
    expect(includesTarget(picked, MECH)).toBe(false);
  });
});
