import { describe, expect, it } from "vitest";

import shippedPlaces from "../../../../src/data/scannables/places.json";
import {
  UNPLACED_KEY,
  parsePlaces,
  placeSuggestions,
  scannablePlaceCards,
  type ScannablePlace,
  type ScannablePool,
} from "../../../../src/lib/suggest/scannablePlaces.js";
import {
  SCAN_GROUPS,
  missingScannables,
  scanGroups,
  type ScanGroup,
  type ScannableEntry,
} from "../../../../src/lib/suggest/scannables.js";
import type { CodexRow } from "../../../../src/lib/codexScans.js";

function entry(type: string, scanned: number, required: number | null): ScannableEntry {
  return { type, name: type.slice(1), scanned, required, image: null, planet: null, wiki: null };
}

type Missing = Record<ScanGroup, ScannableEntry[]>;

function missing(groups: Partial<Missing>): Missing {
  return { somachords: [], fragments: [], prex: [], frameFighter: [], objects: [], ...groups };
}

function pool(
  group: ScanGroup,
  types: string[],
  perItem = 1,
  cap: number | null = null,
): ScannablePool {
  return { group, types, perItem, cap };
}

function place(
  id: string,
  pools: ScannablePool[],
  extra: Partial<ScannablePlace> = {},
): ScannablePlace {
  return {
    id,
    name: id,
    kind: "planet",
    art: null,
    mapKey: null,
    run: "",
    gear: [],
    steps: [],
    gates: [],
    fixed: false,
    wiki: null,
    pools,
    ...extra,
  };
}

const ALL = SCAN_GROUPS;
const keys = (cards: { key: string }[]): string[] => cards.map((card) => card.key);

describe("scannablePlaceCards pools", () => {
  it("counts each missing item up to perItem, capped per pool", () => {
    const data = missing({ objects: [entry("/a", 0, 5), entry("/b", 2, 3), entry("/c", 0, 1)] });
    const [uncapped] = scannablePlaceCards(
      data,
      [place("p", [pool("objects", ["/a", "/b", "/c"], 2)])],
      ALL,
    );
    expect(uncapped?.perRun).toBe(2 + 1 + 1);
    const [capped] = scannablePlaceCards(
      data,
      [place("p", [pool("objects", ["/a", "/b", "/c"], 2, 3)])],
      ALL,
    );
    expect(capped?.perRun).toBe(3);
    expect(capped?.left).toBe(3);
  });

  it("sums every pool and counts an unknown requirement as one scan", () => {
    const data = missing({ objects: [entry("/a", 0, null)], somachords: [entry("/s", 1, 4)] });
    const places = [place("p", [pool("objects", ["/a"], 5), pool("somachords", ["/s"], 5)])];
    expect(scannablePlaceCards(data, places, ALL)[0]?.perRun).toBe(1 + 3);
  });

  it("keeps a fractional cap to the tenth", () => {
    const data = missing({ objects: [entry("/a", 0, 1)], prex: [entry("/p", 0, 1)] });
    const places = [place("p", [pool("objects", ["/a"], 1, 0.1), pool("prex", ["/p"], 1, 0.2)])];
    expect(scannablePlaceCards(data, places, ALL)[0]?.perRun).toBe(0.3);
  });

  it("counts an item two pools list once in what is left", () => {
    const data = missing({ objects: [entry("/a", 0, 2)] });
    const places = [place("p", [pool("objects", ["/a"]), pool("objects", ["/a"])])];
    const [card] = scannablePlaceCards(data, places, ALL);
    expect(card?.left).toBe(1);
    expect(card?.items).toHaveLength(1);
  });

  it("matches type paths without regard to case", () => {
    const data = missing({ objects: [entry("/Lotus/A", 0, 1)] });
    expect(
      keys(scannablePlaceCards(data, [place("p", [pool("objects", ["/lotus/a"])])], ALL)),
    ).toEqual(["p"]);
  });
});

describe("scannablePlaceCards filter", () => {
  const data = missing({ objects: [entry("/o", 0, 1)], somachords: [entry("/s", 0, 1)] });
  const places = [
    place("mixed", [pool("objects", ["/o"]), pool("somachords", ["/s"])]),
    place("objectsOnly", [pool("objects", ["/o"])]),
  ];

  it("counts only the filtered groups toward a place", () => {
    const [mixed] = scannablePlaceCards(data, places, ["somachords"]);
    expect(mixed).toMatchObject({ key: "mixed", left: 1, perRun: 1 });
    expect(mixed?.groups).toEqual([{ group: "somachords", count: 1 }]);
  });

  it("drops a place with nothing left under the filter", () => {
    expect(keys(scannablePlaceCards(data, places, ["somachords"]))).toEqual(["mixed"]);
    expect(keys(scannablePlaceCards(data, places, ["prex"]))).toEqual([]);
  });
});

describe("scannablePlaceCards rank", () => {
  const data = missing({
    objects: [
      ...["/a", "/b", "/c", "/d", "/e"].map((type) => entry(type, 0, 1)),
      entry("/f", 0, 3),
    ],
  });

  it("puts stops first whatever they yield", () => {
    const places = [
      place("big", [pool("objects", ["/a", "/b", "/c"])]),
      place("stop", [pool("objects", ["/d"])], { kind: "stop" }),
    ];
    expect(keys(scannablePlaceCards(data, places, ALL))).toEqual(["stop", "big", UNPLACED_KEY]);
  });

  it("orders by yield, then fixed spots, then fewer left, then name", () => {
    const places = [
      place("small", [pool("objects", ["/a"])]),
      place("random", [pool("objects", ["/a", "/b"])]),
      place("fixed", [pool("objects", ["/c", "/d"])], { fixed: true }),
      place("fewer", [pool("objects", ["/f"], 2)]),
      place("more", [pool("objects", ["/a", "/b", "/c"], 1, 2)]),
      place("bravo", [pool("objects", ["/e"])]),
      place("alpha", [pool("objects", ["/d"])]),
    ];
    expect(keys(scannablePlaceCards(data, places, ALL))).toEqual([
      "fixed",
      "fewer",
      "random",
      "more",
      "alpha",
      "bravo",
      "small",
    ]);
  });
});

describe("scannablePlaceCards unplaced", () => {
  it("puts items no place lists on a final card, filtered like the rest", () => {
    const data = missing({
      objects: [entry("/o", 0, 1), entry("/lost", 0, 1)],
      prex: [entry("/px", 0, 1)],
    });
    const places = [place("stop", [pool("objects", ["/o"])], { kind: "stop" })];
    const cards = scannablePlaceCards(data, places, ALL);
    expect(keys(cards)).toEqual(["stop", UNPLACED_KEY]);
    expect(cards[1]).toMatchObject({ place: null, left: 2, perRun: 0 });
    expect(cards[1]?.items.map((item) => item.group)).toEqual(["prex", "objects"]);
    expect(keys(scannablePlaceCards(data, places, ["objects"]))).toEqual(["stop", UNPLACED_KEY]);
    expect(keys(scannablePlaceCards(data, places, ["somachords"]))).toEqual([]);
  });

  it("treats an item listed under a filtered-out pool as placed", () => {
    const data = missing({ objects: [entry("/o", 0, 1)] });
    const places = [place("p", [pool("somachords", ["/o"])])];
    expect(scannablePlaceCards(data, places, ["objects"])).toEqual([]);
  });
});

describe("scannablePlaceCards completed items", () => {
  const codexRow = (type: string, scanned: number, required: number): CodexRow => ({
    type,
    name: type,
    scanned,
    required,
    complete: scanned >= required,
    faction: "objects",
    image: null,
  });
  const extras = { "/a": { section: "objects" }, "/b": { section: "objects" } };
  const places = [place("p", [pool("objects", ["/a"])]), place("q", [pool("objects", ["/b"])])];

  it("drops an item once a refresh shows it complete, and the place with it", () => {
    const before = scanGroups(
      missingScannables([codexRow("/a", 0, 1), codexRow("/b", 0, 1)], extras),
    );
    expect(keys(scannablePlaceCards(before, places, ALL))).toEqual(["p", "q"]);
    const after = scanGroups(
      missingScannables([codexRow("/a", 1, 1), codexRow("/b", 0, 1)], extras),
    );
    expect(keys(scannablePlaceCards(after, places, ALL))).toEqual(["q"]);
  });
});

describe("scannablePlaceCards groups", () => {
  it("counts groups largest first and lists items by group then name", () => {
    const data = missing({
      objects: [entry("/z", 0, 1), entry("/y", 0, 1)],
      somachords: [entry("/s", 0, 1)],
    });
    const places = [place("p", [pool("somachords", ["/s"]), pool("objects", ["/z", "/y"])])];
    const [card] = scannablePlaceCards(data, places, ALL);
    expect(card?.groups).toEqual([
      { group: "objects", count: 2 },
      { group: "somachords", count: 1 },
    ]);
    expect(card?.items.map((item) => item.entry.type)).toEqual(["/s", "/y", "/z"]);
  });
});

describe("placeSuggestions", () => {
  it("keeps the ranked order and carries the card", () => {
    const data = missing({ objects: [entry("/a", 0, 1)] });
    const cards = scannablePlaceCards(data, [place("p", [pool("objects", ["/a"])])], ALL);
    const [suggestion] = placeSuggestions(cards);
    expect(suggestion).toMatchObject({ id: "scannablePlace:p", order: 0, category: "simulacrum" });
    expect(suggestion?.details?.scannablePlace).toBe(cards[0]);
  });
});

describe("parsePlaces", () => {
  it("drops entries and pools the shape does not hold", () => {
    const parsed = parsePlaces([
      {
        id: "ok",
        name: "Ok",
        kind: "stop",
        fixed: true,
        pools: [
          { group: "prex", types: ["/a", 3], perItem: 1, cap: null },
          { group: "fish", types: [], perItem: 1 },
        ],
      },
      { id: "badKind", name: "Bad", kind: "moon", pools: [] },
      { name: "noId", kind: "planet" },
      null,
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      id: "ok",
      kind: "stop",
      fixed: true,
      art: null,
      gear: [],
      pools: [{ group: "prex", types: ["/a"], perItem: 1, cap: null }],
    });
    expect(parsePlaces({})).toEqual([]);
  });
});

describe("shipped places", () => {
  it("parses every authored place and pool", () => {
    const parsed = parsePlaces(shippedPlaces);
    expect(parsed.map((entry) => entry.id)).toEqual(shippedPlaces.map((entry) => entry.id));
    expect(parsed.flatMap((entry) => entry.pools)).toHaveLength(
      shippedPlaces.flatMap((entry) => entry.pools).length,
    );
  });
});
