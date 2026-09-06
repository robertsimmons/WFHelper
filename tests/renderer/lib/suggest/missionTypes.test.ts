import { describe, expect, it } from "vitest";

import {
  missionOpinion,
  normalizeType,
  readMissions,
} from "../../../../src/lib/suggest/missionTypes.js";
import { defaultPreferences } from "../../../../src/lib/suggest/preferences.js";

const PREFS = defaultPreferences();

describe("missionOpinion", () => {
  it("rates the types shipped as defaults", () => {
    expect(missionOpinion(PREFS, "Spy")).toBe("bad");
    expect(missionOpinion(PREFS, "Capture")).toBe("good");
  });

  it("ignores case and stray spacing", () => {
    expect(missionOpinion(PREFS, "  sPY ")).toBe("bad");
  });

  it("reads both spellings the parser can emit as one type", () => {
    expect(missionOpinion(PREFS, "Extermination")).toBe(missionOpinion(PREFS, "Exterminate"));
    const prefs = {
      ...PREFS,
      missionTypes: { ...PREFS.missionTypes, [normalizeType("Extermination")]: "bad" as const },
    };
    expect(missionOpinion(prefs, "Exterminate")).toBe("bad");
    expect(missionOpinion(prefs, "Extermination")).toBe("bad");
  });

  it("has no opinion on an unrated type", () => {
    expect(missionOpinion(PREFS, "Alchemy")).toBeNull();
    expect(missionOpinion(PREFS, "")).toBeNull();
    expect(missionOpinion(PREFS, null)).toBeNull();
  });

  it("takes the user's rating over the shipped one", () => {
    const prefs = { ...PREFS, missionTypes: { ...PREFS.missionTypes, spy: "good" as const } };
    expect(missionOpinion(prefs, "Spy")).toBe("good");
  });
});

describe("readMissions", () => {
  it("names the disliked types in the order the game lists them", () => {
    expect(readMissions(PREFS, ["Capture", "Spy", "Rescue"]).slow).toEqual(["Spy", "Rescue"]);
  });

  it("calls a run quick only when every mission is liked", () => {
    expect(readMissions(PREFS, ["Capture", "Exterminate"]).allFast).toBe(true);
    expect(readMissions(PREFS, ["Capture", "Alchemy"]).allFast).toBe(false);
    expect(readMissions(PREFS, []).allFast).toBe(false);
  });

  it("treats an unrated type as neither quick nor slow", () => {
    const read = readMissions(PREFS, ["Alchemy", "Defense"]);
    expect(read.slow).toEqual([]);
    expect(read.allFast).toBe(false);
  });
});
