import { describe, expect, it } from "vitest";

import { resolveAcquisition } from "../../../../../src/lib/suggest/acquisition/index.js";
import { inventory, KUVA_BRAMMA, weaponDb } from "./fixtures.js";
import type {
  AcquisitionContext,
  AcquisitionTarget,
} from "../../../../../src/lib/suggest/acquisition/types.js";

function target(name: string, overrides: Partial<AcquisitionContext> = {}): AcquisitionTarget {
  const match = resolveAcquisition({
    itemDb: weaponDb(),
    inventory: null,
    ...overrides,
    only: [name],
  })[0];
  if (!match) throw new Error(`no target for ${name}`);
  return match;
}

function steps(item: AcquisitionTarget): string[] {
  return item.paths.find((path) => path.kind === "nemesis")?.steps.map((step) => step.where) ?? [];
}

describe("nemesis weapons", () => {
  it("reads a Kuva weapon as a Lich hunt", () => {
    const bramma = target("Kuva Bramma");
    expect(bramma.nemesis).toEqual({
      family: "kuva",
      requires: ["The War Within"],
      spawn: expect.stringContaining("Kuva Larvling"),
      elements: expect.arrayContaining(["Heat", "Radiation"]),
      progenitors: expect.any(Array),
      bonus: { min: 25, max: 60 },
      valenceFusion: true,
    });
  });

  it("walks the run from the larvling to the parazon", () => {
    const lines = steps(target("Kuva Bramma"));
    expect(lines[0]).toBe("Requires The War Within");
    expect(lines[1]).toContain("level 20+ Grineer node");
    expect(lines.join(" | ")).toContain("progenitor Warframe for the element you want");
    expect(lines.join(" | ")).toContain("25-60% roll");
    expect(lines.join(" | ")).toContain("Murmur");
    expect(lines.join(" | ")).toContain("Requiem");
    expect(lines[lines.length - 1]).toContain("valence fusion");
  });

  it("offers the whole weapon on a path the item DB has no recipe for", () => {
    const bramma = target("Kuva Bramma");
    expect(bramma.parts.known).toBe(false);
    const path = bramma.paths.find((row) => row.kind === "nemesis");
    expect(path?.complete).toBe(true);
    expect(path?.covers).toEqual(["Kuva Bramma"]);
  });

  it("stops asking once the weapon is in hand", () => {
    const names = resolveAcquisition({
      itemDb: weaponDb(),
      inventory: inventory({ longGuns: [KUVA_BRAMMA] }),
    }).map((row) => row.name);
    expect(names).not.toContain("Kuva Bramma");
  });

  it("names the Coda's own quest gate", () => {
    const coda = target("Coda Motovore");
    expect(coda.nemesis?.family).toBe("coda");
    expect(coda.nemesis?.requires).toEqual(["The Hex"]);
  });

  it("leaves out the step nothing has told it, rather than guessing", () => {
    const coda = target("Coda Motovore");
    expect(coda.nemesis?.spawn).toBeNull();
    expect(coda.nemesis?.bonus).toBeNull();
    expect(coda.nemesis?.elements).toEqual([]);
    const lines = steps(coda);
    expect(lines.some((line) => line.includes("node"))).toBe(false);
    expect(lines.join(" | ")).toContain("the bonus itself is a roll");
  });

  it("buys the Coda weapon off Eleanor rather than sending the player progenitor hunting", () => {
    const lines = steps(target("Coda Motovore")).join(" | ");
    expect(lines).toContain("Eleanor");
    expect(lines).toContain("Live Heartcells");
    expect(lines).not.toContain("progenitor");
  });

  it("walks the Coda grind on its own meter and mods", () => {
    const lines = steps(target("Coda Motovore")).join(" | ");
    expect(lines).toContain("Malware Disinfection");
    expect(lines).toContain("Antivirus");
    expect(lines).not.toContain("Murmur");
    expect(lines).not.toContain("Requiem");
  });

  it("names the progenitor Warframes for a Kuva weapon and none for a Coda one", () => {
    const heat = target("Kuva Bramma").nemesis?.progenitors.find((row) => row.element === "Heat");
    expect(heat?.warframes).toContain("Chroma");
    expect(target("Coda Motovore").nemesis?.progenitors).toEqual([]);
  });

  it("takes the spawn and the roll from curated data when it has them", () => {
    const coda = target("Coda Motovore", {
      curatedWeapons: {
        "Coda Motovore": {
          difficulty: "hard",
          nemesis: {
            family: "coda",
            spawn: "Kill an Infested Candidate in Höllvania",
            elements: ["Heat", "Toxin"],
            bonus: { min: 25, max: 60 },
          },
        },
      },
    });
    expect(coda.nemesis?.spawn).toBe("Kill an Infested Candidate in Höllvania");
    expect(coda.difficulty).toBe("hard");
    expect(steps(coda)[1]).toBe("Kill an Infested Candidate in Höllvania");
    expect(steps(coda).join(" | ")).toContain("(Heat, Toxin)");
  });

  it("sends a Tenet melee to Ergo Glast rather than to a Sister", () => {
    const livia = target("Tenet Livia");
    expect(livia.nemesis).toBeNull();
    expect(livia.paths.some((path) => path.kind === "nemesis")).toBe(false);
    const vendor = livia.paths.find((path) => path.kind === "vendor");
    expect(vendor?.complete).toBe(true);
    expect(vendor?.steps[0].where).toContain("Ergo Glast");
  });

  it("does not double up when the curated table also names the nemesis", () => {
    const bramma = target("Kuva Bramma", {
      curatedWeapons: {
        "Kuva Bramma": {
          sources: [{ kind: "nemesis", parts: "both", where: "Kuva Lich" }],
        },
      },
    });
    expect(bramma.paths.filter((path) => path.kind === "nemesis")).toHaveLength(1);
  });
});
