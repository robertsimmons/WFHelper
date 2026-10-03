import { describe, expect, it } from "vitest";

import { resolveAcquisition } from "../../../../../src/lib/suggest/acquisition/index.js";
import type { ItemDbEntry } from "../../../../../src/types/inventory.js";

// uniqueNames and recipe shape as DE's export spells them.
const DETH_MACHINE_RIFLE = "/Lotus/Types/Sentinels/SentinelWeapons/DethMachineRifle";
const DETH_MACHINE_RIFLE_PRIME = "/Lotus/Types/Sentinels/SentinelWeapons/PrimeDethMachineRifle";
const MULTRON = "/Lotus/Types/Friendly/Pets/MoaPets/MoaPetComponents/HextraWeapon";
const AKATEN = "/Lotus/Types/Friendly/Pets/ZanukaPets/ZanukaPetMeleeWeaponPS";
const CRYOTRA = "/Lotus/Types/Friendly/Pets/MoaPets/MoaPetComponents/CryoxionWeapon";
const CRYOTRA_BP = "/Lotus/Types/Recipes/Weapons/CryotraBlueprint";
const VINQUIBUS = "/Lotus/Weapons/Tenno/Bayonet/TnBayonetRifleWeapon";
const VINQUIBUS_BP = "/Lotus/Weapons/Tenno/Bayonet/TnBayonetRifleBlueprint";
const VINQUIBUS_MELEE = "/Lotus/Weapons/Tenno/Bayonet/TnBayonetMeleeWeapon";
const OROKIN_CELL = "/Lotus/Types/Items/MiscItems/OrokinCell";

function weapon(name: string, productCategory: string, extra: ItemDbEntry = {}): ItemDbEntry {
  return { name, productCategory, masterable: true, ...extra };
}

function recipe(blueprint: string): ItemDbEntry {
  return {
    recipe: {
      buildPrice: 15_000,
      buildTime: 43_200,
      num: 1,
      blueprintUniqueName: blueprint,
      ingredients: [{ uniqueName: OROKIN_CELL, count: 1 }],
    },
  };
}

function db(): Record<string, ItemDbEntry> {
  return {
    [DETH_MACHINE_RIFLE]: weapon("Deth Machine Rifle", "SentinelWeapons"),
    [DETH_MACHINE_RIFLE_PRIME]: weapon("Deth Machine Rifle Prime", "SentinelWeapons", {
      isPrime: true,
    }),
    [MULTRON]: weapon("Multron", "SentinelWeapons"),
    [AKATEN]: weapon("Akaten", "SentinelWeapons"),
    [CRYOTRA]: weapon("Cryotra", "SentinelWeapons", recipe(CRYOTRA_BP)),
    [CRYOTRA_BP]: { name: "Cryotra Blueprint", buildsProduct: CRYOTRA },
    [VINQUIBUS]: weapon("Vinquibus", "LongGuns", {
      ...recipe(VINQUIBUS_BP),
      otherForm: VINQUIBUS_MELEE,
    }),
    [VINQUIBUS_BP]: { name: "Vinquibus Blueprint", buildsProduct: VINQUIBUS },
    [VINQUIBUS_MELEE]: weapon("Vinquibus (Melee)", "Melee", { otherForm: VINQUIBUS }),
    [OROKIN_CELL]: { name: "Orokin Cell", category: "Resource" },
  };
}

function names(itemDb = db()): string[] {
  return resolveAcquisition({ itemDb, inventory: null }).map((target) => target.name);
}

describe("weapons that arrive inside something else", () => {
  it("never targets a companion weapon built with its companion", () => {
    expect(names()).not.toContain("Deth Machine Rifle");
    expect(names()).not.toContain("Deth Machine Rifle Prime");
  });

  it("never targets a MOA or Hound weapon that comes with the build", () => {
    expect(names()).not.toContain("Multron");
    expect(names()).not.toContain("Akaten");
  });

  it("keeps a companion weapon that has a blueprint of its own", () => {
    const cryotra = resolveAcquisition({ itemDb: db(), inventory: null, only: ["Cryotra"] })[0];
    expect(cryotra?.weaponClass).toBe("companion");
    expect(cryotra?.parts.main?.name).toBe("Cryotra Blueprint");
  });

  it("never targets the unbuilt second form of a gun-blade", () => {
    expect(names()).not.toContain("Vinquibus (Melee)");
    expect(names()).toContain("Vinquibus");
  });

  it("keeps a second form whose partner has no blueprint either", () => {
    const itemDb = db();
    delete itemDb[VINQUIBUS]?.recipe;
    expect(names(itemDb)).toContain("Vinquibus (Melee)");
  });
});
