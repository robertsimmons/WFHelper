import { describe, expect, it } from "vitest";

import { readCircuit } from "../../../../src/lib/suggest/circuit.js";
import type { ItemDbEntry, MasteryData } from "../../../../src/types/inventory.js";
import type { SuggestionContext } from "../../../../src/types/suggest.js";

const MESA = "/Lotus/Powersuits/Cowgirl/Cowgirl";

const itemDb: Record<string, ItemDbEntry> = {
  [MESA]: { name: "Mesa", imageUrl: "mesa.png", category: "Warframe" } as ItemDbEntry,
};

function roster(status: "mastered" | "progress"): MasteryData {
  return { items: [{ uniqueName: MESA, name: "Mesa", status }], stats: {} } as MasteryData;
}

function context(options: {
  inventory?: unknown;
  mastery?: MasteryData | null;
}): SuggestionContext {
  return {
    world: { duviriCycle: { choices: [{ category: "normal", choices: ["Mesa"] }] } },
    inventory: options.inventory ?? null,
    itemDb,
    mastery: options.mastery ?? null,
    t: (key: string) => key,
  } as unknown as SuggestionContext;
}

function choice(ctx: SuggestionContext) {
  const read = readCircuit(ctx, "circuitNormal");
  expect(read).not.toBeNull();
  return read!.choices[0]!;
}

describe("circuit choices", () => {
  it("reads mastery off the roster, not off what is in the account now", () => {
    // Mastery is banked: a frame levelled and sold still counts, so only the
    // subsume is left to win.
    const sold = choice(context({ mastery: roster("mastered") }));
    expect(sold.state).toBe("subsume");
    expect(sold.statuses).toEqual([
      { win: "mastery", done: true },
      { win: "subsume", done: false },
    ]);
  });

  it("calls a part-ranked frame unmastered", () => {
    const partial = choice(context({ mastery: roster("progress") }));
    expect(partial.state).toBe("wanted");
    expect(partial.statuses).toEqual([
      { win: "mastery", done: false },
      { win: "subsume", done: false },
    ]);
  });

  it("never reads an unread roster as already done", () => {
    const unknown = choice(context({}));
    expect(unknown.state).toBe("wanted");
    expect(unknown.statuses?.[0]).toEqual({ win: "mastery", done: false });
  });

  it("answers both wins separately once both are banked", () => {
    const both = choice(
      context({
        mastery: roster("mastered"),
        inventory: { InfestedFoundry: { ConsumedSuits: [{ s: MESA }] } },
      }),
    );
    // One value could never say this: the old state collapsed to "done" and the
    // reader could no longer tell which half was finished.
    expect(both.state).toBe("done");
    expect(both.statuses).toEqual([
      { win: "mastery", done: true },
      { win: "subsume", done: true },
    ]);
  });

  it("gives an adapter the one win it can bank", () => {
    const read = readCircuit(
      {
        ...context({}),
        world: { duviriCycle: { choices: [{ category: "hard", choices: ["Braton"] }] } },
        itemDb: {
          "/Lotus/Weapons/Tenno/Rifle/Braton": {
            name: "Braton",
            imageUrl: "braton.png",
            category: "Primary",
          } as ItemDbEntry,
        },
      } as unknown as SuggestionContext,
      "circuitSteelPath",
    );
    expect(read?.choices[0]?.statuses).toEqual([{ win: "adapter", done: false }]);
  });
});
