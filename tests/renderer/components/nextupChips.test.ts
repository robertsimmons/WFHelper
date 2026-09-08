import { describe, expect, it } from "vitest";

import {
  choicesState,
  COUNT_LABEL,
  COUNT_TITLE,
  STATE_CHIP,
  tierBorderClass,
  tierLetter,
  tierTextClass,
  tileCounts,
  tileDims,
  timeLeftText,
  valencePercent,
  valenceTone,
} from "../../../src/components/nextup/chips.js";
import { en } from "../../../src/i18n/en.js";
import {
  ONE_FUSION_FROM_CAP,
  valenceVerdict,
  type ValenceVerdict,
} from "../../../src/lib/suggest/valence.js";
import type { ChipState } from "../../../src/components/nextup/chips.js";
import type { ChoiceState } from "../../../src/types/suggest.js";

const STATES: ChoiceState[] = ["wanted", "subsume", "done"];
const CHIPS: ChipState[] = [...STATES, "owned"];

const NOW = Date.parse("2026-03-02T00:00:00Z");
const at = (ms: number): string => new Date(NOW + ms).toISOString();

describe("StateChip", () => {
  it("names a chip for every choice state, plus ownership of its own", () => {
    expect(Object.keys(STATE_CHIP).sort()).toEqual([...CHIPS].sort());
  });

  it("labels each chip it draws with a key English defines", () => {
    for (const state of CHIPS) {
      const chip = STATE_CHIP[state];
      if (chip) expect(en).toHaveProperty(chip.label);
    }
  });

  it("tones the outstanding states apart, off the card's own palette", () => {
    expect(STATE_CHIP.wanted?.tone).toContain("success");
    expect(STATE_CHIP.subsume?.tone).toContain("warning");
  });

  it("draws no chip for something in hand, either way, so no tile says owned", () => {
    expect(STATE_CHIP.done).toBeNull();
    expect(STATE_CHIP.owned).toBeNull();
  });
});

describe("tileCounts", () => {
  it("draws nothing at all for an unread inventory, rather than a zero", () => {
    expect(tileCounts(null)).toEqual([]);
    expect(tileCounts(undefined)).toEqual([]);
  });

  it("reports a read inventory holding none, muted rather than green", () => {
    const [count] = tileCounts({ owned: 0 });
    expect(count?.kind).toBe("inventory");
    expect(count?.value).toBe(0);
    expect(count?.tone).not.toContain("success");
  });

  it("greens a count the player actually holds", () => {
    expect(tileCounts({ owned: 3 })[0]?.tone).toContain("success");
  });

  it("says nothing of a foundry or a shelf with nothing on it", () => {
    expect(tileCounts({ owned: 1, pending: 0, built: 0 }).map((c) => c.kind)).toEqual([
      "inventory",
    ]);
  });

  it("yellows a built copy the same as one the foundry is running", () => {
    const counts = tileCounts({ owned: 1, pending: 2, built: 4 });
    expect(counts.map((c) => c.kind)).toEqual(["inventory", "foundry", "built"]);
    expect(counts[1]?.tone).toContain("warning");
    expect(counts[2]?.tone).toBe(counts[1]?.tone);
  });

  it("labels and titles every count off keys English defines", () => {
    for (const count of tileCounts({ owned: 1, pending: 1, built: 1 })) {
      expect(en).toHaveProperty(COUNT_LABEL[count.kind]);
      expect(en).toHaveProperty(COUNT_TITLE[count.kind]);
    }
  });
});

describe("tileDims", () => {
  it("never dims a resource, however much is in hand", () => {
    expect(tileDims(true, true, null)).toBe(false);
    expect(tileDims(true, null, { owned: 9, stacks: true })).toBe(false);
  });

  it("never dims a tile that was not told the item is gear", () => {
    expect(tileDims(true, null, null)).toBe(false);
    expect(tileDims(true, undefined, { owned: 1 })).toBe(false);
  });

  it("dims gear with nothing left owed, from either source", () => {
    expect(tileDims(true, false, null)).toBe(true);
    expect(tileDims(true, null, { owned: 1, stacks: false })).toBe(true);
  });

  it("keeps a tile that still owes something at full contrast", () => {
    expect(tileDims(false, false, null)).toBe(false);
    expect(tileDims(undefined, false, null)).toBe(false);
  });

  it("lets the caller override what the count claims", () => {
    expect(tileDims(true, true, { owned: 1, stacks: false })).toBe(false);
  });
});

describe("tier colours", () => {
  const LETTERS = ["S", "A", "B", "C", "D", "F"];

  it("colours every tier in the ladder, D included", () => {
    for (const letter of LETTERS) {
      expect(tierTextClass(letter)).not.toBe(tierTextClass(null));
      expect(tierBorderClass(letter)).not.toBe(tierBorderClass(null));
    }
  });

  it("gives a suffixed tier its letter's colour", () => {
    expect(tierTextClass("A-")).toBe(tierTextClass("A"));
    expect(tierBorderClass("S+")).toBe(tierBorderClass("S"));
  });

  it("leaves an unrated tier plain", () => {
    expect(tierTextClass(null)).toBe("text-text-muted");
    expect(tierBorderClass("")).toBe("border-border");
  });
});

describe("TierBadge", () => {
  it("draws the letter it is given, suffix and all", () => {
    expect(tierLetter("S")).toBe("S");
    expect(tierLetter("A-")).toBe("A-");
    expect(tierLetter("  B  ")).toBe("B");
  });

  it("draws nothing for an absent or blank tier", () => {
    expect(tierLetter(null)).toBeNull();
    expect(tierLetter(undefined)).toBeNull();
    expect(tierLetter("")).toBeNull();
    expect(tierLetter("   ")).toBeNull();
  });
});

describe("TimeLeft", () => {
  it("reads days, hours and minutes compactly", () => {
    expect(timeLeftText(at(2 * 86_400_000 + 4 * 3_600_000), NOW)).toBe("2d 4h");
    expect(timeLeftText(at(3 * 3_600_000 + 12 * 60_000), NOW)).toBe("3h 12m");
    expect(timeLeftText(at(18 * 60_000), NOW)).toBe("18m");
  });

  it("draws nothing for an absent, unparseable or past expiry", () => {
    expect(timeLeftText(null, NOW)).toBeNull();
    expect(timeLeftText(undefined, NOW)).toBeNull();
    expect(timeLeftText("not-a-date", NOW)).toBeNull();
    expect(timeLeftText(at(-60_000), NOW)).toBeNull();
    expect(timeLeftText(at(0), NOW)).toBeNull();
  });
});

describe("card state", () => {
  it("reads a card of choices as the best thing still outstanding", () => {
    expect(choicesState(["done", "wanted", "subsume"])).toBe("wanted");
    expect(choicesState(["done", "subsume"])).toBe("subsume");
  });

  it("reads a week with nothing left as ownership, not as a choice", () => {
    expect(choicesState(["done", "done"])).toBe("owned");
  });

  it("has no state for a card with no choices", () => {
    expect(choicesState([])).toBeNull();
  });
});

describe("valencePercent", () => {
  it("reports one decimal place, as the wiki does", () => {
    expect(valencePercent(60)).toBe("60.0");
    expect(valencePercent(52.8)).toBe("52.8");
    expect(valencePercent(43.25)).toBe("43.3");
  });
});

describe("valenceTone", () => {
  const VERDICTS: ValenceVerdict[] = ["done", "secondCopy", "caps", "ready", "short"];

  it("tones an offer that puts the cap in reach as good, owned copy or not", () => {
    expect(valenceTone(valenceVerdict(null, 55))).toBe("text-success");
    expect(valenceTone(valenceVerdict(40, 55))).toBe("text-success");
  });

  it("reads the same for Glast's unowned melee as for Eleanor's owned weapon", () => {
    const offered = ONE_FUSION_FROM_CAP + 2;
    expect(valenceTone(valenceVerdict(null, offered))).toBe(
      valenceTone(valenceVerdict(30, offered)),
    );
  });

  it("never reads good where a purchase cannot reach the cap", () => {
    expect(valenceTone(valenceVerdict(40, 45))).not.toContain("success");
    expect(valenceTone(valenceVerdict(null, 45))).not.toContain("success");
    expect(valenceTone(valenceVerdict(59, 45))).not.toContain("success");
  });

  it("keeps the offered percentage plain where the owned copy is what finishes it", () => {
    expect(valenceVerdict(55, 30)).toBe("secondCopy");
    expect(valenceTone("secondCopy")).not.toContain("success");
  });

  it("tones every verdict off an existing token", () => {
    for (const verdict of VERDICTS) {
      expect(valenceTone(verdict)).toMatch(/^text-(success|text-secondary|text-muted)$/);
    }
  });
});
