import { describe, expect, it } from "vitest";

import { resolveAcquisition } from "../../../../../src/lib/suggest/acquisition/index.js";
import { creditsFromWhere } from "../../../../../src/lib/suggest/acquisition/paths.js";
import { frame, inventory, itemDb, LITH_M1, MAG_BP, part, relicDb } from "./fixtures.js";
import type {
  AcquisitionContext,
  AcquisitionTarget,
} from "../../../../../src/lib/suggest/acquisition/types.js";

function context(overrides: Partial<AcquisitionContext> = {}): AcquisitionContext {
  return { itemDb: itemDb(), inventory: null, ...overrides };
}

function target(name: string, overrides: Partial<AcquisitionContext> = {}): AcquisitionTarget {
  const match = resolveAcquisition(context({ ...overrides, only: [name] }))[0];
  if (!match) throw new Error(`no target for ${name}`);
  return match;
}

describe("acquisition paths", () => {
  it("reads the credit price out of a curated market line", () => {
    expect(creditsFromWhere("Market (35,000 Credits)")).toBe(35_000);
    expect(creditsFromWhere("Market")).toBeNull();
    expect(creditsFromWhere("Ropalolyst, Jupiter")).toBeNull();
  });

  it("turns each curated source into a path with concrete steps", () => {
    const mag = target("Mag");
    const kinds = mag.paths.map((path) => path.kind);
    expect(kinds).toContain("market");
    expect(kinds).toContain("boss");
    expect(kinds).toContain("circuit");
    const boss = mag.paths.find((path) => path.kind === "boss");
    expect(boss?.steps).toEqual([
      {
        kind: "boss",
        where: "The Sergeant, Iliad, Phobos",
        parts: ["Mag Neuroptics", "Mag Chassis", "Mag Systems"],
      },
    ]);
  });

  it("splits what a source covers by the half of the build it pays", () => {
    const mag = target("Mag");
    expect(mag.paths.find((path) => path.kind === "market")?.covers).toEqual(["Mag Blueprint"]);
    expect(mag.paths.find((path) => path.kind === "boss")?.complete).toBe(false);
    expect(mag.paths.find((path) => path.kind === "circuit")?.complete).toBe(true);
  });

  it("drops a source that covers nothing still missing", () => {
    const mag = target("Mag", { inventory: inventory({ recipes: { [MAG_BP]: 1 } }) });
    expect(mag.paths.some((path) => path.kind === "market")).toBe(false);
    expect(mag.paths.some((path) => path.kind === "boss")).toBe(true);
  });

  it("sorts the easiest genuinely available path first", () => {
    const mag = target("Mag");
    expect(mag.paths[0].kind).toBe("market");
    expect(mag.paths.map((path) => path.effort)).toEqual(
      [...mag.paths.map((path) => path.effort)].sort((a, b) => a - b),
    );
    expect(mag.effort).toBe(mag.paths[0].effort);
  });

  it("puts a whole-build lab research ahead of a partial boss farm", () => {
    const volt = target("Volt");
    expect(volt.paths[0].kind).toBe("lab");
    expect(volt.paths[0].complete).toBe(true);
    expect(volt.effort).toBeLessThan(target("Mag Prime").effort);
  });

  it("leaves an unrated frame ranked between an easy and a hard one", () => {
    const unrated = target("Mag Prime").effort;
    const easier = target("Mag Prime", { ratings: { "Mag Prime": { difficulty: "easy" } } }).effort;
    const harder = target("Mag Prime", { ratings: { "Mag Prime": { difficulty: "hard" } } }).effort;
    expect(easier).toBeLessThan(unrated);
    expect(harder).toBeGreaterThan(unrated);
  });

  it("does not sink a path for want of the optional difficulty table", () => {
    const withTable = target("Mag", { ratings: { Mag: { difficulty: "normal" } } });
    const withoutTable = target("Mag", { ratings: undefined });
    expect(withoutTable.effort).toBe(withTable.effort);
  });

  it("rewards relics already in hand", () => {
    const held = target("Mag Prime", {
      relicDb: relicDb(),
      inventory: inventory({ misc: { [LITH_M1]: 9 } }),
    });
    const none = target("Mag Prime", { relicDb: relicDb() });
    const heldEffort = held.paths.find((path) => path.kind === "relics")?.effort ?? 1;
    const noneEffort = none.paths.find((path) => path.kind === "relics")?.effort ?? 0;
    expect(heldEffort).toBeLessThan(noneEffort);
  });

  it("prices the set and every missing part when the market can", () => {
    const prices: Record<string, number> = {
      "Mag Prime Set": 120,
      "Mag Prime Neuroptics": 30,
      "Mag Prime Blueprint": 45,
    };
    const prime = target("Mag Prime", { plat: (name) => prices[name] ?? null });
    const trade = prime.paths.find((path) => path.kind === "trade");
    expect(trade?.cost.plat?.set).toBe(120);
    expect(trade?.cost.plat?.parts).toEqual([
      { name: "Mag Prime Blueprint", plat: 45 },
      { name: "Mag Prime Neuroptics", plat: 30 },
    ]);
    expect(trade?.cost.plat?.partsTotal).toBe(75);
  });

  it("leaves the parts total unset while any part is unpriced", () => {
    const prime = target("Mag Prime", {
      plat: (name) => (name === "Mag Prime Set" ? 120 : null),
    });
    const trade = prime.paths.find((path) => path.kind === "trade");
    expect(trade?.cost.plat?.partsTotal).toBeNull();
    expect(trade?.cost.plat?.set).toBe(120);
  });

  it("offers no trade path when nothing can be priced", () => {
    const prime = target("Mag Prime", { plat: () => null });
    expect(prime.paths.some((path) => path.kind === "trade")).toBe(false);
  });

  it("leaves the market credits unset when the curated line names no price", () => {
    const mag = target("Mag");
    expect(mag.paths.find((path) => path.kind === "market")?.cost.credits).toBeNull();
  });

  it("carries the credit price a curated market line does name", () => {
    const db = {
      ...itemDb(),
      "/Lotus/Powersuits/Ninja/Ash": frame("Ash", "/Lotus/Types/Recipes/Warframes/AshBlueprint", [
        "/Lotus/Types/Recipes/Warframes/AshNeuropticsComponent",
      ]),
      "/Lotus/Types/Recipes/Warframes/AshBlueprint": { name: "Ash Blueprint" },
      "/Lotus/Types/Recipes/Warframes/AshNeuropticsComponent": part("Ash Neuroptics"),
    };
    const ash = resolveAcquisition({ itemDb: db, inventory: null, only: ["Ash"] })[0];
    expect(ash.paths.find((path) => path.kind === "market")?.cost.credits).toBe(35_000);
  });
});
