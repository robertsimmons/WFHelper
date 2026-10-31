// Every item a plan or shop names reads through the one label reader against the
// real item database, so a spelling the game does not use fails here instead of
// silently reading nothing in the app.
import { beforeAll, describe, expect, it } from "vitest";

import * as itemDatabase from "../../../../../../services/itemDatabase";
import { resolveAcquisition } from "../../../../../../src/lib/suggest/acquisition/index.js";
import { authoredPlans } from "../../../../../../src/lib/suggest/acquisition/plan/data.js";
import { resourceEntry } from "../../../../../../src/lib/suggest/acquisition/plan/resources.js";
import {
  itemsForLabel,
  questDoneForLabel,
  readLabel,
  readPlayerState,
  type PlayerState,
} from "../../../../../../src/lib/suggest/acquisition/plan/state.js";
import { authoredShops } from "../../../../../../src/lib/suggest/acquisition/shops/data.js";
import { COSMETIC } from "../../../../../../src/lib/suggest/acquisition/shops/schema.js";
import type { AuthoredPlan } from "../../../../../../src/lib/suggest/acquisition/plan/schema.js";
import type { ItemDbEntry, RawInventoryData } from "../../../../../../src/types/inventory.js";

/** Each Nightwave season pays its own Cred item, and the bundled export lags the live one. */
const SEASONAL = new Set(["Nightwave Creds"]);

let state: PlayerState;
let modular: Set<string>;

beforeAll(() => {
  itemDatabase.buildDatabase();
  const itemDb = itemDatabase.getRendererLookup() as unknown as Record<string, ItemDbEntry>;
  const sweep = resolveAcquisition({ itemDb, inventory: null, kinds: ["modular"] });
  modular = new Set(sweep.map((target) => target.name));
  state = readPlayerState(
    { Affiliations: [], RegularCredits: 0 } as unknown as RawInventoryData,
    itemDb,
  );
});

/** Gear newer than the bundled export has nothing to read yet; a modular type is
 *  no item of its own but the sweep still plans it. */
const inDatabase = (item: string): boolean =>
  itemsForLabel(state, item, item) !== null || modular.has(item);

const reads = (label: string, item: string): boolean =>
  SEASONAL.has(label) ||
  questDoneForLabel(state, label) !== null ||
  readLabel(state, label, item, resourceEntry) !== null;

function planNames(plan: AuthoredPlan): string[] {
  const groups = [...plan.groups, ...(plan.afterQuest?.groups ?? [])];
  const rows = groups
    .flatMap((group) => group.rows)
    .filter((row) => !row.task && !row.rank)
    .map((row) => row.label);
  return [...(plan.materials ?? []).map((material) => material.label), ...rows];
}

describe("every item a plan names is in the item database", () => {
  it("reads every material, row and shop ware", () => {
    const offenders = [
      ...authoredPlans()
        .filter((plan) => inDatabase(plan.name))
        .flatMap((plan) =>
          planNames(plan)
            .filter((label) => !reads(label, plan.name))
            .map((label) => `${plan.name}: ${label}`),
        ),
      ...[...authoredShops()].flatMap(([key, shop]) =>
        shop.wares
          .filter((ware) => ware.item !== COSMETIC && inDatabase(ware.item))
          .filter((ware) => !reads(ware.name, ware.item))
          .map((ware) => `shop ${key}: ${ware.name}`),
      ),
    ];
    expect(offenders).toEqual([]);
  });
});
