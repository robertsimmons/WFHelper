import { describe, expect, it } from "vitest";

import { resolveAcquisition } from "../../../../../src/lib/suggest/acquisition/index.js";
import { sortKeys } from "../../../../../src/lib/suggest/acquisition/sort.js";
import { inventory, itemDb, LITH_M1, MAGP_BP, relicDb } from "./fixtures.js";
import type { AcquisitionTarget } from "../../../../../src/lib/suggest/acquisition/types.js";
import type { VaultTraderInventoryItem, WorldState } from "../../../../../src/types/world.js";

const NOW = Date.parse("2026-01-10T12:00:00Z");
const OPEN = { activation: "2026-01-09T00:00:00Z", expiry: "2026-01-11T00:00:00Z" };
const AFTER = Date.parse("2026-01-11T00:00:01Z");

function baro(inventory: VaultTraderInventoryItem[]): WorldState {
  return { voidTrader: { ...OPEN, location: "Strata Relay (Earth)", inventory } };
}

function varzia(inventory: VaultTraderInventoryItem[]): WorldState {
  return { vaultTrader: { ...OPEN, inventory } };
}

/** Mag sold only by Baro, with the market pricing the set. */
function baroMag(
  world: WorldState | null,
  now = NOW,
  where = "Baro Ki'Teer - Relay",
): AcquisitionTarget {
  const quest = /quest key/.test(where) ? { quest: "Sands of Inaros" } : {};
  const [target] = resolveAcquisition({
    itemDb: itemDb(),
    inventory: inventory(),
    plat: (name) => (name === "Mag Set" ? 120 : null),
    curatedWeapons: { Mag: { sources: [{ kind: "vendor", parts: "both", where, ...quest }] } },
    only: ["Mag"],
    world,
    now,
  });
  return target!;
}

/** Mag Prime short only the Neuroptics a vaulted relic pays, no relic held. */
function vaultedMagPrime(world: WorldState | null, now = NOW): AcquisitionTarget {
  const db = relicDb();
  db.groups["Lith M1"]!.dropping = "none";
  const [target] = resolveAcquisition({
    itemDb: itemDb(),
    inventory: inventory({ recipes: { [MAGP_BP]: 1 } }),
    relicDb: db,
    plat: (name) => (name === "Mag Prime Set" ? 60 : null),
    only: ["Mag Prime"],
    world,
    now,
  });
  return target!;
}

const band = (target: AcquisitionTarget): number | null =>
  sortKeys(target, "recommended")[0] ?? null;

describe("a Baro-only item", () => {
  it("is plat only while Baro is away or not stocking it", () => {
    expect(band(baroMag(null))).toBe(3);
    expect(band(baroMag({}))).toBe(3);
    expect(band(baroMag(baro([{ item: "Volt" }])))).toBe(3);
  });

  it("is a farm while Baro stocks it", () => {
    expect(band(baroMag(baro([{ item: "Mag", ducats: 400 }])))).toBe(2);
  });

  it("goes back to plat only once his window closes", () => {
    expect(band(baroMag(baro([{ item: "Mag" }]), AFTER))).toBe(3);
  });

  it("walks a quest bought from Baro while he stocks the quest", () => {
    const where = "Baro Ki'Teer - Sands of Inaros quest key";
    expect(band(baroMag(null, NOW, where))).toBe(3);
    expect(band(baroMag(baro([{ item: "Sands of Inaros Blueprint" }]), NOW, where))).toBe(2);
  });
});

describe("a vaulted Prime with no relic held", () => {
  const shelf = varzia([{ uniqueName: LITH_M1, item: "Lith M1 Relic", aya: 1 }]);

  it("is a farm while Varzia sells a relic for the missing part", () => {
    const prime = vaultedMagPrime(shelf);
    expect(prime.paths.find((path) => path.kind === "relics")?.cost.relics?.stranded).toEqual([]);
    expect(band(prime)).toBe(2);
  });

  it("is plat only once her window expires, or without a world read", () => {
    expect(sortKeys(vaultedMagPrime(shelf, AFTER), "recommended")).toEqual([3, 60]);
    expect(sortKeys(vaultedMagPrime(null), "recommended")).toEqual([3, 60]);
  });

  it("is a farm while Baro sells the relic", () => {
    const atBaro = baro([{ uniqueName: LITH_M1, item: "Lith M1 Relic", ducats: 100 }]);
    expect(band(vaultedMagPrime(atBaro))).toBe(2);
  });
});
