// Writes a plan file for every item the acquisition sweep can suggest that has
// none yet, from the same data the sweep reads: the app's item database (DE's
// Public Export plus @wfcd/items), the relic tables and the curated source
// tables. Existing plans are never touched.
// Usage: node scripts/suggest/build-acquisition-plans.mjs [--dry] [--only "Name,Name"]
// Needs `pnpm run build:main` first: the item and relic databases are the
// compiled main-process services.

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
        'export { buildCraftingTree } from "./src/lib/craftingTree.ts";',
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

const PART_PATH = /\/Types\/Recipes\//i;
const BLUEPRINT = /\s+Blueprint$/i;
const RARITIES = ["Common", "Uncommon", "Rare"];

function grouped(value) {
  return Math.round(value).toLocaleString("en-US");
}

/** "Mag Prime Neuroptics Blueprint" and "Mag Prime Neuroptics" are one drop. */
function partKey(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+blueprint$/, "")
    .trim();
}

/** Every relic reward by part, with its rarity and the chances a row quotes.
 *  @wfcd's reward uniqueNames are the relic's own, so rewards match by name. */
function relicIndex(relicDb) {
  const index = new Map();
  for (const group of Object.values(relicDb.groups)) {
    const intact = group.qualities.intact?.rewards ?? [];
    const radiant = group.qualities.radiant?.rewards ?? [];
    for (const reward of intact) {
      const key = partKey(reward.name);
      const shine = radiant.find((entry) => partKey(entry.name) === key);
      const list = index.get(key) ?? [];
      list.push({
        relic: group.name,
        tier: group.tier,
        vaulted: group.vaulted === true,
        rarity: reward.rarity,
        intact: reward.chance,
        radiant: shine?.chance ?? null,
      });
      index.set(key, list);
    }
  }
  return index;
}

/** The recipe tree flattened into what a plan lists: drops to farm, builds in
 *  the order the foundry takes them, and the materials each build eats. */
function walkRecipe(tree, itemName, lookup) {
  const farm = new Map();
  const builds = [];
  const materials = new Map();
  const unknown = [];

  const addFarm = (name, uniqueName, count) => {
    const existing = farm.get(name);
    if (existing) existing.count += count;
    else farm.set(name, { name, uniqueName, count });
  };

  const visit = (node, depth, owner) => {
    if (depth > 0 && node.isBlueprintItem) {
      addFarm(node.name, node.uniqueName, node.count);
      return;
    }
    // A crafted material is listed itself; the store multiplies its recipe out.
    const entry = depth > 0 && !PART_PATH.test(node.uniqueName) ? lookup(node.name) : null;
    if (!entry && node.recipe && node.children.length > 0) {
      // A frame component's blueprint is the part itself: one pile, one drop.
      if (depth > 0 && PART_PATH.test(node.uniqueName)) {
        addFarm(node.name.replace(BLUEPRINT, ""), node.uniqueName, node.count);
      }
      const label = depth === 0 ? itemName : node.name.replace(BLUEPRINT, "");
      const runs = Math.max(1, Math.ceil(node.count / Math.max(1, node.recipe.num || 1)));
      for (const child of node.children) visit(child, depth + 1, label);
      builds.push({
        label,
        runs,
        main: depth === 0,
        credits: (node.recipe.buildPrice || 0) * runs,
        seconds: node.recipe.buildTime || 0,
        inputs: node.children
          .filter((child) => !child.isBlueprintItem)
          .map((child) => ({ name: child.name.replace(BLUEPRINT, ""), count: child.count })),
      });
      return;
    }
    if (depth === 0) return;
    if (entry) {
      const material = materials.get(entry.spelled) ?? { total: 0, uses: new Map() };
      material.total += node.count;
      material.uses.set(owner, (material.uses.get(owner) ?? 0) + node.count);
      materials.set(entry.spelled, material);
    } else if (PART_PATH.test(node.uniqueName) || /\bPrime\b/.test(node.name)) {
      addFarm(node.name, node.uniqueName, node.count);
    } else {
      unknown.push(node.name);
    }
  };
  visit(tree, 0, itemName);
  return { farm: [...farm.values()], builds, materials, unknown };
}

function hours(seconds) {
  return `${Math.round(seconds / 3600)}h`;
}

function duration(seconds) {
  const h = Math.round(seconds / 3600);
  return h >= 24 && h % 24 === 0 ? `${h / 24} day${h === 24 ? "" : "s"}` : `${h}h`;
}

function chanceText(drop) {
  if (drop.rarity === "Common") return `${drop.intact}% Intact`;
  return drop.radiant === null ? `${drop.intact}% Intact` : `${drop.radiant}% Radiant`;
}

/** "Lith O2 or Neo O1, Common: 25.33% Intact", one clause per rarity. */
function relicNote(drops) {
  const clauses = [];
  for (const rarity of RARITIES) {
    const at = drops.filter((drop) => drop.rarity === rarity);
    if (at.length === 0) continue;
    const names = [...new Set(at.map((drop) => drop.relic))].join(" or ");
    clauses.push(`${names}, ${rarity}: ${chanceText(at[0])}`);
  }
  return clauses.join("; ");
}

function sortDrops(drops) {
  const era = ["Lith", "Meso", "Neo", "Axi", "Requiem", "Vanguard"];
  return [...drops].sort(
    (a, b) =>
      era.indexOf(a.tier) - era.indexOf(b.tier) ||
      a.relic.localeCompare(b.relic, "en", { numeric: true }),
  );
}

/** The commonest rarity a part drops at among the relics a row shows. */
function bestRarity(drops) {
  return Math.min(...drops.map((drop) => RARITIES.indexOf(drop.rarity)));
}

function shortName(label, itemName) {
  return label.startsWith(`${itemName} `) ? label.slice(itemName.length + 1) : label;
}

function fissureGroup(name, parts, vaulted) {
  const rows = [];
  const hidden = [];
  const vaultedOnly = [];
  for (const part of parts) {
    const active = part.drops.filter((drop) => !drop.vaulted);
    const shown = sortDrops(active.length > 0 ? active : part.drops);
    const old = sortDrops(part.drops.filter((drop) => drop.vaulted));
    if (active.length > 0 && old.length > 0) {
      const relics = [...new Set(old.map((drop) => drop.relic))].join(", ");
      hidden.push(`${shortName(part.name, name)}: ${relics}`);
    }
    part.rarity = bestRarity(shown);
    if (!vaulted && active.length === 0)
      vaultedOnly.push(`${part.name} drops only from vaulted relics.`);
    rows.push({
      qty: part.count > 1 ? grouped(part.count) : null,
      label: part.name,
      note: relicNote(shown),
      alt: null,
      done: false,
    });
  }
  const rarest = Math.max(...parts.map((part) => part.rarity));
  const hardest = parts.filter((part) => part.rarity === rarest);
  const bottleneck =
    rarest > 0 && hardest.length === 1 && parts.length > 1
      ? `${shortName(hardest[0].name, name)} is the bottleneck`
      : null;
  return {
    type: "fissure",
    place: "ANY VOID FISSURE",
    sub: null,
    activity: vaulted ? "crack the matching vaulted relics" : "crack the matching relic era",
    meta: bottleneck,
    mode: null,
    live: null,
    skip: null,
    earns: null,
    spends: [],
    map: null,
    rows,
    conditions: vaulted
      ? [
          `${name} is vaulted: its relics no longer drop from missions.`,
          "Vaulted relics and the parts themselves still trade between players.",
        ]
      : vaultedOnly,
    bonuses: [],
    disclosures:
      hidden.length > 0 ? [{ title: "also in vaulted relics", body: `${hidden.join("; ")}.` }] : [],
  };
}

function buildNote(build, itemName, lookup) {
  const bits = build.credits > 0 ? [`${grouped(build.credits / build.runs)} cr`] : [];
  for (const input of build.inputs) {
    const count = input.count / build.runs;
    const label = shortName(input.name, itemName);
    if (lookup(input.name)) bits.push(`${grouped(count)} ${input.name}`);
    else bits.push(count > 1 ? `${count} ${label}` : label);
  }
  if (build.main && build.seconds >= 86400) bits.push(duration(build.seconds));
  return bits.join(", ");
}

function foundryGroup(name, builds, masteryReq, lookup) {
  const before = builds.filter((build) => !build.main);
  const main = builds.find((build) => build.main);
  const times = [...new Set(before.map((build) => build.seconds))];
  const lead =
    before.length === 0
      ? ""
      : times.length === 1
        ? `${hours(times[0])}${before.length > 1 || before[0].runs > 1 ? " each" : ""}, then `
        : `${times.map(hours).join(" / ")}, then `;
  const meta = [`${lead}${hours(main.seconds)}`, masteryReq > 0 ? `MR ${masteryReq}` : null]
    .filter(Boolean)
    .join(", ");
  return {
    type: "foundry",
    place: "FOUNDRY",
    sub: null,
    activity: before.length > 0 ? `build components, then ${name}` : `build ${name}`,
    meta,
    mode: null,
    live: null,
    skip: null,
    earns: null,
    spends: [],
    map: null,
    rows: builds.map((build) => ({
      qty: build.runs > 1 ? grouped(build.runs) : null,
      label: build.label,
      note: buildNote(build, name, lookup),
      alt: null,
      done: false,
    })),
    conditions: [],
    bonuses: [],
    disclosures: [],
  };
}

function materialList(walk, name) {
  const out = [];
  for (const [label, material] of walk.materials) {
    const uses = [...material.uses.entries()];
    const note =
      uses.length === 1
        ? shortName(uses[0][0], name) === name
          ? null
          : shortName(uses[0][0], name)
        : uses.map(([owner, qty]) => `${grouped(qty)} ${shortName(owner, name)}`).join(", ");
    out.push({ qty: grouped(material.total), label, note });
  }
  const credits = walk.builds.reduce((sum, build) => sum + build.credits, 0);
  if (credits > 0) out.push({ qty: grouped(credits), label: "Credits", note: null });
  return out;
}

const VAULTED_PRIME_EFFORT = 8;
const UNVAULTED_PRIME_EFFORT = 5;

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

function tradeableOf(parts) {
  const flags = parts.map((part) => itemDb[part.uniqueName]?.tradable);
  if (flags.every((flag) => flag === true)) return true;
  if (flags.every((flag) => flag === false)) return false;
  return null;
}

function primePlan(target, lookup, relics) {
  const tree = renderer.buildCraftingTree(target.uniqueName, itemDb, new Map());
  if (!tree) return { skip: "no recipe in the item database" };
  const walk = walkRecipe(tree, target.name, lookup);
  if (walk.unknown.length > 0) {
    return { skip: `not in the resource store: ${[...new Set(walk.unknown)].join(", ")}` };
  }
  const parts = walk.farm.map((part) => ({ ...part, drops: relics.get(partKey(part.name)) ?? [] }));
  const dropless = parts.filter((part) => part.drops.length === 0).map((part) => part.name);
  if (dropless.length > 0) return { skip: `no relic drops ${dropless.join(", ")}` };
  // The item's own vaulted flag is stale for some Primes, so vault status comes
  // from the relics: unvaulted when every part has a relic that is not vaulted.
  const relicsVaulted = parts.every((part) => part.drops.every((drop) => drop.vaulted));
  const vaulted = !parts.every((part) => part.drops.some((drop) => !drop.vaulted));
  const partly = !vaulted && parts.some((part) => part.drops.every((drop) => drop.vaulted));
  return {
    vaulted,
    relicsVaulted,
    partly,
    plan: {
      name: target.name,
      kind: planKind(target),
      effort: vaulted ? VAULTED_PRIME_EFFORT : UNVAULTED_PRIME_EFFORT,
      tradeable: tradeableOf(parts),
      progress: progressOf(target),
      badges: vaulted ? [{ text: "vaulted", tone: "warn" }] : [],
      prices: [],
      materials: materialList(walk, target.name),
      groups: [
        fissureGroup(target.name, parts, vaulted),
        foundryGroup(target.name, walk.builds, itemDb[target.uniqueName]?.masteryReq ?? 0, lookup),
      ],
    },
  };
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
    vaulted: false,
    partly: false,
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
const relics = relicIndex(relicDb);
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
const notes = [];
for (const target of missing) {
  const bucket = `${planKind(target) ?? target.kind} ${family(target.name)}`;
  counts[bucket] = (counts[bucket] ?? 0) + 1;
  const result =
    target.isPrime && target.parts.known
      ? primePlan(target, lookup, relics)
      : wholeItemPlan(target);
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
  if (result.vaulted && result.relicsVaulted === false) {
    notes.push(`${target.name}: vaulted item, yet some relics holding it are flagged current`);
  }
  if (result.partly) notes.push(`${target.name}: some parts drop only from vaulted relics`);
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
if (notes.length > 0) console.log(`notes:\n  ${notes.join("\n  ")}`);
