import { afterEach, describe, expect, it } from "vitest";

import { vendorsProvider } from "../../../../src/lib/suggest/providers/vendors.js";
import {
  resetValenceDocForTest,
  setValenceDocForTest,
} from "../../../../src/lib/suggest/valence.js";
import type { AdversaryVendorsDoc } from "../../../../src/lib/world/adversaryVendors.js";
import { defaultPreferences } from "../../../../src/lib/suggest/preferences.js";
import { ownedRewardFor } from "../../../../src/lib/suggest/ownedRewards.js";
import { vendorOffers } from "../../../../src/lib/suggest/vendorOffers.js";
import type { ItemDbEntry } from "../../../../src/types/inventory.js";
import type { Translator } from "../../../../src/lib/i18n.js";
import type { TrackerState } from "../../../../src/lib/world/dailies.js";
import type { ActivityPref, SuggestionContext } from "../../../../src/types/suggest.js";
import type { WorldState } from "../../../../src/types/world.js";

const NOW = Date.parse("2026-09-05T12:00:00Z");
const HOUR = 60 * 60_000;
const t = ((key: string) => key) as unknown as Translator;

function tracker(overrides: Partial<TrackerState> = {}): TrackerState {
  return { progress: {}, hidden: [], periods: {}, custom: [], seq: 0, ...overrides };
}

function prefs(activities: Record<string, ActivityPref> = {}) {
  return { ...defaultPreferences(), activities };
}

function context(overrides: Partial<SuggestionContext> = {}): SuggestionContext {
  return {
    world: null,
    inventory: null,
    itemDb: {},
    inventoryModifiedAt: null,
    mastery: null,
    relicDb: null,
    plat: null,
    tracker: tracker(),
    prefs: prefs(),
    dropPools: {},
    nowMs: NOW,
    t,
    ...overrides,
  };
}

function baroWorld(leavesInMs: number): WorldState {
  return {
    voidTrader: {
      activation: new Date(NOW - 4 * HOUR).toISOString(),
      expiry: new Date(NOW + leavesInMs).toISOString(),
      location: "Larunda Relay (Mercury)",
      inventory: [
        { uniqueName: "/Lotus/Types/Mod1", item: "Primed Continuity", ducats: 350 },
        { uniqueName: "/Lotus/Types/Mod2", item: "Primed Flow", ducats: 350 },
      ],
    },
  } as unknown as WorldState;
}

/** Batch A is Eleanor's live rotation at NOW; Coda Motovore carries the top roll. */
function valenceDoc(motovoreBonus: number): AdversaryVendorsDoc {
  return {
    generatedAt: NOW,
    coda: {
      batch: "A",
      items: [
        { name: "Coda Motovore", element: "Cold", bonus: motovoreBonus },
        { name: "Coda Pox", element: "Impact", bonus: 25 },
      ],
    },
    tenet: [],
  };
}

function ids(ctx: SuggestionContext): string[] {
  return vendorsProvider.collect(ctx).map((draft) => draft.id);
}

function draft(ctx: SuggestionContext, id: string) {
  return vendorsProvider.collect(ctx).find((entry) => entry.id === id);
}

describe("vendorsProvider", () => {
  afterEach(() => {
    resetValenceDocForTest();
  });

  it("says nothing about a travelling vendor without world data", () => {
    expect(ids(context())).not.toContain("vendors:baro");
    expect(ids(context())).not.toContain("vendors:darvo");
  });

  it("says nothing about a vendor who has not arrived", () => {
    const world = {
      voidTrader: {
        activation: new Date(NOW + 24 * HOUR).toISOString(),
        expiry: new Date(NOW + 72 * HOUR).toISOString(),
        location: "Larunda Relay (Mercury)",
        inventory: [],
      },
    } as unknown as WorldState;
    expect(ids(context({ world }))).not.toContain("vendors:baro");
  });

  it("says nothing about Varzia, who Next Up no longer covers", () => {
    const world = {
      vaultTrader: {
        activation: new Date(NOW - 24 * HOUR).toISOString(),
        expiry: new Date(NOW + 24 * HOUR).toISOString(),
        inventory: [{ uniqueName: "/Lotus/Types/Relic", item: "Lith A1 Relic" }],
      },
    } as unknown as WorldState;
    expect(ids(context({ world }))).not.toContain("vendors:varzia");
  });

  it("suggests Baro while he is in the relay", () => {
    const baro = draft(context({ world: baroWorld(40 * HOUR) }), "vendors:baro");
    expect(baro?.category).toBe("vendor");
    expect(baro?.wiki).toBe("Baro Ki'Teer");
  });

  it("surfaces the manifest for the details view", () => {
    const baro = draft(context({ world: baroWorld(40 * HOUR) }), "vendors:baro");
    expect(baro?.details?.pool).toEqual(["Primed Continuity", "Primed Flow"]);
  });

  it("grows more urgent as the window closes", () => {
    const early = draft(context({ world: baroWorld(60 * HOUR) }), "vendors:baro");
    const late = draft(context({ world: baroWorld(4 * HOUR) }), "vendors:baro");
    expect(late?.signals.urgency).toBeGreaterThan(early?.signals.urgency ?? 0);
  });

  it("fingerprints a visit so a dismissal lifts on the next rotation", () => {
    const first = draft(context({ world: baroWorld(40 * HOUR) }), "vendors:baro");
    const later = {
      voidTrader: {
        activation: new Date(NOW + 14 * 24 * HOUR).toISOString(),
        expiry: new Date(NOW + 16 * 24 * HOUR).toISOString(),
        location: "Larunda Relay (Mercury)",
        inventory: [],
      },
    } as unknown as WorldState;
    const next = draft(context({ world: later, nowMs: NOW + 15 * 24 * HOUR }), "vendors:baro");
    expect(next?.fingerprint).not.toBe(first?.fingerprint);
  });

  it("drops a visit the user already ticked off", () => {
    const world = baroWorld(40 * HOUR);
    const activation = (world.voidTrader as { activation: string }).activation;
    const ctx = context({
      world,
      tracker: tracker({ progress: { baro: { key: `baro:${activation}`, count: 1 } } }),
    });
    expect(ids(ctx)).not.toContain("vendors:baro");
  });

  it("respects a vendor the user hid in the tracker", () => {
    const ctx = context({ world: baroWorld(40 * HOUR), tracker: tracker({ hidden: ["baro"] }) });
    expect(ids(ctx)).not.toContain("vendors:baro");
  });

  it("hides a vendor rated never and keeps one rated low, last", () => {
    const world = baroWorld(40 * HOUR);
    expect(ids(context({ world, prefs: prefs({ baro: "never" }) }))).not.toContain("vendors:baro");
    const low = draft(context({ world, prefs: prefs({ baro: "low" }) }), "vendors:baro");
    expect(low?.deprioritized).toBe(true);
  });

  it("suggests Darvo's deal, which carries no arrival time", () => {
    const world = {
      dailyDeals: [
        {
          uniqueName: "/Lotus/Types/Deal",
          item: "Rubico Prime",
          salePrice: 60,
          discount: 50,
          sold: 100,
          total: 300,
          expiry: new Date(NOW + 6 * HOUR).toISOString(),
        },
      ],
    } as unknown as WorldState;
    const darvo = draft(context({ world }), "vendors:darvo");
    expect(darvo?.details?.pool).toEqual(["Rubico Prime"]);
    expect(darvo?.signals.urgency).toBeGreaterThan(0);
  });

  it("keeps the real manifest and offers no curated stand-in for it", () => {
    const baro = draft(context({ world: baroWorld(40 * HOUR) }), "vendors:baro");
    expect(baro?.details?.pool).toEqual(["Primed Continuity", "Primed Flow"]);
    expect(baro?.reward).toBeUndefined();
  });

  it("suggests a vendor world state says nothing about", () => {
    const palladino = draft(context(), "vendors:palladino");
    expect(palladino?.category).toBe("vendor");
    expect(palladino?.details?.pool).toBeUndefined();
    expect(palladino?.details?.expiry).toBe("2026-09-07T00:00:00.000Z");
  });

  it("puts the most valuable curated offering on the card", () => {
    const palladino = draft(context(), "vendors:palladino");
    expect(palladino?.reward?.name).toBe(vendorOffers("palladino")[0].name);
    const coda = draft(context(), "vendors:codaWeapons");
    expect(coda?.reward).toEqual({ name: "Coda Pox", uniqueName: expect.any(String) });
  });

  it("counts down a four-day vendor to its own rotation", () => {
    const coda = draft(context(), "vendors:codaWeapons");
    expect(coda?.details?.expiry).toBe("2026-09-09T00:00:00.000Z");
    const later = draft(context({ nowMs: NOW + 3 * 24 * HOUR }), "vendors:codaWeapons");
    expect(later?.signals.urgency).toBeGreaterThan(coda?.signals.urgency ?? 0);
  });

  it("leaves a vendor the curated table never named exactly as it was", () => {
    expect(vendorOffers("darvo")).toEqual([]);
    expect(vendorOffers("nobody")).toEqual([]);
    const world = {
      dailyDeals: [{ item: "Rubico Prime", expiry: new Date(NOW + 6 * HOUR).toISOString() }],
    } as unknown as WorldState;
    const darvo = draft(context({ world }), "vendors:darvo");
    expect(darvo?.details?.pool).toEqual(["Rubico Prime"]);
    expect(darvo?.reward).toBeUndefined();
  });

  it("hides a curated vendor rated never and keeps one rated low, last", () => {
    expect(ids(context({ prefs: prefs({ palladino: "never" }) }))).not.toContain(
      "vendors:palladino",
    );
    const low = draft(context({ prefs: prefs({ palladino: "low" }) }), "vendors:palladino");
    expect(low?.deprioritized).toBe(true);
  });

  it("says nothing about a deal that sold out or expired", () => {
    const soldOut = {
      dailyDeals: [
        {
          item: "Rubico Prime",
          sold: 300,
          total: 300,
          expiry: new Date(NOW + 6 * HOUR).toISOString(),
        },
      ],
    } as unknown as WorldState;
    expect(ids(context({ world: soldOut }))).not.toContain("vendors:darvo");

    const expired = {
      dailyDeals: [{ item: "Rubico Prime", expiry: new Date(NOW - HOUR).toISOString() }],
    } as unknown as WorldState;
    expect(ids(context({ world: expired }))).not.toContain("vendors:darvo");
  });

  it("names the best roll on offer and pushes the vendor up for it", () => {
    setValenceDocForTest(valenceDoc(49.2));
    const coda = draft(context(), "vendors:codaWeapons");
    expect(coda?.reward?.name).toBe("Coda Motovore");
    expect(coda?.signals.value).toBeGreaterThan(
      draft(context({ prefs: prefs() }), "vendors:palladino")?.signals.value ?? 1,
    );
    expect(coda?.whySegments?.[1]).toEqual({ text: "nextUp.whyValenceTwoAway" });
    expect(coda?.details?.pool?.[0]).toBe("nextUp.valenceOffer");
  });

  it("marks a roll one purchase from the cap as worth the trip", () => {
    setValenceDocForTest(valenceDoc(53.1));
    const coda = draft(context(), "vendors:codaWeapons");
    expect(coda?.whySegments?.[1]).toEqual({ text: "nextUp.whyValenceOneAway", tone: "good" });
    expect(coda?.signals.value).toBe(0.8);
  });

  it("tops the vendor out for a roll already at the cap", () => {
    setValenceDocForTest(valenceDoc(60));
    const coda = draft(context(), "vendors:codaWeapons");
    expect(coda?.whySegments?.[1]).toEqual({ text: "nextUp.whyValenceCapped", tone: "good" });
    expect(coda?.signals.value).toBe(1);
  });

  it("leaves an unreported rotation exactly where the table puts it", () => {
    setValenceDocForTest(null);
    const coda = draft(context(), "vendors:codaWeapons");
    expect(coda?.signals.value).toBe(0.45);
    expect(coda?.whySegments).toBeUndefined();
    expect(coda?.reward?.name).toBe(vendorOffers("codaWeapons")[0].name);
  });

  it("counts what the player owns and has built of a curated offering", () => {
    const CLEM_BP = "/Lotus/Types/Recipes/Components/ClemBallBlueprint";
    const CLEM = "/Lotus/Types/Restoratives/Consumable/ClemBall";
    const itemDb = {
      [CLEM_BP]: { name: "Clem Clone Blueprint", buildsProduct: CLEM },
    } as unknown as Record<string, ItemDbEntry>;
    const offer = vendorOffers("clem")[0];
    expect(offer.uniqueName).toBe(CLEM_BP);
    expect(
      ownedRewardFor(
        offer,
        itemDb,
        new Map([
          [CLEM_BP, 3],
          [CLEM, 2],
        ]),
      ),
    ).toEqual({ owned: 3, built: 2 });
  });
});
