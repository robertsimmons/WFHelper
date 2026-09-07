import { describe, expect, it } from "vitest";

import { bannerAside, bannerFor } from "../../../../src/lib/suggest/bannerArt.js";
import type { SuggestionCategory } from "../../../../src/types/suggest.js";

const DAILY: SuggestionCategory = "daily";

const ART = [
  "kahl",
  "deepArchimedea",
  "temporalArchimedea",
  "descendiaNormal",
  "descendiaSteelPath",
  "dailyFocus",
  "archonHunt",
  "netracells",
  "bird3",
  "simaris",
  "sortie",
  "syndicateStanding",
  "steelPathHonors",
  "ayatanHunt",
  "calendar1999",
  "codaWeapons",
  "tenetMelee",
  "baro",
  "varzia",
  "darvo",
  "clem",
  "acrithis",
  "yonta",
  "palladino",
];

const VENDOR_ART = [
  "baro",
  "darvo",
  "palladino",
  "acrithis",
  "bird3",
  "yonta",
  "codaWeapons",
  "tenetMelee",
];

const NO_ART = ["circuitNormal", "circuitSteelPath", "spIncursions"];

describe("bannerFor", () => {
  it.each(ART)("resolves art for %s", (id) => {
    const art = bannerFor(id, DAILY, "nora");
    expect(art?.url).toMatch(/assets\/nextup\/.+\.webp$/);
  });

  it.each(ART)("resolves art for the dailies-prefixed %s", (id) => {
    expect(bannerFor(`dailies:${id}`, DAILY, "nora")).toEqual(bannerFor(id, DAILY, "nora"));
  });

  it.each(VENDOR_ART)("resolves art for the vendors-prefixed %s", (id) => {
    const art = bannerFor(`vendors:${id}`, "vendor", "nora");
    expect(art?.url).toMatch(/assets\/nextup\/.+\.webp$/);
  });

  it.each(NO_ART)("leaves %s without a banner", (id) => {
    expect(bannerFor(id, DAILY, "nora")).toBeNull();
  });

  it.each(["relics", "acquisition", "mastery"] as SuggestionCategory[])(
    "gives the %s category no banner of its own",
    (category) => {
      expect(bannerFor("someUnknownTask", category, "nora")).toBeNull();
    },
  );

  it("takes the nightwave art from the preference, whatever the task id", () => {
    expect(bannerFor("kahl", "nightwave", "amir")?.url).toContain("nightwave-amir");
    expect(bannerFor("kahl", "nightwave", "nora")?.url).toContain("nightwave-nora");
  });
});

describe("bannerAside", () => {
  it("pushes the reward clear of the side the art is anchored on", () => {
    expect(bannerAside({ url: "", position: "100% 50%", fit: "cover" })).toBe("justify-start");
    expect(bannerAside({ url: "", position: "0% 50%", fit: "cover" })).toBe("justify-end");
    expect(bannerAside({ url: "", position: "50% 50%", fit: "cover" })).toBe("justify-center");
    expect(bannerAside(null)).toBe("justify-center");
  });
});
