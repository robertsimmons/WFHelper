import { describe, expect, it } from "vitest";

import { resolveAcquisition } from "../../../../../src/lib/suggest/acquisition/index.js";
import { headlinePath } from "../../../../../src/lib/suggest/acquisition/paths.js";
import { createQuestDone } from "../../../../../src/lib/suggest/acquisition/quests.js";
import { sortRow } from "../../../../../src/lib/suggest/acquisition/sort.js";
import { frame, inventory, part } from "./fixtures.js";
import type { ItemDbEntry, RawInventoryData } from "../../../../../src/types/inventory.js";
import type { AcquisitionTarget } from "../../../../../src/lib/suggest/acquisition/types.js";

const INAROS = "/Lotus/Powersuits/Sandman/Sandman";
const INAROS_BP = "/Lotus/Types/Recipes/WarframeRecipes/SandmanBlueprint";
const INAROS_NEURO = "/Lotus/Types/Recipes/WarframeRecipes/SandmanHelmetComponent";
const INAROS_QUEST = "/Lotus/Types/Keys/MummyQuest/MummyQuestKeyChain";

const YARELI = "/Lotus/Powersuits/Yareli/Yareli";
const YARELI_BP = "/Lotus/Types/Recipes/WarframeRecipes/YareliBlueprint";
const YARELI_NEURO = "/Lotus/Types/Recipes/WarframeRecipes/YareliHelmetComponent";
const YARELI_QUEST = "/Lotus/Types/Keys/YareliQuest/YareliQuestKeyChain";

const OLD_PEACE = "/Lotus/Types/Keys/OldPeaceQuest/OldPeaceQuestKeyChain";

function db(): Record<string, ItemDbEntry> {
  return {
    [INAROS]: frame("Inaros", INAROS_BP, [INAROS_NEURO]),
    [INAROS_BP]: { name: "Inaros Blueprint", buildsProduct: INAROS },
    [INAROS_NEURO]: part("Inaros Neuroptics"),
    [YARELI]: frame("Yareli", YARELI_BP, [YARELI_NEURO]),
    [YARELI_BP]: { name: "Yareli Blueprint", buildsProduct: YARELI },
    [YARELI_NEURO]: part("Yareli Neuroptics"),
    [INAROS_QUEST]: { name: "Sands of Inaros", category: "Key" },
    [YARELI_QUEST]: { name: "The Waverider", category: "Key" },
    [OLD_PEACE]: { name: "The Old Peace", category: "Key" },
  };
}

function withQuests(base: RawInventoryData, done: string[]): RawInventoryData {
  return { ...base, QuestKeys: done.map((ItemType) => ({ ItemType, Completed: true })) };
}

function resolve(name: string, playerInventory: RawInventoryData | null): AcquisitionTarget {
  const match = resolveAcquisition({ itemDb: db(), inventory: playerInventory, only: [name] })[0];
  if (!match) throw new Error(`no target for ${name}`);
  return match;
}

describe("a finished quest as a route", () => {
  it("hands the headline to Baro once Sands of Inaros is done", () => {
    const open = resolve("Inaros", withQuests(inventory(), []));
    expect(headlinePath(open.paths)?.kind).toBe("quest");

    const done = resolve("Inaros", withQuests(inventory(), [INAROS_QUEST]));
    expect(done.paths.map((path) => path.kind)).not.toContain("quest");
    const headline = headlinePath(done.paths);
    expect(headline?.kind).toBe("vendor");
    expect(headline?.steps[0]?.where).toMatch(/^Baro Ki'Teer/);
    expect(done.effort).toBe(headline?.effort);
    expect(done.effort).toBeGreaterThan(open.effort);
  });

  it("falls to Simaris standing for a quest blueprint already spent", () => {
    const owned = inventory({ misc: { [YARELI_NEURO]: 1 } });
    const done = resolve("Yareli", withQuests(owned, [YARELI_QUEST]));
    expect(done.parts.missing.map((row) => row.name)).toEqual(["Yareli Blueprint"]);
    const headline = headlinePath(done.paths);
    expect(headline?.kind).toBe("vendor");
    expect(headline?.steps[0]?.where).toMatch(/Simaris/);
    expect(sortRow(done, done.effort, "recommended").keys[1]).toBe(headline?.effort);
  });

  it("keeps the quest where the payload says nothing about quests", () => {
    const unknown = resolve("Inaros", null);
    const noKeys = resolve("Inaros", inventory());
    for (const target of [unknown, noKeys]) {
      expect(headlinePath(target.paths)?.kind).toBe("quest");
    }
    expect(noKeys.effort).toBe(unknown.effort);
  });

  it("keeps a quest the player has not finished", () => {
    const other = resolve("Inaros", withQuests(inventory(), [YARELI_QUEST]));
    expect(headlinePath(other.paths)?.kind).toBe("quest");
  });
});

describe("createQuestDone", () => {
  const done = createQuestDone(withQuests(inventory(), [INAROS_QUEST, OLD_PEACE]), db());

  it("reads no quest progress as unknown", () => {
    expect(createQuestDone(null, db())).toBeNull();
    expect(createQuestDone(inventory(), db())).toBeNull();
  });

  it("finds the quest a table row or a sentence names", () => {
    expect(done?.("Sands of Inaros quest - guaranteed, no RNG")).toBe(true);
    expect(done?.("The blueprint is rewarded on completion of the Sands of Inaros Quest.")).toBe(
      true,
    );
    expect(done?.("The Waverider quest")).toBe(false);
    expect(done?.("Some quest nothing names")).toBe(false);
  });

  it("never spends a quest that only opens the farm", () => {
    expect(
      done?.(
        "Vinquibus' blueprints are obtained from Roathe's Oblivion, available after completing The Old Peace quest.",
      ),
    ).toBe(false);
  });
});
