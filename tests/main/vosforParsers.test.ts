import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain build script module, no type declarations
import * as vosfor from "../../scripts/suggest/vosfor.mjs";

const { buildVosfor, parseLoidCollections, parseYields } = vosfor;

const LOID = `<section begin=loidogoffer/>
{| class="emodtable"
|-
!Rowspan=2|Arcane Collection
!colspan=4|Rarity
|-
![[File:IconCommon.png|class=icon]]Common
![[File:IconUncommon.png|class=icon]]Uncommon
![[File:IconRare.png|class=icon]]Rare
!|[[File:IconLegendary.png|class=icon]]Legendary
|-
!rowspan=2|[[File:EidolonArcaneCollection.png|120px]]<br>Eidolon
|{{Arcane|Arcane Ice}}
|
|{{Arcane|Arcane Fury}}<br>{{Arcane|Arcane Aegis}}
|{{Arcane|Arcane Barrier}}<br>{{Arcane|Arcane Energize}}<br>{{Arcane|Arcane Grace}}
|-
|'''60%''' ({{Math|60% / 1|round=0.01|percent=y}} × 1)
|'''-'''
|'''35%''' ({{Math|35% / 2|round=0.01|percent=y}} × 2)
|'''5%''' ({{Math|5% / 3|round=0.01|percent=y}} × 3)
|-
|}
<section end=loidogoffer />`;

const ENHANCEMENT = `=== Dissolution ===
All collections cost {{Resource|Vosfor|200}} and {{cc|50,000}} to purchase. Each collection gives '''3''' arcanes per purchase.
*'''Eidolon Arcane Collection'''
**'''60%''' chance for a common arcane ('''60%''' for each common arcane)
**'''35%''' chance for a rare arcane ('''17.5%''' for each rare arcane)
**'''5%''' chance for a legendary arcane ('''1.67%''' for each legendary arcane)
==== Dissolution Efficiency List ====`;

const MODULE = {
  Arcanes: {
    "Arcane Ice": { Name: "Arcane Ice", Dissolution: 12 },
    "Arcane Fury": { Name: "Arcane Fury", Dissolution: 28 },
    "Arcane Aegis": { Name: "Arcane Aegis", Dissolution: 28 },
    "Arcane Barrier": { Name: "Arcane Barrier", Dissolution: 98 },
    "Arcane Energize": { Name: "Arcane Energize", Dissolution: 98 },
    "Arcane Grace": { Name: "Arcane Grace", Dissolution: 98 },
    Unsellable: { Name: "Unsellable", Dissolution: false },
  },
};

describe("parseLoidCollections", () => {
  it("reads each rarity column's arcanes and odds, skipping empty columns", () => {
    expect(parseLoidCollections(LOID)).toEqual([
      {
        name: "Eidolon",
        pools: [
          { rarity: "Common", chance: 60, arcanes: ["Arcane Ice"] },
          { rarity: "Rare", chance: 35, arcanes: ["Arcane Aegis", "Arcane Fury"] },
          {
            rarity: "Legendary",
            chance: 5,
            arcanes: ["Arcane Barrier", "Arcane Energize", "Arcane Grace"],
          },
        ],
      },
    ]);
  });

  it("throws when a pool's arcanes disagree with its × count", () => {
    expect(() => parseLoidCollections(LOID.replace("× 2)", "× 3)"))).toThrow(/Eidolon Rare/);
  });
});

describe("parseYields", () => {
  it("keeps numeric yields only, sorted by name", () => {
    const yields = parseYields(MODULE);
    expect(Object.keys(yields)[0]).toBe("Arcane Aegis");
    expect(yields).not.toHaveProperty("Unsellable");
    expect(yields["Arcane Energize"]).toBe(98);
  });
});

describe("buildVosfor", () => {
  it("prices every collection and turns pool chances into fractions", () => {
    const { data, warnings } = buildVosfor(LOID, ENHANCEMENT, MODULE);
    expect(warnings).toEqual([]);
    expect(data.collections[0]).toMatchObject({ vosfor: 200, credits: 50000, arcanesPerPack: 3 });
    expect(data.collections[0].pools[2].chance).toBe(0.05);
  });

  it("throws when the stated per-arcane chance implies another pool size", () => {
    const off = ENHANCEMENT.replace(
      "'''1.67%''' for each legendary",
      "'''2.5%''' for each legendary",
    );
    expect(() => buildVosfor(LOID, off, MODULE)).toThrow(/Eidolon Legendary: 3 arcanes/);
  });

  it("reports a differing rarity chance instead of throwing", () => {
    const loid = LOID.replace("'''60%''' ({{Math|60% / 1", "'''50%''' ({{Math|50% / 1").replace(
      "'''35%''' ({{Math|35% / 2",
      "'''45%''' ({{Math|45% / 2",
    );
    expect(buildVosfor(loid, ENHANCEMENT, MODULE).warnings).toHaveLength(2);
  });

  it("throws on a pool arcane the data module does not know", () => {
    const loid = LOID.replace("{{Arcane|Arcane Ice}}", "{{Arcane|Arcane Typo}}");
    expect(() => buildVosfor(loid, ENHANCEMENT, MODULE)).toThrow(/Arcane Typo/);
  });
});
