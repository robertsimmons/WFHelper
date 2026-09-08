import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/lib/wfm/backendLite.js", () => ({
  fetchBackendRaw: vi.fn(),
  isBackendLiteConfigured: vi.fn(() => false),
}));
vi.mock("../../../../src/lib/log.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  bestValenceOffer,
  ONE_FUSION_FROM_CAP,
  setValenceRows,
  VALENCE_CAP,
  VALENCE_FINISHED,
  valenceAfterPurchase,
  valenceGain,
  valenceOffers,
  valenceOffersFor,
  valenceRowsFor,
  valenceVerdict,
} from "../../../../src/lib/suggest/valence.js";
import { VALENCE_UPGRADE_TYPE } from "../../../../src/lib/suggest/ownedValence.js";
import type { AdversaryVendorsDoc } from "../../../../src/lib/world/adversaryVendors.js";
import type { ItemDbEntry, RawInventoryData } from "../../../../src/types/inventory.js";
import type { OwnedValence } from "../../../../src/lib/suggest/ownedValence.js";

/** Batch A is the live Coda rotation at this instant. */
const NOW = Date.parse("2026-09-05T12:00:00.000Z");

// The wiki's own tables on 2026-09-06, verbatim.
const DOC: AdversaryVendorsDoc = {
  generatedAt: NOW,
  coda: {
    batch: "A",
    items: [
      { name: "Coda Catabolyst", element: "Magnetic", bonus: 25.5 },
      { name: "Coda Hema", element: "Toxin", bonus: 34.5 },
      { name: "Coda Mire", element: "Impact", bonus: 47 },
      { name: "Coda Motovore", element: "Cold", bonus: 49.2 },
      { name: "Coda Pox", element: "Impact", bonus: 25 },
    ],
  },
  codaNext: {
    batch: "B",
    items: [{ name: "Coda Bubonico", element: "Toxin", bonus: 43.7 }],
  },
  tenet: [
    { name: "Tenet Ferrox", element: "Cold", bonus: 25.7 },
    { name: "Tenet Agendus", element: "Toxin", bonus: 41.1 },
  ],
};

/** One rotation row over the fusion threshold, so gain can separate the table. */
const REACHABLE: AdversaryVendorsDoc = {
  generatedAt: NOW,
  coda: {
    batch: "A",
    items: [
      { name: "Coda Motovore", element: "Cold", bonus: 49.2 },
      { name: "Coda Hema", element: "Toxin", bonus: 54.1 },
    ],
  },
  tenet: [],
};

function held(name: string, percent: number): OwnedValence {
  return { uniqueName: `/Lotus/${name}`, name, element: "Heat", percent };
}

function owned(...rows: OwnedValence[]): Map<string, OwnedValence> {
  return new Map(rows.map((row) => [row.name.toLowerCase(), row]));
}

describe("valenceAfterPurchase", () => {
  it("hands over the offered roll when the player owns no copy", () => {
    expect(valenceAfterPurchase(null, 54.1)).toBe(54.1);
  });

  it("fuses from the better of the two copies", () => {
    expect(valenceAfterPurchase(40, 30)).toBe(44);
    expect(valenceAfterPurchase(30, 40)).toBe(44);
  });

  it("rounds the fusion threshold straight up to the cap", () => {
    expect(valenceAfterPurchase(ONE_FUSION_FROM_CAP, 25)).toBe(VALENCE_CAP);
    expect(valenceAfterPurchase(VALENCE_FINISHED, 25)).toBe(VALENCE_CAP);
    expect(valenceAfterPurchase(52.7, 25)).toBeLessThan(VALENCE_CAP);
  });
});

describe("valenceVerdict", () => {
  it("finds nothing left to do for a weapon at or over the threshold", () => {
    expect(valenceVerdict(VALENCE_CAP, 59)).toBe("done");
    expect(valenceVerdict(VALENCE_FINISHED, 25)).toBe("done");
  });

  it("says any second copy caps a weapon between the bar and the threshold", () => {
    expect(valenceVerdict(ONE_FUSION_FROM_CAP, 25)).toBe("secondCopy");
    expect(valenceVerdict(57.9, 59)).toBe("secondCopy");
  });

  it("caps a weapon owned under the bar when the offer clears it", () => {
    expect(valenceVerdict(30, ONE_FUSION_FROM_CAP)).toBe("caps");
  });

  it("calls an offer over the bar ready when the player owns none", () => {
    expect(valenceVerdict(null, 54.1)).toBe("ready");
  });

  it("calls anything under the bar short, owned or not", () => {
    expect(valenceVerdict(null, 52.7)).toBe("short");
    expect(valenceVerdict(30, 52.7)).toBe("short");
  });
});

describe("valenceGain", () => {
  it("follows the table the plan sets out", () => {
    expect(valenceGain(58, 59)).toBe(0);
    expect(valenceGain(55, 25)).toBe(0.5);
    expect(valenceGain(40, 54)).toBe(1);
    expect(valenceGain(null, 54)).toBe(0.8);
    expect(valenceGain(40, 40)).toBe(0.1);
    expect(valenceGain(null, 40)).toBe(0.1);
  });

  it("ranks a purchase that caps outright above one that only sets it up", () => {
    expect(valenceGain(40, 54)).toBeGreaterThan(valenceGain(null, 54));
    expect(valenceGain(null, 54)).toBeGreaterThan(valenceGain(55, 54));
  });
});

describe("valenceOffers", () => {
  it("takes Eleanor's rows from the batch the clock says is selling", () => {
    const rolls = valenceOffers(DOC, "codaWeapons", NOW);
    expect(rolls.map((roll) => roll.name)).toEqual([
      "Coda Motovore",
      "Coda Mire",
      "Coda Hema",
      "Coda Catabolyst",
      "Coda Pox",
    ]);
    expect(rolls[0]).toMatchObject({ element: "Cold", bonus: 49.2, owned: null, result: 49.2 });
  });

  it("orders by gain rather than by the highest percentage", () => {
    const rolls = valenceOffers(REACHABLE, "codaWeapons", NOW, owned(held("Coda Motovore", 57)));
    // Motovore carries the lower roll and the better gain: the player already
    // owns one over the bar, so any second copy of it caps.
    expect(rolls.map((roll) => roll.name)).toEqual(["Coda Hema", "Coda Motovore"]);
    expect(rolls.map((roll) => roll.verdict)).toEqual(["ready", "secondCopy"]);
  });

  it("reads the player's own percentage and what a purchase would produce", () => {
    const rolls = valenceOffers(REACHABLE, "codaWeapons", NOW, owned(held("Coda Hema", 50)));
    expect(rolls[0]).toMatchObject({
      name: "Coda Hema",
      owned: 50,
      result: VALENCE_CAP,
      verdict: "caps",
      gain: 1,
    });
  });

  it("drops a capped weapon to zero gain without dropping it off the table", () => {
    const rolls = valenceOffers(REACHABLE, "codaWeapons", NOW, owned(held("Coda Hema", 60)));
    expect(rolls.find((roll) => roll.name === "Coda Hema")).toMatchObject({ gain: 0 });
    expect(rolls).toHaveLength(2);
  });

  it("shows no bonuses at all when the doc names neither the live batch", () => {
    const stale: AdversaryVendorsDoc = {
      generatedAt: DOC.generatedAt,
      coda: DOC.codaNext ?? DOC.coda,
      tenet: DOC.tenet,
    };
    expect(valenceOffers(stale, "codaWeapons", NOW)).toEqual([]);
  });

  it("takes Ergo Glast's rows straight, since he holds one stock", () => {
    const rolls = valenceOffers(DOC, "tenetMelee", NOW);
    expect(rolls.map((roll) => roll.name)).toEqual(["Tenet Agendus", "Tenet Ferrox"]);
  });

  it("says nothing for a vendor the wiki tables do not cover", () => {
    expect(valenceOffers(DOC, "baro", NOW)).toEqual([]);
  });

  it("treats a missing doc as unknown rather than a low roll", () => {
    expect(valenceOffers(null, "codaWeapons", NOW)).toEqual([]);
  });
});

describe("valenceOffersFor", () => {
  const HEMA = "/Lotus/Weapons/Infested/InfestedLich/LongGuns/CodaHema";
  const itemDb = { [HEMA]: { name: "Coda Hema" } } as unknown as Record<string, ItemDbEntry>;
  const inventory = {
    LongGuns: [
      {
        ItemType: HEMA,
        UpgradeType: VALENCE_UPGRADE_TYPE,
        UpgradeFingerprint: JSON.stringify({
          compat: HEMA,
          buffs: [{ Tag: "InnateHeatDamage", Value: 957011712 }],
        }),
      },
    ],
  } as unknown as RawInventoryData;

  it("reads the offer against the copy the inventory actually holds", () => {
    const rolls = valenceOffersFor(REACHABLE, "codaWeapons", NOW, inventory, itemDb);
    const hema = rolls.find((roll) => roll.name === "Coda Hema");
    expect(hema).toMatchObject({ owned: 56.2, verdict: "secondCopy", uniqueName: HEMA });
  });

  it("leaves every offer unowned when no inventory was read", () => {
    const rolls = valenceOffersFor(REACHABLE, "codaWeapons", NOW, null, itemDb);
    expect(rolls.every((roll) => roll.owned === null)).toBe(true);
  });
});

describe("bestValenceOffer", () => {
  it("picks the most advancing offer, never the highest percentage", () => {
    const rolls = valenceOffers(REACHABLE, "codaWeapons", NOW, owned(held("Coda Motovore", 57)));
    expect(bestValenceOffer(rolls)?.name).toBe("Coda Hema");
  });

  it("is null when the whole table is already finished", () => {
    const rolls = valenceOffers(
      REACHABLE,
      "codaWeapons",
      NOW,
      owned(held("Coda Motovore", 60), held("Coda Hema", 58)),
    );
    expect(rolls).toHaveLength(2);
    expect(bestValenceOffer(rolls)).toBeNull();
  });
});

describe("valenceRowsFor", () => {
  it("hands the card back the rows the provider computed", () => {
    const rolls = valenceOffers(DOC, "tenetMelee", NOW);
    setValenceRows("vendors:tenetMelee", rolls);
    expect(valenceRowsFor("vendors:tenetMelee").map((row) => row.name)).toEqual([
      "Tenet Agendus",
      "Tenet Ferrox",
    ]);
    expect(valenceRowsFor("vendors:baro")).toEqual([]);
  });

  it("forgets a vendor whose rotation stopped reporting", () => {
    setValenceRows("vendors:codaWeapons", valenceOffers(DOC, "codaWeapons", NOW));
    setValenceRows("vendors:codaWeapons", []);
    expect(valenceRowsFor("vendors:codaWeapons")).toEqual([]);
  });
});
