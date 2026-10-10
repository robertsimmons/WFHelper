// Writes a plan file for every sweep-suggestable item lacking one, from the data the
// sweep reads: the item database and curated source tables. Relic Primes are planned
// at runtime, so they are only reported. Existing plans are never touched. Needs
// `pnpm run build:main` first (compiled services).
// Usage: node scripts/suggest/build-acquisition-plans.mjs [--dry] [--only "Name,Name"]

import fs from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

import { CACHE_DIR, DATA_DIR, readJson, writeJsonAtomic } from "./io.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const COMPILED = path.join(REPO_ROOT, ".electron-build");
const PLANS_DIR = path.join(DATA_DIR, "acquisitionPlans");
const require = createRequire(import.meta.url);

const dry = process.argv.includes("--dry");
const onlyArg = process.argv.indexOf("--only");
const only =
  onlyArg === -1
    ? null
    : new Set(process.argv[onlyArg + 1].split(",").map((name) => name.trim().toLowerCase()));

// The services log through electron-log, which stands down in test mode, and
// read the cached DE overlay from Electron's userData folder.
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "warn";
const USER_DATA = path.join(process.env.APPDATA ?? "", "WFHelper");
const loadModule = Module._load;
Module._load = function load(request, ...rest) {
  if (request === "electron") return { app: { getPath: () => USER_DATA, isPackaged: false } };
  return loadModule.call(this, request, ...rest);
};

function requireCompiled(relative) {
  const file = path.join(COMPILED, relative);
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}; run pnpm run build:main first.`);
  return require(file);
}

function loadDatabases() {
  requireCompiled("services/publicExportSource.js").loadOverlayFromDisk();
  const itemDatabase = requireCompiled("services/itemDatabase.js");
  itemDatabase.buildDatabase();
  const relicDb = requireCompiled("services/relicService.js").getRelicDatabase();
  return { itemDb: itemDatabase.getRendererLookup(), relicDb };
}

const EAGER_GLOB = /import\.meta\.glob\(\s*"([^"]+)"\s*,\s*\{\s*eager:\s*true\s*\}\s*\)/g;

function globFiles(fromDir, pattern) {
  const dir = path.resolve(fromDir, path.dirname(pattern));
  const name = new RegExp(
    `^${path.basename(pattern).replace(/[.]/g, "\\.").replace(/\*/g, ".*")}$`,
  );
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => name.test(file))
    .map((file) => `${path.dirname(pattern)}/${file}`);
}

/** Vite's eager import.meta.glob, spelled out as static imports. */
const viteGlob = {
  name: "vite-eager-glob",
  setup(pluginBuild) {
    pluginBuild.onLoad({ filter: /src[\\/].*\.ts$/ }, (args) => {
      const source = fs.readFileSync(args.path, "utf-8");
      if (!source.includes("import.meta.glob")) return undefined;
      const imports = [];
      const contents = source.replace(EAGER_GLOB, (_, pattern) => {
        const entries = globFiles(path.dirname(args.path), pattern).map((file) => {
          const id = `__glob${imports.length}`;
          imports.push(`import * as ${id} from ${JSON.stringify(file)};`);
          return `${JSON.stringify(file)}: ${id}`;
        });
        return `{ ${entries.join(", ")} }`;
      });
      return { contents: `${imports.join("\n")}\n${contents}`, loader: "ts" };
    });
  },
};

// The sweep is renderer code, so it is bundled rather than reimplemented here.
async function loadRenderer() {
  const outfile = path.join(CACHE_DIR, "acquisition-plans-bundle.mjs");
  await build({
    stdin: {
      contents: [
        'export { resolveAcquisition } from "./src/lib/suggest/acquisition/index.ts";',
        'export { resourceEntry } from "./src/lib/suggest/acquisition/plan/resources.ts";',
        'export { validatePlan } from "./src/lib/suggest/acquisition/plan/validate.ts";',
        'export { generatePrimePlan } from "./src/lib/suggest/acquisition/plan/prime.ts";',
      ].join("\n"),
      resolveDir: REPO_ROOT,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    define: { "import.meta.env": JSON.stringify({ MODE: "production", DEV: false, PROD: true }) },
    plugins: [viteGlob],
    logLevel: "error",
  });
  return import(pathToFileURL(outfile).href);
}

function shippedPlanNames() {
  const names = new Set();
  for (const file of fs.readdirSync(PLANS_DIR)) {
    if (!/^plan-.*\.json$/.test(file)) continue;
    const plan = readJson(path.join(PLANS_DIR, file));
    if (plan?.name) names.add(plan.name.trim().toLowerCase());
  }
  return names;
}

function sweepEffort(target) {
  const scaled = target.effort <= 1 ? target.effort * 10 : target.effort;
  return Math.min(10, Math.max(1, Math.round(scaled)));
}

function planKind(target) {
  if (target.kind === "warframe") return target.isPrime ? "warframe-prime" : "warframe";
  if (target.kind === "weapon") return target.weaponClass;
  return target.kind;
}

function progressOf(target) {
  const need = target.parts.components.length + (target.parts.main ? 1 : 0);
  return { have: 0, need: Math.max(need, 1), unit: "parts" };
}

const PATH_GROUPS = {
  market: "vendor",
  vendor: "vendor",
  lab: "research",
  junction: "gate",
  quest: "gate",
  boss: "boss",
  mission: "farm",
  bounty: "bounty",
  nemesis: "boss",
};

/** Gear handed over whole from a curated source: the easiest path is the group
 *  and every other one its "also from", as the drop-table plan reads it. */
function wholeItemPlan(target) {
  const paths = target.paths.filter((p) => PATH_GROUPS[p.kind] && p.steps.length === 1);
  if (paths.length === 0 || target.parts.known) return { skip: "no part source in the data" };
  const [head, ...rest] = paths;
  const where = head.steps[0].where;
  return {
    plan: {
      name: target.name,
      kind: planKind(target),
      effort: sweepEffort(target),
      tradeable: null,
      progress: progressOf(target),
      badges: [],
      prices: [],
      groups: [
        {
          type: PATH_GROUPS[head.kind],
          place: head.kind === "market" ? "MARKET" : where.toUpperCase(),
          sub: null,
          activity: null,
          meta: null,
          mode: null,
          live: null,
          skip: null,
          earns: null,
          spends: [],
          map: null,
          rows: [{ qty: null, label: target.name, note: null, alt: null, done: false }],
          conditions: [],
          bonuses: [],
          disclosures: rest.map((path) => ({ title: "also from", body: path.steps[0].where })),
        },
      ],
    },
  };
}

function slugOf(name) {
  return name
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/\s*&\s*/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function family(name) {
  const match =
    /\b(Prime|Wraith|Vandal|Prisma|MK1|Kuva|Tenet|Coda|Dex|Umbra|Rakta|Sancti|Secura|Synoid|Telos|Vaykor)\b/i.exec(
      name,
    );
  return match ? match[1] : "other";
}

const { itemDb, relicDb } = loadDatabases();
const renderer = await loadRenderer();
const lookup = renderer.resourceEntry;
const targets = renderer.resolveAcquisition({
  itemDb,
  inventory: null,
  relicDb,
  plat: null,
  curatedWeapons: readJson(path.join(DATA_DIR, "weapons.json")),
});
const shipped = shippedPlanNames();
const missing = targets.filter(
  (target) =>
    !shipped.has(target.name.trim().toLowerCase()) &&
    (!only || only.has(target.name.trim().toLowerCase())),
);

const counts = {};
const written = [];
const skipped = [];
const generated = [];
for (const target of missing) {
  const bucket = `${planKind(target) ?? target.kind} ${family(target.name)}`;
  counts[bucket] = (counts[bucket] ?? 0) + 1;
  // A relic Prime's plan is built at runtime; the report only says whether it is.
  if (target.isPrime && target.parts.known) {
    const plan = renderer.generatePrimePlan(target, { itemDb, relicDb, world: null });
    if (plan) generated.push(`${target.name} (effort ${plan.effort})`);
    else skipped.push(`${target.name}: no part drops from a relic; needs an authored plan`);
    continue;
  }
  const result = wholeItemPlan(target);
  if (result.skip) {
    skipped.push(`${target.name}: ${result.skip}`);
    continue;
  }
  // classify-sources.py sets source once the file exists.
  const problems = renderer
    .validatePlan(result.plan, lookup)
    .filter((problem) => !problem.startsWith("source "));
  if (problems.length > 0) {
    skipped.push(`${target.name}: invalid, ${problems.join("; ")}`);
    continue;
  }
  const slug = slugOf(target.name);
  const file = path.join(PLANS_DIR, `plan-${slug}.json`);
  if (fs.existsSync(file)) {
    skipped.push(`${target.name}: plan-${slug}.json already exists under another name`);
    continue;
  }
  if (!dry) await writeJsonAtomic(file, result.plan);
  written.push(slug);
}

console.log("missing by kind and family:", counts);
console.log(`written ${written.length}:`, written.join(" "));
console.log(`skipped ${skipped.length}:\n  ${skipped.join("\n  ")}`);
console.log(`generated at runtime ${generated.length}:\n  ${generated.join("\n  ")}`);
