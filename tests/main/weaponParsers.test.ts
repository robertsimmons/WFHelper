import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain build script module, no type declarations
import * as lua from "../../scripts/suggest/lua.mjs";
// @ts-expect-error -- plain build script module, no type declarations
import * as weapons from "../../scripts/suggest/weapons.mjs";

const { parseLuaTable } = lua;
const {
  buildEntry,
  buildProgenitors,
  buildTable,
  classifyStatement,
  difficultyFor,
  extractAcquisition,
  listWeapons,
  resolveTranscludes,
  splitStatements,
  statementParts,
  stripMarkup,
  transcludedSections,
  weaponSources,
} = weapons;

describe("parseLuaTable", () => {
  it("reads named keys, quoted keys and nested tables", () => {
    expect(
      parseLuaTable(`return {
        ["AX-52"] = { Name = "AX-52", Mastery = 12, Traits = { "Tenno" } },
        Acceltra = { Name = "Acceltra", Conclave = false, Users = { "Gauss", "Arthur" } },
      }`),
    ).toEqual({
      "AX-52": { Name: "AX-52", Mastery: 12, Traits: ["Tenno"] },
      Acceltra: { Name: "Acceltra", Conclave: false, Users: ["Gauss", "Arthur"] },
    });
  });

  it("skips line and block comments", () => {
    expect(
      parseLuaTable(`-- header
        return { -- trailing
          A = 1, --[[ inline ]] B = 2,
        }`),
    ).toEqual({ A: 1, B: 2 });
  });

  it("reads the infinite fire rate the stat tables use", () => {
    expect(parseLuaTable("return { FireRate = math.huge }")).toEqual({ FireRate: Infinity });
  });

  it("keeps an array-only table as an array", () => {
    expect(parseLuaTable(`return { { Part = "Barrel" }, { Part = "Stock" } }`)).toEqual([
      { Part: "Barrel" },
      { Part: "Stock" },
    ]);
  });

  it("reads long brackets, escapes, booleans and nil", () => {
    expect(parseLuaTable(`return { A = [[a\nb]], B = "q\\"q", C = true, D = nil }`)).toEqual({
      A: "a\nb",
      B: 'q"q',
      C: true,
      D: null,
    });
  });

  it("refuses a module with no return", () => {
    expect(() => parseLuaTable("local x = 1")).toThrow(/no return statement/);
  });
});

describe("stripMarkup", () => {
  it("keeps the visible half of a link", () => {
    expect(stripMarkup("dropped by the [[Stalker]] on [[Ur]], [[Uranus]]")).toBe(
      "dropped by the Stalker on Ur, Uranus",
    );
    expect(stripMarkup("[[Trade System|traded]] between players")).toBe("traded between players");
  });

  it("spells out the currency templates", () => {
    expect(stripMarkup("for {{cc|100,000}} and {{dc|610}}")).toBe(
      "for 100,000 Credits and 610 Ducats",
    );
    expect(stripMarkup("spending {{sc|125,000}}")).toBe("spending 125,000 Standing");
  });

  it("renders an item template as its display name", () => {
    expect(stripMarkup("10 {{Resource|Live Heartcell|Live Heartcells}}")).toBe(
      "10 Live Heartcells",
    );
    expect(stripMarkup("{{Weapon|Coda Mire}} and {{WF|Gauss}}")).toBe("Coda Mire and Gauss");
  });

  it("collapses a currency the article spells out twice", () => {
    expect(stripMarkup("for {{sc|6,000}} Standing")).toBe("for 6,000 Standing");
  });

  it("drops bold, html, reference marks and image links", () => {
    expect(stripMarkup("'''Rank 1'''<sup>[1]</sup> at [[Cavalero]] [[File:Icon.png|20px]]")).toBe(
      "Rank 1 at Cavalero",
    );
  });
});

describe("extractAcquisition", () => {
  it("reads the template form", () => {
    expect(
      extractAcquisition("{{Acquisition|Dread's blueprint is dropped by the [[Stalker]].}}"),
    ).toBe("Dread's blueprint is dropped by the [[Stalker]].");
  });

  it("reads the section form and stops at the next heading", () => {
    const page = "intro\n==Acquisition==\nBought from the [[Market]].\n\n==Notes==\nnot this\n";
    expect(extractAcquisition(page)).toContain("Bought from the [[Market]].");
    expect(extractAcquisition(page)).not.toContain("not this");
  });

  it("returns null for an article with no acquisition statement", () => {
    expect(extractAcquisition("==Notes==\nnothing here\n")).toBeNull();
  });
});

describe("splitStatements", () => {
  it("splits sentences and bullets and drops wikitables", () => {
    expect(
      splitStatements(
        "The blueprint is sold in the [[Market]]. Its parts drop from [[Sabotage]].\n" +
          "*A bullet line.\n{|\n|-\n| a || b\n|}\n",
      ),
    ).toEqual([
      "The blueprint is sold in the Market.",
      "Its parts drop from Sabotage.",
      "A bullet line.",
    ]);
  });
});

describe("classifyStatement", () => {
  const kindOf = (text: string): string | null => classifyStatement(text)?.kind ?? null;

  it("names the kind behind each phrasing", () => {
    expect(kindOf("The Ignis's blueprint can be researched from the Chem Lab in the dojo.")).toBe(
      "lab",
    );
    expect(kindOf("A built Boltor is awarded from completing the Venus to Mercury Junction.")).toBe(
      "junction",
    );
    expect(kindOf("The blueprint is awarded on completing the Vor's Prize quest.")).toBe("quest");
    expect(kindOf("The main blueprint can be acquired from Tier 5 Chrysalith Bounties.")).toBe(
      "bounty",
    );
    expect(kindOf("Sold by Baro Ki'Teer in the Concourse for 100,000 Credits.")).toBe("vendor");
    expect(kindOf("The Hek's blueprint can be purchased from the Market.")).toBe("market");
    expect(kindOf("Dread's blueprint is dropped by the Stalker.")).toBe("boss");
    expect(kindOf("The barrel drops from Rotation C of Survival on Venus Proxima.")).toBe(
      "mission",
    );
  });

  it("prefers the lab over the market wording that follows it", () => {
    expect(
      kindOf("Researched in the Energy Lab of the dojo, then bought from the Market for credits."),
    ).toBe("lab");
  });

  it("drops trade rules, sale prices and anything no rule recognises", () => {
    expect(classifyStatement("This weapon can be sold for 7,500 Credits.")).toBeNull();
    expect(classifyStatement("All parts can be traded between players.")).toBeNull();
    expect(classifyStatement("It looks very nice on a wall.")).toBeNull();
  });

  it("drops a sentence that names a cost but no way of getting anything", () => {
    expect(
      classifyStatement("Each item costs 5,000 Standing, totaling 20,000 Standing."),
    ).toBeNull();
  });

  it("drops a statement too long to read as a location", () => {
    expect(classifyStatement(`Bought from the Market. ${"x".repeat(300)}`)).toBeNull();
  });
});

describe("statementParts", () => {
  it("reads which half of the build a statement pays out", () => {
    expect(statementParts("The main blueprint drops here.")).toBe("main");
    expect(statementParts("The barrel and receiver drop here.")).toBe("components");
    expect(statementParts("The blueprint and its components drop here.")).toBe("both");
    expect(statementParts("A built Aklato can be purchased.")).toBe("both");
  });
});

describe("weaponSources", () => {
  it("keeps one row per distinct statement", () => {
    const sources = weaponSources(
      "==Acquisition==\nThe Boltor's blueprint can be purchased from the [[Market]]. " +
        "Alternatively, a built Boltor is awarded from completing the [[Venus]] to [[Mercury]] [[Junction]].\n",
    );
    expect(sources.map((row: { kind: string }) => row.kind)).toEqual(["market", "junction"]);
    expect(sources[0].where).toBe("The Boltor's blueprint can be purchased from the Market.");
  });

  it("returns nothing for an article with no acquisition statement", () => {
    expect(weaponSources("==Notes==\nnothing\n")).toEqual([]);
  });
});

describe("difficultyFor", () => {
  it("rates the cheapest known path", () => {
    expect(difficultyFor([{ kind: "market", parts: "both", where: "x" }], null)).toBe("easy");
    expect(difficultyFor([{ kind: "lab", parts: "both", where: "x" }], null)).toBe("easy");
    expect(difficultyFor([{ kind: "vendor", parts: "both", where: "x" }], null)).toBe("normal");
    expect(difficultyFor([{ kind: "mission", parts: "both", where: "x" }], null)).toBe("hard");
  });

  it("charges a step when the main blueprint and the components come apart", () => {
    expect(difficultyFor([{ kind: "market", parts: "main", where: "x" }], null)).toBe("easy");
    expect(
      difficultyFor(
        [
          { kind: "market", parts: "main", where: "x" },
          { kind: "mission", parts: "components", where: "y" },
        ],
        null,
      ),
    ).toBe("normal");
  });

  it("rates every nemesis run hard and an unknown weapon not at all", () => {
    expect(difficultyFor([], { family: "coda" })).toBe("hard");
    expect(difficultyFor([], null)).toBeNull();
  });
});

describe("transcludedSections and resolveTranscludes", () => {
  const page = [
    "For transcluding onto other adversary weapon pages.",
    "===Kuva Acquisition===",
    "{{PAGENAME}} is obtained by vanquishing a [[Kuva Lich]].",
    "===Coda Acquisition===",
    "{{PAGENAME}} is purchased from [[Eleanor]] for 10 Live Heartcells.",
  ].join("\n");

  it("splits the page into one body per heading", () => {
    expect(Object.keys(transcludedSections(page))).toEqual([
      "Kuva Acquisition",
      "Coda Acquisition",
    ]);
  });

  it("substitutes the transcluded body and the page name", () => {
    const sections = transcludedSections(page);
    expect(
      resolveTranscludes(
        "{{Transclude|Adversary System/Weapons#Coda Acquisition}}",
        sections,
        "Coda Motovore",
      ),
    ).toBe("Coda Motovore is purchased from [[Eleanor]] for 10 Live Heartcells.");
  });

  it("drops a transclude it has no body for", () => {
    expect(resolveTranscludes("{{Transclude|Somewhere#Else}}", {}, "X")).toBe("");
  });
});

describe("listWeapons", () => {
  it("carries the article link and the traits, sorted and deduped", () => {
    const entry = (Name: string, extra = {}) => ({ Name, Link: Name, Traits: ["Tenno"], ...extra });
    expect(
      listWeapons({
        primary: { Braton: entry("Braton"), Ax: entry("AX-52") },
        melee: { Braton: entry("Braton"), Skip: { Name: "Skip" } },
      }).map((row: { name: string; group: string }) => [row.name, row.group]),
    ).toEqual([
      ["AX-52", "primary"],
      ["Braton", "primary"],
    ]);
  });
});

describe("buildEntry", () => {
  const weapon = (name: string, traits: string[] = ["Tenno"]) => ({
    name,
    link: name,
    group: "primary",
    traits,
    lich: false,
    mastery: 0,
  });

  it("leaves kuva and tenet weapons to the built-in nemesis facts", () => {
    expect(buildEntry(weapon("Kuva Bramma", ["Grineer", "Kuva Lich"]), "x", {})).toBeNull();
    expect(buildEntry(weapon("Tenet Envoy", ["Corpus", "Tenet"]), "x", {})).toBeNull();
  });

  it("gives a coda weapon the spawn, elements and bonus window", () => {
    const entry = buildEntry(
      weapon("Dual Coda Torxica", ["Infested", "Technocyte Coda"]),
      "==Acquisition==\nnothing readable\n",
      {},
    );
    expect(entry.nemesis.family).toBe("coda");
    expect(entry.nemesis.bonus).toEqual({ min: 25, max: 60 });
    expect(entry.nemesis.elements).toContain("Heat");
    expect(entry.nemesis.spawn).toMatch(/Mixtape/);
    expect(entry.difficulty).toBe("hard");
  });

  it("returns null for a weapon whose article says nothing usable", () => {
    expect(buildEntry(weapon("Braton"), "==Notes==\nnothing\n", {})).toBeNull();
  });
});

describe("buildTable", () => {
  it("leaves Primes out, since they come from relics", () => {
    const article = "{{Acquisition|The blueprint is sold in the [[Market]].}}";
    const table = buildTable(
      [
        { name: "Braton", link: "Braton", group: "primary", traits: ["Tenno"], mastery: 0 },
        {
          name: "Braton Prime",
          link: "Braton Prime",
          group: "primary",
          traits: ["Prime"],
          mastery: 0,
        },
      ],
      { Braton: article, "Braton Prime": article },
      {},
    );
    expect(Object.keys(table)).toEqual(["Braton"]);
  });
});

describe("buildProgenitors", () => {
  it("maps each frame to the element it hands a nemesis weapon", () => {
    expect(
      buildProgenitors({
        Warframes: {
          Volt: { Name: "Volt", Progenitor: "Electricity" },
          Ember: { Name: "Ember", Progenitor: "Heat" },
          Nothing: { Name: "Nothing", Progenitor: "Blast" },
          Nameless: { Progenitor: "Heat" },
        },
      }),
    ).toEqual({ Ember: "Heat", Volt: "Electricity" });
  });
});
