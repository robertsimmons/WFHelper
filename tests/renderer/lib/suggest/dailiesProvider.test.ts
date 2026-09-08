import { describe, expect, it } from "vitest";

import { nextDailyResetUtc, nextWeeklyResetUtc } from "../../../../src/lib/format.js";
import { collectSuggestions } from "../../../../src/lib/suggest/engine.js";
import { defaultPreferences } from "../../../../src/lib/suggest/preferences.js";
import { dailiesProvider } from "../../../../src/lib/suggest/providers/dailies.js";
import { rewardWorth, taskWorth } from "../../../../src/lib/suggest/rewards.js";
import { worthGroupOf } from "../../../../src/lib/suggest/score.js";
import { clearUnplacedForTest, unplacedNames } from "../../../../src/lib/suggest/unplaced.js";
import { UNRESOLVED_WORTH } from "../../../../src/lib/suggest/worthLadder.js";
import type { Translator } from "../../../../src/lib/i18n.js";
import type { TrackerState } from "../../../../src/lib/world/dailies.js";
import type { DropRow } from "../../../../config/shared/dropTypes.js";
import type { ItemDbEntry, RawInventoryData } from "../../../../src/types/inventory.js";
import type { ActivityPref, SuggestionContext } from "../../../../src/types/suggest.js";
import type { CalendarDay, GlobalBoost, WorldState } from "../../../../src/types/world.js";

const NOW = Date.parse("2026-09-05T12:00:00Z");
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

function ids(ctx: SuggestionContext): string[] {
  return dailiesProvider.collect(ctx).map((draft) => draft.id);
}

describe("dailiesProvider", () => {
  it("suggests undone daily and weekly tasks", () => {
    const collected = ids(context());
    expect(collected).toContain("dailies:sortie");
    expect(collected).toContain("dailies:circuitNormal");
  });

  it("leaves vendor rotations and alerts to their own providers", () => {
    const collected = ids(context());
    expect(collected).not.toContain("dailies:baro");
    expect(collected).not.toContain("dailies:varzia");
    expect(collected).not.toContain("dailies:codaWeapons");
  });

  it("leaves steel path incursions to the tracker and off the feed", () => {
    const periodKey = `daily:${nextDailyResetUtc(new Date(NOW)).toISOString()}`;
    const collected = ids(
      context({
        tracker: tracker({ progress: { spIncursions: { key: periodKey, count: 2 } } }),
        prefs: prefs({ spIncursions: "normal" }),
      }),
    );
    expect(collected).not.toContain("dailies:spIncursions");
    expect(collected).toContain("dailies:simaris");
  });

  it("drops a task already done this period", () => {
    const periodKey = `daily:${nextDailyResetUtc(new Date(NOW)).toISOString()}`;
    const ctx = context({
      tracker: tracker({ progress: { simaris: { key: periodKey, count: 1 } } }),
    });
    expect(ids(ctx)).not.toContain("dailies:simaris");
  });

  it("keeps a task whose progress belongs to a period that has since reset", () => {
    const ctx = context({
      tracker: tracker({
        progress: { simaris: { key: "daily:2020-01-01T00:00:00.000Z", count: 1 } },
      }),
    });
    expect(ids(ctx)).toContain("dailies:simaris");
  });

  it("respects a task the user hid in the tracker", () => {
    const ctx = context({ tracker: tracker({ hidden: ["sortie"] }) });
    expect(ids(ctx)).not.toContain("dailies:sortie");
  });

  it("carries partial progress on multi-run tasks", () => {
    const netracells = dailiesProvider
      .collect(context())
      .find((draft) => draft.id === "dailies:netracells");
    expect(netracells?.progress).toEqual({ current: 0, required: 5 });
    expect(netracells?.category).toBe("weekly");
  });

  it("carries what the card needs to tick the task off in place", () => {
    const netracells = dailiesProvider
      .collect(context())
      .find((draft) => draft.id === "dailies:netracells");
    expect(netracells?.complete).toEqual({
      taskId: "netracells",
      periodKey: `weekly:${nextWeeklyResetUtc(new Date(NOW)).toISOString()}`,
      count: 0,
      target: 5,
    });
  });

  it("fingerprints a task by its period so a reset lifts any dismissal", () => {
    const today = dailiesProvider
      .collect(context())
      .find((draft) => draft.id === "dailies:simaris");
    const later = dailiesProvider
      .collect(context({ nowMs: NOW + 3 * 24 * 60 * 60_000 }))
      .find((draft) => draft.id === "dailies:simaris");
    expect(today?.fingerprint).not.toBe(later?.fingerprint);
  });

  it("fingerprints a world-driven task by the window the game reports", () => {
    const world = {
      sortie: { id: "s1", expiry: new Date(NOW + 8 * 60 * 60_000).toISOString(), missions: [] },
    } as unknown as WorldState;
    const sortie = dailiesProvider
      .collect(context({ world }))
      .find((draft) => draft.id === "dailies:sortie");
    expect(sortie?.fingerprint).toContain("sortie:");
    expect(sortie?.signals.urgency).toBeGreaterThan(0);
  });

  it("leaves nightwave acts out of the feed entirely", () => {
    const world = {
      nightwave: {
        challenges: [
          {
            id: "act-1",
            title: "Friendly Fire",
            description: "Kill 150 enemies",
            standing: 4500,
            requiredCount: 150,
            isDaily: false,
            isElite: true,
            activation: null,
            expiry: new Date(NOW + 6 * 60 * 60_000).toISOString(),
          },
        ],
      },
    } as unknown as WorldState;

    const ids = dailiesProvider.collect(context({ world })).map((entry) => entry.id);
    expect(ids).not.toContain("dailies:nw:act-1");
    expect(ids.some((id) => id.startsWith("dailies:nw:"))).toBe(false);
  });
});

// Echoes the key and its params so assertions pin structure, not English copy.
const echoT: Translator = (key, params) =>
  params
    ? `${key}(${Object.entries(params)
        .map(([name, value]) => `${name}=${String(value)}`)
        .join(",")})`
    : key;

/** NOW is 2026-09-05, and DE numbers calendar days by day-of-year. */
const TODAY_OF_YEAR = 248;

/** What the curated table says a calendar day pays when nothing else resolves. */
const CALENDAR_CURATED = taskWorth(defaultPreferences(), "calendar1999") ?? 0;

function calendarWorld(days: CalendarDay[]): WorldState {
  return {
    calendarSeason: {
      activation: null,
      expiry: new Date(NOW + 40 * 24 * 60 * 60_000).toISOString(),
      season: "Winter",
      days,
    },
  } as unknown as WorldState;
}

function draft(ctx: SuggestionContext, id: string) {
  return dailiesProvider.collect(ctx).find((entry) => entry.id === id);
}

describe("dailiesProvider reward promotion", () => {
  it("promotes a good calendar reward and keeps its name off the why line", () => {
    const world = calendarWorld([
      {
        day: TODAY_OF_YEAR + 2,
        events: [
          {
            kind: "reward",
            label: "Tauforged Azure Archon Shard",
            uniqueName: "/Lotus/Types/Items/MiscItems/ArchonShardAzureTauforged",
          },
        ],
      },
    ]);
    const calendar = draft(context({ world, t: echoT }), "dailies:calendar1999");
    expect(worthGroupOf(calendar!)).toBe("must");
    expect(calendar?.why).toBe("nextUp.whyInDays(days=2)");
    expect(calendar?.whyWithReward).toBe(
      "nextUp.whyRewardInDays(reward=Tauforged Azure Archon Shard,days=2)",
    );
    expect(calendar?.reward).toEqual({
      name: "Tauforged Azure Archon Shard",
      uniqueName: "/Lotus/Types/Items/MiscItems/ArchonShardAzureTauforged",
    });
  });

  it("carries a calendar reward that world state gives no uniqueName for", () => {
    const world = calendarWorld([
      { day: TODAY_OF_YEAR, events: [{ kind: "reward", label: "Umbra Forma" }] },
    ]);
    const calendar = draft(context({ world, t: echoT }), "dailies:calendar1999");
    expect(calendar?.reward).toEqual({ name: "Umbra Forma", uniqueName: undefined });
    expect(calendar?.why).toBe("nextUp.whyToday");
  });

  it("pictures the next payday, not the best one in the week", () => {
    const world = calendarWorld([
      { day: TODAY_OF_YEAR, events: [{ kind: "reward", label: "Kuva" }] },
      { day: TODAY_OF_YEAR + 3, events: [{ kind: "reward", label: "Umbra Forma" }] },
    ]);
    const calendar = draft(context({ world, t: echoT }), "dailies:calendar1999");
    expect(calendar?.whyWithReward).toBe("nextUp.whyRewardToday(reward=Kuva)");
    expect(calendar?.reward?.name).toBe("Kuva");
  });

  it("pictures the better of the next payday's two options", () => {
    const world = calendarWorld([
      {
        day: TODAY_OF_YEAR + 2,
        events: [
          { kind: "reward", label: "Kuva" },
          { kind: "reward", label: "Umbra Forma" },
        ],
      },
      { day: TODAY_OF_YEAR + 4, events: [{ kind: "reward", label: "Aura Forma" }] },
    ]);
    const calendar = draft(context({ world, t: echoT }), "dailies:calendar1999");
    expect(calendar?.reward?.name).toBe("Umbra Forma");
    expect(calendar?.why).toBe("nextUp.whyInDays(days=2) - Kuva / Umbra Forma");
  });

  it("passes over a payday nothing rates rather than picturing it", () => {
    const world = calendarWorld([
      { day: TODAY_OF_YEAR + 1, events: [{ kind: "reward", label: "Photor Somachord Tone" }] },
      { day: TODAY_OF_YEAR + 2, events: [{ kind: "reward", label: "Umbra Forma" }] },
    ]);
    const calendar = draft(context({ world, t: echoT }), "dailies:calendar1999");
    expect(calendar?.reward?.name).toBe("Umbra Forma");
    expect(calendar?.why).toBe("nextUp.whyInDays(days=2)");
  });

  it("ignores a reward too far out to be a reason to log in", () => {
    const world = calendarWorld([
      { day: TODAY_OF_YEAR + 30, events: [{ kind: "reward", label: "Umbra Forma" }] },
    ]);
    const calendar = draft(context({ world, t: echoT }), "dailies:calendar1999");
    // Nothing in reach, so the card falls back to what the curated table says a
    // calendar day pays rather than to a category constant.
    expect(calendar?.signals.value).toBe(CALENDAR_CURATED);
    expect(calendar?.why).toBe("Winter");
  });

  // A live season really does ship days numbered 95-174 in September, which is
  // the case that made the calendar card promote nothing at all.
  it("still promotes when the season's day numbers are not this year's", () => {
    const world = calendarWorld([
      { day: 97, events: [{ kind: "reward", label: "Topaz Archon Shard" }] },
      { day: 144, events: [{ kind: "reward", label: "Kuva" }] },
    ]);
    const calendar = draft(context({ world, t: echoT }), "dailies:calendar1999");
    expect(worthGroupOf(calendar!)).toBe("must");
    // Running order, so the first listed day is the nearest one we can claim.
    expect(calendar?.why).toBe("nextUp.whyUpcoming");
    expect(calendar?.whyWithReward).toBe("nextUp.whyRewardUpcoming(reward=Topaz Archon Shard)");
  });

  it("pictures a reward the ladder has no place for, and takes nothing for it", () => {
    clearUnplacedForTest();
    const world = calendarWorld([
      { day: TODAY_OF_YEAR + 1, events: [{ kind: "reward", label: "Photor Somachord Tone" }] },
    ]);
    const calendar = draft(context({ world, t: echoT }), "dailies:calendar1999");
    expect(calendar?.reward?.name).toBe("Photor Somachord Tone");
    // Unplaced is worth nothing, so the curated calendar entry is what is left.
    expect(calendar?.signals.value).toBe(CALENDAR_CURATED);
    expect(unplacedNames()).toContain("photor somachord tone");
    clearUnplacedForTest();
  });

  it("re-fingerprints the calendar when the promoted reward changes", () => {
    const shard = draft(
      context({
        world: calendarWorld([
          { day: TODAY_OF_YEAR, events: [{ kind: "reward", label: "Umbra Forma" }] },
        ]),
      }),
      "dailies:calendar1999",
    );
    const kuva = draft(
      context({
        world: calendarWorld([{ day: TODAY_OF_YEAR, events: [{ kind: "reward", label: "Kuva" }] }]),
      }),
      "dailies:calendar1999",
    );
    expect(shard?.fingerprint).not.toBe(kuva?.fingerprint);
  });

  it("promotes Teshin's offer from the same table", () => {
    const world = {
      steelPath: {
        currentReward: { name: "Umbra Forma Blueprint", cost: 150 },
        expiry: new Date(NOW + 5 * 24 * 60 * 60_000).toISOString(),
      },
    } as unknown as WorldState;
    const teshin = draft(context({ world }), "dailies:steelPathHonors");
    expect(worthGroupOf(teshin!)).toBe("must");
  });

  it("gives Teshin's offer art without naming it twice", () => {
    const world = {
      steelPath: {
        currentReward: { name: "Umbra Forma Blueprint", cost: 150 },
        expiry: new Date(NOW + 5 * 24 * 60 * 60_000).toISOString(),
      },
    } as unknown as WorldState;
    const teshin = draft(context({ world, t: echoT }), "dailies:steelPathHonors");
    expect(teshin?.reward).toEqual({ name: "Umbra Forma Blueprint", uniqueName: undefined });
    // The tracker row already reads "<reward> - <cost>", so both lines are the same.
    expect(teshin?.whyWithReward).toBeUndefined();
    expect(teshin?.why).toContain("Umbra Forma Blueprint");
  });

  it("falls back to the task table when the world state names no reward", () => {
    const archon = draft(context(), "dailies:archonHunt");
    const clem = draft(context(), "dailies:clem");
    expect(worthGroupOf(archon!)).toBe("must");
    expect(worthGroupOf(clem!)).toBe("junk");
  });

  it("does not let a task's own resolved reward demote it", () => {
    const world = { archonHunt: { boss: "Boreal", missions: [] } } as unknown as WorldState;
    const resolved = draft(context({ world }), "dailies:archonHunt");
    const curated = draft(context(), "dailies:archonHunt");
    expect(resolved?.reward?.name).toBe("Azure Archon Shard");
    expect(resolved?.signals.value ?? 0).toBeGreaterThanOrEqual(curated?.signals.value ?? 1);
    expect(worthGroupOf(resolved!)).toBe("must");
  });

  it("floors a task nothing curated instead of handing it a category default", () => {
    const uncurated = draft(context(), "dailies:circuitNormal");
    expect(uncurated?.signals.value).toBe(UNRESOLVED_WORTH);
    expect(worthGroupOf(uncurated!)).toBe("unplaced");
    // It sinks under everything the ladder places, chore or not.
    expect(uncurated?.signals.value ?? 1).toBeLessThan(
      draft(context(), "dailies:clem")?.signals.value ?? 0,
    );
  });

  it("pays a currency task off the currency, not off its category", () => {
    for (const id of ["kahl", "simaris", "syndicateStanding", "dailyFocus"]) {
      expect(worthGroupOf(draft(context(), `dailies:${id}`)!)).toBe("filler");
    }
  });
});

const KUVA_BUNDLE_ID = "/Lotus/Types/StoreItems/Packages/Calendar/CalendarKuvaBundleSmall";
const ARCANE_UNLOCKER_ID = "/Lotus/Types/Items/MiscItems/SecondaryArcaneUnlocker";

/** Modelled on a live season: a lone challenge day, a two-reward pick, a
 *  three-upgrade pick. */
const CALENDAR_CHOICES: CalendarDay[] = [
  {
    day: TODAY_OF_YEAR + 1,
    events: [
      { kind: "challenge", label: "Kill 30 Enemies With Finishers", description: "Any mission" },
    ],
  },
  {
    day: TODAY_OF_YEAR + 2,
    events: [
      { kind: "reward", label: "Calendar Kuva Bundle Small", uniqueName: KUVA_BUNDLE_ID },
      { kind: "reward", label: "Secondary Arcane Unlocker", uniqueName: ARCANE_UNLOCKER_ID },
    ],
  },
  {
    day: TODAY_OF_YEAR + 5,
    events: [
      { kind: "upgrade", label: "On Headshot Kill: +100% Critical Chance" },
      { kind: "upgrade", label: "Health Orbs Grant Overguard" },
      { kind: "upgrade", label: "On Melee Kill: +50% Melee Damage" },
    ],
  },
];

describe("dailiesProvider calendar choices", () => {
  it("names the options of every upcoming pick on the card line", () => {
    const calendar = draft(
      context({ world: calendarWorld(CALENDAR_CHOICES), t: echoT }),
      "dailies:calendar1999",
    );
    expect(calendar?.why).toContain("Kuva Bundle Small / Secondary Arcane Unlocker");
    expect(calendar?.why).toContain("nextUp.whyInDays(days=2)");
  });

  it("hands the details view one group per pick, art join and tiers intact", () => {
    const calendar = draft(
      context({ world: calendarWorld(CALENDAR_CHOICES), t: echoT }),
      "dailies:calendar1999",
    );
    expect(calendar?.details?.options).toEqual([
      {
        day: TODAY_OF_YEAR + 2,
        options: [
          {
            name: "Calendar Kuva Bundle Small",
            uniqueName: KUVA_BUNDLE_ID,
            displayName: "Kuva Bundle Small",
            worth: "ok",
          },
          {
            name: "Secondary Arcane Unlocker",
            uniqueName: ARCANE_UNLOCKER_ID,
            displayName: "Secondary Arcane Unlocker",
            worth: undefined,
          },
        ],
      },
    ]);
  });

  it("leaves a day of buffs out of the picks entirely", () => {
    const calendar = draft(
      context({
        world: calendarWorld([CALENDAR_CHOICES[2] as CalendarDay]),
        t: echoT,
      }),
      "dailies:calendar1999",
    );
    expect(calendar?.details?.options).toBeUndefined();
    expect(calendar?.why).toBe("Winter");
  });

  it("lists the reward of a day that offers it beside buffs, and keeps the buffs out", () => {
    const calendar = draft(
      context({
        world: calendarWorld([
          {
            day: TODAY_OF_YEAR + 2,
            events: [
              { kind: "reward", label: "Umbra Forma" },
              { kind: "upgrade", label: "Health Orbs Grant Overguard" },
            ],
          },
        ]),
        t: echoT,
      }),
      "dailies:calendar1999",
    );
    expect(calendar?.details?.options).toEqual([
      {
        day: TODAY_OF_YEAR + 2,
        options: [
          {
            name: "Umbra Forma",
            uniqueName: undefined,
            displayName: "Umbra Forma",
            worth: "great",
          },
        ],
      },
    ]);
  });

  it("reads a day with one event as what that day is, not a pick", () => {
    const calendar = draft(
      context({ world: calendarWorld([CALENDAR_CHOICES[0] as CalendarDay]), t: echoT }),
      "dailies:calendar1999",
    );
    expect(calendar?.details?.options).toBeUndefined();
    expect(calendar?.why).toBe("Winter");
  });

  it("lists a single-reward day but keeps it off the card's pick line", () => {
    const calendar = draft(
      context({
        world: calendarWorld([
          { day: TODAY_OF_YEAR + 2, events: [{ kind: "reward", label: "Umbra Forma" }] },
        ]),
        t: echoT,
      }),
      "dailies:calendar1999",
    );
    expect(calendar?.details?.options).toEqual([
      {
        day: TODAY_OF_YEAR + 2,
        options: [
          {
            name: "Umbra Forma",
            uniqueName: undefined,
            displayName: "Umbra Forma",
            worth: "great",
          },
        ],
      },
    ]);
    expect(calendar?.why).toBe("nextUp.whyInDays(days=2)");
  });

  it("lists every upcoming payday, single-reward days among the picks", () => {
    const calendar = draft(
      context({
        world: calendarWorld([
          ...CALENDAR_CHOICES,
          { day: TODAY_OF_YEAR + 6, events: [{ kind: "reward", label: "Umbra Forma" }] },
          {
            day: TODAY_OF_YEAR + 8,
            events: [
              { kind: "reward", label: "Forma" },
              { kind: "reward", label: "Endo" },
            ],
          },
        ]),
        t: echoT,
      }),
      "dailies:calendar1999",
    );
    expect(calendar?.details?.options?.map((group) => group.day)).toEqual([
      TODAY_OF_YEAR + 2,
      TODAY_OF_YEAR + 6,
      TODAY_OF_YEAR + 8,
    ]);
  });
});

const GREEN_SHARD_ID = "/Lotus/Types/Gameplay/NarmerSorties/ArchonCrystalGreen";
const KUVA_BUNDLE_LARGE_ID = "/Lotus/Types/StoreItems/Packages/Calendar/CalendarKuvaBundleLarge";

/** A season the way the live one ships: one real week long, with days numbered
 *  against the 1999 calendar's own year rather than this one. */
function liveSeasonWorld(days: CalendarDay[]): WorldState {
  return {
    calendarSeason: {
      activation: new Date(NOW).toISOString(),
      expiry: new Date(NOW + 7 * 24 * 60 * 60_000).toISOString(),
      season: "Summer",
      days,
    },
  } as unknown as WorldState;
}

/** The live Summer season, day numbers and payouts as DE ships them: six
 *  paydays either side of today's day-of-year, two picks apiece, plus the
 *  challenge and buff days that are no payday at all. */
const LIVE_SEASON: CalendarDay[] = [
  { day: 185, events: [{ kind: "challenge", label: "Kill 250 Enemies With Abilities" }] },
  {
    day: 190,
    events: [
      { kind: "reward", label: "Calendar Kuva Bundle Large", uniqueName: KUVA_BUNDLE_LARGE_ID },
      { kind: "reward", label: "Calendar Major Artifact Pack" },
    ],
  },
  { day: 192, events: [{ kind: "challenge", label: "Kill 250 Techrot Enemies" }] },
  {
    day: 204,
    events: [
      { kind: "reward", label: "Endo" },
      { kind: "reward", label: "Calendar Kuva Bundle Small" },
    ],
  },
  { day: 212, events: [{ kind: "upgrade", label: "Melee Crit Chance" }] },
  {
    day: 229,
    events: [
      { kind: "reward", label: "Emerald Archon Shard", uniqueName: GREEN_SHARD_ID },
      { kind: "reward", label: "Exilus Weapon Adapter" },
    ],
  },
  {
    day: 240,
    events: [
      { kind: "reward", label: "Calendar Artifact Pack" },
      { kind: "reward", label: "Primary Arcane Adapter" },
    ],
  },
  { day: 257, events: [{ kind: "challenge", label: "Kill 30 Eximus" }] },
  {
    day: 261,
    events: [
      { kind: "reward", label: "Calendar Major Artifact Pack" },
      { kind: "reward", label: "Exilus Weapon Adapter" },
    ],
  },
  {
    day: 264,
    events: [
      { kind: "reward", label: "Endo" },
      { kind: "reward", label: "Exilus Weapon Adapter Blueprint" },
    ],
  },
  { day: 271, events: [{ kind: "upgrade", label: "Melee Attack Speed" }] },
];

const LIVE_PAYDAYS = [190, 204, 229, 240, 261, 264];

describe("dailiesProvider calendar season whose days are its own", () => {
  it("lists every payday, not the ones whose number happens to be past today", () => {
    const calendar = draft(
      context({ world: liveSeasonWorld(LIVE_SEASON), t: echoT }),
      "dailies:calendar1999",
    );
    expect(calendar?.details?.options?.map((group) => group.day)).toEqual(LIVE_PAYDAYS);
  });

  it("keeps both picks of every payday, rated or not", () => {
    const calendar = draft(
      context({ world: liveSeasonWorld(LIVE_SEASON), t: echoT }),
      "dailies:calendar1999",
    );
    expect(calendar?.details?.options?.map((group) => group.options.length)).toEqual(
      LIVE_PAYDAYS.map(() => 2),
    );
    // Worth comes from the ladder rather than a literal, so placing an entry
    // reorders the feed without breaking this.
    expect(calendar?.details?.options?.[0]?.options).toEqual([
      {
        name: "Calendar Kuva Bundle Large",
        uniqueName: KUVA_BUNDLE_LARGE_ID,
        displayName: "Kuva Bundle Large",
        worth: rewardWorth(defaultPreferences(), "Calendar Kuva Bundle Large") ?? undefined,
      },
      {
        name: "Calendar Major Artifact Pack",
        uniqueName: undefined,
        displayName: "Major Artifact Pack",
        worth: "good",
      },
    ]);
  });

  it("records a pick the ladder does not place, so settings can show the gap", () => {
    // A name nothing will ever curate: a real one gets placed sooner or later,
    // and then this stops testing the mechanism it is here for.
    const world = liveSeasonWorld([
      { day: 190, events: [{ kind: "reward", label: "Nonexistent Trinket Of Testing" }] },
    ]);
    clearUnplacedForTest();
    draft(context({ world, t: echoT }), "dailies:calendar1999");
    expect(unplacedNames()).toContain("nonexistent trinket of testing");
    clearUnplacedForTest();
  });

  it("pictures the best the season pays, with the art join intact", () => {
    const calendar = draft(
      context({ world: liveSeasonWorld(LIVE_SEASON), t: echoT }),
      "dailies:calendar1999",
    );
    expect(calendar?.reward).toEqual({ name: "Emerald Archon Shard", uniqueName: GREEN_SHARD_ID });
    expect(worthGroupOf(calendar!)).toBe("must");
  });

  it("claims no day distance the numbering cannot support", () => {
    const calendar = draft(
      context({ world: liveSeasonWorld(LIVE_SEASON), t: echoT }),
      "dailies:calendar1999",
    );
    expect(calendar?.why).toContain("nextUp.whyUpcoming");
    expect(calendar?.whyWithReward).toContain(
      "nextUp.whyRewardUpcoming(reward=Emerald Archon Shard)",
    );
  });

  it("lists more paydays than the world row previews", () => {
    const days: CalendarDay[] = Array.from({ length: 20 }, (_, index) => ({
      day: 100 + index * 4,
      events: [{ kind: "reward" as const, label: "Endo" }],
    }));
    const calendar = draft(
      context({ world: liveSeasonWorld(days), t: echoT }),
      "dailies:calendar1999",
    );
    expect(calendar?.details?.options).toHaveLength(20);
  });

  it("pictures an unrated payday when the season places nothing at all", () => {
    // Both names are deliberately uncurated, so the premise cannot be undone by
    // a later ladder placement.
    const calendar = draft(
      context({
        world: liveSeasonWorld([
          { day: 190, events: [{ kind: "reward", label: "Photor Somachord Tone" }] },
          { day: 264, events: [{ kind: "reward", label: "Nonexistent Trinket Of Testing" }] },
        ]),
        t: echoT,
      }),
      "dailies:calendar1999",
    );
    expect(calendar?.reward?.name).toBe("Photor Somachord Tone");
    expect(calendar?.signals.value).toBe(CALENDAR_CURATED);
  });
});

/** DE names the shard after the Archon, so the boss alone identifies the reward. */
function archonWorld(boss: string, missions: string[]): WorldState {
  return {
    archonHunt: {
      boss,
      activation: null,
      expiry: new Date(NOW + 5 * 24 * 60 * 60_000).toISOString(),
      missions: missions.map((mission, index) => ({ mission, node: `Node${index}` })),
    },
  } as unknown as WorldState;
}

describe("dailiesProvider mission and shard reasons", () => {
  it("names the shard the week's Archon drops, art line aside", () => {
    const hunt = draft(
      context({ world: archonWorld("Boreal", ["Capture"]), t: echoT }),
      "dailies:archonHunt",
    );
    expect(hunt?.reward).toEqual({ name: "Azure Archon Shard", uniqueName: undefined });
    expect(hunt?.whyWithReward).toContain("Azure Archon Shard");
    expect(hunt?.why).not.toContain("Azure Archon Shard");
  });

  it("reads each Archon to its own shard", () => {
    const named = (boss: string) =>
      draft(context({ world: archonWorld(boss, []), t: echoT }), "dailies:archonHunt")?.reward
        ?.name;
    expect(named("Amar")).toBe("Crimson Archon Shard");
    expect(named("Nira")).toBe("Amber Archon Shard");
  });

  it("charges a slow mission type as effort", () => {
    const spy = draft(
      context({ world: archonWorld("Boreal", ["Spy", "Defense"]), t: echoT }),
      "dailies:archonHunt",
    );
    const quick = draft(
      context({ world: archonWorld("Boreal", ["Capture", "Exterminate"]), t: echoT }),
      "dailies:archonHunt",
    );
    expect(spy?.signals.effort).toBeGreaterThan(quick?.signals.effort ?? 0);
  });

  it("lists the hunt's three missions as the card's line", () => {
    const hunt = draft(
      context({ world: archonWorld("Boreal", ["Spy", "Capture", "Defense"]), t: echoT }),
      "dailies:archonHunt",
    );
    expect(hunt?.why).toBe("Spy, Capture, Defense");
    expect(hunt?.whyWithReward).toBe("Azure Archon Shard - Spy, Capture, Defense");
  });

  it("tones the mission the player dislikes and leaves the rest plain", () => {
    const hunt = draft(
      context({ world: archonWorld("Boreal", ["Spy", "Capture", "Defense"]), t: echoT }),
      "dailies:archonHunt",
    );
    expect(hunt?.whySegments).toEqual([
      { text: "Spy", tone: "bad" },
      { text: "Capture" },
      { text: "Defense" },
    ]);
  });

  it("tones nothing for a week the player dislikes none of", () => {
    const hunt = draft(
      context({ world: archonWorld("Boreal", ["Capture", "Exterminate", "Defense"]), t: echoT }),
      "dailies:archonHunt",
    );
    expect(hunt?.whySegments).toEqual([
      { text: "Capture" },
      { text: "Exterminate" },
      { text: "Defense" },
    ]);
    expect(hunt?.whySegments?.every((segment) => segment.tone === undefined)).toBe(true);
  });

  it("leaves the line plain for a hunt the world state lists no missions for", () => {
    const hunt = draft(
      context({ world: archonWorld("Boreal", []), t: echoT }),
      "dailies:archonHunt",
    );
    expect(hunt?.whySegments).toBeUndefined();
    expect(hunt?.why).toBe("");
  });

  it("leaves the sortie's line to its summary rather than a mission list", () => {
    const world = {
      sortie: {
        id: "s1",
        expiry: new Date(NOW + 8 * 60 * 60_000).toISOString(),
        missions: [{ mission: "Spy", node: "Node0", modifier: "Eximus" }],
      },
    } as unknown as WorldState;
    const sortie = draft(context({ world, t: echoT }), "dailies:sortie");
    expect(sortie?.whySegments).toBeUndefined();
    expect(sortie?.why).toContain("nextUp.whySlowMissions(types=Spy)");
  });
});

describe("dailiesProvider feed order", () => {
  it("puts the weeklies that pay shards above the chores that pay standing", () => {
    const ranked = collectSuggestions([dailiesProvider], context({})).map(
      (suggestion) => suggestion.id,
    );
    const at = (id: string): number => ranked.indexOf(id);

    for (const chore of [
      "dailies:kahl",
      "dailies:simaris",
      "dailies:dailyFocus",
      "dailies:syndicateStanding",
      "dailies:clem",
    ]) {
      expect(at("dailies:netracells")).toBeLessThan(at(chore));
      expect(at("dailies:archonHunt")).toBeLessThan(at(chore));
    }
    // Nothing curated the Circuit, so it sinks rather than sitting mid-table.
    expect(at("dailies:circuitNormal")).toBeGreaterThan(at("dailies:kahl"));
  });
});

describe("dailiesProvider urgency windows", () => {
  it("does not write a weekly off for the first four days of the week", () => {
    // The 72 hour constant scored every weekly exactly zero here.
    const monday = Date.parse("2026-09-07T12:00:00Z");
    const netracells = draft(context({ nowMs: monday }), "dailies:netracells");
    expect(netracells?.signals.urgency ?? 0).toBeGreaterThan(0);
  });

  it("puts a daily and a weekly halfway through their windows level", () => {
    // Thursday noon: twelve of the day's twenty-four hours, and eighty-four of
    // the week's hundred and sixty-eight.
    const halfway = context({ nowMs: Date.parse("2026-09-10T12:00:00Z") });
    expect(draft(halfway, "dailies:simaris")?.signals.urgency).toBeCloseTo(0.5, 6);
    expect(draft(halfway, "dailies:netracells")?.signals.urgency).toBeCloseTo(0.5, 6);
  });

  it("climbs as a weekly's own week runs out", () => {
    const early = draft(context({ nowMs: Date.parse("2026-09-07T12:00:00Z") }), "dailies:kahl");
    const late = draft(context({ nowMs: Date.parse("2026-09-12T12:00:00Z") }), "dailies:kahl");
    expect(late?.signals.urgency ?? 0).toBeGreaterThan(early?.signals.urgency ?? 1);
  });
});

describe("dailiesProvider activity preferences", () => {
  it("drops an activity the user never wants to see", () => {
    expect(ids(context({ prefs: prefs({ sortie: "never" }) }))).not.toContain("dailies:sortie");
  });

  it("keeps an activity set to low, marked for the back of the list", () => {
    const sortie = draft(context({ prefs: prefs({ sortie: "low" }) }), "dailies:sortie");
    expect(sortie?.deprioritized).toBe(true);
    expect(draft(context(), "dailies:sortie")?.deprioritized).toBe(false);
  });

  it("ranks every low activity behind the normal ones, whatever they score", () => {
    const ranked = collectSuggestions(
      [dailiesProvider],
      context({ prefs: prefs({ archonHunt: "low" }) }),
    );
    expect(ranked[ranked.length - 1]?.id).toBe("dailies:archonHunt");
  });
});

// Copied out of drop-data-cache.json.
const poolRow = (item: string, place: string, chance: number, rarity = "Uncommon"): DropRow => ({
  kind: "bounty",
  item,
  place,
  rarity,
  chance,
});

const SORTIE_POOL: DropRow[] = [
  poolRow("Ayatan Anasa Sculpture", "Sortie", 28),
  poolRow("4000 Endo", "Sortie", 12),
  poolRow("6000X Kuva", "Sortie", 12),
  poolRow("Melee Riven Mod", "Sortie", 9.8, "Rare"),
  poolRow("Rifle Riven Mod", "Sortie", 7, "Rare"),
  poolRow("Pistol Riven Mod", "Sortie", 7, "Rare"),
  poolRow("Forma", "Sortie", 2.5, "Rare"),
  poolRow("Shotgun Riven Mod", "Sortie", 2.2, "Rare"),
  poolRow("Zaw Riven Mod", "Sortie", 1, "Rare"),
  poolRow("Kitgun Riven Mod", "Sortie", 1, "Rare"),
  poolRow("Legendary Core", "Sortie", 0.19, "Legendary"),
];

const NETRACELL_POOL: DropRow[] = [
  poolRow("Entrati Lanthorn", "Entrati Netracell Coffer", 100, "Common"),
  poolRow("Crimson Archon Shard", "Entrati Netracell Coffer (Level 0 - 100)", 17.5),
  poolRow("Azure Archon Shard", "Entrati Netracell Coffer (Level 0 - 100)", 17.5),
  poolRow("Amber Archon Shard", "Entrati Netracell Coffer (Level 0 - 100)", 17.5),
  poolRow("Melee Arcane Adapter", "Entrati Netracell Coffer (Level 0 - 100)", 15),
  poolRow("Melee Crescendo", "Entrati Netracell Coffer (Level 0 - 100)", 10),
  poolRow("Tauforged Crimson Archon Shard", "Entrati Netracell Coffer (Level 0 - 100)", 4.17),
  poolRow("Tauforged Azure Archon Shard", "Entrati Netracell Coffer (Level 0 - 100)", 4.17),
  poolRow("Tauforged Amber Archon Shard", "Entrati Netracell Coffer (Level 0 - 100)", 4.17),
];

/** Only the shards rate, so the pool comes down to one family. */
const SHARDS_ONLY_POOL: DropRow[] = NETRACELL_POOL.filter((pool) =>
  pool.item.includes("Archon Shard"),
);

describe("dailiesProvider drop pools", () => {
  it("labels netracells by what its coffer pays", () => {
    const netracells = draft(
      context({ dropPools: { netracells: NETRACELL_POOL }, t: echoT }),
      "dailies:netracells",
    );
    expect(netracells?.reward?.name).toBe("Amber Archon Shard");
    // Several families, so the tile stands beside the labels rather than for them.
    expect(netracells?.why).toBe(
      "Archon Shards, Melee Arcane Adapter - nextUp.whyRemaining(remaining=5,target=5)",
    );
    expect(netracells?.whyWithReward).toBeUndefined();
  });

  it("lets art stand in for a pool that came down to one family", () => {
    const netracells = draft(
      context({ dropPools: { netracells: SHARDS_ONLY_POOL }, t: echoT }),
      "dailies:netracells",
    );
    expect(netracells?.reward?.name).toBe("Amber Archon Shard");
    expect(netracells?.why).toBe("nextUp.whyRemaining(remaining=5,target=5)");
    expect(netracells?.whyWithReward).toBe(
      "Archon Shards - nextUp.whyRemaining(remaining=5,target=5)",
    );
  });

  it("names the three families a sortie pays", () => {
    const sortie = draft(
      context({ dropPools: { sortie: SORTIE_POOL }, t: echoT }),
      "dailies:sortie",
    );
    expect(sortie?.why).toBe("Ayatan Anasa Sculpture, Riven Mods, Endo");
    expect(sortie?.whyWithReward).toBeUndefined();
    expect(sortie?.reward?.name).toBe("Ayatan Anasa Sculpture");
  });

  it("appends the labels to the task's own detail instead of replacing it", () => {
    const world = {
      sortie: {
        id: "s1",
        boss: "Vor",
        expiry: new Date(NOW + 8 * 60 * 60_000).toISOString(),
        missions: [],
      },
    } as unknown as WorldState;
    const sortie = draft(
      context({ world, dropPools: { sortie: SORTIE_POOL }, t: echoT }),
      "dailies:sortie",
    );
    expect(sortie?.why).toBe("dailies.boss(name=Vor) - Ayatan Anasa Sculpture, Riven Mods, Endo");
  });

  it("is worth the best thing in the pool once that beats the curated table", () => {
    const withPool = draft(
      context({ dropPools: { netracells: NETRACELL_POOL } }),
      "dailies:netracells",
    );
    const withoutPool = draft(context(), "dailies:netracells");
    // The pool pays a Tauforged shard; the curated table only promises a plain one.
    expect(withPool?.signals.value ?? 0).toBeGreaterThan(withoutPool?.signals.value ?? 0);
  });

  it("never lets a pool of nothing much drag a task under its curated worth", () => {
    const junk = [poolRow("Somachord Tone", "Sortie", 100, "Common")];
    const withJunk = draft(context({ dropPools: { sortie: junk } }), "dailies:sortie");
    const withoutPool = draft(context(), "dailies:sortie");
    expect(withJunk?.signals.value).toBe(withoutPool?.signals.value);
  });

  it("leaves a task with no pool and no named reward alone", () => {
    const netracells = draft(context({ t: echoT }), "dailies:netracells");
    expect(netracells?.reward).toBeUndefined();
    expect(netracells?.whyWithReward).toBeUndefined();
    expect(netracells?.why).toBe("nextUp.whyRemaining(remaining=5,target=5)");
  });
});

/** The week live in the game while this was written. */
const FRAMES = ["Gara", "Khora", "Revenant"];
const ADAPTERS = ["Braton", "Lato", "Skana", "Paris", "Kunai"];
const UNRATED_FRAME = "Nonesuch";

const suitId = (name: string): string => `/Lotus/Powersuits/${name}/${name}`;
const adapterId = (name: string): string =>
  `/Lotus/Types/Items/MiscItems/IncarnonAdapters/${name}Adapter`;

function circuitDb(): Record<string, ItemDbEntry> {
  const db: Record<string, ItemDbEntry> = {};
  for (const name of [...FRAMES, UNRATED_FRAME]) {
    db[suitId(name)] = { name, category: "Warframes", imageUrl: `${name}.png` };
  }
  for (const name of ADAPTERS) {
    db[`/Lotus/Weapons/${name}`] = { name, category: "Primary", imageUrl: `${name}.png` };
    db[adapterId(name)] = {
      name: `${name} Incarnon Genesis`,
      category: "Misc",
      imageUrl: `${name}Incarnon.png`,
    };
  }
  return db;
}

function circuitWorld(normal: string[], hard: string[]): WorldState {
  return {
    duviriCycle: {
      choices: [
        { category: "normal", choices: normal },
        { category: "hard", choices: hard },
      ],
    },
  } as unknown as WorldState;
}

function circuitContext(
  inventory: RawInventoryData | null = null,
  normal: string[] = FRAMES,
  hard: string[] = ADAPTERS,
): SuggestionContext {
  return context({ world: circuitWorld(normal, hard), itemDb: circuitDb(), inventory, t: echoT });
}

const owns = (suits: string[], adapters: string[] = []): RawInventoryData =>
  ({
    Suits: suits.map((name) => ({ ItemType: suitId(name) })),
    MiscItems: adapters.map((name) => ({ ItemType: adapterId(name) })),
  }) as unknown as RawInventoryData;

const subsumes = (suits: string[], fed: string[]): RawInventoryData =>
  ({
    Suits: suits.map((name) => ({ ItemType: suitId(name) })),
    InfestedFoundry: { ConsumedSuits: fed.map((name) => ({ s: suitId(name) })) },
  }) as unknown as RawInventoryData;

describe("dailiesProvider normal Circuit", () => {
  it("values the week by the best frame the player still needs", () => {
    const circuit = draft(circuitContext(), "dailies:circuitNormal");
    expect(circuit?.signals.value).toBeCloseTo(0.7);
    expect(circuit?.signals.effort).toBe(0.85);
    expect(circuit?.why).toBe("nextUp.whyCircuitFrame(frame=Gara)");
    expect(circuit?.whyWithReward).toBeUndefined();
  });

  it("moves on to the next frame once one is owned", () => {
    const circuit = draft(circuitContext(owns(["Gara"])), "dailies:circuitNormal");
    expect(circuit?.why).toBe("nextUp.whyCircuitFrame(frame=Khora)");
  });

  it("reads a subsumed frame as finished and one merely held as half done", () => {
    const circuit = draft(circuitContext(subsumes(["Gara"], ["Khora"])), "dailies:circuitNormal");
    expect(circuit?.why).toBe("nextUp.whyCircuitFrame(frame=Revenant)");
    expect(circuit?.choices?.map((choice) => choice.state)).toEqual(["subsume", "done", "wanted"]);
  });

  it("ranks a frame that only needs subsuming below one the player lacks", () => {
    const held = draft(circuitContext(owns(FRAMES)), "dailies:circuitNormal");
    const missing = draft(circuitContext(), "dailies:circuitNormal");
    expect(held?.signals.value).toBe(0.4);
    expect(held?.why).toBe("nextUp.whyCircuitSubsume(frame=Gara)");
    expect(missing?.signals.value).toBeGreaterThan(held?.signals.value ?? 0);
  });

  it("keeps the card at a floor when every frame is owned and subsumed", () => {
    const circuit = draft(circuitContext(subsumes(FRAMES, FRAMES)), "dailies:circuitNormal");
    expect(circuit?.choices?.every((choice) => choice.state === "done")).toBe(true);
    expect(circuit?.signals.value).toBe(0.1);
    expect(circuit?.why).toBe("nextUp.whyCircuitAllOwned");
  });

  it("reads a frame the tables say nothing about as an ordinary farm", () => {
    const rated = draft(circuitContext(), "dailies:circuitNormal");
    const unrated = draft(circuitContext(null, [UNRATED_FRAME]), "dailies:circuitNormal");
    expect(unrated?.signals.value).toBe(rated?.signals.value);
    expect(unrated?.why).toBe(`nextUp.whyCircuitFrame(frame=${UNRATED_FRAME})`);
  });

  it("hands the card a strip per frame, in the order the game lists them", () => {
    const circuit = draft(circuitContext(), "dailies:circuitNormal");
    expect(circuit?.choices?.map((choice) => choice.name)).toEqual(FRAMES);
    expect(circuit?.choices?.[0]).toMatchObject({
      imageUrl: "Gara.png",
      kind: "frame",
      state: "wanted",
      effort: "normal",
    });
    expect(circuit?.reward).toBeUndefined();
  });

  it("carries every acquisition source through for the details modal", () => {
    const circuit = draft(circuitContext(), "dailies:circuitNormal");
    expect(circuit?.choices?.[0]?.sources).toEqual([
      { kind: "bounty", where: "Plains of Eidolon bounties, Lvl 5-40" },
      { kind: "quest", where: "Saya's Vigil quest" },
    ]);
  });

  it("leaves the card alone until the item database is loaded", () => {
    const circuit = draft(
      context({ world: circuitWorld(FRAMES, ADAPTERS) }),
      "dailies:circuitNormal",
    );
    expect(circuit?.choices).toBeUndefined();
    expect(circuit?.signals.effort).not.toBe(0.85);
  });
});

describe("dailiesProvider Steel Path Circuit", () => {
  it("values the week by the best adapter the player still needs", () => {
    const circuit = draft(circuitContext(), "dailies:circuitSteelPath");
    expect(circuit?.signals.effort).toBe(0.6);
    expect(circuit?.why).toBe("nextUp.whyIncarnonGraded(weapon=Braton,grade=A,count=5)");
  });

  it("drops to the next tier down once the best adapter is owned", () => {
    const all = draft(circuitContext(), "dailies:circuitSteelPath");
    const some = draft(circuitContext(owns([], ["Braton"])), "dailies:circuitSteelPath");
    expect(some?.signals.value).toBeLessThan(all?.signals.value ?? 0);
    expect(some?.why).toContain("count=4");
    expect(some?.choices?.[0]).toMatchObject({ name: "Braton", kind: "adapter", state: "done" });
  });

  it("keeps the card at a floor when every adapter is owned", () => {
    const circuit = draft(circuitContext(owns([], ADAPTERS)), "dailies:circuitSteelPath");
    expect(circuit?.signals.value).toBe(0.1);
    expect(circuit?.why).toBe("nextUp.whyIncarnonAllOwned");
  });

  it("lets an ungraded adapter sit beside a great one without dragging it down", () => {
    const rated = draft(circuitContext(null, FRAMES, ["Braton"]), "dailies:circuitSteelPath");
    const mixed = draft(
      circuitContext(null, FRAMES, ["Braton", "Nonesuch"]),
      "dailies:circuitSteelPath",
    );
    expect(mixed?.signals.value).toBe(rated?.signals.value);
    expect(mixed?.why).toContain("weapon=Braton");
  });

  it("hands the card a graded strip per adapter, in the order the game lists them", () => {
    const circuit = draft(circuitContext(), "dailies:circuitSteelPath");
    expect(circuit?.choices?.map((choice) => choice.name)).toEqual(ADAPTERS);
    expect(circuit?.choices?.every((choice) => Boolean(choice.tier))).toBe(true);
    // The adapter's art is the evolved weapon, not the base.
    expect(circuit?.choices?.[0]?.imageUrl).toBe("BratonIncarnon.png");
  });

  it("carries the evolution path through for the details modal", () => {
    const circuit = draft(circuitContext(), "dailies:circuitSteelPath");
    expect(circuit?.choices?.[0]).toMatchObject({ tier: "A", upgradePath: "0121" });
  });

  it("has only two states, since an adapter cannot be half done", () => {
    const circuit = draft(circuitContext(owns([], ["Braton"])), "dailies:circuitSteelPath");
    expect(circuit?.choices?.map((choice) => choice.state)).toEqual([
      "done",
      "wanted",
      "wanted",
      "wanted",
      "wanted",
    ]);
  });
});

describe("dailiesProvider ranking against progress", () => {
  const weeklyKey = `weekly:${nextWeeklyResetUtc(new Date(NOW)).toISOString()}`;

  function order(count: number): string[] {
    const ctx = context({
      tracker: tracker({ progress: { netracells: { key: weeklyKey, count } } }),
    });
    return collectSuggestions([dailiesProvider], ctx).map((suggestion) => suggestion.id);
  }

  it("leaves a card where it was when the user ticks a run off", () => {
    expect(order(3)).toEqual(order(0));
  });

  it("charges a part-done task for what is left of it, not for the whole run", () => {
    const started = collectSuggestions(
      [dailiesProvider],
      context({ tracker: tracker({ progress: { netracells: { key: weeklyKey, count: 3 } } }) }),
    ).find((suggestion) => suggestion.id === "dailies:netracells");
    const fresh = collectSuggestions([dailiesProvider], context()).find(
      (suggestion) => suggestion.id === "dailies:netracells",
    );

    expect(started?.progress).toEqual({ current: 3, required: 5 });
    expect(started?.signals.effort ?? 1).toBeLessThan(fresh?.signals.effort ?? 0);
    // Effort orders nothing, so getting cheaper must not move the card at all.
    expect(started?.score).toBe(fresh?.score);
  });

  it("never charges a five-run weekly the maximum possible effort", () => {
    const netracells = draft(context(), "dailies:netracells");
    expect(netracells?.signals.effort ?? 1).toBeLessThan(0.7);
  });
});

describe("dailiesProvider under a server-wide affinity boost", () => {
  const HOUR = 60 * 60_000;

  function boostWorld(overrides: Partial<GlobalBoost> = {}): WorldState {
    const boost: GlobalBoost = {
      kind: "affinity",
      multiplier: 2,
      activation: new Date(NOW - HOUR).toISOString(),
      expiry: new Date(NOW + HOUR).toISOString(),
      ...overrides,
    };
    return { globalBoosts: [boost] } as unknown as WorldState;
  }

  function boosted(world: WorldState | null, id: string) {
    return draft(context({ world, t: echoT }), id);
  }

  it("says so on the daily focus cap and pays more for it", () => {
    const live = boosted(boostWorld(), "dailies:dailyFocus");
    const plain = boosted(null, "dailies:dailyFocus");
    expect(live?.why).toContain("nextUp.whyAffinityBoost(multiplier=2)");
    expect(live?.signals.value ?? 0).toBeGreaterThan(plain?.signals.value ?? 0);
  });

  it("says so on steel path circuit, which you run on your own gear", () => {
    const live = boosted(boostWorld(), "dailies:circuitSteelPath");
    expect(live?.why).toContain("nextUp.whyAffinityBoost(multiplier=2)");
  });

  it("carries the multiplier DE actually shipped", () => {
    const live = boosted(boostWorld({ multiplier: 3 }), "dailies:dailyFocus");
    expect(live?.why).toContain("nextUp.whyAffinityBoost(multiplier=3)");
  });

  it("leaves tasks the boost does not help where they were", () => {
    const world = boostWorld();
    for (const id of ["dailies:circuitNormal", "dailies:netracells", "dailies:sortie"]) {
      expect(boosted(world, id)?.why).not.toContain("nextUp.whyAffinityBoost");
      expect(boosted(world, id)?.signals.value).toBe(boosted(null, id)?.signals.value);
    }
  });

  it("ignores a boost whose window has closed", () => {
    const past = boostWorld({
      activation: new Date(NOW - 3 * HOUR).toISOString(),
      expiry: new Date(NOW - HOUR).toISOString(),
    });
    expect(boosted(past, "dailies:dailyFocus")?.why).not.toContain("nextUp.whyAffinityBoost");
  });

  it("ignores a boost that has not started yet", () => {
    const upcoming = boostWorld({
      activation: new Date(NOW + HOUR).toISOString(),
      expiry: new Date(NOW + 3 * HOUR).toISOString(),
    });
    expect(boosted(upcoming, "dailies:dailyFocus")?.why).not.toContain("nextUp.whyAffinityBoost");
  });

  it("ignores a live boost that is not affinity", () => {
    const resources = boostWorld({ kind: "resources" });
    const focus = boosted(resources, "dailies:dailyFocus");
    expect(focus?.why).not.toContain("nextUp.whyAffinityBoost");
    expect(focus?.signals.value).toBe(boosted(null, "dailies:dailyFocus")?.signals.value);
  });

  it("does nothing for a world state carrying no boosts at all", () => {
    const empty = { globalBoosts: [] } as unknown as WorldState;
    expect(boosted(empty, "dailies:dailyFocus")?.why).not.toContain("nextUp.whyAffinityBoost");
  });
});
