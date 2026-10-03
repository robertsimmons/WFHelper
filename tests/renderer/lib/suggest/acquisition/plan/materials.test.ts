import { describe, expect, it } from "vitest";
import { materialGroups } from "../../../../../../src/lib/suggest/acquisition/plan/materials.js";
import { resourceLookup } from "../../../../../../src/lib/suggest/acquisition/plan/resources.js";
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

  it("lists alternates under Other spots rather than dropping them", () => {
    const [alone] = materialGroups([need("Alloy Plate", 1)], resources());
    expect(alone.disclosures).toEqual([
      { title: "Other spots", body: "DRACO, CERES (Interception); TESSERA, VENUS" },
    ]);
    const [shared] = materialGroups([need("Rubedo", 1), need("Alloy Plate", 1)], resources());
    expect(shared.disclosures).toEqual([
      { title: "Other spots", body: "Alloy Plate: DRACO, CERES (Interception); TESSERA, VENUS" },
    ]);
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
