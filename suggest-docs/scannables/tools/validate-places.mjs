// Checks src/data/scannables/places.json and the scannables map pins against scannables-plan.md.
// Prints every problem, then the snapshot's unplaced missing items. Exit 1 on any problem.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(repo, p), "utf8"));
const places = read("src/data/scannables/places.json");
const codex = read("node_modules/warframe-public-export-plus/ExportCodex.json");
const extra = read("src/data/codexScanRequirements.json").extraInfo;
const snap = read("suggest-docs/scannables/snapshot.json");

const problems = [];
const bad = (msg) => problems.push(msg);

const codexSection = new Map();
for (const section of ["objects", "loreFragments", "songs", "fighterFrames"])
  for (const type of Object.keys(codex[section] ?? {})) codexSection.set(type, section);
const expectedGroup = (type) => {
  const section = codexSection.get(type) ?? (extra[type]?.section === "plants" ? "plants" : null);
  if (!section) return null;
  if (section === "loreFragments") return type.includes("/LoreCardFragments/") ? "prex" : "fragments";
  return { objects: "objects", plants: "objects", songs: "somachords", fighterFrames: "frameFighter" }[section];
};

const KINDS = new Set(["landscape", "planet", "tileset", "stop", "drop"]);
const GROUPS = new Set(["somachords", "fragments", "prex", "frameFighter", "objects"]);
const ids = new Set();
const placed = new Set();
const allStrings = [];

for (const p of places) {
  const at = `place ${p.id}`;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.id)) bad(`${at}: id not kebab-case`);
  if (ids.has(p.id)) bad(`${at}: duplicate id`);
  ids.add(p.id);
  if (!KINDS.has(p.kind)) bad(`${at}: kind ${p.kind}`);
  if (typeof p.name !== "string" || !p.name) bad(`${at}: name`);
  if (typeof p.run !== "string" || p.run.length > 32) bad(`${at}: run "${p.run}" is ${p.run?.length} chars`);
  if (typeof p.fixed !== "boolean") bad(`${at}: fixed`);
  if (p.mapKey !== null && typeof p.mapKey !== "string") bad(`${at}: mapKey`);
  if (p.wiki !== null && !/^https:\/\/wiki\.warframe\.com\/w\//.test(p.wiki)) bad(`${at}: wiki ${p.wiki}`);
  for (const g of p.gear) if (g.length > 24) bad(`${at}: gear chip "${g}" over 24 chars`);
  for (const s of p.steps) if (s.length > 60) bad(`${at}: step "${s}" is ${s.length} chars`);
  if (!Array.isArray(p.gates)) bad(`${at}: gates`);
  if (p.art === null) bad(`${at}: no art`);
  else if (!fs.existsSync(path.join(repo, "assets/scannables", p.art))) bad(`${at}: art ${p.art} missing`);
  else if (fs.statSync(path.join(repo, "assets/scannables", p.art)).size > 420_000) bad(`${at}: art ${p.art} over 400 KB`);
  allStrings.push(p.name, p.run, ...p.gear, ...p.steps, ...p.gates);
  if (!p.pools.length) bad(`${at}: no pools`);
  for (const pool of p.pools) {
    if (!GROUPS.has(pool.group)) bad(`${at}: group ${pool.group}`);
    if (!(pool.perItem > 0)) bad(`${at}: perItem ${pool.perItem}`);
    if (pool.cap !== null && !(pool.cap > 0)) bad(`${at}: cap ${pool.cap}`);
    if (new Set(pool.types).size !== pool.types.length) bad(`${at}: duplicate type in a ${pool.group} pool`);
    for (const type of pool.types) {
      const g = expectedGroup(type);
      if (!g) bad(`${at}: ${type} not in ExportCodex`);
      else if (g !== pool.group) bad(`${at}: ${type} is ${g}, pool says ${pool.group}`);
      placed.add(type);
    }
  }
}
for (const s of allStrings) if (/[—–]/.test(s)) bad(`dash in "${s}"`);

const PIN_KINDS = new Set(["fragment", "somachord", "fish", "prex", "object"]);
const pinDir = path.join(repo, "src/data/maps/pins");
const pinCounts = {};
for (const file of fs.readdirSync(pinDir).filter((f) => f.startsWith("scannables-"))) {
  const pins = JSON.parse(fs.readFileSync(path.join(pinDir, file), "utf8"));
  const mapKey = file.replace(/^scannables-|\.json$/g, "");
  pinCounts[mapKey] = pins.length;
  if (!places.some((p) => p.mapKey === mapKey)) bad(`${file}: no place uses mapKey ${mapKey}`);
  const pinIds = new Set();
  for (const pin of pins) {
    const at = `${file} pin ${pin.id}`;
    if (pinIds.has(pin.id)) bad(`${at}: duplicate id`);
    pinIds.add(pin.id);
    if (!PIN_KINDS.has(pin.kind)) bad(`${at}: kind ${pin.kind}`);
    const [x, y] = pin.position ?? [];
    if (!(x >= 0 && x <= 4000 && y >= 0 && y <= 4000)) bad(`${at}: position ${pin.position}`);
    if (typeof pin.label !== "string" || !pin.label) bad(`${at}: label`);
    if (pin.note !== null && typeof pin.note !== "string") bad(`${at}: note`);
    for (const ref of pin.refs) {
      if (!expectedGroup(ref)) bad(`${at}: ref ${ref} not in ExportCodex`);
      else if (!places.some((p) => p.mapKey === mapKey && p.pools.some((q) => q.types.includes(ref))))
        bad(`${at}: ref ${ref} not in a ${mapKey} pool`);
    }
  }
}

const unplaced = [];
for (const [cat, g] of Object.entries(snap.groups)) {
  const list = cat === "fragments" ? Object.values(g.subsets).flatMap((s) => s.missing) : g.missing;
  for (const e of list) if (!placed.has(e.type)) unplaced.push(`${cat}: ${e.name} (${e.type})`);
}

console.log(`${places.length} places; kinds ${JSON.stringify(places.reduce((m, p) => ((m[p.kind] = (m[p.kind] ?? 0) + 1), m), {}))}`);
console.log(`pins ${JSON.stringify(pinCounts)}`);
console.log(`unplaced missing items (${unplaced.length}):`);
for (const u of unplaced) console.log(`  ${u}`);
if (problems.length) {
  console.log(`problems (${problems.length}):`);
  for (const m of problems) console.log(`  ${m}`);
  process.exit(1);
}
console.log("clean");
