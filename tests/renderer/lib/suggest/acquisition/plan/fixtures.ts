import type { ItemDbEntry, RawInventoryData } from "../../../../../../src/types/inventory.js";
import type { WorldState } from "../../../../../../src/types/world.js";

const ALLOY_PLATE = "/Lotus/Types/Items/MiscItems/AlloyPlate";
const CIRCUITS = "/Lotus/Types/Items/MiscItems/Circuits";
const FERRITE = "/Lotus/Types/Items/MiscItems/Ferrite";
const RHINO = "/Lotus/Powersuits/Rhino/Rhino";
const RHINO_BP = "/Lotus/Types/Recipes/Warframes/RhinoBlueprint";

export function itemDb(): Record<string, ItemDbEntry> {
  return {
    [ALLOY_PLATE]: { name: "Alloy Plate" },
    [CIRCUITS]: { name: "Circuits" },
    [FERRITE]: { name: "Ferrite" },
    [RHINO]: { name: "Rhino" },
    [RHINO_BP]: { name: "Rhino Blueprint", buildsProduct: RHINO },
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

export function duviri(mood: string, endsAt: number): WorldState {
  return { duviriCycle: { state: mood, expiry: new Date(endsAt).toISOString() } };
}
