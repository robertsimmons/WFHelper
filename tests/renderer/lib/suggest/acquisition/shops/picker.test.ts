import { describe, expect, it } from "vitest";

import {
  farmNeed,
  pickShop,
  type ShopPickInput,
  type ShopTotal,
} from "../../../../../../src/lib/suggest/acquisition/shops/picker.js";
import type { AuthoredShop } from "../../../../../../src/lib/suggest/acquisition/shops/schema.js";

const C = "Crimson Talent";
const E = "Emerald Talent";

function talent(): AuthoredShop {
  return {
    vendor: "Hunhow",
    place: "Pontis Tower",
    either: true,
    currencies: [
      { name: C, perRun: 14 },
      { name: E, perRun: 14 },
    ],
    wares: [
      { name: "Frame Systems Blueprint", item: "Frame", price: { [C]: 90, [E]: 90 } },
      { name: "Wrath Blueprint", item: "Wrath", price: { [C]: 90 } },
      { name: "Pride Blade Blueprint", item: "Pride", price: { [E]: 45 } },
      { name: "Scene", item: "cosmetic", price: { [C]: 50 } },
    ],
  };
}

function input(overrides: Partial<ShopPickInput> = {}): ShopPickInput {
  return {
    key: "hunhow",
    shop: talent(),
    own: (ware) => ware.item === "Frame",
    crafting: () => 0,
    wanted: (ware) => (ware.item === "Frame" || ware.name === "Pride Blade Blueprint" ? 2 : 1),
    held: () => ({ owned: 0, quest: 0 }),
    balance: (currency) => (currency === C ? 100 : 20),
    flipped: [],
    also: ["Wrath", "Pride"],
    ...overrides,
  };
}

const ids = (shop: ReturnType<typeof pickShop>): string[][] =>
  shop.groups.map((group) => group.units.map((unit) => unit.id));

const rows = (totals: readonly ShopTotal[]) =>
  totals.map((line) => [line.currency, line.balance, line.need, line.short]);

describe("pickShop", () => {
  it("draws one unit per row, sized by what the recipes want, cosmetics last", () => {
    const shop = pickShop(input());
    expect(shop.groups.map((group) => group.item)).toEqual(["Frame", "Wrath", "Pride", "cosmetic"]);
    expect(ids(shop)).toEqual([
      ["Frame Systems Blueprint #1", "Frame Systems Blueprint #2"],
      ["Wrath Blueprint"],
      ["Pride Blade Blueprint #1", "Pride Blade Blueprint #2"],
      ["Scene"],
    ]);
    expect(shop.groups[shop.groups.length - 1].units[0].picked).toBe(false);
    expect(shop.all.picks).toBe(5);
    expect(shop.also).toEqual(["Wrath", "Pride"]);
  });

  it("marks held units owned and a pending quest reward as not to buy", () => {
    const shop = pickShop(
      input({
        held: (ware) => (ware.item === "Frame" ? { owned: 1, quest: 0 } : { owned: 0, quest: 1 }),
      }),
    );
    const [frame, wrath] = shop.groups;
    expect(frame.units.map((unit) => [unit.owned, unit.picked])).toEqual([
      [true, false],
      [false, true],
    ]);
    expect(wrath.units[0]).toMatchObject({ owned: false, quest: true, picked: false });
  });

  it("totals each currency on its own, then the either pool from what they have spare", () => {
    const { all } = pickShop(input());
    // Crimson has 10 spare after its 90, Emerald none, so either is 170 short.
    expect(rows(all.totals)).toEqual([
      [C, 100, 90, 0],
      [E, 20, 90, 70],
      [null, 10, 180, 170],
    ]);
    expect(all.short).toBe(240);
    expect(all.runs).toBe(18);
    expect(all.covered).toBe(false);
  });

  it("asks a farm for its currency's own need plus the pool the others can't pay", () => {
    const { all } = pickShop(input());
    expect(farmNeed(all.totals, C)).toBe(270);
    expect(farmNeed(all.totals, E)).toBe(260);
    const single = pickShop(input({ shop: { ...talent(), either: false } }));
    expect(farmNeed(single.all.totals, C)).toBe(single.all.totals[0].need);
  });

  it("keeps the floor when the pooled figure would undercount it", () => {
    const shop = pickShop(
      input({
        balance: (currency) => (currency === C ? 1000 : 0),
        flipped: ["Frame Systems Blueprint #1", "Frame Systems Blueprint #2"],
      }),
    );
    expect(shop.all.short).toBe(90);
  });

  it("flips a default either way, and a stored flip on an owned unit is moot", () => {
    const shop = pickShop(input({ flipped: ["Wrath Blueprint", "Scene"] }));
    const units = shop.groups.flatMap((group) => group.units);
    expect(units.find((unit) => unit.id === "Wrath Blueprint")?.picked).toBe(false);
    expect(units.find((unit) => unit.id === "Scene")?.picked).toBe(true);
    const owned = pickShop(
      input({ flipped: ["Wrath Blueprint"], held: () => ({ owned: 2, quest: 0 }) }),
    );
    expect(owned.all.picks).toBe(0);
    expect(owned.all.covered).toBe(true);
  });

  it("gives no shortfall or runs while a needed balance is unreadable", () => {
    const { all } = pickShop(input({ balance: () => null }));
    expect(all.short).toBeNull();
    expect(all.runs).toBeNull();
    expect(all.covered).toBeNull();
  });

  it("charges a both-at-once ware in each currency even in an either shop", () => {
    const shop = talent();
    shop.wares = [
      { name: "Trinket Blueprint", item: "Frame", price: { [C]: 12, [E]: 12 }, all: true },
      { name: "Frame Systems Blueprint", item: "Frame", price: { [C]: 90, [E]: 90 } },
    ];
    const picked = pickShop(input({ shop, wanted: () => 1, balance: () => 50 }));
    expect(picked.groups[0].units.map((unit) => unit.either)).toEqual([false, true]);
    expect(rows(picked.all.totals)).toEqual([
      [C, 50, 12, 0],
      [E, 50, 12, 0],
      [null, 76, 90, 14],
    ]);
    expect(picked.all.short).toBe(14);
  });

  it("charges both currencies of a ware outside an either shop, and runs them together", () => {
    const otak: AuthoredShop = {
      vendor: "Otak",
      place: "Necralisk",
      together: true,
      currencies: [
        { name: "Rania Crystal Fragment", perRun: 40 },
        { name: "Belric Crystal Fragment", perRun: 40 },
      ],
      wares: [
        {
          name: "Citrine Blueprint",
          item: "Citrine",
          price: { "Rania Crystal Fragment": 500, "Belric Crystal Fragment": 300 },
        },
      ],
    };
    const shop = pickShop(input({ key: "otak", shop: otak, balance: () => 100 }));
    expect(shop.all.totals.map((line) => line.short)).toEqual([400, 200]);
    expect(shop.all.short).toBe(600);
    expect(shop.all.runs).toBe(10);
  });

  it("estimates no runs when the currency has no per-run yield", () => {
    const loid: AuthoredShop = {
      vendor: "Loid",
      place: "Sanctum Anatomica",
      currencies: [{ name: "Vessel Capillaries" }],
      wares: [{ name: "Onos Blueprint", item: "Onos", price: { "Vessel Capillaries": 360 } }],
    };
    const shop = pickShop(input({ key: "loid", shop: loid, balance: () => 60 }));
    expect(shop.all.short).toBe(300);
    expect(shop.all.runs).toBeNull();
  });
});

const HUSK = "Scuttler Husk";
const BANE = "Kullervo's Bane";

function acrithis(): AuthoredShop {
  return {
    vendor: "Acrithis",
    place: "Dormizone",
    currencies: [
      { name: HUSK, perRun: 18 },
      { name: BANE, perRun: 5 },
    ],
    wares: [
      { name: "Oraxia Blueprint", item: "Oraxia", price: { [HUSK]: 60 } },
      { name: "Oraxia Chassis Blueprint", item: "Oraxia", price: { [HUSK]: 20 } },
      { name: "Thalys Blueprint", item: "Thalys", price: { [HUSK]: 96 } },
      { name: "Kullervo Blueprint", item: "Kullervo", price: { [BANE]: 15 } },
      { name: "Rauta Blueprint", item: "Rauta", price: { [BANE]: 12 } },
    ],
  };
}

function plan(item: string, overrides: Partial<ShopPickInput> = {}) {
  return pickShop(
    input({
      key: "acrithis",
      shop: acrithis(),
      own: (ware) => ware.item === item,
      wanted: () => 1,
      held: (ware) => ({
        owned: ware.name === "Oraxia Blueprint" || ware.item === "Thalys" ? 1 : 0,
        quest: 0,
      }),
      balance: (currency) => (currency === HUSK ? 89 : 14),
      ...overrides,
    }),
  );
}

describe("a plan's share of the shop", () => {
  it("counts only picks priced in a currency its own unbought wares cost", () => {
    const oraxia = plan("Oraxia");
    expect(oraxia.ownWares).toBe(1);
    expect(rows(oraxia.own.totals)).toEqual([
      [HUSK, 89, 20, 0],
      [BANE, 14, 0, 0],
    ]);
    expect(oraxia.own.covered).toBe(true);
    // The picker still prices every pick, Bane included.
    expect(rows(oraxia.all.totals)).toEqual([
      [HUSK, 89, 20, 0],
      [BANE, 14, 27, 13],
    ]);
  });

  it("totals every pick in a currency the plan shares with other items", () => {
    const kullervo = plan("Kullervo");
    expect(rows(kullervo.own.totals)).toEqual([
      [HUSK, 89, 0, 0],
      [BANE, 14, 27, 13],
    ]);
    expect(kullervo.own.short).toBe(13);
  });

  it("counts nothing once the plan's own wares are held", () => {
    const thalys = plan("Thalys");
    expect(thalys.ownWares).toBe(0);
    expect(thalys.own.picks).toBe(0);
    expect(thalys.own.totals.every((line) => line.need === 0)).toBe(true);
  });

  it("owns a ware listed under another item when its recipe consumes it", () => {
    const rauta = plan("Rauta", {
      own: (ware) => ware.item === "Rauta" || ware.name === "Oraxia Chassis Blueprint",
    });
    expect(rauta.ownWares).toBe(2);
    expect(rows(rauta.own.totals)).toEqual([
      [HUSK, 89, 20, 0],
      [BANE, 14, 27, 13],
    ]);
  });

  it("adds what the plan's recipe consumes to that currency's need", () => {
    const kullervo = plan("Kullervo", { crafting: (currency) => (currency === BANE ? 10 : 0) });
    expect(rows(kullervo.own.totals)[1]).toEqual([BANE, 14, 37, 23]);
    expect(rows(kullervo.all.totals)[1]).toEqual([BANE, 14, 27, 13]);
  });
});
