import { componentUniqueNameAliases } from "../../../../../config/shared/componentNames.js";
import { buildCraftingTree, type CraftingTreeNode } from "../../../craftingTree.js";
import { traderRelics, type TraderShelf } from "../../traderRelics.js";
import { planGroup } from "./materials.js";
import { primeOverride, type PrimeOverride, type PrimeOverrideLookup } from "./primeOverrides.js";
import { resourceEntry, type ResourceLookup } from "./resources.js";
import type { AuthoredPlan, PlanBadge, PlanGroup, PlanRow } from "./schema.js";
import type { ItemDbEntry } from "../../../../types/inventory.js";
import type {
  RelicCache,
  RelicDatabase,
  RelicDropping,
  RelicGroup,
} from "../../../../types/relics.js";
import type { WorldState } from "../../../../types/world.js";
import type { AcquisitionKind, PartPlan, WeaponClass } from "../types.js";

/** What generating a Prime's plan reads off its acquisition target. */
export interface PrimeTarget {
  name: string;
  uniqueName: string;
  kind: AcquisitionKind;
  weaponClass: WeaponClass | null;
  isPrime: boolean;
  parts: PartPlan;
}

export interface PrimeLive {
  itemDb: Record<string, ItemDbEntry>;
  relicDb: RelicDatabase | null | undefined;
  /** Null is unknown trader stock, never an empty shelf. */
  world?: WorldState | null | undefined;
  now?: number | undefined;
  overrides?: PrimeOverrideLookup | undefined;
  resources?: ResourceLookup | undefined;
}

type PartState = "open" | "caches" | "vaulted" | "unknown";

interface RelicDrop {
  relic: string;
  tier: string;
  rarity: string;
  intact: number;
  radiant: number | null;
  /** Null when neither the drop tables nor the bundled flag can say. */
  dropping: RelicDropping | null;
  /** True when the state came from the bundled flag, the drop tables unloaded. */
  bundled: boolean;
  caches: RelicCache[];
}

interface FarmPart {
  name: string;
  uniqueName: string;
  count: number;
  drops: RelicDrop[];
  state: PartState;
}

interface Build {
  label: string;
  runs: number;
  main: boolean;
  credits: number;
  seconds: number;
  inputs: { name: string; count: number }[];
}

interface Walk {
  farm: { name: string; uniqueName: string; count: number }[];
  builds: Build[];
  materials: Map<string, { total: number; uses: Map<string, number> }>;
}

const PART_PATH = /\/Types\/Recipes\//i;
const BLUEPRINT = /\s+Blueprint$/i;
const RARITIES = ["Common", "Uncommon", "Rare"];
const ERAS = ["Lith", "Meso", "Neo", "Axi", "Requiem", "Vanguard"];
const VAULTED_EFFORT = 8;
const OPEN_EFFORT = 5;
/** AUTHORING's rule: a lower Mastery Rank is no gate worth a step. */
const MR_GATE_ABOVE = 2;

/** "Mag Prime Neuroptics Blueprint" and "Mag Prime Neuroptics" are one drop. */
function partKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+blueprint$/, "")
    .trim();
}

function rarityOf(value: string): string {
  const lower = value.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function droppingOf(group: RelicGroup): { dropping: RelicDropping | null; bundled: boolean } {
  if (group.dropping) return { dropping: group.dropping, bundled: false };
  if (typeof group.vaulted !== "boolean") return { dropping: null, bundled: false };
  return { dropping: group.vaulted ? "none" : "missions", bundled: true };
}

interface RelicIndex {
  byUniqueName: Map<string, RelicDrop[]>;
  byName: Map<string, RelicDrop[]>;
}

function push(index: Map<string, RelicDrop[]>, key: string, drop: RelicDrop): void {
  const list = index.get(key) ?? [];
  if (!list.some((entry) => entry.relic === drop.relic)) list.push(drop);
  index.set(key, list);
}

const INDEXES = new WeakMap<RelicDatabase, RelicIndex>();

/** Every relic reward by part, once per relic database. */
function relicIndex(db: RelicDatabase): RelicIndex {
  const cached = INDEXES.get(db);
  if (cached) return cached;
  const index: RelicIndex = { byUniqueName: new Map(), byName: new Map() };
  for (const group of Object.values(db.groups)) {
    const intact = group.qualities.intact?.rewards ?? [];
    const radiant = group.qualities.radiant?.rewards ?? [];
    const state = droppingOf(group);
    for (const reward of intact) {
      const key = partKey(reward.name);
      const shine = radiant.find((entry) => partKey(entry.name) === key);
      const drop: RelicDrop = {
        relic: group.name,
        tier: group.tier,
        rarity: rarityOf(reward.rarity),
        intact: reward.chance,
        radiant: shine?.chance ?? null,
        ...state,
        caches: group.caches ?? [],
      };
      push(index.byName, key, drop);
      if (reward.uniqueName) push(index.byUniqueName, reward.uniqueName.toLowerCase(), drop);
    }
  }
  INDEXES.set(db, index);
  return index;
}

function dropsFor(index: RelicIndex, uniqueName: string, name: string): RelicDrop[] {
  for (const alias of componentUniqueNameAliases(uniqueName)) {
    const found = index.byUniqueName.get(alias.toLowerCase());
    if (found) return found;
  }
  return index.byName.get(partKey(name)) ?? [];
}

/** The recipe tree flattened into what a plan lists: drops to farm, builds in
 *  the order the foundry takes them, and the materials each build eats. A
 *  material the store does not name is still listed, bare. */
function walkRecipe(tree: CraftingTreeNode, itemName: string, lookup: ResourceLookup): Walk {
  const farm = new Map<string, { name: string; uniqueName: string; count: number }>();
  const builds: Build[] = [];
  const materials: Walk["materials"] = new Map();

  const addFarm = (name: string, uniqueName: string, count: number): void => {
    const existing = farm.get(name);
    if (existing) existing.count += count;
    else farm.set(name, { name, uniqueName, count });
  };
  const addMaterial = (label: string, owner: string, count: number): void => {
    const material = materials.get(label) ?? { total: 0, uses: new Map<string, number>() };
    material.total += count;
    material.uses.set(owner, (material.uses.get(owner) ?? 0) + count);
    materials.set(label, material);
  };

  const visit = (node: CraftingTreeNode, depth: number, owner: string): void => {
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
    if (entry) addMaterial(entry.spelled, owner, node.count);
    else if (PART_PATH.test(node.uniqueName) || /\bPrime\b/.test(node.name)) {
      addFarm(node.name, node.uniqueName, node.count);
    } else addMaterial(node.name, owner, node.count);
  };
  visit(tree, 0, itemName);
  return { farm: [...farm.values()], builds, materials };
}

function grouped(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function hours(seconds: number): string {
  return `${Math.round(seconds / 3600)}h`;
}

function duration(seconds: number): string {
  const h = Math.round(seconds / 3600);
  return h >= 24 && h % 24 === 0 ? `${h / 24} day${h === 24 ? "" : "s"}` : `${h}h`;
}

function chanceText(drop: RelicDrop): string {
  if (drop.rarity === "Common" || drop.radiant === null) return `${drop.intact}% Intact`;
  return `${drop.radiant}% Radiant`;
}

/** "Lith O2 or Neo O1, Common: 25.33% Intact", one clause per rarity. */
function relicNote(drops: readonly RelicDrop[]): string {
  const clauses: string[] = [];
  for (const rarity of RARITIES) {
    const at = drops.filter((drop) => drop.rarity === rarity);
    if (at.length === 0) continue;
    const names = [...new Set(at.map((drop) => drop.relic))].join(" or ");
    clauses.push(`${names}, ${rarity}: ${chanceText(at[0])}`);
  }
  return clauses.join("; ");
}

function sortDrops(drops: readonly RelicDrop[]): RelicDrop[] {
  return [...drops].sort(
    (a, b) =>
      ERAS.indexOf(a.tier) - ERAS.indexOf(b.tier) ||
      a.relic.localeCompare(b.relic, "en", { numeric: true }),
  );
}

function shortName(label: string, itemName: string): string {
  return label.startsWith(`${itemName} `) ? label.slice(itemName.length + 1) : label;
}

function relicLabel(relic: string): string {
  return `${relic} relic`;
}

function classify(drops: readonly RelicDrop[]): PartState {
  if (drops.some((drop) => drop.dropping === "missions")) return "open";
  if (drops.some((drop) => drop.dropping === "caches")) return "caches";
  if (drops.some((drop) => drop.dropping === "none")) return "vaulted";
  return "unknown";
}

/** The relics a part's row shows: the pool it drops from now. */
function currentPool(part: FarmPart): RelicDrop[] {
  const wanted: Record<PartState, RelicDropping | null> = {
    open: "missions",
    caches: "caches",
    vaulted: "none",
    unknown: null,
  };
  const pool = part.drops.filter((drop) => drop.dropping === wanted[part.state]);
  return sortDrops(pool.length > 0 ? pool : part.drops);
}

function row(label: string, note: string | null, qty: string | null = null): PlanRow {
  return { qty, label, note, alt: null, done: false };
}

/** "Systems Rare, Chassis Common": what this relic pays toward the item. */
function carries(relic: string, parts: readonly FarmPart[], itemName: string): string {
  return parts
    .flatMap((part) => {
      const drop = part.drops.find((entry) => entry.relic === relic);
      return drop ? [`${shortName(part.name, itemName)} ${drop.rarity}`] : [];
    })
    .join(", ");
}

function gateGroup(masteryReq: number, override: PrimeOverride | null): PlanGroup | null {
  const gates = override?.gates ?? [];
  const rows: PlanRow[] = gates.map((gate) => ({
    ...row(gate.label, gate.note),
    ...(gate.rank ? { rank: gate.rank } : {}),
  }));
  const gated = masteryReq > MR_GATE_ABOVE;
  if (gated) rows.push(row(`Mastery Rank ${masteryReq}`, "the Foundry won't craft it below this"));
  if (rows.length === 0) return null;
  return gates.length === 0
    ? planGroup("gate", "MASTERY RANK", rows, { activity: `reach MR ${masteryReq} to build it` })
    : planGroup("gate", "QUESTS", rows);
}

function dropsIn(
  parts: readonly FarmPart[],
  state: PartState,
  dropping: RelicDropping,
): RelicDrop[] {
  const relics = new Map<string, RelicDrop>();
  for (const part of parts) {
    if (part.state !== state) continue;
    for (const drop of part.drops) if (drop.dropping === dropping) relics.set(drop.relic, drop);
  }
  return sortDrops([...relics.values()]);
}

function cacheGroup(parts: readonly FarmPart[], itemName: string): PlanGroup | null {
  const relics = dropsIn(parts, "caches", "caches");
  if (relics.length === 0) return null;
  const rows = relics.map((drop) => {
    const regions = [...drop.caches]
      .sort((a, b) => b.chance - a.chance || a.region.localeCompare(b.region))
      .map((cache) => `${cache.region} ${cache.chance}%`)
      .join(", ");
    const pays = carries(drop.relic, parts, itemName);
    return row(relicLabel(drop.relic), regions ? `${pays}; ${regions}` : pays);
  });
  return planGroup("farm", "RAILJACK DERELICT CACHES", rows, {
    activity: "open the loot caches in a Railjack mission in these regions",
  });
}

/** Unknown is no world read at all; a trader who is away is a known empty shelf. */
function shelf(
  world: WorldState | null | undefined,
  trader: "vaultTrader" | "voidTrader",
  db: RelicDatabase,
  now: number,
): TraderShelf | null | undefined {
  if (!world) return undefined;
  return traderRelics(world[trader], db, now);
}

interface VaultRoute {
  groups: PlanGroup[];
  /** Relic rows Varzia's group lists, which is what the Aya group pays for. */
  varziaRows: number;
  /** Total Aya her listed relics cost; null when any price is unknown. */
  aya: number | null;
}

const NO_VAULT: VaultRoute = { groups: [], varziaRows: 0, aya: null };

const VARZIA_PLACE = "MAROO'S BAZAAR, MARS";

function vaultGroups(
  parts: readonly FarmPart[],
  itemName: string,
  live: PrimeLive,
  db: RelicDatabase,
  now: number,
): VaultRoute {
  const vaulted = parts.filter((part) => part.state === "vaulted");
  if (vaulted.length === 0) return NO_VAULT;
  const varzia = shelf(live.world, "vaultTrader", db, now);
  const baro = shelf(live.world, "voidTrader", db, now);
  const pays = (relic: string): string => carries(relic, parts, itemName);

  if (varzia === undefined) {
    const rows = dropsIn(parts, "vaulted", "none").map((drop) =>
      row(relicLabel(drop.relic), pays(drop.relic)),
    );
    return {
      groups: [
        planGroup("vendor", VARZIA_PLACE, rows, {
          sub: "Varzia",
          activity: "buy any of these relics she stocks, with Aya",
          live: { state: "waiting", text: "Varzia's stock unknown" },
        }),
      ],
      varziaRows: rows.length,
      aya: null,
    };
  }

  const atVarzia = new Map((varzia?.relics ?? []).map((entry) => [entry.group.name, entry]));
  const atBaro = new Map((baro?.relics ?? []).map((entry) => [entry.group.name, entry]));
  const varziaRows = new Map<string, PlanRow>();
  const baroRows = new Map<string, PlanRow>();
  const waiting: PlanRow[] = [];
  let aya: number | null = 0;
  for (const part of vaulted) {
    const relics = sortDrops(part.drops.filter((drop) => drop.dropping === "none"));
    const sold = relics.filter((drop) => atVarzia.has(drop.relic));
    const traded = relics.filter((drop) => atBaro.has(drop.relic));
    for (const drop of sold) {
      if (varziaRows.has(drop.relic)) continue;
      const price = atVarzia.get(drop.relic)?.offer.aya;
      aya = typeof price === "number" && aya !== null ? aya + price : null;
      const cost = typeof price === "number" ? `${price} Aya, ` : "";
      varziaRows.set(drop.relic, row(relicLabel(drop.relic), `${cost}${pays(drop.relic)}`));
    }
    for (const drop of traded) {
      const offer = atBaro.get(drop.relic)?.offer;
      const cost = [
        typeof offer?.ducats === "number" ? `${grouped(offer.ducats)} Ducats` : null,
        typeof offer?.credits === "number" ? `${grouped(offer.credits)} cr` : null,
      ].filter((bit): bit is string => bit !== null);
      const price = cost.length > 0 ? `${cost.join(", ")}, ` : "";
      baroRows.set(drop.relic, row(relicLabel(drop.relic), `${price}${pays(drop.relic)}`));
    }
    if (sold.length === 0 && traded.length === 0) {
      waiting.push(row(part.name, "not at Varzia or Baro now"));
    }
  }

  // How long until she rotates is the live Varzia fact's job, so the plan text
  // never goes stale between rotations.
  const groups: PlanGroup[] = [];
  const rows = [...varziaRows.values(), ...waiting];
  const waitText = varzia
    ? "not at Varzia or Baro now; wait for her stock to rotate"
    : "Varzia is away; not at Baro now";
  if (rows.length > 0) {
    groups.push(
      planGroup("vendor", VARZIA_PLACE, rows, {
        sub: "Varzia",
        activity: "buy these relics with Aya",
        live: waiting.length > 0 ? { state: "waiting", text: waitText } : null,
      }),
    );
  }
  if (baroRows.size > 0) {
    groups.push(
      planGroup("vendor", "BARO KI'TEER", [...baroRows.values()], {
        sub: live.world?.voidTrader?.location ?? null,
        activity: "buy these relics with Ducats before he leaves",
      }),
    );
  }
  return { groups, varziaRows: varziaRows.size, aya: varziaRows.size > 0 ? aya : null };
}

function ayaGroup(lookup: ResourceLookup, relics: number, aya: number | null): PlanGroup {
  const best = lookup("Aya")?.best ?? null;
  const note = relics === 1 ? "for the relic above" : `for the ${relics} relics above`;
  return planGroup(
    "currency",
    best?.place ?? "AYA",
    [row("Aya", note, aya ? grouped(aya) : null)],
    {
      sub: best?.sub ?? null,
      activity: best?.activity ?? null,
      meta: best?.meta ?? null,
      ref: "Aya",
    },
  );
}

const STATE_LINES: Partial<Record<PartState, string>> = {
  vaulted: "drops only from vaulted relics.",
  caches: "drops only from Railjack cache relics.",
  unknown: "vault status unknown.",
};

function fissureGroup(itemName: string, parts: readonly FarmPart[]): PlanGroup {
  const hidden: string[] = [];
  const conditions: string[] = [];
  const rarity = new Map<FarmPart, number>();
  const rows = parts.map((part) => {
    const qty = part.count > 1 ? grouped(part.count) : null;
    if (part.drops.length === 0) return row(part.name, "no known relic drops it", qty);
    const shown = currentPool(part);
    rarity.set(part, Math.min(...shown.map((drop) => RARITIES.indexOf(drop.rarity))));
    const old = sortDrops(part.drops.filter((drop) => drop.dropping === "none"));
    if (part.state !== "vaulted" && old.length > 0) {
      hidden.push(`${shortName(part.name, itemName)}: ${old.map((drop) => drop.relic).join(", ")}`);
    }
    const line = STATE_LINES[part.state];
    if (line) conditions.push(`${part.name} ${line}`);
    return row(part.name, relicNote(shown), qty);
  });
  if (parts.some((part) => part.drops.some((drop) => drop.bundled))) {
    conditions.push("Vault status is from bundled data until the drop tables load.");
  }
  const rated = [...rarity.entries()];
  const rarest = Math.max(...rated.map(([, value]) => value));
  const hardest = rated.filter(([, value]) => value === rarest);
  const bottleneck =
    rarest > 0 && hardest.length === 1 && parts.length > 1
      ? `${shortName(hardest[0][0].name, itemName)} is the bottleneck`
      : null;
  const open = parts.every((part) => part.state === "open");
  return planGroup("fissure", "ANY VOID FISSURE", rows, {
    activity: open ? "crack the matching relic era" : "crack the relics from the steps above",
    meta: bottleneck,
    conditions,
    disclosures:
      hidden.length > 0 ? [{ title: "also in vaulted relics", body: `${hidden.join("; ")}.` }] : [],
  });
}

function buildNote(build: Build, itemName: string, lookup: ResourceLookup): string {
  const bits = build.credits > 0 ? [`${grouped(build.credits / build.runs)} cr`] : [];
  for (const input of build.inputs) {
    const count = input.count / build.runs;
    if (lookup(input.name)) bits.push(`${grouped(count)} ${input.name}`);
    else {
      const label = shortName(input.name, itemName);
      bits.push(count > 1 ? `${count} ${label}` : label);
    }
  }
  if (build.main && build.seconds >= 86400) bits.push(duration(build.seconds));
  return bits.join(", ");
}

function foundryGroup(
  itemName: string,
  builds: readonly Build[],
  masteryReq: number,
  lookup: ResourceLookup,
): PlanGroup {
  const main = builds.find((build) => build.main);
  if (!main) {
    return planGroup("foundry", "FOUNDRY", [row(itemName, "recipe unknown")], {
      activity: `build ${itemName}`,
    });
  }
  const before = builds.filter((build) => !build.main);
  const times = [...new Set(before.map((build) => build.seconds))];
  const each = before.length > 1 || before[0]?.runs > 1 ? " each" : "";
  const lead =
    before.length === 0
      ? ""
      : times.length === 1
        ? `${hours(times[0])}${each}, then `
        : `${times.map(hours).join(" / ")}, then `;
  const mr = masteryReq > 0 && masteryReq <= MR_GATE_ABOVE ? `MR ${masteryReq}` : null;
  return planGroup(
    "foundry",
    "FOUNDRY",
    builds.map((build) =>
      row(
        build.label,
        buildNote(build, itemName, lookup),
        build.runs > 1 ? grouped(build.runs) : null,
      ),
    ),
    {
      activity: before.length > 0 ? `build components, then ${itemName}` : `build ${itemName}`,
      meta: [`${lead}${hours(main.seconds)}`, mr].filter(Boolean).join(", "),
    },
  );
}

function materialList(walk: Walk, itemName: string): NonNullable<AuthoredPlan["materials"]> {
  const out: NonNullable<AuthoredPlan["materials"]> = [];
  for (const [label, material] of walk.materials) {
    const uses = [...material.uses.entries()];
    const note =
      uses.length === 1
        ? shortName(uses[0][0], itemName) === itemName
          ? null
          : shortName(uses[0][0], itemName)
        : uses.map(([owner, qty]) => `${grouped(qty)} ${shortName(owner, itemName)}`).join(", ");
    out.push({ qty: grouped(material.total), label, note });
  }
  const credits = walk.builds.reduce((sum, build) => sum + build.credits, 0);
  if (credits > 0) out.push({ qty: grouped(credits), label: "Credits", note: null });
  return out;
}

function planKind(target: PrimeTarget): string {
  if (target.kind === "warframe") return "warframe-prime";
  if (target.kind === "weapon") return target.weaponClass ?? "weapon";
  return target.kind;
}

function tradeableOf(
  parts: readonly FarmPart[],
  itemDb: Record<string, ItemDbEntry>,
): boolean | null {
  const flags = parts.map((part) => itemDb[part.uniqueName]?.tradable);
  if (flags.every((flag) => flag === true)) return true;
  if (flags.every((flag) => flag === false)) return false;
  return null;
}

/** Without a recipe the card's own parts still say what to farm. */
function farmFromCard(target: PrimeTarget): Walk["farm"] {
  const rows = [...(target.parts.main ? [target.parts.main] : []), ...target.parts.components];
  return rows.map((part) => ({
    name: part.name,
    uniqueName: part.uniqueName,
    count: part.required,
  }));
}

function badgesFor(
  parts: readonly FarmPart[],
  masteryReq: number,
  override: PrimeOverride | null,
): PlanBadge[] {
  const badges: PlanBadge[] = [];
  if (parts.some((part) => part.state === "unknown")) {
    badges.push({ text: "vault status unknown", tone: "info" });
  }
  if (parts.some((part) => part.state === "vaulted"))
    badges.push({ text: "vaulted", tone: "warn" });
  else if (parts.some((part) => part.state === "caches")) {
    badges.push({ text: "relics from Railjack caches", tone: "warn" });
  } else if (masteryReq > MR_GATE_ABOVE) badges.push({ text: `MR ${masteryReq}`, tone: "info" });
  const seen = new Set(badges.map((badge) => badge.text));
  for (const badge of override?.badges ?? []) {
    if (!seen.has(badge.text)) badges.push(badge);
    seen.add(badge.text);
  }
  return badges;
}

function routeCost(parts: readonly FarmPart[], builds: readonly Build[]): string {
  const source = parts.some((part) => part.state === "vaulted")
    ? "Aya for Varzia's relics"
    : parts.some((part) => part.state === "caches")
      ? "relics from Railjack caches"
      : "relics from missions";
  const main = builds.find((build) => build.main);
  return main
    ? `${source}, then fissures, ${duration(main.seconds)} build`
    : `${source}, then fissures`;
}

/** The plan for a Prime whose parts drop from relics, built from live data:
 *  vault state, trader stock, recipe. Null when it is not one, which leaves the
 *  item to an authored plan or to unknown. Platinum is never a step. */
export function generatePrimePlan(target: PrimeTarget, live: PrimeLive): AuthoredPlan | null {
  const db = live.relicDb;
  if (!target.isPrime || !target.parts.known || !db) return null;
  const lookup = live.resources ?? resourceEntry;
  const now = live.now ?? Date.now();
  const override = (live.overrides ?? primeOverride)(target.name);
  const tree = buildCraftingTree(target.uniqueName, live.itemDb, new Map());
  const walk: Walk = tree
    ? walkRecipe(tree, target.name, lookup)
    : { farm: farmFromCard(target), builds: [], materials: new Map() };
  const index = relicIndex(db);
  const parts: FarmPart[] = walk.farm.map((part) => {
    const drops = dropsFor(index, part.uniqueName, part.name);
    return { ...part, drops, state: classify(drops) };
  });
  if (parts.length === 0 || parts.every((part) => part.drops.length === 0)) return null;

  const masteryReq = live.itemDb[target.uniqueName]?.masteryReq ?? 0;
  const vault = vaultGroups(parts, target.name, live, db, now);
  const [varzia, ...rest] = vault.groups;
  const groups = [
    gateGroup(masteryReq, override),
    cacheGroup(parts, target.name),
    vault.varziaRows > 0 ? ayaGroup(lookup, vault.varziaRows, vault.aya) : null,
    varzia ?? null,
    ...rest,
    fissureGroup(target.name, parts),
    foundryGroup(target.name, walk.builds, masteryReq, lookup),
  ].filter((group): group is PlanGroup => group !== null);

  const vaulted = parts.some((part) => part.state === "vaulted");
  const effort = override?.effort?.value ?? (vaulted ? VAULTED_EFFORT : OPEN_EFFORT);
  const need = target.parts.components.length + (target.parts.main ? 1 : 0);
  return {
    name: target.name,
    kind: planKind(target),
    source: "relics",
    effort,
    tradeable: tradeableOf(parts, live.itemDb),
    progress: { have: 0, need: Math.max(need, 1), unit: "parts" },
    badges: badgesFor(parts, masteryReq, override),
    prices: [],
    routes: [
      {
        name: vaulted ? `Varzia relics, as ${target.name}` : "Void Fissures",
        cost: routeCost(parts, walk.builds),
        effort,
        role: "chosen",
      },
    ],
    materials: tree ? materialList(walk, target.name) : [],
    groups,
  };
}
