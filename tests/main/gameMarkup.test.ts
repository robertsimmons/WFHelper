import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  damageTypeElement,
  gameTextToDisplay,
  stripGameTokens,
  stripGameTokensFromKey,
} from "../../config/shared/gameMarkup";

// Real strings, not invented ones: the grammar is DE's, so the fixtures are theirs.
const EN_NAMES: Record<string, string> = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../src/data/itemNames/en.json"), "utf8"),
);

const dictValue = (key: string): string => {
  const value = EN_NAMES[key];
  if (!value) throw new Error(`fixture missing from en.json: ${key}`);
  return value;
};

describe("stripGameTokensFromKey", () => {
  it("strips a token a join key has already case-folded", () => {
    expect(stripGameTokensFromKey("<archwing> odonata prime")).toBe("odonata prime");
    expect(stripGameTokensFromKey("<ARCHWING> Rathbone")).toBe("Rathbone");
    // A token the tables have never carried, so nothing has to be listed for it.
    expect(stripGameTokensFromKey("<melee> ack & brunt")).toBe("ack & brunt");
  });

  it("names a damage type in a key the way the display pass names it", () => {
    expect(stripGameTokensFromKey("<dt_poison> nukor")).toBe("Toxin nukor");
    expect(stripGameTokens("<DT_POISON> Nukor")).toBe("Toxin Nukor");
  });

  it("leaves a key with no markup in it alone", () => {
    expect(stripGameTokensFromKey("odonata prime")).toBe("odonata prime");
  });
});

describe("damage-type tokens", () => {
  it("names the element a bare damage-type icon stands for", () => {
    // The act that showed a raw <DT_POISON> to the player.
    expect(
      gameTextToDisplay("Kill |COUNT| Enemies with <DT_POISON>Toxin Damage.", {
        values: { COUNT: 15 },
      }),
    ).toBe("Kill 15 Enemies with Toxin Damage.");
    expect(
      gameTextToDisplay(
        "Corrosive Damage is formed by combining <DT_ELECTRICITY> and <DT_POISON>.",
      ),
    ).toBe("Corrosive Damage is formed by combining Electricity and Toxin.");
  });

  it("does not repeat a name the string already spells out", () => {
    expect(gameTextToDisplay("Kill |COUNT| Enemies with <DT_EXPLOSION>Blast Damage.")).toBe(
      "Kill X Enemies with Blast Damage.",
    );
    expect(
      stripGameTokens(dictValue("/Lotus/Language/CrewShip/SalvageUpgradeFireDamagePctIncrease")),
    ).toBe("|val|% Heat Damage");
  });

  it("treats the _COLOR family as a tint on the word beside it", () => {
    // "<DT_FREEZE_COLOR> Freeze" would read as "Cold Freeze" if the tint named itself.
    expect(damageTypeElement("DT_FREEZE_COLOR")).toBeNull();
    expect(damageTypeElement("DT_VIRAL_TINT_COLOR_NO_ADV")).toBeNull();
    expect(gameTextToDisplay(dictValue("/Lotus/Language/Arcanes/ToxicBloodOnKillDesc"))).toBe(
      "create pool of toxic blood for Xs, dealing X Toxin Damage/s. Standing in the area applies the Toxin Damage to Theorem Arcanes.",
    );
  });

  it("names a damage type it has never seen from the token's own tail", () => {
    expect(damageTypeElement("DT_TACHYON")).toBe("tachyon");
    expect(gameTextToDisplay("Deal <DT_TACHYON> damage")).toBe("Deal Tachyon damage");
    expect(gameTextToDisplay("Deal <DT_TACHYON>Tachyon damage")).toBe("Deal Tachyon damage");
  });

  it("takes translated element names when a surface has them", () => {
    expect(
      gameTextToDisplay("Kill |COUNT| Enemies with <DT_POISON>", {
        values: { COUNT: 3 },
        elementName: (element) => (element === "toxin" ? "Toxine" : element),
      }),
    ).toBe("Kill 3 Enemies with Toxine");
  });
});

describe("icon tokens", () => {
  it("drops glyphs that have no meaning outside the game", () => {
    expect(stripGameTokens(dictValue("/Lotus/Language/Gifts/AVReceiver"))).toBe(
      "Kinemantik A/V Receiver",
    );
    expect(
      gameTextToDisplay(dictValue("/Lotus/Language/Arcanes/OperatorEnergyOnGhostDissipateDesc")),
    ).toBe(
      "WHILE IN VOID SLING: Press to dissipate the endpoint in a Xm radius. Enemies hit create a short lived Void Mote that replenishes X Energy on pick up.",
    );
  });

  it("leaves angle brackets that are prose rather than markup", () => {
    expect(stripGameTokens("Foo <bar> Baz")).toBe("Foo <bar> Baz");
  });

  it("reads DE's mixed-case and HTML-borrowed markup as markup", () => {
    expect(stripGameTokens("Kinemantik<Retro_TM> Radio")).toBe("Kinemantik Radio");
    expect(gameTextToDisplay("TRIUMPH: allies gain Overguard.<br>TRAGEDY: enemies burn.")).toBe(
      "TRIUMPH: allies gain Overguard. TRAGEDY: enemies burn.",
    );
  });
});

describe("value placeholders", () => {
  it("fills what the app knows and stands in for what it does not", () => {
    expect(gameTextToDisplay("Assist |ALLY| for |DURATION|s", { values: { ALLY: "Quincy" } })).toBe(
      "Assist Quincy for Xs",
    );
    expect(gameTextToDisplay("Kill |COUNT| Enemies", { values: { COUNT: 0 } })).toBe(
      "Kill 0 Enemies",
    );
    expect(gameTextToDisplay("Kill |COUNT| Enemies", { placeholder: "?" })).toBe("Kill ? Enemies");
  });

  it("matches a placeholder whatever case DE shipped it in", () => {
    expect(gameTextToDisplay("|val|m and |RANGE|m", { values: { VAL: 5, range: 9 } })).toBe(
      "5m and 9m",
    );
  });

  it("keeps the text inside a structural span and drops the marker", () => {
    expect(gameTextToDisplay("|TITLE_START|Ack-Ack|TITLE_END||BREAK||NAME|")).toBe("Ack-Ack X");
    expect(gameTextToDisplay("Complete |COLOR|Mercury Junction|NO_COLOR| and visit.")).toBe(
      "Complete Mercury Junction and visit.",
    );
  });

  it("drops a bounty's colour-spanned title line, which the card shows itself", () => {
    expect(
      gameTextToDisplay("|OPEN_COLOR|Antivirus Bounty|CLOSE_COLOR|\r\nDestroy |COUNT| speakers", {
        values: { COUNT: 6 },
      }),
    ).toBe("Destroy 6 speakers");
  });
});

describe("every English game string", () => {
  const MAX_REPORTED = 10;
  const leaks = (predicate: (value: string) => boolean): string[] => {
    const offenders = Object.entries(EN_NAMES)
      .map(([key, value]) => [key, gameTextToDisplay(value)] as const)
      .filter(([, display]) => predicate(display))
      .map(([key, display]) => `${key}: ${display}`);
    return offenders.length > MAX_REPORTED
      ? [...offenders.slice(0, MAX_REPORTED), `... ${offenders.length - MAX_REPORTED} more`]
      : offenders;
  };

  it("survives the pass without leaking an icon token", () => {
    expect(leaks((display) => /<[A-Za-z][A-Za-z0-9_]*>/.test(display))).toEqual([]);
  });

  it("survives the pass without leaking a value placeholder", () => {
    expect(leaks((display) => /\|[A-Za-z][A-Za-z0-9_]*\|/.test(display))).toEqual([]);
  });

  it("never empties a string that had readable words in it", () => {
    const emptied = Object.entries(EN_NAMES)
      .filter(([, value]) => /[A-Za-z]{3}/.test(value.replace(/<[^>]*>|\|[^|]*\|/g, "")))
      .filter(([, value]) => gameTextToDisplay(value).length === 0)
      .map(([key]) => key);
    expect(emptied).toEqual([]);
  });
});
