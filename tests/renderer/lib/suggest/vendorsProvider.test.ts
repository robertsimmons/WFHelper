import { describe, expect, it } from "vitest";

import { vendorsProvider } from "../../../../src/lib/suggest/providers/vendors.js";
import { defaultPreferences } from "../../../../src/lib/suggest/preferences.js";
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

function ids(ctx: SuggestionContext): string[] {
  return vendorsProvider.collect(ctx).map((draft) => draft.id);
}

function draft(ctx: SuggestionContext, id: string) {
  return vendorsProvider.collect(ctx).find((entry) => entry.id === id);
}

describe("vendorsProvider", () => {
  it("suggests nothing without world data", () => {
    expect(ids(context())).toEqual([]);
  });

  it("says nothing about a vendor who has not arrived", () => {
    const world = {
      voidTrader: {
        activation: new Date(NOW + 24 * HOUR).toISOString(),
        expiry: new Date(NOW + 72 * HOUR).toISOString(),
        location: "Larunda Relay (Mercury)",
        inventory: [],
      },
      vaultTrader: {
        activation: new Date(NOW + 48 * HOUR).toISOString(),
        expiry: new Date(NOW + 96 * HOUR).toISOString(),
      },
    } as unknown as WorldState;
    expect(ids(context({ world }))).toEqual([]);
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
    expect(ids(context({ world, prefs: prefs({ baro: "never" }) }))).toEqual([]);
    const low = draft(context({ world, prefs: prefs({ baro: "low" }) }), "vendors:baro");
    expect(low?.deprioritized).toBe(true);
  });

  it("suggests Varzia while Prime Resurgence is running", () => {
    const world = {
      vaultTrader: {
        activation: new Date(NOW - 24 * HOUR).toISOString(),
        expiry: new Date(NOW + 24 * HOUR).toISOString(),
        inventory: [{ uniqueName: "/Lotus/Types/Relic", item: "Lith A1 Relic" }],
      },
    } as unknown as WorldState;
    const varzia = draft(context({ world }), "vendors:varzia");
    expect(varzia?.details?.pool).toEqual(["Lith A1 Relic"]);
    expect(varzia?.signals.urgency).toBeGreaterThan(0);
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
    expect(ids(context({ world: soldOut }))).toEqual([]);

    const expired = {
      dailyDeals: [{ item: "Rubico Prime", expiry: new Date(NOW - HOUR).toISOString() }],
    } as unknown as WorldState;
    expect(ids(context({ world: expired }))).toEqual([]);
  });
});
