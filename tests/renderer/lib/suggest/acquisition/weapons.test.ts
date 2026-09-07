import { describe, expect, it } from "vitest";

import { resolveAcquisition } from "../../../../../src/lib/suggest/acquisition/index.js";
import {
  AKBOLTO,
  BRATON,
  BRATON_ADAPTER,
  BRATON_BARREL,
  BRATON_BP,
  BRATONP_BARREL,
  CORVAS,
  frame,
  inventory,
  LITH_B1,
  NIKANA,
  ODONATA,
  ONORIX,
  SWEEPER,
  weaponDb,
  weaponRelicDb,
} from "./fixtures.js";
import type {
  AcquisitionContext,
  AcquisitionTarget,
} from "../../../../../src/lib/suggest/acquisition/types.js";

function context(overrides: Partial<AcquisitionContext> = {}): AcquisitionContext {
  return { itemDb: weaponDb(), inventory: null, ...overrides };
}

function find(targets: AcquisitionTarget[], name: string): AcquisitionTarget {
  const match = targets.find((target) => target.name === name);
  if (!match) throw new Error(`no target for ${name}`);
  return match;
}

function target(name: string, overrides: Partial<AcquisitionContext> = {}): AcquisitionTarget {
  return find(resolveAcquisition(context({ ...overrides, only: [name] })), name);
}

describe("weapon enumeration", () => {
  it("wants a weapon of every class when nothing is owned", () => {
    const targets = resolveAcquisition(context());
    const classes = new Map(targets.map((row) => [row.name, row.weaponClass]));
    expect(classes.get("Braton")).toBe("primary");
    expect(classes.get("Akbolto")).toBe("secondary");
    expect(classes.get("Nikana")).toBe("melee");
    expect(classes.get("Corvas")).toBe("archgun");
    expect(classes.get("Onorix")).toBe("archmelee");
    expect(classes.get("Sweeper")).toBe("companion");
    for (const row of targets) {
      expect(row.kind).toBe(row.name === "Odonata" ? "archwing" : "weapon");
    }
  });

  it("wants the archwing suit itself, with no weapon class on it", () => {
    const odonata = target("Odonata");
    expect(odonata.kind).toBe("archwing");
    expect(odonata.weaponClass).toBeNull();
    expect(odonata.needs).toEqual(["mastery"]);
  });

  it("drops an archwing suit already flown", () => {
    const owned = inventory({ spaceSuits: [ODONATA] });
    const names = resolveAcquisition(context({ inventory: owned })).map((row) => row.name);
    expect(names).not.toContain("Odonata");
  });

  it("skips exalted gear and the blueprints and parts of a build", () => {
    const names = resolveAcquisition(context()).map((row) => row.name);
    expect(names).not.toContain("Excalibur Sword");
    expect(names).not.toContain("Braton Blueprint");
    expect(names).not.toContain("Braton Barrel");
  });

  it("counts the main blueprint apart from the component blueprints", () => {
    const braton = target("Braton");
    expect(braton.parts.known).toBe(true);
    expect(braton.parts.main?.name).toBe("Braton Blueprint");
    expect(braton.parts.components.map((row) => row.name)).toEqual([
      "Braton Barrel",
      "Braton Receiver",
    ]);
    expect(braton.parts.missing).toHaveLength(3);
  });

  it("keeps parts already held out of the missing list", () => {
    const braton = target("Braton", {
      inventory: inventory({ recipes: { [BRATON_BP]: 1 }, misc: { [BRATON_BARREL]: 1 } }),
    });
    expect(braton.parts.missing.map((row) => row.name)).toEqual(["Braton Receiver"]);
  });

  it("drops a weapon that is built and has nothing else outstanding", () => {
    const names = resolveAcquisition(context({ inventory: inventory({ pistols: [AKBOLTO] }) })).map(
      (row) => row.name,
    );
    expect(names).not.toContain("Akbolto");
  });

  it("drops an owned archwing gun, melee and sentinel weapon alike", () => {
    const owned = inventory({
      melee: [NIKANA],
      spaceGuns: [CORVAS],
      spaceMelee: [ONORIX],
      sentinelWeapons: [SWEEPER],
    });
    const names = resolveAcquisition(context({ inventory: owned })).map((row) => row.name);
    expect(names).not.toContain("Nikana");
    expect(names).not.toContain("Corvas");
    expect(names).not.toContain("Onorix");
    expect(names).not.toContain("Sweeper");
  });

  it("narrows the sweep to a kind", () => {
    const db = { ...weaponDb(), "/Lotus/Powersuits/Volt/Volt": frame("Volt", "/bp", []) };
    const weapons = resolveAcquisition({ itemDb: db, inventory: null, kinds: ["weapon"] });
    const frames = resolveAcquisition({ itemDb: db, inventory: null, kinds: ["warframe"] });
    const suits = resolveAcquisition({ itemDb: db, inventory: null, kinds: ["archwing"] });
    expect(weapons.map((row) => row.name)).not.toContain("Volt");
    expect(weapons.map((row) => row.name)).not.toContain("Odonata");
    expect(frames.map((row) => row.name)).toEqual(["Volt"]);
    expect(suits.map((row) => row.name)).toEqual(["Odonata"]);
  });
});

describe("weapon incarnon adapters", () => {
  it("keeps farming a weapon that is built but has no adapter yet", () => {
    const braton = target("Braton", { inventory: inventory({ longGuns: [BRATON] }) });
    expect(braton.needs).toEqual(["incarnon"]);
    expect(braton.parts.missing).toHaveLength(0);
    expect(braton.paths.map((path) => path.id)).toEqual(["incarnon"]);
    expect(braton.paths[0].steps[0].where).toContain("Steel Path Circuit, week 1");
  });

  it("carries the adapter grade and upgrade path", () => {
    expect(target("Braton").incarnon).toEqual({
      grade: "A",
      upgradePath: "0121",
      week: 1,
      owned: false,
    });
  });

  it("drops the weapon once the adapter is installed on it", () => {
    const names = resolveAcquisition(context({ inventory: inventory({ incarnon: [BRATON] }) })).map(
      (row) => row.name,
    );
    expect(names).not.toContain("Braton");
  });

  it("counts an uninstalled adapter sitting in the inventory", () => {
    const held = inventory({ longGuns: [BRATON], misc: { [BRATON_ADAPTER]: 1 } });
    const names = resolveAcquisition(context({ inventory: held })).map((row) => row.name);
    expect(names).not.toContain("Braton");
  });

  it("asks nothing of a weapon with no adapter of its own", () => {
    expect(target("Akbolto").incarnon).toBeNull();
    expect(target("Akbolto").needs).toEqual(["mastery"]);
  });

  it("leaves the adapter need on the base weapon, not on its Prime", () => {
    expect(target("Braton Prime").incarnon).toBeNull();
  });
});

describe("weapon primes", () => {
  it("counts the relics the player already holds", () => {
    const prime = target("Braton Prime", {
      relicDb: weaponRelicDb(),
      inventory: inventory({ misc: { [LITH_B1]: 3 } }),
    });
    const relics = prime.paths.find((path) => path.kind === "relics");
    expect(relics?.cost.relics).toMatchObject({ known: true, held: 3, needed: 2 });
    expect(relics?.cost.relics?.rows).toEqual([
      { relic: "Lith B1", part: "Braton Prime Barrel", held: 3 },
    ]);
  });

  it("still offers the relic path with no relics held", () => {
    const prime = target("Braton Prime", { relicDb: weaponRelicDb() });
    const relics = prime.paths.find((path) => path.kind === "relics");
    expect(relics?.cost.relics).toMatchObject({ known: true, held: 0, needed: 2 });
    expect(relics?.effort).toBeGreaterThan(
      target("Braton Prime", {
        relicDb: weaponRelicDb(),
        inventory: inventory({ misc: { [LITH_B1]: 5 } }),
      }).paths.find((path) => path.kind === "relics")?.effort ?? 1,
    );
  });

  it("reads a Prime as an upgrade when the base weapon is already in hand", () => {
    const prime = target("Braton Prime", { inventory: inventory({ longGuns: [BRATON] }) });
    expect(prime.needs).toEqual(["mastery", "prime"]);
  });

  it("asks only for mastery when the base weapon is missing too", () => {
    expect(target("Braton Prime").needs).toEqual(["mastery"]);
  });

  it("spends one spare part on one weapon only", () => {
    const ctx = context({ inventory: inventory({ misc: { [BRATONP_BARREL]: 1 } }) });
    const prime = find(resolveAcquisition(ctx), "Braton Prime");
    expect(prime.parts.components[0]).toMatchObject({ owned: 1, missing: 0 });
  });
});
