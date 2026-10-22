import { describe, expect, it } from "vitest";

import data from "../../../../src/data/suggest/vendorExchange.json";
import {
  exchangeLedger,
  exchangeWindow,
  neededOffers,
  shortOf,
  spareOf,
  vendorExchange,
} from "../../../../src/lib/suggest/vendorExchange.js";
import type { AcquisitionTarget } from "../../../../src/lib/suggest/acquisition/types.js";
import type { RawInventoryData } from "../../../../src/types/inventory.js";

const ZARIMAN = "/Lotus/Types/Gameplay/Zariman/Resources";
const DOWN = `${ZARIMAN}/ZarimanDogTagCommon`;
const CREST = `${ZARIMAN}/ZarimanDogTagRare`;
const PINION = `${ZARIMAN}/VoidAngelItem`;
const ORB = `${ZARIMAN}/ZarimanMiscItemA`;
const LANTHORN = `${ZARIMAN}/ZarimanMiscItemB`;
const THRAX = `${ZARIMAN}/VoidWraithItem`;
const FERRITE = "/Lotus/Types/Items/MiscItems/Ferrite";
const ALLOY = "/Lotus/Types/Items/MiscItems/AlloyPlate";
const TAU = "/Lotus/Types/Gameplay/Tau/Resources";
const HYPERCORE = `${TAU}/TwelveBossResourceDactolystItem`;
const BRIDGE = `${TAU}/TwelveBossResourceHunhullusItem`;
const ASCARIS = `${TAU}/TwelveBossResourcePrimesItem`;
const AGNOVIDISC = `${TAU}/TwelveResourceCommonItem`;
const LAUDAVI = `${TAU}/TwelveResourceUncommonItem`;
const SERVORIS = `${TAU}/TwelveResourceRareItem`;

const HOUR = 3_600_000;
const WINDOW = exchangeWindow("yonta", Date.UTC(2026, 9, 22, 9, 30));
const DAY = exchangeWindow("marie", Date.UTC(2026, 9, 22, 9, 30));

const ARTIFACTS = data.marie.artifacts;
const UPGRADES = data.marie.offers.filter((offer) => offer.kind === "upgrade");

interface Held {
  misc?: Record<string, number>;
  holdfasts?: number;
  artifacts?: number;
  upgrades?: boolean;
}

function inventory({ misc = {}, holdfasts = 5, artifacts = 0, upgrades = false }: Held) {
  return {
    MiscItems: Object.entries(misc).map(([ItemType, ItemCount]) => ({ ItemType, ItemCount })),
    Affiliations: [{ Tag: "ZarimanSyndicate", Title: holdfasts, Standing: 0 }],
    OperatorAmps: ARTIFACTS.slice(0, artifacts).map((artifact) => ({
      ItemType: artifact.uniqueName,
    })),
    Upgrades: upgrades ? UPGRADES.map((offer) => ({ ItemType: offer.uniqueName })) : [],
  } as unknown as RawInventoryData;
}

/** A frame still owed its mastery whose build asks for these materials. */
function target(name: string, materials: Record<string, number>): AcquisitionTarget {
  return {
    uniqueName: `/Lotus/Powersuits/${name}`,
    name,
    needs: ["mastery"],
    isPrime: false,
    modular: null,
    parts: {
      materials: Object.entries(materials).map(([uniqueName, required]) => ({
        uniqueName,
        name: uniqueName,
        required,
        owned: 0,
        missing: required,
      })),
    },
  } as unknown as AcquisitionTarget;
}

function ledger(held: Held, targets: AcquisitionTarget[] = []) {
  return exchangeLedger(inventory(held), {}, targets, "Holdfasts ranks");
}

/** Every price Marie can charge, covered at the top of its range. */
const MARIE_RICH = { [AGNOVIDISC]: 5000, [LAUDAVI]: 5000, [SERVORIS]: 5000 };

describe("exchange need and spare", () => {
  it("adds builds, Holdfasts ranks left and unbuilt artifacts before taking off what is held", () => {
    const book = ledger({ misc: { [PINION]: 4, [HYPERCORE]: 100 }, holdfasts: 4, artifacts: 3 }, [
      target("Uriel", { [PINION]: 2 }),
      target("Koumei", { [PINION]: 1, [HYPERCORE]: 20 }),
    ]);
    // Rank 5 asks five Pinions on top of the three the builds want.
    expect(book.needed(PINION)).toBe(8);
    expect(shortOf(book, PINION)).toBe(4);
    expect(spareOf(book, PINION)).toBe(0);
    // Two artifacts left at 150 each, plus Koumei's 20.
    expect(book.needed(HYPERCORE)).toBe(320);
    expect(shortOf(book, HYPERCORE)).toBe(220);
    expect(book.wantedBy(PINION).map((row) => row.name)).toEqual([
      "Uriel",
      "Koumei",
      "Holdfasts ranks",
    ]);
  });

  it("calls everything held past the need spare", () => {
    const book = ledger({ misc: { [FERRITE]: 9000 } }, [target("Uriel", { [FERRITE]: 1000 })]);
    expect(spareOf(book, FERRITE)).toBe(8000);
    expect(shortOf(book, FERRITE)).toBe(0);
  });
});

describe("exchange affordability", () => {
  it("is affordable only when two of the prices are covered at their maximum", () => {
    // Down rolls two of Ferrite 4000, Alloy 4000, Voidgel 2, Lanthorn 1.
    const short = { holdfasts: 0 };
    const one = neededOffers(
      "yonta",
      ledger({ ...short, misc: { [FERRITE]: 4000 + 7000, [ALLOY]: 3999 + 7000 } }),
    );
    expect(one.find((offer) => offer.uniqueName === DOWN)?.affordable).toBe(false);
    const two = neededOffers(
      "yonta",
      ledger({ ...short, misc: { [FERRITE]: 4000 + 7000, [ALLOY]: 4000 + 7000 } }),
    );
    expect(two.find((offer) => offer.uniqueName === DOWN)?.affordable).toBe(true);
  });

  it("never pays with resources the player still needs", () => {
    const book = ledger({ misc: { [ORB]: 10, [LANTHORN]: 10 } }, [
      target("Uriel", { [ORB]: 10, [LANTHORN]: 10, [CREST]: 1 }),
    ]);
    const crest = neededOffers("yonta", book).find((offer) => offer.uniqueName === CREST);
    expect(crest?.affordable).toBe(false);
    expect(crest?.costs.every((cost) => cost.spare === 0)).toBe(true);
  });
});

describe("Yonta tile", () => {
  const crestBuild = [target("Uriel", { [CREST]: 2 })];
  const payable = { [ORB]: 4, [LANTHORN]: 2 };

  it("shows a needed plume the spare pays for", () => {
    const yonta = vendorExchange("yonta", ledger({ misc: payable }, crestBuild), WINDOW, {
      kuvaOpen: false,
      dismissed: false,
    });
    expect(yonta?.offers.map((offer) => offer.name)).toEqual(["Voidplume Crest"]);
    expect(yonta?.offers[0]?.short).toBe(2);
    expect(yonta?.pay.map((spare) => spare.uniqueName).sort()).toEqual([LANTHORN, ORB].sort());
    expect(yonta?.kuva).toBeNull();
  });

  it("states have and need per offer and lists each price mat once against every offer", () => {
    const yonta = vendorExchange(
      "yonta",
      ledger({ misc: { ...payable, [ORB]: 5, [CREST]: 1 } }, [
        target("Uriel", { [CREST]: 3, [ORB]: 1 }),
      ]),
      WINDOW,
      { kuvaOpen: false, dismissed: false },
    );
    const crest = yonta?.offers[0];
    expect([crest?.held, crest?.needed, crest?.short]).toEqual([1, 3, 2]);
    const names = yonta?.mats.map((mat) => mat.uniqueName) ?? [];
    expect(new Set(names).size).toBe(names.length);
    const orb = yonta?.mats.find((mat) => mat.uniqueName === ORB);
    expect([orb?.held, orb?.needed, orb?.spare]).toEqual([5, 1, 4]);
    expect(orb?.wantedBy.map((row) => row.name)).toEqual(["Uriel"]);
    expect(orb?.prices).toEqual([{ min: 3, max: 4, covers: true }]);
  });

  it("hides when nothing it stocks is short", () => {
    expect(
      vendorExchange("yonta", ledger({ misc: payable }), WINDOW, {
        kuvaOpen: true,
        dismissed: false,
      }),
    ).toBeNull();
  });

  it("hides when a needed plume costs more than the spare", () => {
    expect(
      vendorExchange("yonta", ledger({ misc: { [ORB]: 3, [THRAX]: 100 } }, crestBuild), WINDOW, {
        kuvaOpen: true,
        dismissed: false,
      }),
    ).toBeNull();
  });

  it("holds the Kuva trade while five spare Pinions and the week are open", () => {
    const rich = ledger({ misc: { [PINION]: 5 } });
    const open = vendorExchange("yonta", rich, WINDOW, { kuvaOpen: true, dismissed: false });
    expect(open?.offers).toEqual([]);
    expect(open?.kuva?.quantity).toBe(35000);
    expect(vendorExchange("yonta", rich, WINDOW, { kuvaOpen: false, dismissed: false })).toBeNull();
    expect(
      vendorExchange("yonta", ledger({ misc: { [PINION]: 4 } }), WINDOW, {
        kuvaOpen: true,
        dismissed: false,
      }),
    ).toBeNull();
  });

  it("drops the offers for the window once done, keeping the Kuva trade", () => {
    const book = ledger({ misc: { ...payable, [PINION]: 5 } }, crestBuild);
    const done = vendorExchange("yonta", book, WINDOW, { kuvaOpen: true, dismissed: true });
    expect(done?.offers).toEqual([]);
    expect(done?.kuva).not.toBeNull();
  });
});

describe("Marie tile", () => {
  it("shows the boss resources an unbuilt artifact still needs", () => {
    const marie = vendorExchange(
      "marie",
      ledger({ misc: MARIE_RICH, artifacts: 4, upgrades: true }),
      DAY,
      { kuvaOpen: true, dismissed: false },
    );
    expect(marie?.offers.map((offer) => offer.uniqueName).sort()).toEqual(
      [ASCARIS, BRIDGE, HYPERCORE].sort(),
    );
    expect(marie?.offers.every((offer) => offer.short === 150)).toBe(true);
    expect(marie?.kuva).toBeNull();
  });

  it("wants an unowned Tektolyst mod or arcane once", () => {
    const marie = vendorExchange("marie", ledger({ misc: MARIE_RICH, artifacts: 5 }), DAY, {
      kuvaOpen: false,
      dismissed: false,
    });
    expect(marie?.offers).toHaveLength(UPGRADES.length);
    expect(marie?.offers.every((offer) => offer.kind === "upgrade" && offer.short === 1)).toBe(
      true,
    );
  });

  it("never shows once every artifact is built and nothing else is needed", () => {
    expect(
      vendorExchange("marie", ledger({ misc: MARIE_RICH, artifacts: 5, upgrades: true }), DAY, {
        kuvaOpen: true,
        dismissed: false,
      }),
    ).toBeNull();
  });
});

describe("exchangeWindow", () => {
  it("runs Yonta on 8h windows and Marie on the UTC day", () => {
    expect(WINDOW.expiry).toBe(new Date(Date.UTC(2026, 9, 22, 16)).toISOString());
    expect(DAY.expiry).toBe(new Date(Date.UTC(2026, 9, 23)).toISOString());
    expect(exchangeWindow("yonta", Date.UTC(2026, 9, 22, 16) + HOUR).key).not.toBe(WINDOW.key);
  });
});
