import { describe, expect, it } from "vitest";

import { nextDailyResetUtc, nextWeeklyResetUtc } from "../../../../src/lib/format.js";
import { dailiesProvider } from "../../../../src/lib/suggest/providers/dailies.js";
import type { Translator } from "../../../../src/lib/i18n.js";
import type { TrackerState } from "../../../../src/lib/world/dailies.js";
import type { SuggestionContext } from "../../../../src/types/suggest.js";
import type { WorldState } from "../../../../src/types/world.js";

const NOW = Date.parse("2026-09-05T12:00:00Z");
const t = ((key: string) => key) as unknown as Translator;

function tracker(overrides: Partial<TrackerState> = {}): TrackerState {
  return { progress: {}, hidden: [], periods: {}, custom: [], seq: 0, ...overrides };
}

function context(overrides: Partial<SuggestionContext> = {}): SuggestionContext {
  return {
    world: null,
    inventory: null,
    inventoryModifiedAt: null,
    tracker: tracker(),
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
    expect(netracells?.link).toEqual({ view: "world", labelKey: "nextUp.viewInWeeklies" });
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

  it("suggests live nightwave acts", () => {
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

    const act = dailiesProvider
      .collect(context({ world }))
      .find((draft) => draft.id === "dailies:nw:act-1");
    expect(act?.category).toBe("nightwave");
    expect(act?.title).toBe("Friendly Fire");
    expect(act?.signals.urgency).toBeGreaterThan(0);
  });
});
