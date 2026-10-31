import { describe, expect, it } from "vitest";

import { relicSource, type RelicSourceRow } from "../../config/shared/relicSources";

function row(
  place: string,
  gameMode: string | null,
  kind: RelicSourceRow["kind"] = "mission",
): RelicSourceRow {
  return { place, chance: 12.5, kind, gameMode, refinement: null };
}

describe("relicSource", () => {
  it("splits a mission rotation off its node and reads the row's game mode", () => {
    expect(relicSource(row("Hydron (Sedna), Rotation C", "Defense"))).toEqual({
      place: "Hydron (Sedna)",
      kind: "mission",
      missionType: "Defense",
      rotation: "C",
      stage: null,
      refinement: null,
      chance: 12.5,
    });
  });

  it("keeps a node with no rotations whole", () => {
    expect(relicSource(row("Ukko (Void)", "Capture"))).toMatchObject({
      place: "Ukko (Void)",
      missionType: "Capture",
      rotation: null,
    });
  });

  it("files a Railjack cache row under its node", () => {
    expect(relicSource(row("Khufu Envoy (Caches) (Pluto), Rotation A", "Skirmish"))).toMatchObject({
      place: "Khufu Envoy (Pluto)",
      kind: "caches",
      missionType: "Skirmish",
      rotation: "A",
    });
  });

  it("keeps a bounty stage as the table states it and reads no mission type", () => {
    const stage = "Stage 2, Stage 3 of 4, and Stage 3 of 5";
    expect(
      relicSource(row(`Level 15 - 25 Plague Star, Rotation A (${stage})`, "Survival", "bounty")),
    ).toMatchObject({
      place: "Level 15 - 25 Plague Star",
      kind: "bounty",
      missionType: null,
      rotation: "A",
      stage,
    });
  });

  it("reads a row with no game mode as an unknown type", () => {
    expect(relicSource(row("Arbitrations, Rotation C", null))).toMatchObject({
      place: "Arbitrations",
      kind: "mission",
      missionType: null,
    });
  });
});
