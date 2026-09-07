import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/lib/wfm/backendLite.js", () => ({
  fetchBackendRaw: vi.fn(),
  isBackendLiteConfigured: vi.fn(() => false),
}));
vi.mock("../../../../src/lib/log.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  ONE_FUSION_FROM_CAP,
  TWO_FUSIONS_FROM_CAP,
  VALENCE_CAP,
  valenceOffers,
  valenceTier,
  valenceValueFloor,
} from "../../../../src/lib/suggest/valence.js";
import type { AdversaryVendorsDoc } from "../../../../src/lib/world/adversaryVendors.js";

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

describe("valenceTier", () => {
  it("calls a roll at the cap capped", () => {
    expect(valenceTier(VALENCE_CAP)).toBe("capped");
    expect(valenceTier(59.9)).not.toBe("capped");
  });

  it("calls a roll one further purchase from the cap one away", () => {
    expect(valenceTier(ONE_FUSION_FROM_CAP)).toBe("oneAway");
    expect(valenceTier(55)).toBe("oneAway");
    expect(valenceTier(52.7)).toBe("twoAway");
  });

  it("calls a roll two further purchases from the cap two away", () => {
    expect(valenceTier(TWO_FUSIONS_FROM_CAP)).toBe("twoAway");
    expect(valenceTier(47.9)).toBe("ordinary");
  });

  it("leaves the whole low half of the range ordinary", () => {
    expect(valenceTier(25)).toBe("ordinary");
    expect(valenceTier(40)).toBe("ordinary");
  });
});

describe("valenceValueFloor", () => {
  it("ranks a capped roll above everything and leaves an ordinary one alone", () => {
    expect(valenceValueFloor("capped")).toBeGreaterThan(valenceValueFloor("oneAway"));
    expect(valenceValueFloor("oneAway")).toBeGreaterThan(valenceValueFloor("twoAway"));
    expect(valenceValueFloor("ordinary")).toBe(0);
  });
});

describe("valenceOffers", () => {
  it("takes Eleanor's rows from the batch the clock says is selling, best first", () => {
    const rolls = valenceOffers(DOC, "codaWeapons", NOW);
    expect(rolls.map((roll) => roll.name)).toEqual([
      "Coda Motovore",
      "Coda Mire",
      "Coda Hema",
      "Coda Catabolyst",
      "Coda Pox",
    ]);
    expect(rolls[0]).toMatchObject({ element: "Cold", bonus: 49.2, tier: "twoAway" });
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
