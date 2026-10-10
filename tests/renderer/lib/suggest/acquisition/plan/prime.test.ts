import { describe, expect, it } from "vitest";

import { frame, part } from "../fixtures.js";
import { resolveAcquisition } from "../../../../../../src/lib/suggest/acquisition/index.js";
import {
  authoredPlan,
  generatePrimePlan,
  planFor,
  primeOverrides,
  resolvePlanFor,
  validatePlan,
  validatePrimeOverride,
} from "../../../../../../src/lib/suggest/acquisition/plan/index.js";
import { platFor } from "../../../../../../src/lib/suggest/acquisition/sort.js";
import { includesSource } from "../../../../../../src/lib/suggest/acquisition/sources.js";
import type { PrimeOverride } from "../../../../../../src/lib/suggest/acquisition/plan/primeOverrides.js";
import type { AcquisitionTarget } from "../../../../../../src/lib/suggest/acquisition/types.js";
import type { ItemDbEntry } from "../../../../../../src/types/inventory.js";
import type {
  RelicDatabase,
  RelicDropping,
  RelicGroup,
} from "../../../../../../src/types/relics.js";
import type { VaultTrader, WorldState } from "../../../../../../src/types/world.js";

const NAME = "Testframe Prime";
const TF = "/Lotus/Powersuits/Testframe/TestframePrime";
const TF_BP = "/Lotus/Types/Recipes/WarframeRecipes/TestframePrimeBlueprint";
const TF_NEURO = "/Lotus/Types/Recipes/WarframeRecipes/TestframePrimeHelmetComponent";
const TF_SYS = "/Lotus/Types/Recipes/WarframeRecipes/TestframePrimeSystemsComponent";
const ARGON = "/Lotus/Types/Items/MiscItems/ArgonCrystal";
const OROKIN_CELL = "/Lotus/Types/Items/MiscItems/OrokinCell";

const NOW = Date.parse("2026-10-10T00:00:00Z");
const DAY = 86_400_000;

function itemDb(masteryReq = 0): Record<string, ItemDbEntry> {
  return {
    [TF]: { ...frame(NAME, TF_BP, [TF_NEURO, TF_SYS]), masteryReq },
    [TF_BP]: { name: `${NAME} Blueprint`, buildsProduct: TF, tradable: true },
    [TF_NEURO]: {
      ...part(`${NAME} Neuroptics`),
      recipe: {
        buildPrice: 15_000,
        buildTime: 43_200,
        num: 1,
        blueprintUniqueName: TF_NEURO.replace("Component", "Blueprint"),
        ingredients: [{ uniqueName: ARGON, count: 2 }],
      },
    },
    [TF_SYS]: part(`${NAME} Systems`),
    [ARGON]: { name: "Argon Crystal", category: "Resource" },
    [OROKIN_CELL]: { name: "Orokin Cell", category: "Resource" },
  };
}

type Reward = [name: string, uniqueName: string, rarity: string, chance: number];

const BLUEPRINT: Reward = [`${NAME} Blueprint`, TF_BP, "uncommon", 11];
const NEURO: Reward = [
  `${NAME} Neuroptics Blueprint`,
  TF_NEURO.replace("Component", "Blueprint"),
  "rare",
  2,
];
const SYSTEMS: Reward = [
  `${NAME} Systems Blueprint`,
  TF_SYS.replace("Component", "Blueprint"),
  "common",
  25.33,
];

function projection(name: string): string {
  return `/Lotus/Types/Game/Projections/${name.replace(/\s+/g, "")}Bronze`;
}

function group(
  name: string,
  dropping: RelicDropping | null,
  rewards: Reward[],
  extra: Partial<RelicGroup> = {},
): RelicGroup {
  const [tier, code] = name.split(" ");
  return {
    key: name,
    name,
    tier,
    code,
    vaulted: dropping === "none",
    dropping,
    caches: [],
    imageUrl: null,
    qualities: {
      intact: {
        uniqueName: projection(name),
        rewards: rewards.map(([reward, uniqueName, rarity, chance]) => ({
          name: reward,
          uniqueName,
          rarity,
          chance,
          urlName: null,
          ducats: 45,
        })),
      },
    },
    ...extra,
  };
}

function relicDb(...groups: RelicGroup[]): RelicDatabase {
  return {
    groups: Object.fromEntries(groups.map((entry) => [entry.key, entry])),
    byUniqueName: Object.fromEntries(
      groups.map((entry) => [projection(entry.name), { groupKey: entry.key, quality: "intact" }]),
    ),
  };
}

const OPEN = relicDb(group("Lith T1", "missions", [BLUEPRINT, NEURO, SYSTEMS]));

/** Neuroptics only in a vaulted relic; the rest still drop. */
const PARTLY_VAULTED = relicDb(
  group("Lith T1", "missions", [BLUEPRINT, SYSTEMS]),
  group("Neo T1", "none", [NEURO]),
);

function trader(relics: string[], extra: Partial<VaultTrader> = {}): VaultTrader {
  return {
    activation: new Date(NOW - DAY).toISOString(),
    expiry: new Date(NOW + 3 * DAY).toISOString(),
    inventory: relics.map((name) => ({
      uniqueName: projection(name),
      item: `${name} Relic`,
      aya: 1,
    })),
    ...extra,
  };
}

function targetFor(
  db: Record<string, ItemDbEntry>,
  relics: RelicDatabase | null,
): AcquisitionTarget {
  const [target] = resolveAcquisition({
    itemDb: db,
    inventory: null,
    relicDb: relics,
    only: [NAME],
  });
  if (!target) throw new Error("no target");
  return target;
}

function generate(
  relics: RelicDatabase,
  world: WorldState | null = null,
  options: { masteryReq?: number; override?: PrimeOverride } = {},
) {
  const db = itemDb(options.masteryReq);
  return generatePrimePlan(targetFor(db, relics), {
    itemDb: db,
    relicDb: relics,
    world,
    now: NOW,
    overrides: (name) => (options.override && name === NAME ? options.override : null),
  });
}

function types(plan: ReturnType<typeof generate>): string[] {
  return (plan?.groups ?? []).map((entry) => `${entry.type} ${entry.place}`);
}

describe("generatePrimePlan", () => {
  it("walks fissures and the foundry for a Prime whose relics all drop", () => {
    const plan = generate(OPEN);
    expect(types(plan)).toEqual(["fissure ANY VOID FISSURE", "foundry FOUNDRY"]);
    expect(plan).toMatchObject({
      name: NAME,
      kind: "warframe-prime",
      source: "relics",
      effort: 5,
      badges: [],
      prices: [],
      routes: [{ name: "Void Fissures", effort: 5, role: "chosen" }],
    });
    const fissure = plan?.groups[0];
    expect(fissure?.activity).toBe("crack the matching relic era");
    expect(fissure?.rows.map((row) => [row.label, row.note])).toEqual([
      [`${NAME} Blueprint`, "Lith T1, Uncommon: 11% Intact"],
      [`${NAME} Neuroptics`, "Lith T1, Rare: 2% Intact"],
      [`${NAME} Systems`, "Lith T1, Common: 25.33% Intact"],
    ]);
    expect(plan?.materials).toEqual([
      { qty: "2", label: "Argon Crystal", note: "Neuroptics" },
      { qty: "1", label: "Orokin Cell", note: null },
      { qty: "40,000", label: "Credits", note: null },
    ]);
    expect(validatePlan(plan)).toEqual([]);
  });

  it("sends a vaulted-only part to the Varzia relics she stocks, Aya first", () => {
    const plan = generate(PARTLY_VAULTED, { vaultTrader: trader(["Neo T1"]) });
    expect(types(plan)).toEqual([
      "currency CAMBION DRIFT, DEIMOS",
      "vendor MAROO'S BAZAAR, MARS",
      "fissure ANY VOID FISSURE",
      "foundry FOUNDRY",
    ]);
    expect(plan?.effort).toBe(8);
    expect(plan?.badges[0]).toEqual({ text: "vaulted", tone: "warn" });
    expect(plan?.routes?.[0]?.name).toBe(`Varzia relics, as ${NAME}`);
    const [aya, varzia, fissure] = plan?.groups ?? [];
    expect(aya?.ref).toBe("Aya");
    expect(aya?.rows[0]).toMatchObject({ label: "Aya", qty: "1" });
    expect(varzia?.live).toBeNull();
    expect(varzia?.rows.map((row) => [row.label, row.note])).toEqual([
      ["Neo T1 relic", "1 Aya, Neuroptics Rare"],
    ]);
    expect(fissure?.conditions).toContain(`${NAME} Neuroptics drops only from vaulted relics.`);
    expect(validatePlan(plan)).toEqual([]);
  });

  it("lists Baro's vaulted relics in a group of his own", () => {
    const plan = generate(PARTLY_VAULTED, {
      vaultTrader: trader([]),
      voidTrader: trader(["Neo T1"], { location: "Larunda Relay (Mercury)" }),
    });
    expect(types(plan)).toEqual([
      "vendor BARO KI'TEER",
      "fissure ANY VOID FISSURE",
      "foundry FOUNDRY",
    ]);
    expect(plan?.groups[0]?.sub).toBe("Larunda Relay (Mercury)");
    expect(plan?.effort).toBe(8);
    expect(validatePlan(plan)).toEqual([]);
  });

  it("waits on a vaulted part neither trader stocks, with no Aya to bank", () => {
    const plan = generate(PARTLY_VAULTED, { vaultTrader: trader(["Axi Z9"]) });
    expect(types(plan)).toEqual([
      "vendor MAROO'S BAZAAR, MARS",
      "fissure ANY VOID FISSURE",
      "foundry FOUNDRY",
    ]);
    const varzia = plan?.groups[0];
    expect(varzia?.live).toEqual({
      state: "waiting",
      text: "not at Varzia or Baro now; wait for her stock to rotate",
    });
    expect(varzia?.rows.map((row) => [row.label, row.note])).toEqual([
      [`${NAME} Neuroptics`, "not at Varzia or Baro now"],
    ]);
    expect(validatePlan(plan)).toEqual([]);
  });

  it("reads Varzia's stock as unknown without a world read, never as empty", () => {
    const plan = generate(PARTLY_VAULTED, null);
    const varzia = plan?.groups.find((entry) => entry.type === "vendor");
    expect(varzia?.live).toEqual({ state: "waiting", text: "Varzia's stock unknown" });
    expect(varzia?.rows.map((row) => row.label)).toEqual(["Neo T1 relic"]);
    const aya = plan?.groups.find((entry) => entry.type === "currency");
    expect(aya?.rows[0]?.qty).toBeNull();

    const db = itemDb();
    const resolved = resolvePlanFor(
      { ...targetFor(db, PARTLY_VAULTED), tier: null },
      { itemDb: db, inventory: null, relicDb: PARTLY_VAULTED, world: null, now: NOW },
    );
    const live = resolved?.groups.find((entry) => entry.type === "vendor")?.live;
    expect(live).toEqual({ state: "waiting", text: "Varzia's stock unknown", resolved: false });
  });

  it("rates a fully vaulted Prime 8 and leads with the vaulted badge", () => {
    const db = relicDb(group("Neo T1", "none", [BLUEPRINT, NEURO, SYSTEMS]));
    const plan = generate(db, { vaultTrader: trader(["Neo T1"]) });
    expect(plan?.effort).toBe(8);
    expect(plan?.badges).toEqual([{ text: "vaulted", tone: "warn" }]);
    expect(plan?.groups.find((entry) => entry.type === "fissure")?.activity).toBe(
      "crack the relics from the steps above",
    );
  });

  it("farms a cache-only relic from Railjack and keeps effort 5", () => {
    const db = relicDb(
      group("Lith T1", "missions", [BLUEPRINT, NEURO]),
      group("Axi T2", "caches", [SYSTEMS], {
        caches: [
          { region: "Veil Proxima", chance: 4.35 },
          { region: "Pluto Proxima", chance: 9.68 },
        ],
      }),
    );
    const plan = generate(db, {});
    expect(types(plan)).toEqual([
      "farm RAILJACK DERELICT CACHES",
      "fissure ANY VOID FISSURE",
      "foundry FOUNDRY",
    ]);
    expect(plan?.effort).toBe(5);
    expect(plan?.badges[0]).toEqual({ text: "relics from Railjack caches", tone: "warn" });
    expect(plan?.groups[0]?.rows).toMatchObject([
      { label: "Axi T2 relic", note: "Systems Common; Pluto Proxima 9.68%, Veil Proxima 4.35%" },
    ]);
    expect(validatePlan(plan)).toEqual([]);
  });

  it("falls back to the bundled vault flag until the drop tables load", () => {
    const db = relicDb(
      group("Lith T1", null, [BLUEPRINT, SYSTEMS], { vaulted: false }),
      group("Neo T1", null, [NEURO], { vaulted: true }),
    );
    const plan = generate(db, { vaultTrader: trader(["Neo T1"]) });
    expect(plan?.effort).toBe(8);
    expect(plan?.badges[0]).toEqual({ text: "vaulted", tone: "warn" });
    expect(plan?.groups.find((entry) => entry.type === "fissure")?.conditions).toContain(
      "Vault status is from bundled data until the drop tables load.",
    );
  });

  it("reads a relic with no vault state anywhere as unknown, never guessed", () => {
    const unflagged = group("Neo T1", null, [NEURO]);
    delete unflagged.vaulted;
    const db = relicDb(group("Lith T1", "missions", [BLUEPRINT, SYSTEMS]), unflagged);
    const plan = generate(db, {});
    expect(plan?.badges[0]).toEqual({ text: "vault status unknown", tone: "info" });
    expect(plan?.effort).toBe(5);
  });

  it("keeps a part no relic drops as its own row", () => {
    const db = relicDb(group("Lith T1", "missions", [BLUEPRINT, NEURO]));
    const plan = generate(db, {});
    const rows = plan?.groups.find((entry) => entry.type === "fissure")?.rows ?? [];
    expect(rows.map((row) => [row.label, row.note])).toContainEqual([
      `${NAME} Systems`,
      "no known relic drops it",
    ]);
    expect(plan?.badges[0]).toEqual({ text: "vault status unknown", tone: "info" });
  });

  it("gates a Mastery Rank above 2 and leaves a lower one in the foundry line", () => {
    const gated = generate(OPEN, {}, { masteryReq: 14 });
    expect(types(gated)[0]).toBe("gate MASTERY RANK");
    expect(gated?.groups[0]?.rows[0]?.label).toBe("Mastery Rank 14");
    expect(gated?.badges).toEqual([{ text: "MR 14", tone: "info" }]);

    const low = generate(OPEN, {}, { masteryReq: 2 });
    expect(types(low)).toEqual(["fissure ANY VOID FISSURE", "foundry FOUNDRY"]);
    expect(low?.groups[1]?.meta).toBe("12h, then 72h, MR 2");
  });

  it("merges an override's gates, badges and stated effort", () => {
    const override: PrimeOverride = {
      name: NAME,
      badges: [{ text: "comes with Testkavat Prime", tone: "info" }],
      gates: [{ label: "The Archwing", note: "Railjack needs it" }],
      effort: { value: 6, reason: "the Rare drops at 2%" },
    };
    const world = { vaultTrader: trader(["Neo T1"]) };
    const plan = generate(PARTLY_VAULTED, world, { masteryReq: 8, override });
    expect(types(plan)[0]).toBe("gate QUESTS");
    expect(plan?.groups[0]?.rows.map((row) => row.label)).toEqual([
      "The Archwing",
      "Mastery Rank 8",
    ]);
    expect(plan?.badges).toEqual([
      { text: "vaulted", tone: "warn" },
      { text: "comes with Testkavat Prime", tone: "info" },
    ]);
    expect(plan?.effort).toBe(6);
    expect(plan?.routes?.[0]?.effort).toBe(6);
    expect(validatePlan(plan)).toEqual([]);
  });

  it("plans nothing without a relic database, for a non-Prime, or with no part in a relic", () => {
    const db = itemDb();
    const target = targetFor(db, OPEN);
    expect(generatePrimePlan(target, { itemDb: db, relicDb: null })).toBeNull();
    expect(
      generatePrimePlan({ ...target, isPrime: false }, { itemDb: db, relicDb: OPEN }),
    ).toBeNull();
    const other = relicDb(group("Lith Q1", "missions", [["Other Part", "/Other", "common", 25]]));
    expect(generatePrimePlan(target, { itemDb: db, relicDb: other })).toBeNull();
  });

  it("never makes platinum a step", () => {
    const plan = generate(PARTLY_VAULTED, { vaultTrader: trader(["Neo T1"]) });
    expect(JSON.stringify(plan)).not.toMatch(/platinum|\bplat\b/i);
  });
});

describe("resolving a generated plan", () => {
  it("matches Varzia's shelf by the relics the group names", () => {
    const db = itemDb();
    const world = { vaultTrader: trader(["Neo T1"]) };
    const resolved = resolvePlanFor(
      { ...targetFor(db, PARTLY_VAULTED), tier: null },
      { itemDb: db, inventory: null, relicDb: PARTLY_VAULTED, world, now: NOW },
    );
    const varzia = resolved?.groups.find((entry) => entry.type === "vendor");
    expect(varzia?.facts).toContainEqual({
      kind: "varzia",
      text: "1 of 1 relic in stock now, rotates in 3d",
      resolved: true,
    });
  });

  it("merges tips into the generated steps and keeps one whose step went away", () => {
    const db = itemDb();
    const tip = (id: string, group: "vendor" | "fissure") => ({
      id,
      text: id,
      kind: "tactic" as const,
      consensus: "common" as const,
      anchor: { group, ...(group === "vendor" ? { place: "MAROO'S BAZAAR" } : {}) },
      dispute: null,
    });
    const tips = () => [tip("varzia", "vendor"), tip("crack", "fissure")];
    const resolve = (relics: RelicDatabase) =>
      resolvePlanFor(
        { ...targetFor(db, relics), tier: null },
        { itemDb: db, inventory: null, relicDb: relics, now: NOW, tips },
      );
    const vaulted = resolve(PARTLY_VAULTED);
    expect(vaulted?.groups.find((entry) => entry.type === "vendor")?.tips[0]?.id).toBe("varzia");
    expect(vaulted?.groups.find((entry) => entry.type === "fissure")?.tips[0]?.id).toBe("crack");
    const open = resolve(OPEN);
    expect(open?.tips.map((entry) => entry.id)).toEqual(["varzia"]);
  });
});

describe("plan lookup", () => {
  it("lets an authored file beat generation", () => {
    const khora = authoredPlan("Khora Prime");
    expect(khora).not.toBeNull();
    const db = itemDb();
    const target = { ...targetFor(db, OPEN), name: "Khora Prime" };
    expect(planFor(target, { itemDb: db, relicDb: OPEN })).toBe(khora);
  });

  it("rates the card off the generated plan and files it under relics", () => {
    const db = itemDb();
    const open = targetFor(db, OPEN);
    expect(open.rating).toEqual({ planned: true, effort: 5, badge: null });
    expect(includesSource(["relics"], open)).toBe(true);
    expect(includesSource(["unique"], open)).toBe(false);

    const vaulted = targetFor(itemDb(), PARTLY_VAULTED);
    expect(vaulted.rating).toEqual({
      planned: true,
      effort: 8,
      badge: { text: "vaulted", tone: "warn" },
    });

    expect(targetFor(itemDb(), null).rating).toEqual({
      planned: false,
      effort: null,
      badge: null,
    });
  });

  it("leaves the plat display as it was: set, missing parts, the lesser one sorts", () => {
    const prices: Record<string, number> = {
      [`${NAME} Set`]: 120,
      [`${NAME} Blueprint`]: 20,
      [`${NAME} Neuroptics`]: 50,
      [`${NAME} Systems`]: 30,
    };
    const plat = (name: string): number | null => prices[name] ?? null;
    const run = (relics: RelicDatabase | null): AcquisitionTarget => {
      const [target] = resolveAcquisition({
        itemDb: itemDb(),
        inventory: null,
        relicDb: relics,
        plat,
        only: [NAME],
      });
      if (!target) throw new Error("no target");
      return target;
    };
    const generated = run(PARTLY_VAULTED);
    const trade = generated.paths.find((path) => path.kind === "trade");
    expect(trade?.cost.plat).toEqual({
      set: 120,
      setSlug: "testframe_prime_set",
      parts: [
        { name: `${NAME} Blueprint`, plat: 20, slug: "testframe_prime_blueprint" },
        { name: `${NAME} Neuroptics`, plat: 50, slug: "testframe_prime_neuroptics" },
        { name: `${NAME} Systems`, plat: 30, slug: "testframe_prime_systems" },
      ],
      partsTotal: 100,
    });
    expect(platFor(generated)).toBe(100);
    expect(run(null).paths.find((path) => path.kind === "trade")?.cost.plat).toEqual(
      trade?.cost.plat,
    );
  });
});

describe("prime overrides", () => {
  it("accepts every shipped override", () => {
    for (const override of primeOverrides()) {
      expect([override.name, validatePrimeOverride(override)]).toEqual([override.name, []]);
    }
  });

  it("takes gates, badges and an effort with its reason", () => {
    expect(
      validatePrimeOverride({
        name: NAME,
        badges: [{ text: "comes with Testkavat Prime", tone: "info" }],
        gates: [{ label: "The Archwing", note: null }],
        effort: { value: 6, reason: "the Rare drops at 2%" },
      }),
    ).toEqual([]);
  });

  it("rejects an effort with no reason, a tip, and a name the generator does not plan", () => {
    expect(
      validatePrimeOverride(
        { name: "Rhino", effort: { value: 6 }, bonuses: { fissure: ["radshare"] } },
        (name) => name === NAME,
      ),
    ).toEqual([
      "bonuses is not an override field",
      'name "Rhino" is not a generated Prime',
      "effort.reason must be a non-empty string",
    ]);
    expect(validatePrimeOverride({ name: NAME, effort: 6 })).toEqual([
      "effort must be an object with a value and a reason",
    ]);
  });
});
