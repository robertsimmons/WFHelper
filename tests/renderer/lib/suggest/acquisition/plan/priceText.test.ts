import { describe, expect, it } from "vitest";

import {
  figuresIn,
  readPrices,
} from "../../../../../../src/lib/suggest/acquisition/plan/priceText.js";

const NONE = { standing: null, syndicate: null };
const VENTKIDS = { standing: "Ventkids Standing", syndicate: "Ventkids" };

describe("readPrices", () => {
  it("lifts a price and rank out of a store activity", () => {
    expect(
      readPrices("Buy the blueprint (Solaris United Rapscallion, 4,000 standing)", NONE),
    ).toMatchObject({
      text: "Buy the blueprint",
      price: [{ currency: "Solaris United Standing", amount: "4,000" }],
      rank: { syndicate: "Solaris United", level: 2 },
      unplaced: [],
    });
  });

  it("keeps the yield in a store meta and takes the rest", () => {
    expect(
      readPrices("20 per craft; Solaris United Outworlder, 2,000 standing", NONE),
    ).toMatchObject({
      text: "20 per craft",
      price: [{ currency: "Solaris United Standing", amount: "2,000" }],
      rank: { syndicate: "Solaris United", level: 1 },
    });
    expect(
      readPrices("10 per refine; 2,000 Entrati standing, Rank 1 Stranger", NONE),
    ).toMatchObject({
      text: "10 per refine",
      price: [{ currency: "Entrati Standing", amount: "2,000" }],
      rank: { syndicate: "Entrati", level: 1 },
    });
  });

  it("reads a plan row note against the group's standing, and Neutral as no rank", () => {
    expect(readPrices("reactor, 5,000 standing, Rank 0: Neutral", VENTKIDS)).toMatchObject({
      text: "reactor",
      price: [{ currency: "Ventkids Standing", amount: "5,000" }],
      rank: null,
      unplaced: [],
    });
    expect(readPrices("10,000 standing, Rank 2: Whozit", VENTKIDS)).toMatchObject({
      text: null,
      rank: { syndicate: "Ventkids", level: 2 },
    });
  });

  it("joins a bare rank level to the title written beside it", () => {
    expect(readPrices("Buy from Little Duck at Rank 2, Agent", NONE)).toMatchObject({
      text: "Buy from Little Duck",
      rank: { syndicate: "Vox Solaris", level: 2 },
    });
  });

  it("marks a reusable blueprint and a per-unit price", () => {
    expect(readPrices("50,000 credits, reusable", NONE)).toMatchObject({
      price: [{ currency: "Credits", amount: "50,000" }],
      reusable: true,
    });
    expect(readPrices("2,500 Vox Solaris standing each", NONE)).toMatchObject({ each: true });
  });

  it("leaves what it cannot place in the text and lists it", () => {
    const beacon = readPrices("5,000 standing per beacon", NONE);
    expect(beacon).toMatchObject({ price: [], text: "5,000 standing per beacon" });
    expect(beacon.unplaced).toEqual(["5,000 standing per beacon"]);
    // A bare standing figure with no syndicate to pay it in is not guessed.
    expect(readPrices("5,000 standing", NONE).unplaced).toEqual(["5,000 standing"]);
    expect(readPrices("~47,000 standing, 1 Forma", VENTKIDS)).toMatchObject({
      price: [],
      unplaced: ["~47,000 standing"],
    });
  });

  it("keeps a foundry line's credits when asked", () => {
    expect(readPrices("12h each, 15,000 cr", NONE, { keepCredits: true })).toMatchObject({
      text: "12h each, 15,000 cr",
      price: [],
      unplaced: [],
    });
  });
});

describe("figuresIn", () => {
  it("finds prices and syndicate ranks, not Mastery or item ranks", () => {
    expect(figuresIn("Rank 3 needs 75 kills, 2,000 standing")).toEqual([
      "2,000 standing",
      "Rank 3",
    ]);
    expect(figuresIn("Ostron rank Trusted")).toEqual(["Ostron rank Trusted"]);
    expect(figuresIn("Mastery Rank 14, gild at rank 30, Intrinsics rank 5")).toEqual([]);
    expect(figuresIn("turn Entrati Family Tokens in")).toEqual([]);
  });
});
