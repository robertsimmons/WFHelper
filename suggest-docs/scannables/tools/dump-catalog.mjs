// Prints every non-Simulacrum codex scannable: section, missing flag, scans, name, type.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const req = JSON.parse(fs.readFileSync(path.join(repo, "src/data/codexScanRequirements.json"), "utf8"));
const snap = JSON.parse(fs.readFileSync(path.join(repo, "suggest-docs/scannables/snapshot.json"), "utf8"));

const missing = new Set();
for (const [cat, g] of Object.entries(snap.groups)) {
  const list = cat === "fragments" ? Object.values(g.subsets).flatMap((s) => s.missing) : g.missing;
  for (const e of list) missing.add(e.type);
}
const SECTIONS = new Set(["objects", "plants", "songs", "loreFragments", "fighterFrames"]);
const rows = [];
for (const [type, e] of Object.entries(req.extraInfo)) {
  if (!SECTIONS.has(e.section)) continue;
  rows.push([e.section, missing.has(type) ? "M" : "-", e.scans ?? "?", e.name, type, e.planet ?? ""].join("\t"));
}
rows.sort();
console.log(rows.join("\n"));
console.error(`rows ${rows.length} missing ${missing.size}`);
