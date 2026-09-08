import { beforeEach, describe, expect, it } from "vitest";

import {
  buildOwnership,
  buildPartPlans,
  resetUnbuiltResourceNeedForTest,
} from "../../../../src/lib/suggest/acquisition/parts.js";
import { defaultPreferences } from "../../../../src/lib/suggest/preferences.js";
import {
  nightwaveProvider,
  nightwaveRowFor,
} from "../../../../src/lib/suggest/providers/nightwave.js";
import { rewardValue } from "../../../../src/lib/suggest/rewards.js";
import { worthGroupOf } from "../../../../src/lib/suggest/score.js";
import { ladderWorth } from "../../../../src/lib/suggest/worthLadder.js";
import type { Translator } from "../../../../src/lib/i18n.js";
import type {
  ItemDbEntry,
  MasteryData,
  MasteryStatus,
  RawInventoryData,
} from "../../../../src/types/inventory.js";
import type { TrackerState } from "../../../../src/lib/world/dailies.js";
import { NIGHTWAVE_STAPLES } from "../../../../src/types/suggest.js";
import type {
  ActivityPref,
  SuggestionContext,
  SuggestionDraft,
} from "../../../../src/types/suggest.js";

const NOW = Date.parse("2026-09-05T12:00:00Z");
const t = ((key: string) => key) as unknown as Translator;

const NITAIN = "/Lotus/Types/Items/MiscItems/Alertium";
const CATALYST = "/Lotus/Types/Items/MiscItems/OrokinCatalyst";
const CATALYST_BP = "/Lotus/Types/Recipes/Components/OrokinCatalystBlueprint";
const REACTOR = "/Lotus/Types/Items/MiscItems/OrokinReactor";
const VAUBAN = "/Lotus/Powersuits/Trapper/Trapper";
const VAUBAN_CHASSIS = "/Lotus/Types/Recipes/Suits/SuitParts/TrapperChassisComponent";
const VAUBAN_HELMET = "/Lotus/Types/Recipes/Suits/SuitParts/TrapperHelmetComponent";
const VAUBAN_SYSTEMS = "/Lotus/Types/Recipes/Suits/SuitParts/TrapperSystemsComponent";
const CRAFT = "/Lotus/Types/Items/Ships/NoraShip";
const CRAFT_MAIN = "/Lotus/Types/Recipes/LandingCraftRecipes/Nora/NoraLandingCraftBlueprint";
const CRAFT_AVIONICS = "/Lotus/Types/Recipes/LandingCraftRecipes/Nora/NoraAvionicsBlueprint";
const CRAFT_ENGINES = "/Lotus/Types/Recipes/LandingCraftRecipes/Nora/NoraEnginesBlueprint";
const CRAFT_FUSELAGE = "/Lotus/Types/Recipes/LandingCraftRecipes/Nora/NoraFuselageBlueprint";
/** Something unbuilt whose recipe still asks for Nitain. */
const HELIOS = "/Lotus/Types/Sentinels/SentinelPreceptsHelios";

const ITEM_DB: Record<string, ItemDbEntry> = {
  [NITAIN]: { name: "Nitain Extract", imageUrl: "nitain.png" },
  [CATALYST]: { name: "Orokin Catalyst", imageUrl: "catalyst.png" },
  [CATALYST_BP]: {
    name: "Orokin Catalyst Blueprint",
    imageUrl: "catalyst-bp.png",
    buildsProduct: CATALYST,
  },
  [REACTOR]: { name: "Orokin Reactor", imageUrl: "reactor.png" },
  [VAUBAN]: { name: "Vauban", imageUrl: "vauban.png", masterable: true, productCategory: "Suits" },
  [VAUBAN_CHASSIS]: { name: "Vauban Chassis", imageUrl: "chassis.png" },
  [VAUBAN_HELMET]: { name: "Vauban Neuroptics", imageUrl: "neuroptics.png" },
  [VAUBAN_SYSTEMS]: { name: "Vauban Systems", imageUrl: "systems.png" },
  [CRAFT]: { name: "Nightwave", imageUrl: "nightwave.png" },
  [CRAFT_MAIN]: { name: "Nightwave Blueprint", imageUrl: "craft.png" },
  [CRAFT_AVIONICS]: { name: "Nightwave Avionics Blueprint", imageUrl: "avionics.png" },
  [CRAFT_ENGINES]: { name: "Nightwave Engines Blueprint", imageUrl: "engines.png" },
  [CRAFT_FUSELAGE]: { name: "Nightwave Fuselage Blueprint", imageUrl: "fuselage.png" },
  [HELIOS]: {
    name: "Helios",
    imageUrl: "helios.png",
    masterable: true,
    recipe: {
      buildPrice: 15000,
      buildTime: 86400,
      num: 1,
      ingredients: [{ uniqueName: NITAIN, count: 4 }],
    },
  },
};

function tracker(): TrackerState {
  return { progress: {}, hidden: [], periods: {}, custom: [], seq: 0 };
}

function stacks(counts: Record<string, number>): RawInventoryData {
  return {
    MiscItems: Object.entries(counts).map(([ItemType, ItemCount]) => ({ ItemType, ItemCount })),
  };
}

function mastery(name: string, status: MasteryStatus): MasteryData {
  return {
    items: [{ name, status }],
    stats: {},
  } as unknown as MasteryData;
}

function prefs(overrides: Partial<ReturnType<typeof defaultPreferences>> = {}) {
  return { ...defaultPreferences(), ...overrides };
}

function context(overrides: Partial<SuggestionContext> = {}): SuggestionContext {
  return {
    world: null,
    inventory: stacks({ [CATALYST]: 1 }),
    itemDb: ITEM_DB,
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

function drafts(ctx: SuggestionContext): SuggestionDraft[] {
  return nightwaveProvider.collect(ctx);
}

function ids(ctx: SuggestionContext): string[] {
  return drafts(ctx).map((draft) => draft.id);
}

function draft(ctx: SuggestionContext, id: string): SuggestionDraft | undefined {
  return drafts(ctx).find((entry) => entry.id === id);
}

/** Seeds the sweep's build totals off one unbuilt item that needs Nitain. */
function sweepNeedingNitain(): void {
  const entry = ITEM_DB[HELIOS] as ItemDbEntry;
  buildPartPlans(
    [{ uniqueName: HELIOS, name: "Helios", entry }],
    ITEM_DB,
    buildOwnership(null, ITEM_DB),
  );
}

/** A sweep that planned nothing at all: every build is finished. */
function sweepNeedingNothing(): void {
  buildPartPlans([], ITEM_DB, buildOwnership(null, ITEM_DB));
}

beforeEach(() => {
  resetUnbuiltResourceNeedForTest();
});

describe("nightwaveProvider stock cards", () => {
  it("says nothing about stock while no inventory has been read", () => {
    const collected = ids(context({ inventory: null }));
    expect(collected).not.toContain("nightwave:catalyst");
    expect(collected).not.toContain("nightwave:nitain");
  });

  it("places a staple below the keep-on-hand level in useful", () => {
    const card = draft(context({ inventory: stacks({ [CATALYST]: 3 }) }), "nightwave:catalyst");
    expect(card?.signals.value).toBe(ladderWorth("useful", "orokin catalyst"));
    expect(card?.progress).toEqual({ current: 3, required: 5 });
  });

  it("places a staple at zero in must-have", () => {
    const card = draft(context(), "nightwave:reactor");
    expect(worthGroupOf({ signals: card?.signals ?? { value: 0, effort: 0, urgency: 0 } })).toBe(
      "must",
    );
    expect(card?.whySegments?.[0]?.tone).toBe("bad");
  });

  it("drops a staple at or above the level", () => {
    const held = stacks({ [CATALYST]: 5, [REACTOR]: 9 });
    const collected = ids(context({ inventory: held }));
    expect(collected).not.toContain("nightwave:catalyst");
    expect(collected).not.toContain("nightwave:reactor");
  });

  it("counts an uncooked blueprint as stock in hand", () => {
    const inventory: RawInventoryData = {
      MiscItems: [{ ItemType: CATALYST, ItemCount: 2 }],
      Recipes: [{ ItemType: CATALYST_BP, ItemCount: 3 }],
    };
    expect(ids(context({ inventory }))).not.toContain("nightwave:catalyst");
  });

  it("gains less the closer the pile is to the level", () => {
    const one = draft(context({ inventory: stacks({ [CATALYST]: 1 }) }), "nightwave:catalyst");
    const four = draft(context({ inventory: stacks({ [CATALYST]: 4 }) }), "nightwave:catalyst");
    expect(one?.signals.gain).toBeGreaterThan(four?.signals.gain ?? 1);
  });

  it("honours a level the player set, and drops the staple at a level of nothing", () => {
    const stock = { ...defaultPreferences().nightwaveStock, "orokin catalyst": 0 };
    const collected = ids(context({ prefs: prefs({ nightwaveStock: stock }) }));
    expect(collected).not.toContain("nightwave:catalyst");
  });

  it("exposes the name, what is held, the level and the price", () => {
    draft(context({ inventory: stacks({ [CATALYST]: 2 }) }), "nightwave:catalyst");
    expect(nightwaveRowFor("nightwave:catalyst")).toEqual({
      key: "orokin catalyst",
      name: "Orokin Catalyst",
      uniqueName: CATALYST,
      kind: "stock",
      held: 2,
      level: 5,
      cred: 75,
      bundle: 1,
    });
  });

  it("prices Nitain as a bundle of five", () => {
    draft(context(), "nightwave:nitain");
    const row = nightwaveRowFor("nightwave:nitain");
    expect(row?.cred).toBe(15);
    expect(row?.bundle).toBe(5);
  });
});

describe("the Nitain exception", () => {
  it("keeps Nitain at zero must-have while something unbuilt still needs it", () => {
    sweepNeedingNitain();
    const card = draft(context(), "nightwave:nitain");
    expect(card?.signals.value).toBe(ladderWorth("must", "nitain extract"));
  });

  it("drops Nitain at zero to useful once everything that uses it is built", () => {
    sweepNeedingNothing();
    const card = draft(context(), "nightwave:nitain");
    expect(card?.signals.value).toBe(ladderWorth("useful", "nitain extract"));
  });

  it("treats an unswept plan as unknown rather than as nothing needing Nitain", () => {
    const card = draft(context(), "nightwave:nitain");
    expect(card?.signals.value).toBe(ladderWorth("must", "nitain extract"));
  });

  it("leaves the other staples out of the build check", () => {
    sweepNeedingNothing();
    const card = draft(context(), "nightwave:reactor");
    expect(card?.signals.value).toBe(ladderWorth("must", "orokin reactor"));
  });
});

describe("nightwaveProvider filler cards", () => {
  it("suggests Vauban parts and the landing craft parts as filler", () => {
    const collected = ids(context());
    expect(collected).toContain("nightwave:vauban");
    expect(collected).toContain("nightwave:landingCraft");
    const vauban = draft(context(), "nightwave:vauban");
    expect(vauban?.signals.value).toBe(rewardValue(defaultPreferences(), "Vauban parts"));
    const craft = draft(context(), "nightwave:landingCraft");
    expect(craft?.signals.value).toBe(
      rewardValue(defaultPreferences(), "Nightwave landing craft parts"),
    );
  });

  it("counts the parts already bought", () => {
    const inventory: RawInventoryData = {
      MiscItems: [{ ItemType: CATALYST, ItemCount: 1 }],
      Recipes: [{ ItemType: VAUBAN_CHASSIS, ItemCount: 1 }],
    };
    const card = draft(context({ inventory }), "nightwave:vauban");
    expect(card?.progress).toEqual({ current: 1, required: 3 });
  });

  it("says nothing about a frame the player already owns", () => {
    const inventory: RawInventoryData = {
      MiscItems: [{ ItemType: CATALYST, ItemCount: 1 }],
      Suits: [{ ItemType: VAUBAN }],
    };
    expect(ids(context({ inventory }))).not.toContain("nightwave:vauban");
  });

  it("says nothing about a frame the player has already mastered", () => {
    const ctx = context({ mastery: mastery("Vauban", "mastered") });
    expect(ids(ctx)).not.toContain("nightwave:vauban");
  });

  it("keeps suggesting a frame that is only part ranked", () => {
    const ctx = context({ mastery: mastery("Vauban", "progress") });
    expect(ids(ctx)).toContain("nightwave:vauban");
  });

  it("drops a set whose every part is already in hand", () => {
    const inventory: RawInventoryData = {
      MiscItems: [{ ItemType: CATALYST, ItemCount: 1 }],
      Recipes: [
        { ItemType: CRAFT_MAIN, ItemCount: 1 },
        { ItemType: CRAFT_AVIONICS, ItemCount: 1 },
        { ItemType: CRAFT_ENGINES, ItemCount: 1 },
        { ItemType: CRAFT_FUSELAGE, ItemCount: 1 },
      ],
    };
    expect(ids(context({ inventory }))).not.toContain("nightwave:landingCraft");
  });

  it("says nothing about a landing craft already sitting in the ships slice", () => {
    const inventory: RawInventoryData = {
      MiscItems: [{ ItemType: CATALYST, ItemCount: 1 }],
      Ships: [{ ItemType: CRAFT }],
    };
    expect(ids(context({ inventory }))).not.toContain("nightwave:landingCraft");
  });

  it("keeps suggesting the craft while only the orbiter's own ship is owned", () => {
    const inventory: RawInventoryData = {
      MiscItems: [{ ItemType: CATALYST, ItemCount: 1 }],
      Ships: [{ ItemType: "/Lotus/Types/Items/Ships/DefaultShip" }],
    };
    expect(ids(context({ inventory }))).toContain("nightwave:landingCraft");
  });

  it("pictures the craft the item database knows rather than the wiki's wording", () => {
    const card = draft(context(), "nightwave:landingCraft");
    expect(card?.reward?.uniqueName).toBe(CRAFT);
    expect(nightwaveRowFor("nightwave:landingCraft")?.uniqueName).toBe(CRAFT);
  });

  it("accepts either spelling of the craft's main blueprint", () => {
    const wikiWording: Record<string, ItemDbEntry> = {
      ...ITEM_DB,
      [CRAFT_MAIN]: { name: "Nightwave Landing Craft Blueprint", imageUrl: "craft.png" },
    };
    const inventory: RawInventoryData = {
      MiscItems: [{ ItemType: CATALYST, ItemCount: 1 }],
      Recipes: [{ ItemType: CRAFT_MAIN, ItemCount: 1 }],
    };
    const card = draft(context({ inventory, itemDb: wikiWording }), "nightwave:landingCraft");
    expect(card?.progress).toEqual({ current: 1, required: 4 });
  });
});

describe("the nightwave activity setting", () => {
  it("says nothing at all when the shop is turned off", () => {
    expect(ids(context({ prefs: prefs({ activities: { nightwave: "never" } }) }))).toEqual([]);
  });

  it("keeps a low shop below everything else", () => {
    const low: Record<string, ActivityPref> = { nightwave: "low" };
    expect(
      drafts(context({ prefs: prefs({ activities: low }) })).every((d) => d.deprioritized),
    ).toBe(true);
  });
});

describe("what the shop speaks about", () => {
  it("covers exactly the staples the contract names", () => {
    const empty: RawInventoryData = { MiscItems: [{ ItemType: REACTOR, ItemCount: 0 }] };
    const keys = drafts(context({ inventory: empty }))
      .map((card) => nightwaveRowFor(card.id))
      .filter((row) => row?.kind === "stock")
      .map((row) => row?.key);
    expect(keys.sort()).toEqual([...NIGHTWAVE_STAPLES].sort());
  });

  it("titles a filler card from its own message key", () => {
    expect(draft(context(), "nightwave:vauban")?.title).toBe("nextUp.nightwaveVaubanParts");
    expect(draft(context(), "nightwave:landingCraft")?.title).toBe("nextUp.nightwaveCraftParts");
  });
});
