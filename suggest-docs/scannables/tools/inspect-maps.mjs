// Summarises the fetched wiki Map: JSON files: categories with marker counts and sample titles.
import fs from "node:fs";

const dir = "C:/Users/rober/.claude/robotron/scratch/wf/scannables-maps";
const only = process.argv[3];
const map = JSON.parse(fs.readFileSync(`${dir}/${process.argv[2]}.json`, "utf8"));
const byCat = {};
for (const m of map.markers) (byCat[m.categoryId] ??= []).push(m);
for (const c of map.categories) {
  const list = byCat[c.id] ?? [];
  if (only && !new RegExp(only, "i").test(c.id + c.name)) {
    console.log(`${c.id}\t${c.name}\t${list.length}`);
    continue;
  }
  console.log(`== ${c.id}\t${c.name}\t${list.length}`);
  for (const m of list) console.log(`  ${m.id}\t[${m.position}]\t${m.popup?.title}\t${(m.popup?.description ?? "").slice(0, 80)}\t${m.popup?.link ?? ""}`);
}
