import { describe, expect, it } from "vitest";

import { resolveAcquisition } from "../../../../src/lib/suggest/acquisition/index.js";
import { buildOwnership } from "../../../../src/lib/suggest/acquisition/parts.js";
import { nitainNeed } from "../../../../src/lib/suggest/nitain.js";
import { inventory } from "./acquisition/fixtures.js";
import {
  DORMA,
  HYDROID_NEURO,
  NEKROS,
  NIDUS,
  NITAIN,
  WANZ,
  masteredNidus,
  nitainDb,
  withHounds,
} from "./nitainFixture.js";
import type { ItemDbEntry, MasteryData, RawInventoryData } from "../../../../src/types/inventory.js";

function need(
  held: RawInventoryData,
  mastery: MasteryData | null = masteredNidus(),
  itemDb: Record<string, ItemDbEntry> = nitainDb(),
) {
  const targets = resolveAcquisition({ itemDb, inventory: held, mastery });
  return nitainNeed(targets, NITAIN, itemDb, buildOwnership(held, itemDb));
}

describe("nitainNeed", () => {
  it("splits what is unbuilt into mastery, Prime and subsume", () => {
    expect(need(inventory({ suits: [NEKROS] }))).toEqual({
      normal: 5,
      prime: 2,
      subsume: 3,
      held: 0,
      short: 10,
    });
  });

  it("walks a part recipe, and drops the Nitain of a part already held", () => {
    expect(need(inventory({ suits: [NEKROS] })).normal).toBe(5);
    expect(need(inventory({ suits: [NEKROS], misc: { [HYDROID_NEURO]: 1 } })).normal).toBe(0);
  });

  it("asks no Nitain of a frame still in hand to feed the Helminth", () => {
    expect(need(inventory({ suits: [NEKROS, NIDUS] })).subsume).toBe(0);
  });

  it("counts a frame owed its mastery under mastery, not subsume as well", () => {
    const unmastered = need(inventory({ suits: [NEKROS] }), null);
    expect(unmastered.subsume).toBe(0);
    expect(unmastered.normal).toBe(8);
  });

  it("asks nothing of a sold frame already subsumed", () => {
    expect(need(inventory({ suits: [NEKROS], subsumed: [NIDUS] })).subsume).toBe(0);
  });

  it("takes what is held off the total, never off one goal", () => {
    const held = need(inventory({ suits: [NEKROS], misc: { [NITAIN]: 4 } }));
    expect(held).toMatchObject({ normal: 5, prime: 2, subsume: 3, held: 4, short: 6 });
    expect(need(inventory({ suits: [NEKROS], misc: { [NITAIN]: 40 } })).short).toBe(0);
  });

  it("prices each unbuilt modular head as one build at its slots' cheapest parts", () => {
    const hounds = withHounds(nitainDb());
    const base = need(inventory({ suits: [NEKROS] })).normal;
    expect(need(inventory({ suits: [NEKROS] }), masteredNidus(), hounds).normal).toBe(base + 6);
    expect(
      need(inventory({ suits: [NEKROS], misc: { [WANZ]: 1 } }), masteredNidus(), hounds).normal,
    ).toBe(base + 3);
    expect(
      need(inventory({ suits: [NEKROS], modularParts: [DORMA] }), masteredNidus(), hounds).normal,
    ).toBe(base + 3);
  });
});
