import { describe, expect, it } from "vitest";

import {
  collectUpgradeVendorSources,
  foldSyndicateRows,
  type PepVendorExports,
} from "../../services/upgradeVendorSources";

const MELEE_INFLUENCE = "/Lotus/Upgrades/CosmeticEnhancers/Offensive/MeleeInfluence";
const EXODIA = "/Lotus/Upgrades/CosmeticEnhancers/Zaw/ExodiaContagion";
const PRESSURE = "/Lotus/Upgrades/Mods/Melee/PressurePoint";
const store = (uniqueName: string) => uniqueName.replace(/^\/Lotus\//, "/Lotus/StoreItems/");

const NAMES: Record<string, string> = {
  CaviaName: "Cavia",
  CaviaTitle4: "Scholar",
  EventName: "Operational Supply",
  EventTitle2: "Defender",
  NecraloidName: "Necraloid",
  NecraloidTitle3: "CLEARANCE: ODIMA",
};
const resolve = (key: string) => NAMES[key] ?? null;

const pep: PepVendorExports = {
  ExportSyndicates: {
    EntratiLabSyndicate: {
      name: "CaviaName",
      titles: [{ level: 4, name: "CaviaTitle4" }],
      favours: [{ storeItem: store(MELEE_INFLUENCE), standingCost: 5000, requiredLevel: 4 }],
    },
    EventSyndicate: {
      name: "EventName",
      titles: [{ level: 2, name: "EventTitle2" }],
      favours: [
        { storeItem: store(EXODIA), standingCost: 5000, creditsCost: 1500, requiredLevel: 2 },
      ],
    },
    NecraloidSyndicate: { name: "NecraloidName", titles: [{ level: 3, name: "NecraloidTitle3" }] },
  },
};

const collect = () => collectUpgradeVendorSources(pep, resolve, () => true);

describe("standing purchases", () => {
  it("carries the standing, the rank it needs and the hub it is bought in", () => {
    expect(collect().get(MELEE_INFLUENCE)).toEqual([
      {
        name: "Cavia",
        nameKey: "CaviaName",
        syndicate: "EntratiLabSyndicate",
        hub: { region: "Deimos", place: "Sanctum Anatomica" },
        cost: { amount: 5000, unit: "standing" },
        rank: { level: 4, title: "Scholar", titleKey: "CaviaTitle4" },
      },
    ]);
  });

  it("folds @wfcd's rank row into the priced offer instead of listing it again", () => {
    const location = "Cavia (Bird 3), Scholar";
    const [offer] = foldSyndicateRows(
      MELEE_INFLUENCE,
      [{ location }],
      collect().get(MELEE_INFLUENCE) ?? [],
      pep,
      resolve,
    );
    expect(offer).toMatchObject({ covers: [location], keeper: "Bird 3", cost: { amount: 5000 } });
  });

  it("prices a row off a closed event's shop, with the credits it also takes", () => {
    const [offer] = foldSyndicateRows(EXODIA, [{ location: "Operational Supply, Defender" }], [], pep, resolve);
    expect(offer).toMatchObject({
      name: "Operational Supply",
      cost: { amount: 5000, unit: "standing", credits: 1500 },
      rank: { level: 2, title: "Defender" },
      covers: ["Operational Supply, Defender"],
    });
  });

  it("matches DE's shouted rank title and leaves an unpriced offer without a cost", () => {
    const location = "NecraLoid (Loid), Clearance Odima";
    const [offer] = foldSyndicateRows(PRESSURE, [{ location }], [], pep, resolve);
    expect(offer).toMatchObject({
      name: "Necraloid",
      keeper: "Loid",
      hub: { region: "Deimos", place: "Necralisk" },
      rank: { level: 3, title: "CLEARANCE: ODIMA" },
    });
    expect(offer.cost).toBeUndefined();
  });

  it("leaves a mission reward that reads like a rank row alone", () => {
    const rows = [{ location: "Arbitrations, Rotation C" }, { location: "Cavia, Complete X" }];
    expect(foldSyndicateRows(PRESSURE, rows, [], pep, resolve)).toEqual([]);
  });
});
