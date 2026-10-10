import { beforeAll, describe, expect, it, vi } from "vitest";

import type { DropRow } from "../../config/shared/dropTypes";

const INTACT = "/Lotus/Types/Game/Projections/T2VoidProjectionVaultTestPrimeABronze";

vi.mock("../../services/publicExportSource", () => ({
  getOverlay: () => ({
    exports: {
      ExportRelicArcane: {
        [INTACT]: {
          uniqueName: INTACT,
          name: "Meso Z98 Relic",
          relicRewards: [
            {
              rewardName: "/Lotus/StoreItems/Types/Recipes/Weapons/KompressaPrimeBlueprint",
              rarity: "RARE",
              tier: 0,
              itemCount: 1,
            },
          ],
        },
      },
    },
    images: null,
  }),
}));

import * as dropData from "../../services/dropData";
import * as itemDatabase from "../../services/itemDatabase";
import { getRelicDatabase } from "../../services/relicService";

function row(place: string, chance: number): DropRow {
  return { item: "Meso Z98 Relic", place, rarity: "Rare", chance, kind: "mission" };
}

describe("relic vault state from the drop tables", () => {
  beforeAll(() => {
    itemDatabase.buildDatabase();
  });

  it("keeps the bundled flag until the tables load, then restamps on every change", () => {
    const before = getRelicDatabase().groups["Meso Z98"];
    expect(before).toMatchObject({ dropping: null, vaulted: false });

    dropData.setRowsForTest([
      row("Khufu Envoy (Caches) (Pluto), Rotation B", 9.68),
      row("Seven Sirens (Caches) (Pluto), Rotation B", 4.35),
      row("Flexa (Caches) (Veil Proxima), Rotation A", 4.35),
    ]);
    expect(getRelicDatabase().groups["Meso Z98"]).toMatchObject({
      dropping: "caches",
      vaulted: false,
      caches: [
        { region: "Pluto Proxima", chance: 9.68 },
        { region: "Veil Proxima", chance: 4.35 },
      ],
    });

    dropData.setRowsForTest([row("Hepit (Void), Rotation A", 14.29)]);
    expect(getRelicDatabase().groups["Meso Z98"]).toMatchObject({
      dropping: "missions",
      vaulted: false,
    });

    dropData.setRowsForTest([]);
    expect(getRelicDatabase().groups["Meso Z98"]).toMatchObject({
      dropping: "none",
      vaulted: true,
    });
  });
});
