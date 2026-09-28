import type { ItemDbEntry, RawInventoryData } from "../../../../../../src/types/inventory.js";
import type { WorldState } from "../../../../../../src/types/world.js";

const ALLOY_PLATE = "/Lotus/Types/Items/MiscItems/AlloyPlate";
const CIRCUITS = "/Lotus/Types/Items/MiscItems/Circuits";
const FERRITE = "/Lotus/Types/Items/MiscItems/Ferrite";
const RHINO = "/Lotus/Powersuits/Rhino/Rhino";
const RHINO_BP = "/Lotus/Types/Recipes/Warframes/RhinoBlueprint";

/** Keyed by the name DE ships for the keychain, which is what a plan row has to
 *  match, spelling and all. */
const QUEST_KEYCHAINS: Record<string, string> = {
  "The War Within": "/Lotus/Types/Keys/WarWithinQuest/WarWithinQuestKeyChain",
  "Call of the Tempestarii": "/Lotus/Types/Keys/TempestariiQuest/TempestariiQuestKeyChain",
  "The Archwing": "/Lotus/Types/Keys/ArchwingQuest/ArchwingQuestKeyChain",
  "The Rising Tide": "/Lotus/Types/Keys/RailJackBuildQuest/RailjackBuildQuestKeyChain",
  "Heart of Deimos": "/Lotus/Types/Keys/InfestedMicroplanetQuest/InfestedMicroplanetQuestKeyChain",
  "The New War": "/Lotus/Types/Keys/NewWarQuest/NewWarQuestKeyChain",
};

function questEntries(): Record<string, ItemDbEntry> {
  const entries: Record<string, ItemDbEntry> = {};
  for (const [name, uniqueName] of Object.entries(QUEST_KEYCHAINS)) {
    entries[uniqueName] = { name, category: "Key" };
  }
  return entries;
}

export function itemDb(): Record<string, ItemDbEntry> {
  return {
    [ALLOY_PLATE]: { name: "Alloy Plate" },
    [CIRCUITS]: { name: "Circuits" },
    [FERRITE]: { name: "Ferrite" },
    [RHINO]: { name: "Rhino" },
    [RHINO_BP]: { name: "Rhino Blueprint", buildsProduct: RHINO },
    ...questEntries(),
  };
}

export function inventory(overrides: Partial<RawInventoryData> = {}): RawInventoryData {
  return {
    MiscItems: [
      { ItemType: ALLOY_PLATE, ItemCount: 100 },
      { ItemType: CIRCUITS, ItemCount: 700 },
    ],
    ...overrides,
  };
}

export function building(endsAt: number): RawInventoryData {
  return {
    ...inventory(),
    PendingRecipes: [{ ItemType: RHINO_BP, CompletionDate: new Date(endsAt).toISOString() }],
  };
}

/** True is a finished quest, false one that is started but unfinished; a quest
 *  left out is absent from the payload, which is how an unstarted one reads. */
export function quests(progress: Record<string, boolean>): RawInventoryData {
  return {
    ...inventory(),
    QuestKeys: Object.entries(progress).map(([name, done]) =>
      done
        ? { ItemType: QUEST_KEYCHAINS[name], Completed: true }
        : { ItemType: QUEST_KEYCHAINS[name] },
    ),
  };
}

export function duviri(mood: string, endsAt: number): WorldState {
  return { duviriCycle: { state: mood, expiry: new Date(endsAt).toISOString() } };
}
