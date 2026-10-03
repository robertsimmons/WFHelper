import { planGroup } from "../../../../../../src/lib/suggest/acquisition/plan/materials.js";
import {
  resourceLookup,
  type ResourceLookup,
} from "../../../../../../src/lib/suggest/acquisition/plan/resources.js";
import type {
  AuthoredPlan,
  PlanRow,
} from "../../../../../../src/lib/suggest/acquisition/plan/schema.js";
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

function spot(place: string, activity: string | null = null): Record<string, unknown> {
  return { place, sub: null, activity, how: null, meta: null };
}

/** A small resource store shaped like resources.json, so plan tests never ride on
 *  what the shipped store happens to say. */
const STORE_TABLE = {
  coverage: { resources: 10, withBestPlace: 10 },
  conflicts: [],
  "Alloy Plate": {
    kind: "farm",
    harvestable: false,
    map: null,
    best: spot("GABII, CERES", "Survival"),
    alternates: [spot("DRACO, CERES", "Interception"), spot("TESSERA, VENUS")],
    tips: ["Nekros Desecrate"],
  },
  Rubedo: {
    kind: "farm",
    harvestable: false,
    map: null,
    best: spot("GABII, CERES", "Survival"),
    alternates: [],
    tips: ["Nekros Desecrate", "Resource booster"],
  },
  "Polymer Bundle": {
    harvestable: false,
    map: null,
    best: spot("ASSUR, URANUS"),
    alternates: [],
  },
  "Cetus Wisp Lens": {
    kind: "craft",
    harvestable: false,
    map: null,
    best: spot("CETUS", "Foundry"),
    alternates: [],
    tips: ["Build in batches"],
    recipe: [
      { qty: 2, label: "Rubedo" },
      { qty: 5, label: "Polymer Bundle" },
    ],
  },
  "Simaris Standing": {
    kind: "standing",
    harvestable: false,
    map: null,
    best: spot("SANCTUARY, RELAY"),
    alternates: [],
    tips: ["Scan with a Synthesis Scanner"],
  },
  Circuits: {
    harvestable: false,
    map: null,
    best: spot("GABII, CERES", "Survival"),
    alternates: [],
  },
  Ferrite: {
    harvestable: true,
    map: "ferrite-map",
    best: spot("OLYMPUS, MARS"),
    alternates: [],
  },
  Veridos: {
    kind: "farm",
    harvestable: true,
    map: "plains-of-eidolon",
    best: spot("PLAINS OF EIDOLON, EARTH", "Mine blue veins"),
    alternates: [],
  },
  "Marquise Veridos": {
    kind: "craft",
    harvestable: false,
    map: null,
    best: spot("CETUS, EARTH", "Buy the blueprint"),
    alternates: [],
    yield: 10,
    recipe: [{ qty: 10, label: "Veridos" }],
  },
  "Veridos Lens": {
    kind: "craft",
    harvestable: false,
    map: null,
    best: spot("CETUS, EARTH", "Buy the blueprint"),
    alternates: [],
    yield: 3,
    recipe: [
      { qty: 2, label: "Marquise Veridos" },
      { qty: 50, label: "Rubedo" },
    ],
  },
  Credits: {
    kind: "currency",
    harvestable: false,
    map: null,
    best: spot("THE INDEX, NEPTUNE", "The Index"),
    alternates: [],
    tips: ["Run it on High Risk"],
  },
  Höllars: { alias: "Credits" },
  Ghost: { alias: "Nobody Here" },
};

export function resources(): ResourceLookup {
  return resourceLookup(STORE_TABLE);
}

function planRow(label: string, done = false, qty: string | null = null): PlanRow {
  return { qty, label, note: null, alt: null, done };
}

function plan(name: string, groups: AuthoredPlan["groups"]): AuthoredPlan {
  return {
    name,
    kind: "warframe",
    source: "boss",
    effort: 3,
    tradeable: null,
    progress: { have: 2, need: 4, unit: "parts" },
    badges: [],
    prices: [],
    groups,
  };
}

/** Rhino as a small authored plan: a Market blueprint, a boss for the parts and
 *  two materials the fixture store puts on the same Gabii run. */
export function rhinoPlan(): AuthoredPlan {
  return {
    ...plan("Rhino", [
      planGroup("vendor", "MARKET", [planRow("Rhino Blueprint", true)]),
      planGroup("boss", "FOSSA, VENUS", [
        planRow("Neuroptics"),
        planRow("Chassis", true),
        planRow("Systems"),
      ]),
      planGroup("foundry", "FOUNDRY", [planRow("Rhino")]),
    ]),
    materials: [
      { qty: "150", label: "Alloy Plate", note: null },
      { qty: "700", label: "Circuits", note: null },
    ],
  };
}

/** One trip the player has already made and one still to do. */
export function skippedPlan(): AuthoredPlan {
  return plan("Helios", [
    planGroup("research", "CLAN DOJO", [planRow("Fieldron"), planRow("Prova")], {
      skip: { reason: "Energy Lab chain finished years ago" },
    }),
    planGroup("foundry", "FOUNDRY", [planRow("Helios")]),
  ]);
}
