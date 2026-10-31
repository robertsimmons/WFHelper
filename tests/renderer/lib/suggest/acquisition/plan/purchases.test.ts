import { describe, expect, it } from "vitest";

import { inventory } from "./fixtures.js";
import {
  resolvePlan,
  type AuthoredPlan,
} from "../../../../../../src/lib/suggest/acquisition/plan/index.js";
import { planGroup } from "../../../../../../src/lib/suggest/acquisition/plan/materials.js";
import { resourceLookup } from "../../../../../../src/lib/suggest/acquisition/plan/resources.js";
import type { ItemDbEntry, RawInventoryData } from "../../../../../../src/types/inventory.js";

const NOW = Date.parse("2026-01-01T00:00:00Z");
const SOLARIS = "Solaris United Standing";
const VENERDO_BP = "/Lotus/Types/Recipes/Test/VenerdoAlloyBlueprint";
const TRAVOCYTE_BP = "/Lotus/Types/Recipes/Test/TravocyteAlloyBlueprint";

const db: Record<string, ItemDbEntry> = {
  [VENERDO_BP]: { name: "Venerdo Alloy Blueprint" },
  [TRAVOCYTE_BP]: { name: "Travocyte Alloy Blueprint" },
};

const blueprint = (amount: string, extra: object = {}) => ({
  kind: "craft",
  harvestable: false,
  map: null,
  recipe: [{ qty: 1, label: "Ore" }],
  best: {
    place: "FORTUNA, VENUS",
    sub: "Smokefinger",
    activity: "buy the blueprint",
    buy: { price: [{ currency: SOLARIS, amount }], ...extra },
  },
});

const store = resourceLookup({
  Ore: { kind: "farm", best: { place: "ORB VALLIS, VENUS", sub: null, activity: "mine" } },
  [SOLARIS]: { kind: "standing" },
  "Venerdo Alloy": blueprint("2,000", {
    reusable: true,
    rank: { syndicate: "Solaris United", level: 1 },
  }),
  "Travocyte Alloy": blueprint("1,000"),
});

function plan(): AuthoredPlan {
  return {
    name: "Board",
    kind: "kdrive",
    source: "standing",
    effort: 3,
    tradeable: false,
    progress: { have: 0, need: 1, unit: "parts" },
    badges: [],
    prices: [],
    groups: [
      planGroup("foundry", "FOUNDRY", [
        { qty: null, label: "Board", note: null, alt: null, done: false },
      ]),
    ],
    materials: [
      { qty: "40", label: "Venerdo Alloy", note: null },
      { qty: "65", label: "Travocyte Alloy", note: null },
    ],
  };
}

function player(recipes: string[], title = 0): RawInventoryData {
  return {
    ...inventory(),
    Affiliations: [{ Tag: "SolarisSyndicate", Standing: 0, Title: title }],
    Recipes: recipes.map((ItemType) => ({ ItemType, ItemCount: 1 })),
  };
}

function vendorRows(held: RawInventoryData | null) {
  const resolved = resolvePlan(plan(), { itemDb: db, inventory: held, now: NOW, resources: store });
  const group = resolved.groups.find((entry) => entry.sub === "Smokefinger");
  if (!group) throw new Error("no Smokefinger step");
  return { resolved, rows: group.rows };
}

describe("a material bought from a vendor", () => {
  it("carries its blueprint's price and rank and owes it until bought", () => {
    const { resolved, rows } = vendorRows(player([]));
    expect(rows[0].purchase).toMatchObject({
      price: [{ currency: SOLARIS, value: 2_000 }],
      rank: "Outworlder",
      rankMet: false,
      blueprint: true,
      reusable: true,
      owned: false,
    });
    expect(rows.map((row) => row.owes)).toEqual([
      [{ currency: SOLARIS, value: 2_000 }],
      [{ currency: SOLARIS, value: 1_000 }],
    ]);
    expect(resolved.ledger.find((entry) => entry.currency === SOLARIS)).toMatchObject({
      spent: 3_000,
      outstanding: 3_000,
    });
  });

  it("owes nothing for a reusable blueprint the player already holds", () => {
    const { resolved, rows } = vendorRows(player([VENERDO_BP], 1));
    expect(rows[0].purchase).toMatchObject({ owned: true, rankMet: true });
    expect(rows[0].owes).toBeUndefined();
    expect(resolved.ledger.find((entry) => entry.currency === SOLARIS)).toMatchObject({
      spent: 1_000,
      outstanding: 1_000,
    });
  });

  it("still owes a held blueprint nothing marks reusable", () => {
    const { rows } = vendorRows(player([TRAVOCYTE_BP]));
    expect(rows[1].purchase).toMatchObject({ reusable: false, owned: false });
    expect(rows[1].owes).toEqual([{ currency: SOLARIS, value: 1_000 }]);
  });

  it("takes reusable from the item data when the store does not say", () => {
    const reusable = {
      ...db,
      [TRAVOCYTE_BP]: { name: "Travocyte Alloy Blueprint", reusableBlueprint: true },
    };
    const resolved = resolvePlan(plan(), {
      itemDb: reusable,
      inventory: player([TRAVOCYTE_BP]),
      now: NOW,
      resources: store,
    });
    const row = resolved.groups
      .flatMap((group) => group.rows)
      .find((entry) => entry.label === "Travocyte Alloy");
    expect(row?.purchase).toMatchObject({ reusable: true, owned: true });
  });
});
