import { describe, expect, it } from "vitest";

import { resolveAcquisition } from "../../../../../src/lib/suggest/acquisition/index.js";
import { itemDb, weaponDb, weaponRelicDb } from "./fixtures.js";
import type {
  AcquisitionContext,
  AcquisitionTarget,
} from "../../../../../src/lib/suggest/acquisition/types.js";

const CURATED = {
  Nikana: {
    difficulty: "easy",
    sources: [{ kind: "market", parts: "both", where: "Market (25,000 Credits)" }],
  },
  Akbolto: {
    sources: [{ kind: "lab", parts: "both", where: "Chem Lab research, Clan Dojo" }],
  },
  Corvas: {
    sources: [
      { kind: "vendor", parts: "both", where: "Quill Onkko, Cetus - Quills Standing (Rank 2)" },
    ],
  },
  Sweeper: {
    sources: [{ kind: "vendor", parts: "both", where: "Steel Meridian - Syndicate offering" }],
  },
};

function target(name: string, overrides: Partial<AcquisitionContext> = {}): AcquisitionTarget {
  const match = resolveAcquisition({
    itemDb: weaponDb(),
    inventory: null,
    curatedWeapons: CURATED,
    ...overrides,
    only: [name],
  })[0];
  if (!match) throw new Error(`no target for ${name}`);
  return match;
}

describe("weapon sources", () => {
  it("turns clan dojo research into a lab path that finishes the weapon", () => {
    const lab = target("Akbolto").paths.find((path) => path.kind === "lab");
    expect(lab?.complete).toBe(true);
    expect(lab?.steps[0].where).toBe("Chem Lab research, Clan Dojo");
  });

  it("turns a standing offering and a syndicate offering alike into a vendor path", () => {
    expect(target("Corvas").paths.find((path) => path.kind === "vendor")?.steps[0].where).toContain(
      "Quills Standing",
    );
    expect(
      target("Sweeper").paths.find((path) => path.kind === "vendor")?.steps[0].where,
    ).toContain("Steel Meridian");
  });

  it("reads the credit price out of a curated weapon market line", () => {
    expect(target("Nikana").paths.find((path) => path.kind === "market")?.cost.credits).toBe(
      25_000,
    );
  });

  it("carries the curated weapon difficulty word", () => {
    expect(target("Nikana").difficulty).toBe("easy");
    expect(target("Akbolto").difficulty).toBeNull();
  });

  it("does not sink a weapon nothing has rated", () => {
    const unrated = target("Akbolto").effort;
    const normal = target("Akbolto", {
      ratings: { Akbolto: { difficulty: "normal" } },
    }).effort;
    const harder = target("Akbolto", { ratings: { Akbolto: { difficulty: "hard" } } }).effort;
    expect(unrated).toBe(normal);
    expect(harder).toBeGreaterThan(unrated);
  });

  it("leaves a weapon with no source and no relics pathless rather than hidden", () => {
    const braton = target("Braton", { curatedWeapons: undefined });
    expect(braton.needs).toContain("mastery");
    expect(braton.paths.every((path) => path.kind === "circuit")).toBe(true);
  });

  it("prices the set and the missing parts when the market can", () => {
    const prices: Record<string, number> = { "Braton Prime Set": 90, "Braton Prime Barrel": 20 };
    const trade = target("Braton Prime", { plat: (name) => prices[name] ?? null }).paths.find(
      (path) => path.kind === "trade",
    );
    expect(trade?.cost.plat?.set).toBe(90);
    expect(trade?.cost.plat?.partsTotal).toBeNull();
  });

  it("ranks frames and weapons against each other in one list", () => {
    const targets = resolveAcquisition({
      itemDb: { ...itemDb(), ...weaponDb() },
      inventory: null,
      relicDb: weaponRelicDb(),
      curatedWeapons: CURATED,
    });
    const names = targets.map((row) => row.name);
    expect(names).toContain("Mag");
    expect(names).toContain("Nikana");
    expect(names.indexOf("Nikana")).toBeLessThan(names.indexOf("Mag"));
    expect(targets.map((row) => row.effort)).toEqual(
      [...targets.map((row) => row.effort)].sort((a, b) => a - b),
    );
    expect(new Set(targets.map((row) => row.kind))).toEqual(
      new Set(["warframe", "archwing", "weapon"]),
    );
  });
});
