// Builds src/data/maps/pins/scannables-<mapKey>.json from the wiki Map: JSON saved by curl.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SRC = "C:/Users/rober/.claude/robotron/scratch/wf/scannables-maps";
const extra = JSON.parse(fs.readFileSync(path.join(repo, "src/data/codexScanRequirements.json"), "utf8")).extraInfo;

const key = (s) => s.toLowerCase().replace(/['\u2018\u2019]/g, "").replace(/\s+/g, " ").trim();
const byName = new Map();
for (const [type, e] of Object.entries(extra)) {
  if (e.section !== "loreFragments" && e.section !== "songs") continue;
  byName.set(`${e.section}:${key(e.name)}`, [...(byName.get(`${e.section}:${key(e.name)}`) ?? []), type]);
}
function typeOf(section, name) {
  const hits = byName.get(`${section}:${key(name)}`) ?? [];
  if (hits.length !== 1) throw new Error(`${hits.length} ${section} matches for "${name}"`);
  return hits[0];
}
const load = (file) => JSON.parse(fs.readFileSync(`${SRC}/${file}.json`, "utf8"));
const note = (m) => {
  const d = (m.popup?.description ?? "").replace(/\s*\n\s*/g, "; ").trim();
  return d || null;
};
function write(mapKey, pins) {
  const out = path.join(repo, "src/data/maps/pins", `scannables-${mapKey}.json`);
  fs.writeFileSync(out, JSON.stringify(pins, null, 2) + "\n");
  console.log(`${mapKey}: ${pins.length} pins`);
}

// Plains: marker order equals the wiki's lettered fish map, A to T (maps.md).
const FISH = [
  "Ancient History", "The Unum", "Amps", "Life In Cetus", "Cetus", "The Quills of Cetus", "Plains Animals",
  "The Tower's Flesh", "Grineer Excavations", "Merchants of Cetus", "Remnants of Orokin", "The Ostrons",
  "The Grineer Tusks", "Tools of Harvest", "Ostron Artisans", "Ostron Patois", "Scavenging Way of Life",
  "Plains of Eidolon", "Harvesting The Tower", "Teralyst Eidolon",
];
const plains = load("plains").markers.filter((m) => m.categoryId === "thousand_year_fish");
if (plains.length !== FISH.length) throw new Error(`plains has ${plains.length} fish markers`);
write("plains-of-eidolon", plains.map((m, i) => ({
  id: `fish-${String.fromCharCode(97 + i)}`,
  position: m.position,
  kind: "fish",
  label: FISH[i],
  refs: [typeOf("loreFragments", FISH[i])],
  note: note(m),
})));

// Orb Vallis: a character's five unlock in order, so each marker refs all five.
const SOLARIS = {
  eudico_fragment: "Eudico", legs_fragment: "Legs", little_duck_fragment: "Little Duck's",
  rude_zuud_fragment: "Rude Zuud's", smokefinger_fragment: "Smokefinger's",
  the_business_fragment: "The Business'", ticker_fragment: "Ticker's",
};
const vallis = load("vallis").markers.filter((m) => m.categoryId in SOLARIS);
write("orb-vallis", vallis.map((m) => {
  const who = SOLARIS[m.categoryId];
  return {
    id: `mem-${m.id}`,
    position: m.position,
    kind: "fragment",
    label: m.popup.title,
    refs: [1, 2, 3, 4, 5].map((n) => typeOf("loreFragments", `${who} Mem Fragment ${n}/5`)),
    note: note(m),
  };
}));

const DUVIRI = {
  scholars_landing: "Scholar's Landing", we_are_not: "We Are Not What We Were", watchers_island: "Watcher's Island",
  lake_veruna: "Lake Verula", galleria: "The Galleria", doll_mausoleum: "The Doll Mausoleum",
  caves_of_academe: "The Caves of Academe", manipura_island: "Manipura Island", island_of_lorn: "The Island of Lorn",
  bleeding_earth: "The Bleeding Earth",
};
const duviri = load("duviri").markers;
const duviriPins = [];
for (const m of duviri) {
  if (m.categoryId in DUVIRI) {
    const entry = DUVIRI[m.categoryId];
    const n = /(\d+)\s*$/.exec(m.popup.title)?.[1];
    duviriPins.push({ id: `frag-${m.id}`, position: m.position, kind: "fragment", label: `${entry} ${n}/9`,
      refs: [typeOf("loreFragments", entry)], note: note(m) });
  } else if (m.categoryId === "somachord") {
    const song = m.popup.title.replace(/\s*Somachord\s*$/, "").replace(/ And /, " and ");
    duviriPins.push({ id: `soma-${m.id}`, position: m.position, kind: "somachord", label: song,
      refs: [typeOf("songs", song)], note: note(m) });
  }
}
write("duviri", duviriPins);
