import { describe, expect, it } from "vitest";
import {
  craftVerb,
  materialGroups,
} from "../../../../../../src/lib/suggest/acquisition/plan/materials.js";
import {
  resourceEntry,
  resourceLookup,
} from "../../../../../../src/lib/suggest/acquisition/plan/resources.js";
import { resources } from "./fixtures.js";

const need = (label: string, qty: number) => ({ label, qty, note: null });

function quantities(needs: ReturnType<typeof need>[]): Record<string, string | null> {
  const rows = materialGroups(needs, resources()).flatMap((group) => group.rows);
  return Object.fromEntries(rows.map((row) => [row.label, row.qty] as const));
}

describe("craft yield", () => {
  it("reads yield from the store and defaults it to one", () => {
    const store = resources();
    expect(store("Marquise Veridos")?.yield).toBe(10);
    expect(store("Cetus Wisp Lens")?.yield).toBe(1);
    expect(store("Rubedo")?.yield).toBe(1);
  });

  it("treats a yield that is not a whole number of at least one as one", () => {
    const store = resourceLookup({
      Zero: { kind: "craft", yield: 0 },
      Fraction: { kind: "craft", yield: 2.5 },
      Text: { kind: "craft", yield: "10" },
    });
    expect([store("Zero")?.yield, store("Fraction")?.yield, store("Text")?.yield]).toEqual([
      1, 1, 1,
    ]);
  });

  it("rounds crafts up to whole batches", () => {
    expect(quantities([need("Marquise Veridos", 15)])).toEqual({
      "Marquise Veridos": "15",
      Veridos: "20",
    });
    expect(quantities([need("Marquise Veridos", 10)]).Veridos).toBe("10");
  });

  it("sums every ask for a craft before rounding up", () => {
    const qty = quantities([need("Marquise Veridos", 4), need("Marquise Veridos", 5)]);
    expect(qty).toEqual({ "Marquise Veridos": "9", Veridos: "10" });
  });

  it("carries batches through a nested recipe", () => {
    expect(quantities([need("Veridos Lens", 4)])).toEqual({
      "Veridos Lens": "4",
      "Marquise Veridos": "4",
      Veridos: "10",
      Rubedo: "100",
    });
  });

  it("rounds a refined part once across a direct ask and a parent's recipe", () => {
    const qty = quantities([need("Veridos Lens", 4), need("Marquise Veridos", 7)]);
    expect(qty["Marquise Veridos"]).toBe("11");
    expect(qty.Veridos).toBe("20");
  });
});

describe("store aliases", () => {
  it("resolves an alias to its target under the alias's own spelling", () => {
    const store = resources();
    expect(store("höllars")).toMatchObject({ name: "Credits", spelled: "Höllars" });
    expect(store("Credits")).toMatchObject({ name: "Credits", spelled: "Credits" });
    expect(store("Höllars")?.tips).toEqual(["Run it on High Risk"]);
  });

  it("drops an alias whose target the store does not name", () => {
    expect(resources()("Ghost")).toBeNull();
  });

  it("merges an alias and its target into one material row", () => {
    const groups = materialGroups([need("Höllars", 10_000), need("Credits", 25_000)], resources());
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      place: "THE INDEX, NEPTUNE",
      bonuses: ["Run it on High Risk"],
    });
    expect(groups[0].rows.map((row) => [row.label, row.qty])).toEqual([["Höllars", "35,000"]]);
  });
});

describe("materialGroups", () => {
  const need = (label: string, qty: number, note: string | null = null) => ({ label, qty, note });

  it("shares one farm group between materials with the same best spot", () => {
    const groups = materialGroups([need("Alloy Plate", 150), need("Rubedo", 300)], resources());
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ type: "farm", place: "GABII, CERES", activity: "Survival" });
    expect(groups[0].rows.map((row) => [row.label, row.qty])).toEqual([
      ["Alloy Plate", "150"],
      ["Rubedo", "300"],
    ]);
  });

  it("carries tips as bonuses, once each", () => {
    const [gabii] = materialGroups([need("Alloy Plate", 1), need("Rubedo", 1)], resources());
    expect(gabii.bonuses).toEqual(["Nekros Desecrate", "Resource booster"]);
  });

  it("expands a craft into its recipe and builds it where the store says", () => {
    const groups = materialGroups(
      [need("Cetus Wisp Lens", 3), need("Rubedo", 100, "for the barrel")],
      resources(),
    );
    expect(groups.map((group) => [group.type, group.place])).toEqual([
      ["farm", "GABII, CERES"],
      ["farm", "ASSUR, URANUS"],
      ["craft", "CETUS"],
    ]);
    expect(groups[0].rows).toMatchObject([{ label: "Rubedo", qty: "106", note: "for the barrel" }]);
    expect(groups[1].rows).toMatchObject([{ label: "Polymer Bundle", qty: "15" }]);
    expect(groups[2].rows).toMatchObject([{ label: "Cetus Wisp Lens", qty: "3" }]);
    expect(groups[2].bonuses).toEqual(["Build in batches"]);
  });

  it("keeps an uncurated entry's spot and drops an unknown into MATERIALS", () => {
    const groups = materialGroups([need("Ferrite", 500), need("Mystery Goo", 2)], resources());
    expect(groups[0]).toMatchObject({ type: "farm", place: "OLYMPUS, MARS", map: "ferrite-map" });
    expect(groups[1]).toMatchObject({ type: "farm", place: "MATERIALS", bonuses: [] });
    expect(groups[1].rows[0].label).toBe("Mystery Goo");
  });
});

describe("vendor purchases", () => {
  const smokefinger = (activity: string, amount: string, level: number | null) => ({
    place: "FORTUNA, VENUS",
    sub: "Smokefinger",
    activity,
    meta: null,
    buy: {
      price: [{ currency: "Solaris United Standing", amount }],
      ...(level ? { rank: { syndicate: "Solaris United", level } } : {}),
      reusable: true,
    },
  });
  const craft = (best: unknown) => ({
    kind: "craft",
    harvestable: false,
    map: null,
    best,
    recipe: [{ qty: 1, label: "Ore" }],
  });
  const store = resourceLookup({
    Ore: { kind: "farm", best: { place: "ORB VALLIS, VENUS", sub: null, activity: "mine" } },
    "Venerdo Alloy": craft(smokefinger("buy the blueprint", "2,000", 1)),
    "Travocyte Alloy": craft(smokefinger("Buy the blueprint", "1,000", null)),
    "Star Amarast": craft(smokefinger("buy the blueprint", "4,000", 2)),
    "Heart Noctrul": craft(smokefinger("buy the blueprint", "1,000", null)),
    "Atmo Systems": {
      kind: "farm",
      best: {
        place: "FORTUNA, VENUS",
        sub: "Little Duck",
        activity: "buy from Little Duck",
        buy: { price: [{ currency: "Vox Solaris Standing", amount: "2,500" }], each: true },
      },
    },
  });
  const needs = ["Venerdo Alloy", "Travocyte Alloy", "Star Amarast", "Heart Noctrul"].map((label) =>
    need(label, 5),
  );

  it("puts everything one vendor sells in one step, one row per material", () => {
    const groups = materialGroups(needs, store);
    const vendor = groups.filter((group) => group.sub === "Smokefinger");
    expect(vendor).toHaveLength(1);
    expect(vendor[0].type).toBe("craft");
    expect(vendor[0].rows.map((row) => row.label)).toEqual([
      "Venerdo Alloy",
      "Travocyte Alloy",
      "Star Amarast",
      "Heart Noctrul",
    ]);
    expect(vendor[0].rows[0].buy).toEqual({
      price: [{ currency: "Solaris United Standing", amount: "2,000" }],
      rank: { syndicate: "Solaris United", level: 1 },
      reusable: true,
      blueprint: true,
    });
    expect(vendor[0].spends).toEqual([{ currency: "Solaris United Standing", amount: "8,000" }]);
  });

  it("prices a bought material per unit and skips a vendor the plan already buys from", () => {
    const [duck] = materialGroups([need("Atmo Systems", 3)], store);
    expect(duck.rows[0].buy).toMatchObject({ each: true });
    expect(duck.spends).toEqual([{ currency: "Vox Solaris Standing", amount: "7,500" }]);
    const covered = materialGroups(needs, store, (_label, source) => source.sub === "Smokefinger");
    expect(covered.flatMap((group) => group.rows).every((row) => !row.buy)).toBe(true);
  });
});

describe("a consumed blueprint is bought once per craft", () => {
  const consumed = (amount: string, currency: string, yields: number) => ({
    kind: "craft",
    harvestable: false,
    map: null,
    yield: yields,
    best: {
      place: "NECRALISK, DEIMOS",
      sub: "Son",
      activity: "buy the blueprint",
      buy: { price: [{ currency, amount }] },
    },
    recipe: [{ qty: 1, label: "Ore" }],
  });
  const store = resourceLookup({
    Ore: { kind: "farm", best: { place: "CAMBION DRIFT, DEIMOS", sub: null, activity: "mine" } },
    Mutagen: consumed("1,250", "Entrati Standing", 1),
    Batch: consumed("1,250", "Entrati Standing", 3),
    Core: consumed("50,000", "Credits", 1),
  });
  const bought = (label: string, qty: number, held = 0) => {
    const owned = (name: string): number => (name === label ? held : 0);
    const groups = materialGroups([need(label, qty)], store, () => false, owned);
    const group = groups.find((entry) => entry.rows.some((row) => row.label === label));
    const row = group?.rows.find((entry) => entry.label === label);
    return { count: row?.buy?.count, spends: group?.spends };
  };

  it.each([
    [1, 1, "1,250"],
    [2, 2, "2,500"],
  ])("buys a yield-one blueprint per unit at %i copies", (qty, count, amount) => {
    expect(bought("Mutagen", qty)).toEqual({
      count,
      spends: [{ currency: "Entrati Standing", amount }],
    });
  });

  it.each([
    [3, 1, "1,250"],
    [6, 2, "2,500"],
    [4, 2, "2,500"],
  ])("buys a yield-three blueprint per whole batch of %i", (qty, count, amount) => {
    expect(bought("Batch", qty)).toEqual({
      count,
      spends: [{ currency: "Entrati Standing", amount }],
    });
  });

  it("buys only for the crafts still short of what is held", () => {
    expect(bought("Batch", 6, 4).count).toBe(1);
    expect(bought("Mutagen", 2, 2).count).toBe(0);
  });

  it("counts a Credits-priced blueprint the same way", () => {
    expect(bought("Core", 2)).toEqual({
      count: 2,
      spends: [{ currency: "Credits", amount: "100,000" }],
    });
  });

  it.each([1, 2])("buys the shipped, reusable Adra Mutagen blueprint once (%i)", (qty) => {
    const groups = materialGroups([need("Adra Mutagen", qty)], resourceEntry);
    const group = groups.find((entry) => entry.rows.some((row) => row.label === "Adra Mutagen"));
    expect(group?.spends).toEqual([{ currency: "Entrati Standing", amount: "1,250" }]);
  });
});

describe("crafted product the player holds", () => {
  const holding =
    (held: Record<string, number>) =>
    (label: string): number =>
      held[label] ?? 0;
  const rows = (needs: ReturnType<typeof need>[], held: Record<string, number>) =>
    materialGroups(needs, resources(), () => false, holding(held)).flatMap((group) => group.rows);
  const qty = (needs: ReturnType<typeof need>[], held: Record<string, number>) =>
    Object.fromEntries(rows(needs, held).map((row) => [row.label, row.qty] as const));

  it("asks the full recipe when none of the product is held", () => {
    expect(qty([need("Marquise Veridos", 15)], {}).Veridos).toBe("20");
  });

  it("asks parts only for the crafts still short when some is held", () => {
    expect(qty([need("Marquise Veridos", 15)], { "Marquise Veridos": 6 }).Veridos).toBe("10");
  });

  it("rounds what is still short up to whole crafts by yield", () => {
    expect(qty([need("Marquise Veridos", 15)], { "Marquise Veridos": 4 }).Veridos).toBe("20");
    expect(qty([need("Marquise Veridos", 15)], { "Marquise Veridos": 5 }).Veridos).toBe("10");
  });

  it("asks no parts, and starts the parts done, once the product is all held", () => {
    const parts = rows([need("Marquise Veridos", 15)], { "Marquise Veridos": 15 });
    expect(parts.find((row) => row.label === "Veridos")).toMatchObject({ qty: "0", done: true });
    expect(parts.find((row) => row.label === "Marquise Veridos")?.done).toBe(false);
  });

  it("nets a nested craft at every depth", () => {
    expect(qty([need("Veridos Lens", 4)], { "Veridos Lens": 1 })).toEqual({
      "Veridos Lens": "4",
      "Marquise Veridos": "2",
      Veridos: "10",
      Rubedo: "50",
    });
    expect(
      qty([need("Veridos Lens", 4)], { "Veridos Lens": 1, "Marquise Veridos": 2 }).Veridos,
    ).toBe("0");
    expect(qty([need("Veridos Lens", 4)], { "Veridos Lens": 4 })).toEqual({
      "Veridos Lens": "4",
      "Marquise Veridos": "0",
      Veridos: "0",
      Rubedo: "0",
    });
  });

  it("nets a part two crafts share by each craft's own holding", () => {
    const needs = [need("Veridos Lens", 3), need("Cetus Wisp Lens", 4)];
    expect(qty(needs, {}).Rubedo).toBe("58");
    expect(qty(needs, { "Veridos Lens": 3 }).Rubedo).toBe("8");
    expect(qty(needs, { "Cetus Wisp Lens": 4 }).Rubedo).toBe("50");
  });

  it("lists a craft after the crafts its recipe holds", () => {
    const crafted = rows([need("Veridos Lens", 4)], {}).filter((row) =>
      ["Veridos Lens", "Marquise Veridos"].includes(row.label),
    );
    expect(crafted.map((row) => row.label)).toEqual(["Marquise Veridos", "Veridos Lens"]);
  });
});

describe("craft verb", () => {
  it("refines a single-input craft and builds any other", () => {
    const store = resources();
    const verb = (label: string) => {
      const entry = store(label);
      if (!entry) throw new Error(`no ${label}`);
      return craftVerb(entry);
    };
    expect(verb("Marquise Veridos")).toBe("refine");
    expect(verb("Veridos Lens")).toBe("build");
  });

  it("refines every shipped gem and builds every shipped alloy and Forma", () => {
    const verb = (label: string) => {
      const entry = resourceEntry(label);
      if (!entry) throw new Error(`no ${label}`);
      return craftVerb(entry);
    };
    expect(["Radiant Zodian", "Marquise Thyst", "Cabochon Embolos"].map(verb)).toEqual([
      "refine",
      "refine",
      "refine",
    ]);
    expect(["Coprite Alloy", "Forma", "Mutagen Mass", "Devolved Namalon"].map(verb)).toEqual([
      "build",
      "build",
      "build",
      "build",
    ]);
  });
});
