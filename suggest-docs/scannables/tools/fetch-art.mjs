// Fetches one wiki image per art file with plain curl and writes assets/scannables/<art> as webp.
// Usage: node fetch-art.mjs [--dry] [art-name ...]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRATCH = "C:/Users/rober/.claude/robotron/scratch/wf/scannables-art";
const OUT = path.join(repo, "assets/scannables");
fs.mkdirSync(SCRATCH, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

// art file -> wiki page, or { page, file } when the infobox image is not the art we want.
const ART = {
  "mercury.webp": "Mercury", "venus.webp": "Venus", "earth.webp": "Earth", "mars.webp": "Mars",
  "phobos.webp": "Phobos", "ceres.webp": "Ceres", "jupiter.webp": "Jupiter", "europa.webp": "Europa",
  "saturn.webp": "Saturn", "uranus.webp": "Uranus", "neptune.webp": "Neptune", "pluto.webp": "Pluto",
  "sedna.webp": "Sedna", "eris.webp": "Eris", "void.webp": "Void", "lua.webp": "Lua", "deimos.webp": "Deimos",
  "kuva-fortress.webp": "Kuva_Fortress", "zariman.webp": "Zariman_Ten_Zero",
  "plains-of-eidolon.webp": "Plains_of_Eidolon", "orb-vallis.webp": "Orb_Vallis",
  "cambion-drift.webp": { page: "Cambion_Drift", file: "Fass deimos promo.jpg" }, "duviri.webp": "Duviri",
  "leverian.webp": "Leverian", "kronia-relay.webp": "Relay",
  "hollvania-central-mall.webp": "Höllvania_Central_Mall", "drifters-camp.webp": "Drifter's_Camp",
  "chrysalith.webp": "Chrysalith", "dagaths-hollow.webp": { page: "Research/Dagath's_Hollow", file: "ResearchDagath'sHollow.png" }, "fortuna-airlock.webp": "Fortuna",
  "maroo-ayatan-hunt.webp": "Maroo",
  "isleweaver.webp": "Isleweaver", "ascension.webp": "Ascension", "the-descendia.webp": "The_Descendia",
  "perita-rebellion.webp": "The_Perita_Rebellion", "break-narmer.webp": "Break_Narmer",
  "albrecht-laboratories.webp": "Albrecht's_Laboratories", "corpus-temple-relief.webp": "Corpus_Ship",
  "grineer-sealab.webp": "Grineer_Sealab", "grineer-settlement.webp": { page: "Grineer_Settlement", file: "CBGrineerSettlement.png" },
  "grineer-asteroid.webp": { page: "Grineer_Asteroid", file: "2013-07-05 00001.jpg" }, "grineer-galleon.webp": { page: "Grineer_Galleon", file: "2013-05-28 00003.jpg" },
  "grineer-forest.webp": { page: "Grineer_Forest", file: "2013-12-19 00035.jpg" }, "carme-mobile-defense.webp": { page: "Corpus_Gas_City", file: "Andrew-wood-andrewwood-de-warframe-gcra.jpg" },
  "kepler-rush.webp": { page: "Rush_(Archwing)", file: "CorpusTransport.png" }, "infested-ship.webp": { page: "Infested_Ship", file: "Infested Ship 1.jpg" },
  "the-sacrifice.webp": "The_Sacrifice", "call-of-the-tempestarii.webp": "Call_of_the_Tempestarii",
  "awakening.webp": "Awakening", "the-new-strange.webp": "The_New_Strange", "once-awake.webp": "Once_Awake",
  "any-mission.webp": "Storage_Container",
};

const dry = process.argv.includes("--dry");
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const curl = (url, out) => execFileSync("curl", ["-s", "-L", "-o", out, url]);
const safe = (s) => s.replace(/[^A-Za-z0-9._-]/g, "_");

const ogImage = (html) => /property="og:image" content="([^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, "&") ?? null;

for (const [art, spec] of Object.entries(ART)) {
  if (only.length && !only.includes(art)) continue;
  const { page, file: forced } = typeof spec === "string" ? { page: spec } : spec;
  let url = forced ? `https://wiki.warframe.com/w/Special:FilePath/${encodeURIComponent(forced.replace(/ /g, "_"))}` : null;
  if (!url) {
    const htmlPath = `${SCRATCH}/html-${safe(page)}.html`;
    if (!fs.existsSync(htmlPath)) curl(`https://wiki.warframe.com/w/${encodeURIComponent(page).replace(/%2F/g, "/")}`, htmlPath);
    url = ogImage(fs.readFileSync(htmlPath, "utf8"));
  }
  if (!url) {
    console.log(`${art}\t${page}\tNO IMAGE`);
    continue;
  }
  const file = decodeURIComponent(url.split("?")[0].split("/").pop());
  if (dry) {
    console.log(`${art}\t${page}\t${file}`);
    continue;
  }
  const src = `${SCRATCH}/img-${safe(file)}`;
  if (!fs.existsSync(src)) curl(url, src);
  try {
    const img = sharp(src);
    const meta = await img.metadata();
    await img.resize({ width: Math.min(960, meta.width), withoutEnlargement: true }).webp({ quality: 72 }).toFile(path.join(OUT, art));
    const size = fs.statSync(path.join(OUT, art)).size;
    console.log(`${art}\t${file}\t${meta.width}x${meta.height}\t${Math.round(size / 1024)} KB`);
  } catch (err) {
    console.log(`${art}\t${file}\tFAILED ${err.message}`);
  }
}
