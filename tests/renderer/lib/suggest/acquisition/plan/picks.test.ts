import { describe, expect, it } from "vitest";

import { inventory, itemDb, resources, rhinoPlan } from "./fixtures.js";
import {
  authoredPlan,
  resolvePlan,
  validatePlan,
} from "../../../../../../src/lib/suggest/acquisition/plan/index.js";
import { planGroup } from "../../../../../../src/lib/suggest/acquisition/plan/materials.js";
import type {
  AuthoredPlan,
  ResolvedPlan,
  ResolvedRow,
} from "../../../../../../src/lib/suggest/acquisition/plan/index.js";
import type {
  PlanPick,
  PlanRow,
} from "../../../../../../src/lib/suggest/acquisition/plan/schema.js";
import type { ItemDbEntry, RawInventoryData } from "../../../../../../src/types/inventory.js";

const NOW = Date.parse("2026-01-01T00:00:00Z");
const BOARD_BP = "/Lotus/Types/Recipes/Test/BoardBlueprint";
const JET_BP = "/Lotus/Types/Recipes/Test/JetBlueprint";
const VENTKIDS = "Ventkids Standing";
const PICK: PlanPick = {
  rank: { syndicate: "Ventkids", level: 2 },
  spends: [{ currency: VENTKIDS, amount: "10,000" }],
};

function db(): Record<string, ItemDbEntry> {
  return {
    ...itemDb(),
    [BOARD_BP]: { name: "Board Blueprint" },
    [JET_BP]: { name: "Jet Blueprint" },
  };
}

function row(label: string, note: string | null, pick: PlanPick | null = null): PlanRow {
  return { qty: null, label, note, alt: null, done: false, pick };
}

/** The board is the Whozit pick, so the vendor's 5,000 is the jet alone. */
function boardPlan(): AuthoredPlan {
  return {
    name: "Board",
    kind: "kdrive",
    source: "standing",
    effort: 3,
    tradeable: false,
    progress: { have: 0, need: 2, unit: "parts" },
    badges: [],
    prices: [],
    groups: [
      planGroup(
        "vendor",
        "ROKY",
        [
          row("Board Blueprint", null, PICK),
          {
            ...row("Jet Blueprint", null),
            buy: { price: [{ currency: VENTKIDS, amount: "5,000" }] },
          },
        ],
        { spends: [{ currency: VENTKIDS, amount: "5,000" }] },
      ),
      planGroup("currency", "ORB VALLIS", [row("races", "trick chains")], {
        earns: { currency: VENTKIDS, amount: "5,000" },
      }),
    ],
  };
}

function ventkids(title: number, recipes: string[] = []): RawInventoryData {
  return {
    ...inventory(),
    Affiliations: [{ Tag: "VentKidsSyndicate", Standing: 0, Title: title }],
    Recipes: recipes.map((ItemType) => ({ ItemType, ItemCount: 1 })),
  };
}

function resolve(playerInventory: RawInventoryData | null, plan = boardPlan()): ResolvedPlan {
  return resolvePlan(plan, {
    itemDb: db(),
    inventory: playerInventory,
    now: NOW,
    resources: resources(),
  });
}

function board(plan: ResolvedPlan, label = "Board Blueprint"): ResolvedRow {
  const found = plan.groups.flatMap((group) => group.rows).find((entry) => entry.label === label);
  if (!found) throw new Error(`no row ${label}`);
  return found;
}

function owed(plan: ResolvedPlan): number | undefined {
  return plan.ledger.find((entry) => entry.currency === VENTKIDS)?.outstanding;
}

describe("a rank-up pick row", () => {
  it("costs nothing while the rank is still ahead", () => {
    const plan = resolve(ventkids(1));
    expect(board(plan)).toMatchObject({ done: false, pick: { state: "ahead", rank: "Whozit" } });
    expect(board(plan).owes).toBeUndefined();
    expect(owed(plan)).toBe(5_000);
    expect(plan.groups[0].spends[0]).toMatchObject({ amount: "5,000", value: 5_000 });
    expect(plan.groups[1].earns?.amount).toBe("5,000");
  });

  it("is done once the rank is held and the blueprint owned", () => {
    const plan = resolve(ventkids(2, [BOARD_BP]));
    expect(board(plan)).toMatchObject({ done: true, source: "inventory" });
    expect(board(plan).pick).toBeUndefined();
    expect(owed(plan)).toBe(5_000);
  });

  it("owes its price once the rank is held without it", () => {
    const plan = resolve(ventkids(2));
    expect(board(plan)).toMatchObject({
      done: false,
      pick: { state: "spent", rank: "Whozit", spends: [{ amount: "10,000", value: 10_000 }] },
      owes: [{ currency: VENTKIDS, value: 10_000 }],
    });
    expect(owed(plan)).toBe(15_000);
    expect(plan.ledger.find((entry) => entry.currency === VENTKIDS)?.spent).toBe(15_000);
    expect(plan.groups[0].spends[0]).toMatchObject({ amount: "15,000", authoredAmount: "5,000" });
    expect(plan.groups[1].earns?.amount).toBe("15,000");
  });

  it("stays free when the payload carries no standing", () => {
    for (const playerInventory of [inventory(), null]) {
      const plan = resolve(playerInventory);
      expect(board(plan).pick?.state).toBe("unknown");
      expect(board(plan).owes).toBeUndefined();
      expect(owed(plan)).toBe(5_000);
    }
  });

  it("leaves the other rows' shares as authored", () => {
    const plan = resolve(ventkids(2));
    expect(board(plan, "Jet Blueprint").owes).toEqual([{ currency: VENTKIDS, value: 5_000 }]);
    expect(plan.groups[0].owes).toBeUndefined();
  });

  it("prices a shipped board blueprint once its pick is gone", () => {
    const flatbelly = authoredPlan("Flatbelly");
    if (!flatbelly) throw new Error("no Flatbelly plan");
    const ahead = resolvePlan(flatbelly, { itemDb: db(), inventory: ventkids(1), now: NOW });
    const spent = resolvePlan(flatbelly, { itemDb: db(), inventory: ventkids(2), now: NOW });
    expect(board(ahead, "Flatbelly Blueprint").pick?.state).toBe("ahead");
    expect(board(spent, "Flatbelly Blueprint").pick?.state).toBe("spent");
    // Whozit still to rank and the parts, then the parts and the board bought.
    expect(owed(ahead)).toBe(22_000 + 15_000);
    expect(owed(spent)).toBe(15_000 + 10_000);
  });
});

describe("validating a pick", () => {
  function withPick(pick: unknown): AuthoredPlan {
    const plan = rhinoPlan();
    (plan.groups[0].rows[0] as { pick?: unknown }).pick = pick;
    return plan;
  }

  const at = "groups[0].rows[0].pick";

  it("accepts a rank and a priced spend", () => {
    const pick = { rank: PICK.rank, spends: [{ currency: "Simaris Standing", amount: "10,000" }] };
    expect(validatePlan(withPick(pick), resources())).toEqual([]);
    expect(validatePlan(withPick(null), resources())).toEqual([]);
  });

  it("needs a known rank", () => {
    const spends = [{ currency: "Simaris Standing", amount: "10,000" }];
    expect(validatePlan(withPick({ spends }), resources())).toEqual([`${at}.rank is required`]);
    expect(
      validatePlan(withPick({ rank: { syndicate: "Nobody", level: 1 }, spends }), resources()),
    ).toEqual([`${at}.rank.syndicate is not a syndicate in the rank table`]);
    expect(
      validatePlan(withPick({ rank: { syndicate: "Ventkids", level: 9 }, spends }), resources()),
    ).toEqual([`${at}.rank.level must be a whole number 1-5`]);
  });

  it("needs a price the ledger can book", () => {
    expect(validatePlan(withPick({ rank: PICK.rank, spends: [] }), resources())).toEqual([
      `${at}.spends must be a non-empty array`,
    ]);
    expect(
      validatePlan(
        withPick({ rank: PICK.rank, spends: [{ currency: "Simaris Standing", amount: "lots" }] }),
        resources(),
      ),
    ).toEqual([`${at}.spends[0].amount must be a grouped number string`]);
    expect(validatePlan(withPick({ rank: PICK.rank, spends: PICK.spends }), resources())).toEqual([
      `groups[0].rows[0].pick.spends[0].currency "${VENTKIDS}" is not in the resource store`,
    ]);
    expect(validatePlan(withPick("free"), resources())).toEqual([
      `${at} must be an object or null`,
    ]);
  });
});
