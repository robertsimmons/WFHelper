import { afterEach, describe, expect, it } from "vitest";

import {
  liveVendorOffers,
  vendorsProvider,
} from "../../../../src/lib/suggest/providers/vendors.js";
import {
  resetValenceDocForTest,
  setValenceDocForTest,
} from "../../../../src/lib/suggest/valence.js";
import type { AdversaryVendorsDoc } from "../../../../src/lib/world/adversaryVendors.js";
import { defaultPreferences } from "../../../../src/lib/suggest/preferences.js";
import { ownedRewardFor } from "../../../../src/lib/suggest/ownedRewards.js";
import { rewardValue } from "../../../../src/lib/suggest/rewards.js";
import { bandFor, worthGroupOf } from "../../../../src/lib/suggest/score.js";
import { vendorOffers } from "../../../../src/lib/suggest/vendorOffers.js";
import { UNRESOLVED_WORTH } from "../../../../src/lib/suggest/worthLadder.js";
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

/** Where the shipped worth ladder puts a reward, which is the only worth input. */
function worth(name: string): number {
  return rewardValue(defaultPreferences(), name) ?? 0;
}

const MOTOVORE_WORTH = worth("Coda Motovore");

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

const MOTOVORE = "/Lotus/Weapons/Infested/InfestedLich/Melee/InfestedHammer/InfLichHammerWeapon";
const POX = "/Lotus/Weapons/Infested/InfestedLich/Pistols/CodaPox";

const VALENCE_ITEM_DB = {
  [MOTOVORE]: { name: "Coda Motovore" },
  [POX]: { name: "Coda Pox" },
} as unknown as Record<string, ItemDbEntry>;

/** A weapon row shaped as the real export writes it: the valence upgrade sits on
 *  the weapon itself and its percentage is encoded in the fingerprint. */
function ownedWeapon(itemType: string, percent: number) {
  const value = Math.round(((percent - 25) / 35) * 0x3fffffff);
  return {
    ItemType: itemType,
    UpgradeType: "/Lotus/Weapons/Grineer/KuvaLich/Upgrades/InnateDamageRandomMod",
    UpgradeFingerprint: JSON.stringify({
      compat: itemType,
      buffs: [{ Tag: "InnateHeatDamage", Value: value }],
    }),
  };
}

/** The player holding a Motovore at `motovore`, and optionally a Pox too. */
function codaContext(motovore: number, pox?: number): SuggestionContext {
  return context({
    itemDb: VALENCE_ITEM_DB,
    inventory: {
      Melee: [ownedWeapon(MOTOVORE, motovore)],
      Pistols: pox === undefined ? [] : [ownedWeapon(POX, pox)],
    } as unknown as SuggestionContext["inventory"],
  });
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

  it("suggests Varzia while her window is open, with her own manifest", () => {
    const world = {
      vaultTrader: {
        activation: new Date(NOW - 24 * HOUR).toISOString(),
        expiry: new Date(NOW + 24 * HOUR).toISOString(),
        inventory: [{ uniqueName: "/Lotus/Types/Relic", item: "Lith A1 Relic" }],
      },
    } as unknown as WorldState;
    const varzia = draft(context({ world }), "vendors:varzia");
    expect(varzia?.category).toBe("vendor");
    expect(varzia?.details?.pool).toEqual(["Lith A1 Relic"]);
    expect(varzia?.wiki).toBe("Prime Resurgence");
  });

  it("says nothing about Varzia before her window opens", () => {
    const world = {
      vaultTrader: {
        activation: new Date(NOW + 24 * HOUR).toISOString(),
        expiry: new Date(NOW + 72 * HOUR).toISOString(),
        inventory: [],
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

  it("sinks a rotation holding nothing over the fusion threshold", () => {
    setValenceDocForTest(valenceDoc(49.2));
    const coda = draft(context(), "vendors:codaWeapons");
    expect(coda?.reward?.name).toBe("Coda Motovore");
    expect(coda?.signals.value).toBeLessThan(
      draft(context({ prefs: prefs() }), "vendors:palladino")?.signals.value ?? 0,
    );
  });

  it("marks an offer over the threshold as worth the trip", () => {
    setValenceDocForTest(valenceDoc(53.1));
    const coda = draft(context(), "vendors:codaWeapons");
    // Worth is the weapon's own; how far the roll carries this player is gain.
    expect(coda?.signals.value).toBeCloseTo(MOTOVORE_WORTH, 10);
    expect(coda?.signals.gain).toBeCloseTo(0.8, 10);
  });

  it("tops the vendor out for the offer that caps a weapon the player owns", () => {
    setValenceDocForTest(valenceDoc(53.1));
    const coda = draft(codaContext(40), "vendors:codaWeapons");
    expect(coda?.reward?.name).toBe("Coda Motovore");
    expect(coda?.signals.value).toBeCloseTo(MOTOVORE_WORTH, 10);
  });

  it("picks the offer that advances the player over the higher roll", () => {
    setValenceDocForTest(valenceDoc(53.1));
    // The player's own Motovore is already over the threshold, so any second
    // copy caps it; the 25% Pox on the same table cannot be beaten by a roll.
    const coda = draft(codaContext(57), "vendors:codaWeapons");
    expect(coda?.reward?.name).toBe("Coda Motovore");
    expect(coda?.signals.value).toBeCloseTo(MOTOVORE_WORTH, 10);
    expect(coda?.signals.gain).toBeCloseTo(0.5, 10);
  });

  it("shows the vendor at zero worth when nothing on offer helps", () => {
    setValenceDocForTest(valenceDoc(53.1));
    const coda = draft(codaContext(60, 60), "vendors:codaWeapons");
    expect(coda?.id).toBe("vendors:codaWeapons");
    expect(coda?.signals.value).toBe(0);
    expect(coda?.signals.gain).toBeUndefined();
  });

  it("reads an unreported rotation as unknown rather than as empty", () => {
    setValenceDocForTest(null);
    const coda = draft(context(), "vendors:codaWeapons");
    // The best weapon the rotation could hold, since nothing says what it does.
    expect(coda?.signals.value).toBeCloseTo(worth("Coda Bubonico"), 10);
    expect(coda?.whySegments).toBeUndefined();
    expect(coda?.reward?.name).toBe(vendorOffers("codaWeapons")[0].name);
  });

  it("scores a stall off the worth ladder, not a per-vendor constant", () => {
    const bird3 = draft(context(), "vendors:bird3");
    expect(bird3?.signals.value).toBeCloseTo(worth("Azure Archon Shard"), 10);
    expect(worthGroupOf(bird3!)).toBe("must");
    expect(bandFor(bird3!, NOW)).toBe(2);
  });

  it("keeps a stall in its own band as its rotation is about to reroll", () => {
    // The grid flips in four hours and Eleanor is still there afterwards holding
    // new rolls, so the window is not a deadline and cannot promote her over an
    // Archon Shard task with days of its week left.
    setValenceDocForTest(null);
    const nowMs = Date.parse("2026-09-08T20:00:00Z");
    const coda = draft(context({ nowMs }), "vendors:codaWeapons");
    expect(worthGroupOf(coda!)).toBe("want");
    expect(coda?.details?.rerolls).toBe(true);
    expect(bandFor(coda!, nowMs)).toBe(2);
  });

  it("promotes the shard Bird 3 is holding this week, not the top of the table", () => {
    // The ladder rates the three colours apart, so a card written off the static
    // table headlines Azure and prices Azure two weeks in three.
    const weeks = [
      ["2026-08-24T12:00:00Z", "Crimson Archon Shard"],
      ["2026-08-31T12:00:00Z", "Azure Archon Shard"],
      ["2026-09-07T12:00:00Z", "Amber Archon Shard"],
    ] as const;
    for (const [iso, name] of weeks) {
      const nowMs = Date.parse(iso);
      expect(liveVendorOffers("bird3", nowMs).map((offer) => offer.name)).toEqual([name]);
      const bird3 = draft(context({ nowMs }), "vendors:bird3");
      expect(bird3?.reward?.name).toBe(name);
      expect(bird3?.reward?.uniqueName).toBe(
        vendorOffers("bird3").find((offer) => offer.name === name)?.uniqueName,
      );
      expect(bird3?.signals.value).toBeCloseTo(worth(name), 10);
    }
  });

  it("leaves a stall whose stock does not rotate on its whole table", () => {
    const acrithis = liveVendorOffers("acrithis", NOW);
    expect(acrithis).toEqual(vendorOffers("acrithis"));
    expect(acrithis.length).toBeGreaterThan(1);
  });

  it("prices Darvo and Varzia flat, whatever they happen to be holding", () => {
    // Darvo discounts one arbitrary market item and Varzia sells vaulted relics
    // by the fistful, so neither stall is worth pricing. They show so the trip
    // is not forgotten, and nothing more.
    const world = {
      vaultTrader: {
        activation: new Date(NOW - 24 * HOUR).toISOString(),
        expiry: new Date(NOW + 24 * HOUR).toISOString(),
        inventory: [{ uniqueName: "/Lotus/Types/Relic", item: "Lith A1 Relic" }],
      },
      dailyDeals: [{ item: "Rubico Prime", expiry: new Date(NOW + 6 * HOUR).toISOString() }],
    } as unknown as WorldState;

    const varzia = draft(context({ world }), "vendors:varzia");
    const darvo = draft(context({ world }), "vendors:darvo");
    expect(varzia).toBeDefined();
    expect(darvo).toBeDefined();
    expect(worthGroupOf(varzia!)).toBe("filler");
    expect(worthGroupOf(darvo!)).toBe("filler");
  });

  it("is worth the best thing on the table, never a sum or an average", () => {
    const acrithis = draft(context(), "vendors:acrithis");
    // Her table runs to two dozen offers; the adapter at the top of it is the
    // whole of what she is worth.
    expect(acrithis?.signals.value).toBeCloseTo(worth("Primary Arcane Adapter"), 10);
    expect(draft(context(), "vendors:yonta")?.signals.value).toBeCloseTo(worth("Kuva"), 10);
  });

  it("keeps a stall worth a resource the player already has plenty of", () => {
    const AZURE = "/Lotus/Types/Gameplay/NarmerSorties/ArchonCrystalBoreal";
    const ctx = context({
      itemDb: { [AZURE]: { name: "Azure Archon Shard" } } as unknown as Record<string, ItemDbEntry>,
      inventory: {
        MiscItems: [{ ItemType: AZURE, ItemCount: 9 }],
      } as unknown as SuggestionContext["inventory"],
    });
    expect(draft(ctx, "vendors:bird3")?.signals.value).toBeCloseTo(worth("Azure Archon Shard"), 10);
  });

  it("stops counting mastery gear on the table the player already owns", () => {
    const BUBONICO =
      "/Lotus/Weapons/Infested/InfestedLich/LongGuns/CodaBubonico/CodaBubonicoCannon";
    const world = {
      voidTrader: {
        activation: new Date(NOW - 4 * HOUR).toISOString(),
        expiry: new Date(NOW + 40 * HOUR).toISOString(),
        inventory: [{ item: "Coda Bubonico" }, { item: "Kuva" }],
      },
    } as unknown as WorldState;
    const itemDb = {
      [BUBONICO]: { name: "Coda Bubonico", masterable: true },
    } as unknown as Record<string, ItemDbEntry>;
    const stocked = draft(context({ world, itemDb }), "vendors:baro");
    expect(stocked?.signals.value).toBeCloseTo(worth("Coda Bubonico"), 10);

    const owned = draft(
      context({
        world,
        itemDb,
        inventory: {
          LongGuns: [{ ItemType: BUBONICO }],
        } as unknown as SuggestionContext["inventory"],
      }),
      "vendors:baro",
    );
    expect(owned?.signals.value).toBeCloseTo(worth("Kuva"), 10);
  });

  it("reads a stall whose manifest has not landed as unknown, not worthless", () => {
    const world = {
      voidTrader: {
        activation: new Date(NOW - 4 * HOUR).toISOString(),
        expiry: new Date(NOW + 40 * HOUR).toISOString(),
        inventory: [],
      },
    } as unknown as WorldState;
    const baro = draft(context({ world }), "vendors:baro");
    expect(baro?.signals.value).toBe(UNRESOLVED_WORTH);
    expect(baro?.signals.value).toBeGreaterThan(0);
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
    ).toEqual({ owned: 3, built: 2, stacks: true });
  });
});
