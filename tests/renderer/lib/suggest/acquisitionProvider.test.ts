import { describe, expect, it } from "vitest";

import { resolveAcquisition } from "../../../../src/lib/suggest/acquisition/index.js";
import { recommendScore } from "../../../../src/lib/suggest/acquisition/recommend.js";
import { DEFAULT_OPTIONS, defaultPreferences } from "../../../../src/lib/suggest/preferences.js";
import {
  ACQUISITION_ACTIVITY,
  acquisitionProvider,
} from "../../../../src/lib/suggest/providers/acquisition.js";
import {
  frame,
  inventory,
  itemDb,
  LITH_M1,
  MAG,
  MAG_BP,
  MAG_CHASSIS,
  MAG_NEURO,
  MAG_SYSTEMS,
  OROKIN_CELL,
  relicDb,
  weaponDb,
  KUVA_BRAMMA,
  MAGP,
} from "./acquisition/fixtures.js";
import type { Translator } from "../../../../src/lib/i18n.js";
import type { ItemDbEntry, RawInventoryData } from "../../../../src/types/inventory.js";
import type { RelicDatabase } from "../../../../src/types/relics.js";
import type {
  ActivityPref,
  SuggestionOptions,
  SuggestionContext,
  SuggestionDraft,
} from "../../../../src/types/suggest.js";
import type { TrackerState } from "../../../../src/lib/world/dailies.js";

const NOW = Date.parse("2026-09-05T12:00:00Z");
const t = ((key: string) => key) as unknown as Translator;

function tracker(): TrackerState {
  return { progress: {}, hidden: [], periods: {}, custom: [], seq: 0 };
}

interface Shape {
  itemDb?: Record<string, ItemDbEntry>;
  inventory?: RawInventoryData | null;
  relicDb?: RelicDatabase | null;
  activities?: Record<string, ActivityPref>;
  options?: Partial<SuggestionOptions>;
}

function context(shape: Shape = {}): SuggestionContext {
  return {
    world: null,
    inventory: shape.inventory ?? null,
    itemDb: shape.itemDb ?? itemDb(),
    inventoryModifiedAt: null,
    mastery: null,
    relicDb: shape.relicDb ?? null,
    plat: null,
    tracker: tracker(),
    prefs: {
      ...defaultPreferences(),
      activities: shape.activities ?? {},
      options: { ...DEFAULT_OPTIONS, ...shape.options },
    },
    dropPools: {},
    nowMs: NOW,
    t,
  };
}

function collect(shape: Shape = {}): SuggestionDraft[] {
  return acquisitionProvider.collect(context(shape));
}

function draftFor(drafts: SuggestionDraft[], uniqueName: string): SuggestionDraft {
  const match = drafts.find((draft) => draft.id === `acquisition:${uniqueName}`);
  if (!match) throw new Error(`no draft for ${uniqueName}`);
  return match;
}

/** Frames nothing has curated, so every one of them resolves to no route. */
function manyFrames(count: number): Record<string, ItemDbEntry> {
  const db: Record<string, ItemDbEntry> = { [OROKIN_CELL]: { name: "Orokin Cell" } };
  for (let index = 0; index < count; index += 1) {
    const name = `Testframe ${String.fromCharCode(65 + index)}`;
    const unique = `/Lotus/Powersuits/Test/Test${index}`;
    const blueprint = `${unique}Blueprint`;
    db[unique] = frame(name, blueprint, []);
    db[blueprint] = { name: `${name} Blueprint`, buildsProduct: unique };
  }
  return db;
}

describe("acquisitionProvider", () => {
  it("caps the section rather than flooding the feed", () => {
    const drafts = collect({ itemDb: manyFrames(12) });
    expect(drafts).toHaveLength(6);
    expect(new Set(drafts.map((draft) => draft.category))).toEqual(new Set(["acquisition"]));
  });

  it("offers every target the resolver found, best recommended first", () => {
    const db = itemDb();
    const targets = resolveAcquisition({ itemDb: db, inventory: null });
    const drafts = collect({ itemDb: db });
    expect(new Set(drafts.map((draft) => draft.id))).toEqual(
      new Set(targets.map((target) => `acquisition:${target.uniqueName}`)),
    );
    const scores = drafts.map((draft) => {
      const target = draft.details?.acquisition;
      return recommendScore(target?.rank ?? null, target?.difficulty ?? null);
    });
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("keeps value running with the resolver's effort so the scorer agrees", () => {
    const drafts = collect();
    for (const draft of drafts) {
      expect(draft.signals.value).toBeCloseTo(1 - draft.signals.effort);
      expect(draft.signals.urgency).toBe(0);
    }
  });

  it("drops the domain on never and keeps it last on low", () => {
    expect(collect({ activities: { [ACQUISITION_ACTIVITY]: "never" } })).toEqual([]);
    const low = collect({ activities: { [ACQUISITION_ACTIVITY]: "low" } });
    expect(low.length).toBeGreaterThan(0);
    for (const draft of low) expect(draft.deprioritized).toBe(true);
  });

  it("says a target has no known route rather than hiding it", () => {
    const drafts = collect({ itemDb: manyFrames(1) });
    const draft = drafts[0];
    expect(draft.details?.acquisition?.paths).toEqual([]);
    const segments = draft.whySegments ?? [];
    expect(segments[segments.length - 1]).toEqual({ text: "nextUp.whyAcqNoRoute", tone: "bad" });
    expect(draft.signals.effort).toBe(1);
  });

  it("reads a build the foundry would take today as ready and all but free", () => {
    const drafts = collect({
      inventory: inventory({
        recipes: { [MAG_BP]: 1 },
        misc: { [MAG_NEURO]: 1, [MAG_CHASSIS]: 1, [MAG_SYSTEMS]: 1, [OROKIN_CELL]: 5 },
      }),
    });
    const mag = draftFor(drafts, MAG);
    expect(mag.signals.effort).toBeLessThan(0.1);
    expect(mag.whySegments).toEqual([{ text: "nextUp.whyAcqReady", tone: "good" }]);
  });

  it("carries the parts a build still owes as progress and in the fingerprint", () => {
    const drafts = collect({ inventory: inventory({ recipes: { [MAG_BP]: 1 } }) });
    const mag = draftFor(drafts, MAG);
    expect(mag.progress).toEqual({ current: 1, required: 4 });
    expect(mag.fingerprint).toBe(`${MAG}|mastery+subsume|1/4`);
  });

  it("counts the relics a Prime needs against the ones held", () => {
    const withRelics = draftFor(
      collect({ relicDb: relicDb(), inventory: inventory({ misc: { [LITH_M1]: 3 } }) }),
      MAGP,
    );
    const relicPath = withRelics.details?.acquisition?.paths.find((path) => path.kind === "relics");
    expect(relicPath?.cost.relics).toMatchObject({ known: true, held: 3, needed: 2 });
    expect(relicPath?.cost.relics?.rows[0]).toMatchObject({ relic: "Lith M1", held: 3 });
  });

  it("still offers the relic run to a Prime with nothing in the pocket", () => {
    const empty = draftFor(collect({ relicDb: relicDb() }), MAGP);
    const relicPath = empty.details?.acquisition?.paths.find((path) => path.kind === "relics");
    expect(relicPath?.cost.relics).toMatchObject({ known: true, held: 0, needed: 2 });
  });

  it("hands a nemesis weapon its whole run, step by step", () => {
    const bramma = draftFor(collect({ itemDb: weaponDb() }), KUVA_BRAMMA);
    const target = bramma.details?.acquisition;
    expect(target?.nemesis?.family).toBe("kuva");
    const run = target?.paths.find((path) => path.kind === "nemesis");
    expect(run?.steps.length).toBeGreaterThan(3);
    expect(run?.steps.some((step) => /Requiem/.test(step.where))).toBe(true);
    expect(bramma.title).toBe("nextUp.acquisitionGet");
  });

  it("offers only the kinds of gear the section is set to include", () => {
    const db = weaponDb();
    const frames = collect({ itemDb: db, options: { acquisitionKinds: ["warframe"] } });
    expect(frames).toEqual([]);
    const melee = collect({ itemDb: db, options: { acquisitionKinds: ["melee"] } });
    expect(melee.length).toBeGreaterThan(0);
    for (const draft of melee) {
      expect(draft.details?.acquisition?.weaponClass).toBe("melee");
    }
  });

  it("offers every kind when the section includes none of them", () => {
    const db = weaponDb();
    const classes = collect({ itemDb: db, options: { acquisitionKinds: [] } }).map(
      (draft) => draft.details?.acquisition?.weaponClass,
    );
    expect(new Set(classes).size).toBeGreaterThan(1);
  });

  it("carries the resolver's tier grade through to the card", () => {
    const mag = draftFor(collect(), MAG);
    expect(mag.grade).toMatch(/^[SABCD]$/);
    expect(mag.grade).toBe(mag.details?.acquisition?.rank);
  });

  it("leaves an unranked target with no grade at all", () => {
    const draft = collect({ itemDb: manyFrames(1) })[0];
    expect(draft.details?.acquisition?.rank).toBeNull();
    expect(draft.grade).toBeUndefined();
    expect("grade" in draft).toBe(false);
  });
});
