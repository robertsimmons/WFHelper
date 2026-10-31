import { describe, expect, it } from "vitest";

import { resources, rhinoPlan } from "../plan/fixtures.js";
import {
  authoredPlans,
  validatePlan,
} from "../../../../../../src/lib/suggest/acquisition/plan/index.js";
import { authoredShops } from "../../../../../../src/lib/suggest/acquisition/shops/data.js";
import { validateShop } from "../../../../../../src/lib/suggest/acquisition/shops/validate.js";
import type { AuthoredShop } from "../../../../../../src/lib/suggest/acquisition/shops/schema.js";

const PLANS = new Set(authoredPlans().map((plan) => plan.name));

function talentShop(): AuthoredShop {
  return {
    vendor: "Hunhow",
    place: "Pontis Tower, Uranus Proxima",
    either: true,
    currencies: [{ name: "Crimson Talent", perRun: 14 }, { name: "Emerald Talent" }],
    wares: [
      {
        name: "Wrath Blueprint",
        item: "Wrath",
        price: { "Crimson Talent": 90 },
      },
      {
        name: "Kuva Wytch Scene",
        item: "cosmetic",
        price: { "Crimson Talent": 25, "Emerald Talent": 25 },
      },
    ],
  };
}

describe("validateShop", () => {
  it("accepts every shop that ships with the app", () => {
    const failures = [...authoredShops()]
      .map(([key, shop]) => [key, validateShop(shop, PLANS)] as const)
      .filter(([, problems]) => problems.length > 0);
    expect(failures).toEqual([]);
  });

  it("accepts a well-formed shop", () => {
    expect(validateShop(talentShop(), PLANS)).toEqual([]);
  });

  it("takes a ware only for a planned item or a cosmetic", () => {
    const shop = talentShop();
    shop.wares[0].item = "Not A Planned Item";
    expect(validateShop(shop, PLANS)).toEqual([
      'wares[0].item must be "cosmetic" or the name of a plan',
    ]);
  });

  it("prices a ware only in the shop's own currencies, in whole units", () => {
    const shop = talentShop();
    shop.wares[0].price = { Credits: 90, "Crimson Talent": 0 };
    expect(validateShop(shop, PLANS)).toEqual([
      "wares[0].price.Credits is not one of the shop's currencies",
      "wares[0].price.Crimson Talent must be a whole number above 0",
    ]);
  });

  it("rejects a currency the store does not spell that way", () => {
    const shop = talentShop();
    shop.currencies[1].name = "emerald talent";
    expect(validateShop(shop, PLANS)).toContain(
      'currencies[1].name "emerald talent" must be spelled "Emerald Talent"',
    );
  });

  it("rejects a repeated ware, and both-at-once on a single price", () => {
    const shop = talentShop();
    shop.wares[1] = { ...shop.wares[0], all: true };
    expect(validateShop(shop, PLANS)).toEqual([
      "wares[1].all must be true and needs a price in two currencies",
      "wares[1].name repeats a ware",
    ]);
  });

  it("needs two currencies before either can pay", () => {
    const shop = talentShop();
    shop.currencies = [shop.currencies[0]];
    shop.wares = [shop.wares[0]];
    expect(validateShop(shop, PLANS)).toEqual(["either needs two currencies"]);
  });
});

describe("validatePlan against shops", () => {
  const shops = (key: string): AuthoredShop | null => (key === "hunhow" ? talentShop() : null);

  it("needs the shop file to exist and to sell the plan's item", () => {
    expect(validatePlan({ ...rhinoPlan(), shop: "nowhere" }, resources(), shops)).toEqual([
      'shop "nowhere" has no shop file',
    ]);
    expect(validatePlan({ ...rhinoPlan(), shop: "hunhow" }, resources(), shops)).toEqual([
      'shop "hunhow" sells nothing for Rhino',
    ]);
    expect(
      validatePlan({ ...rhinoPlan(), name: "Wrath", shop: "hunhow" }, resources(), shops),
    ).toEqual([]);
  });
});
