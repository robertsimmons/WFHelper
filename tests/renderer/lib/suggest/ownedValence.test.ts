import { describe, expect, it } from "vitest";

import {
  ownedValenceByName,
  ownedValenceWeapons,
  valencePercent,
  valenceRollFloat,
  VALENCE_UPGRADE_TYPE,
} from "../../../../src/lib/suggest/ownedValence.js";
import type { ItemDbEntry, RawInventoryData } from "../../../../src/types/inventory.js";

// Every path, tag and encoded value below is verbatim from a real inventory
// export. Three of these weapons carry no family word in their path at all.
const BASSOCYST = "/Lotus/Weapons/Infested/InfestedLich/LongGuns/1999InfShotgunWeapon";
const TORXICA = "/Lotus/Weapons/Infested/InfestedLich/Pistols/1999InfSporePistolWeapon";
const MOTOVORE = "/Lotus/Weapons/Infested/InfestedLich/Melee/InfestedHammer/InfLichHammerWeapon";
const BUBONICO = "/Lotus/Weapons/Infested/InfestedLich/LongGuns/CodaBubonico/CodaBubonicoCannon";
const FERROX = "/Lotus/Weapons/Corpus/BoardExec/Primary/CrpBEFerrox/CrpBEFerrox";
const BRATON = "/Lotus/Weapons/Tenno/Rifle/RifleStandard";

/** The cap: four of the player's own weapons sit on exactly this value. */
const CAP_VALUE = 1073741760;

function fingerprint(compat: string, tag: string, value: number): string {
  return JSON.stringify({ compat, buffs: [{ Tag: tag, Value: value }] });
}

function weapon(itemType: string, tag: string, value: number) {
  return {
    ItemType: itemType,
    UpgradeType: VALENCE_UPGRADE_TYPE,
    UpgradeFingerprint: fingerprint(itemType, tag, value),
  };
}

const itemDb = {
  [BASSOCYST]: { name: "Coda Bassocyst" },
  [TORXICA]: { name: "Dual Coda Torxica" },
  [MOTOVORE]: { name: "Coda Motovore" },
  [BUBONICO]: { name: "Coda Bubonico" },
  [FERROX]: { name: "Tenet Ferrox" },
  [BRATON]: { name: "Braton" },
} as unknown as Record<string, ItemDbEntry>;

function inventory(overrides: Partial<RawInventoryData> = {}): RawInventoryData {
  return {
    LongGuns: [weapon(BASSOCYST, "InnateHeatDamage", 957011712)],
    Pistols: [weapon(TORXICA, "InnateRadDamage", CAP_VALUE)],
    Melee: [weapon(MOTOVORE, "InnateMagDamage", 855902976)],
    ...overrides,
  };
}

describe("valenceRollFloat", () => {
  it("reads the 0x3FFFFFFF encoding the riven fingerprints use", () => {
    expect(valenceRollFloat(0)).toBe(0);
    expect(valenceRollFloat(0x3fffffff)).toBe(1);
    expect(valenceRollFloat(0x3fffffff / 2)).toBeCloseTo(0.5, 10);
  });

  it("treats anything outside the encoding as undecodable, not as a low roll", () => {
    expect(valenceRollFloat(-1)).toBeNull();
    expect(valenceRollFloat(0x40000000)).toBeNull();
    expect(valenceRollFloat("957011712")).toBeNull();
    expect(valenceRollFloat(Number.NaN)).toBeNull();
  });
});

describe("valencePercent", () => {
  it("puts the ends of the encoding on the ends of the 25-60 window", () => {
    expect(valencePercent(0)).toBe(25);
    expect(valencePercent(0x3fffffff)).toBe(60);
  });

  it("reads the cap off the value four of the player's weapons carry", () => {
    expect(valencePercent(CAP_VALUE)).toBe(60);
  });

  it("reports one decimal place, as the game and the wiki both do", () => {
    expect(valencePercent(957011712)).toBe(56.2);
    expect(valencePercent(855902976)).toBe(52.9);
    expect(valencePercent(22802240)).toBe(25.7);
    expect(valencePercent(662418368)).toBe(46.6);
  });
});

describe("ownedValenceWeapons", () => {
  it("names weapons through the item database, not through their path", () => {
    const owned = ownedValenceWeapons(inventory(), itemDb);
    expect(owned.map((row) => row.name)).toEqual([
      "Dual Coda Torxica",
      "Coda Bassocyst",
      "Coda Motovore",
    ]);
  });

  it("reads the element off the fingerprint tag", () => {
    const owned = ownedValenceWeapons(inventory(), itemDb);
    expect(owned.find((row) => row.name === "Coda Bassocyst")).toMatchObject({
      element: "Heat",
      percent: 56.2,
      uniqueName: BASSOCYST,
    });
    expect(owned.find((row) => row.name === "Coda Motovore")?.element).toBe("Magnetic");
  });

  it("ignores a weapon carrying no valence upgrade", () => {
    const owned = ownedValenceWeapons(
      inventory({ LongGuns: [{ ItemType: BRATON, XP: 900_000 }] }),
      itemDb,
    );
    expect(owned.map((row) => row.name)).not.toContain("Braton");
  });

  it("drops a row nothing can decode rather than reading it as a low roll", () => {
    const broken = {
      LongGuns: [
        { ItemType: BASSOCYST, UpgradeType: VALENCE_UPGRADE_TYPE, UpgradeFingerprint: "{oops" },
        weapon(BUBONICO, "InnateSomethingElse", 662418368),
      ],
    };
    expect(ownedValenceWeapons(broken, itemDb)).toEqual([]);
  });

  it("says nothing at all without an inventory, which is not an empty one", () => {
    expect(ownedValenceWeapons(null, itemDb)).toEqual([]);
  });

  it("skips a weapon the item database cannot name", () => {
    expect(ownedValenceWeapons(inventory(), {})).toEqual([]);
  });
});

describe("ownedValenceByName", () => {
  it("keeps the better of two copies, since fusion works from the better one", () => {
    const owned = ownedValenceByName(
      inventory({
        LongGuns: [
          weapon(BUBONICO, "InnateMagDamage", 662418368),
          weapon(BUBONICO, "InnateElectricityDamage", 985126784),
        ],
      }),
      itemDb,
    );
    expect(owned.get("coda bubonico")).toMatchObject({ percent: 57.1, element: "Electricity" });
  });

  it("keys by lowercased English name, which is all the wiki tables carry", () => {
    const owned = ownedValenceByName(inventory(), itemDb);
    expect([...owned.keys()].sort()).toEqual([
      "coda bassocyst",
      "coda motovore",
      "dual coda torxica",
    ]);
  });
});
