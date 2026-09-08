import { afterEach, describe, expect, it } from "vitest";

import ladderData from "../../../../src/data/suggest/rewardValues.json";
import vendorOffers from "../../../../src/data/suggest/vendorOffers.json";
import { normalizeName } from "../../../../src/lib/suggest/rewards.js";
import {
  FOOT_POSITION,
  TOP_POSITION,
  UNPLACED_WORTH,
  bandCeiling,
  entryPosition,
  groupForWorth,
  groupRank,
  ladderWorth,
  ladderWorthAt,
  orderEntries,
  reorderPositions,
  rewardCount,
  setLadderPositions,
  shippedPlacements,
  taskRewardNames,
} from "../../../../src/lib/suggest/worthLadder.js";
import { LADDER_GROUPS, type LadderGroup } from "../../../../src/types/suggest.js";

const PLACED = shippedPlacements();

function first(group: LadderGroup): string {
  return normalizeName(ladderData.ladder[group][0] ?? "");
}

function last(group: LadderGroup): string {
  const names = ladderData.ladder[group];
  return normalizeName(names[names.length - 1] ?? "");
}

describe("the worth ladder", () => {
  it("gives every group its own band, best group highest", () => {
    const bands = LADDER_GROUPS.map((group) => ({
      group,
      high: ladderWorth(group, first(group)),
      low: ladderWorth(group, last(group)),
    }));
    for (const band of bands) expect(band.high).toBeGreaterThan(band.low);
    for (let i = 1; i < bands.length; i += 1) {
      expect(bands[i - 1]?.low ?? 0).toBeGreaterThan(bands[i]?.high ?? 1);
    }
  });

  it("interpolates a reorder as a nudge and a group change as a jump", () => {
    const must = ladderData.ladder.must.map((name) => ladderWorth("must", normalizeName(name)));
    for (let i = 1; i < must.length; i += 1) {
      expect(must[i - 1] ?? 0).toBeGreaterThan(must[i] ?? 1);
    }
    const nudge = (must[0] ?? 0) - (must[1] ?? 0);
    const jump = (must[must.length - 1] ?? 0) - ladderWorth("want", first("want"));
    expect(jump).toBeGreaterThan(nudge);
  });

  it("seats an entry the player moved into a group at the foot of its band", () => {
    expect(ladderWorth("must", "kuva")).toBeLessThanOrEqual(ladderWorth("must", last("must")));
    expect(ladderWorth("must", "kuva")).toBeLessThan(ladderWorth("must", first("must")));
    expect(groupForWorth(ladderWorth("must", "kuva"))).toBe("must");
  });

  it("reads a worth back as the group that owns it", () => {
    for (const group of LADDER_GROUPS) {
      expect(groupForWorth(ladderWorth(group, first(group)))).toBe(group);
      expect(groupForWorth(ladderWorth(group, last(group)))).toBe(group);
    }
    expect(groupForWorth(UNPLACED_WORTH)).toBe("unplaced");
    expect(groupForWorth(0.01)).toBe("unplaced");
  });

  it("holds an unplaced entry at zero however many of it there are", () => {
    expect(ladderWorth("unplaced", "kuva", 500)).toBe(UNPLACED_WORTH);
    expect(bandCeiling("unplaced")).toBe(UNPLACED_WORTH);
  });

  it("never lets quantity carry an entry out of its group", () => {
    for (const group of LADDER_GROUPS) {
      const top = ladderWorth(group, first(group), 1_000_000);
      expect(top).toBeLessThanOrEqual(bandCeiling(group) + 0.02);
      expect(groupForWorth(top)).toBe(group);
    }
  });

  it("ranks the groups best first", () => {
    expect(groupRank("must")).toBeLessThan(groupRank("want"));
    expect(groupRank("junk")).toBeLessThan(groupRank("unplaced"));
  });
});

describe("rewardCount", () => {
  it("reads the count off the name the ladder strips", () => {
    expect(rewardCount("3x Forma")).toBe(3);
    expect(rewardCount("Forma")).toBe(1);
    expect(rewardCount("50,000 Kuva")).toBe(50_000);
    expect(rewardCount("10k Kuva")).toBe(10_000);
    expect(rewardCount(null)).toBe(1);
  });
});

describe("curated task rewards", () => {
  it("names something for every task whose payout world state never does", () => {
    for (const id of ["kahl", "simaris", "syndicateStanding", "dailyFocus", "clem", "ayatanHunt"]) {
      expect(taskRewardNames(id).length).toBeGreaterThan(0);
    }
  });

  it("only names rewards the ladder actually places", () => {
    for (const names of Object.values(ladderData.tasks)) {
      for (const name of names) expect(PLACED[normalizeName(name)]).toBeDefined();
    }
  });

  it("places every curated vendor offer a card can carry as its reward", () => {
    const offers = Object.values(
      vendorOffers as unknown as Record<string, { name: string }[]>,
    ).flat();
    const unplaced = offers
      .map((offer) => normalizeName(offer.name))
      .filter((key) => PLACED[key] === undefined);
    expect(unplaced).toEqual([]);
  });

  it("places every currency and standing an activity can pay", () => {
    for (const name of [
      "Focus Points",
      "Syndicate Standing",
      "Simaris Standing",
      "Kahl's Stock",
      "Steel Essence",
      "Platinum",
      "Ducats",
      "Mastery Points",
      "Nightwave Standing",
      "Credits",
    ]) {
      expect(PLACED[normalizeName(name)]).toBeDefined();
    }
  });
});

function keys(group: LadderGroup): string[] {
  return ladderData.ladder[group].map(normalizeName);
}

describe("reordering the ladder", () => {
  afterEach(() => {
    setLadderPositions({});
  });

  it("leaves a group nobody has dragged in the order it ships in", () => {
    for (const group of LADDER_GROUPS) {
      const shipped = keys(group);
      expect(orderEntries(group, [...shipped].reverse(), {})).toEqual(shipped);
    }
  });

  it("reads a dragged entry back in the place it was dropped", () => {
    const want = keys("want");
    const moved = want[want.length - 1] ?? "";
    const positions = reorderPositions(want, moved, 0);
    expect(orderEntries("want", want, positions)).toEqual([moved, ...want.slice(0, -1)]);
  });

  it("keeps the entries around a drag in the order they were already in", () => {
    const useful = keys("useful");
    const moved = useful[3] ?? "";
    const positions = reorderPositions(useful, moved, 0);
    expect(orderEntries("useful", useful, positions)).toEqual([
      moved,
      ...useful.filter((key) => key !== moved),
    ]);
  });

  it("moves the worth within the band and never out of it", () => {
    const want = keys("want");
    const moved = want[want.length - 1] ?? "";
    const shipped = ladderWorthAt({}, "want", moved);
    const positions = reorderPositions(want, moved, 0);
    const dragged = ladderWorthAt(positions, "want", moved);

    expect(dragged).toBeGreaterThan(shipped);
    expect(dragged).toBe(bandCeiling("want"));
    expect(groupForWorth(dragged)).toBe("want");
  });

  it("holds every entry of every reordered group inside its own band", () => {
    for (const group of LADDER_GROUPS) {
      const shipped = keys(group);
      const positions = reorderPositions(shipped, shipped[shipped.length - 1] ?? "", 0);
      for (const key of shipped) {
        expect(groupForWorth(ladderWorthAt(positions, group, key))).toBe(group);
        expect(groupForWorth(ladderWorthAt(positions, group, key, 1_000_000))).toBe(group);
      }
    }
  });

  it("leaves an entry in another group exactly where it shipped", () => {
    const must = keys("must");
    const before = must.map((key) => ladderWorthAt({}, "must", key));
    const positions = reorderPositions(keys("want"), keys("want")[0] ?? "", 3);
    expect(must.map((key) => ladderWorthAt(positions, "must", key))).toEqual(before);
  });

  it("lifts an entry the player moved into a group off the foot of its band", () => {
    const must = keys("must");
    const positions = reorderPositions([...must, "kuva"], "kuva", 0);
    expect(entryPosition("must", "kuva", {})).toBe(FOOT_POSITION);
    expect(entryPosition("must", "kuva", positions)).toBe(TOP_POSITION);
    expect(ladderWorthAt(positions, "must", "kuva")).toBe(bandCeiling("must"));
    expect(groupForWorth(ladderWorthAt(positions, "must", "kuva"))).toBe("must");
  });

  it("seats a group of one at the top of its band", () => {
    expect(reorderPositions(["kuva"], "kuva", 0)).toEqual({ kuva: TOP_POSITION });
  });

  it("pins a drop past either end to the end it was aimed at", () => {
    const want = keys("want");
    const moved = want[0] ?? "";
    // Past the end, whatever the group's length happens to be today.
    const positions = reorderPositions(want, moved, want.length + 5);
    expect(orderEntries("want", want, positions)).toEqual([...want.slice(1), moved]);
    expect(reorderPositions(want, moved, -5)).toEqual(reorderPositions(want, moved, 0));
  });

  it("pulls a hand-edited position back into the band it names", () => {
    expect(entryPosition("must", "kuva", { kuva: -3 })).toBe(TOP_POSITION);
    expect(entryPosition("must", "kuva", { kuva: 12 })).toBe(FOOT_POSITION);
    expect(entryPosition("must", "kuva", { kuva: Number.NaN })).toBe(FOOT_POSITION);
  });

  it("scores off the order the store published, not the shipped one", () => {
    const want = keys("want");
    const moved = want[want.length - 1] ?? "";
    expect(ladderWorth("want", moved)).toBeLessThan(bandCeiling("want"));
    setLadderPositions(reorderPositions(want, moved, 0));
    expect(ladderWorth("want", moved)).toBe(bandCeiling("want"));
  });
});
