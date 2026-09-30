import { describe, expect, it } from "vitest";

import { dropSourceDetail, dropSourceHeader, dropSourcesFor } from "../../../../src/lib/dropSources.js";
import {
  codexEnemyLookup,
  liveEnemySpawn,
  withEnemySpawns,
} from "../../../../src/lib/enemySpawns.js";
import type { EnemyInfo } from "../../../../src/lib/enemies/enemyInfo.js";
import {
  bestUpgradeLine,
  upgradeSources,
  upgradeVendorCost,
  upgradeVendorDetail,
  upgradeVendorHeader,
  upgradeVendorRank,
  type UpgradeCard,
} from "../../../../src/lib/suggest/upgrades.js";
import { en } from "../../../../src/i18n/en.js";
import type { Translator } from "../../../../src/lib/i18n.js";
import type { DropInfo, UpgradeVendorSource } from "../../../../src/types/inventory.js";
import type { WorldState } from "../../../../src/types/world.js";

const t: Translator = (key, params = {}) =>
  en[key].replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ""));

const CAVIA: UpgradeVendorSource = {
  name: "Cavia",
  cost: { amount: 5000, unit: "standing" },
  rank: { level: 4, title: "Scholar" },
  keeper: "Bird 3",
  hub: { region: "Deimos", place: "Sanctum Anatomica" },
  covers: ["Cavia (Bird 3), Scholar"],
};

function card(drops: DropInfo[], vendors: UpgradeVendorSource[]): UpgradeCard {
  return { name: "Melee Influence", drops, vendors } as unknown as UpgradeCard;
}

const sources = (c: UpgradeCard) => withEnemySpawns(dropSourcesFor(c.drops), null);

describe("standing purchases on the card and the tile", () => {
  it("reads the standing, the rank and where to buy it", () => {
    expect(upgradeVendorCost(CAVIA, t)).toBe("5k standing");
    expect(upgradeVendorHeader(CAVIA, t)).toBe("Deimos · Sanctum Anatomica");
    expect(upgradeVendorDetail(CAVIA, t)).toEqual(["Cavia", "Bird 3", "Rank 4: Scholar"]);
  });

  it("quiets a shouted title and reads a bare rank", () => {
    const shouted = { ...CAVIA, rank: { level: 3, title: "CLEARANCE: ODIMA" } };
    expect(upgradeVendorRank(shouted, t)).toBe("Rank 3: Clearance: Odima");
    expect(upgradeVendorRank({ ...CAVIA, rank: { level: 2, title: null } }, t)).toBe("Rank 2");
  });
});

describe("the card's one source", () => {
  const whisper: DropInfo = { location: "Mocking Whisper", chance: 0.5, rarity: "Rare" };
  const row: DropInfo = { location: "Cavia (Bird 3), Scholar", chance: 100, rarity: "Common" };

  it("takes a priced purchase over a sub-1% mob drop, and hides the rank row it covers", () => {
    const c = card([whisper, row], [CAVIA]);
    const all = upgradeSources(c, sources(c));
    expect(all.map((source) => source.kind)).toEqual(["vendor", "drop"]);
    expect(bestUpgradeLine(c, sources(c), t)).toMatchObject({
      text: "Cavia",
      amount: "5k standing",
    });
  });

  it("takes a drop surer than one in ten over a priced purchase", () => {
    const bounty: DropInfo = { location: "Earth/Cetus (Level 5 - 15 Cetus Bounty), Rotation B", chance: 20 };
    const c = card([bounty], [CAVIA]);
    expect(upgradeSources(c, sources(c))[0].kind).toBe("drop");
  });

  it("puts a shop with no known price after a placed 5% drop", () => {
    const eidolon: DropInfo = { location: "Eidolon Hydrolyst (Capture)", chance: 5 };
    const c = card([eidolon], [{ name: "Cavia" }]);
    const [first, second] = upgradeSources(c, sources(c));
    expect(first.kind).toBe("drop");
    expect(second.kind).toBe("vendor");
  });
});

describe("enemy drops", () => {
  const night: WorldState = { cetusCycle: { isDay: false, expiry: "2099-01-01T00:00:00Z" } } as WorldState;

  it("places an Eidolon on the Plains at night, with the cycle pill when it is night", () => {
    const [source] = withEnemySpawns(
      dropSourcesFor([{ location: "Eidolon Teralyst (Capture)", chance: 10 }]),
      null,
    );
    expect(dropSourceHeader(source, t)).toBe("Earth · Plains of Eidolon");
    expect(dropSourceDetail(source, t)).toEqual(["Eidolon Teralyst", "Capture", "Night"]);
    expect(liveEnemySpawn(source, night)).toEqual({ expiry: "2099-01-01T00:00:00Z", phase: "night" });
    expect(liveEnemySpawn(source, { cetusCycle: { isDay: true } } as WorldState)).toBeNull();
  });

  it("reads a codex enemy's planet and tileset, other planets behind the disclosure", () => {
    const info = {
      name: "Drekar Butcher",
      planets: ["Earth", "Uranus"],
      tileSets: ["Grineer Sealab"],
      missions: ["Exterminate"],
    } as EnemyInfo;
    const lookup = codexEnemyLookup({
      findEnemyByName: (name) => (name === "Drekar Butcher" ? info : null),
      findEnemiesByName: () => [],
      factionSpawnPlanets: () => [],
      tileSetSpawnPlanets: () => [],
    });
    const [source] = withEnemySpawns(dropSourcesFor([{ location: "Drekar Butcher", chance: 1 }]), lookup);
    expect(dropSourceHeader(source, t)).toBe("Earth · Grineer Sealab");
    expect(dropSourceDetail(source, t)).toEqual(["Drekar Butcher", "Exterminate"]);
    expect(source.spawn?.more).toEqual(["Uranus"]);
  });

  it("leaves an enemy nothing places as it was", () => {
    const [source] = withEnemySpawns(dropSourcesFor([{ location: "Jarka Lar", chance: 1 }]), null);
    expect(source.spawn).toBeUndefined();
    expect(dropSourceHeader(source, t)).toBe("Jarka Lar");
  });
});
