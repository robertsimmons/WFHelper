import { formatGap } from "./live.js";
import { formatQuantity, pendingBuildFor, standingBalance, type PlayerState } from "./state.js";
import type { WorldState } from "../../../../types/world.js";
import type { PlanGroup, PlanRow } from "./schema.js";
import type { PlanFactKind, ResolvedFact } from "./types.js";

const RELIC_ERA = /^(Lith|Meso|Neo|Axi|Requiem|Vanguard|Omnia)\b/i;
const NIGHTMARE = /nightmare/i;
const INVASION = /invasion/i;
const VARZIA = /varzia|maroo/i;
const STANDING_SUFFIX = / standing$/i;

function nodeKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function relicEra(label: string): string | null {
  const match = RELIC_ERA.exec(label.trim());
  return match ? match[1].toLowerCase() : null;
}

function planEras(groups: PlanGroup[]): Set<string> {
  const eras = new Set<string>();
  for (const group of groups) {
    for (const row of group.rows) {
      const era = relicEra(row.label);
      if (era) eras.add(era);
    }
  }
  return eras;
}

function fissureFact(eras: Set<string>, world: WorldState, now: number): ResolvedFact | null {
  const fissures = world.fissures;
  if (!Array.isArray(fissures) || eras.size === 0) return null;
  const live = fissures.filter((fissure) => {
    if (fissure.expired === true) return false;
    if (typeof fissure.expiry === "string" && Date.parse(fissure.expiry) <= now) return false;
    return typeof fissure.tier === "string" && eras.has(fissure.tier.toLowerCase());
  });
  if (live.length === 0) {
    return { kind: "fissure", text: "no matching fissure up", resolved: true };
  }
  const first = live[0];
  const where = typeof first.node === "string" && first.node ? first.node : String(first.tier);
  return {
    kind: "fissure",
    text: live.length > 1 ? `${live.length} matching fissures up, ${where}` : `${where} up now`,
    resolved: true,
  };
}

function relicsHeldFact(state: PlayerState, rows: PlanRow[]): ResolvedFact | null {
  let needed = 0;
  let held = 0;
  let counted = 0;
  for (const row of rows) {
    if (!relicEra(row.label)) continue;
    const owned = state.relics.get(row.label.trim().toLowerCase());
    if (owned === undefined) continue;
    counted += 1;
    needed += row.qty ? Number(row.qty.replace(/,/g, "")) : 1;
    held += owned;
  }
  if (counted === 0) return null;
  return {
    kind: "relics",
    text: `${formatQuantity(held)} of ${formatQuantity(needed)} relics held`,
    resolved: true,
  };
}

function varziaFact(
  group: PlanGroup,
  itemName: string,
  world: WorldState,
  now: number,
): ResolvedFact | null {
  const names = `${group.place} ${group.sub ?? ""} ${group.activity ?? ""}`;
  if (!VARZIA.test(names) && group.map !== "maroos-bazaar") return null;
  const trader = world.vaultTrader;
  if (!trader) return null;

  const stock = Array.isArray(trader.inventory) ? trader.inventory : [];
  const wanted = itemName.toLowerCase();
  const carried = stock.some((offer) =>
    String(offer.item ?? "")
      .toLowerCase()
      .includes(wanted),
  );
  const expiry = typeof trader.expiry === "string" ? Date.parse(trader.expiry) : Number.NaN;
  const rotates = Number.isNaN(expiry) ? null : formatGap(expiry - now);
  const lead = carried ? `${itemName} in stock now` : `${itemName} not in stock`;
  return {
    kind: "varzia",
    text: rotates ? `${lead}, rotates in ${rotates}` : lead,
    resolved: true,
  };
}

function foundryFact(
  group: PlanGroup,
  state: PlayerState,
  itemName: string,
  now: number,
): ResolvedFact | null {
  const cooking: string[] = [];
  let soonest: number | null = null;
  for (const row of group.rows) {
    const build = pendingBuildFor(state, row.label, itemName);
    if (!build) continue;
    cooking.push(build.name);
    if (build.endsAt !== null && (soonest === null || build.endsAt < soonest))
      soonest = build.endsAt;
  }
  if (cooking.length === 0) return null;
  const left = soonest === null ? null : formatGap(soonest - now);
  const lead = cooking.length === 1 ? `${cooking[0]} building` : `${cooking.length} building`;
  return { kind: "foundry", text: left ? `${lead}, ${left} left` : lead, resolved: true };
}

function standingFact(
  state: PlayerState,
  currency: string,
  outstanding: Map<string, number>,
): ResolvedFact | null {
  const owed = outstanding.get(currency);
  if (owed === undefined || owed <= 0) return null;
  const held = standingBalance(state, currency) ?? 0;
  const short = Math.max(0, owed - held);
  if (short === 0) return { kind: "standing", text: "already banked", resolved: true };
  if (state.standingCap <= 0) return null;
  const days = Math.ceil(short / state.standingCap);
  return {
    kind: "standing",
    text: `${days} ${days === 1 ? "day" : "days"} at your daily cap`,
    resolved: true,
  };
}

/** The one group that reports how long a standing currency still takes: whoever
 *  banks it, or the first group that spends it when nothing does. */
export function standingOwners(groups: PlanGroup[]): Map<number, string[]> {
  const owner = new Map<string, number>();
  groups.forEach((group, index) => {
    const currency = group.earns?.currency;
    if (currency && STANDING_SUFFIX.test(currency) && !owner.has(currency)) {
      owner.set(currency, index);
    }
  });
  groups.forEach((group, index) => {
    for (const spend of group.spends) {
      if (!STANDING_SUFFIX.test(spend.currency)) continue;
      if (!owner.has(spend.currency)) owner.set(spend.currency, index);
    }
  });
  const byGroup = new Map<number, string[]>();
  for (const [currency, index] of owner) {
    byGroup.set(index, [...(byGroup.get(index) ?? []), currency]);
  }
  return byGroup;
}

function invasionFact(group: PlanGroup, world: WorldState): ResolvedFact | null {
  const invasions = world.invasions;
  if (!Array.isArray(invasions)) return null;
  const key = nodeKey(group.place);
  if (!key) return null;
  const live = invasions.find(
    (invasion) => !invasion.completed && nodeKey(String(invasion.node ?? "")) === key,
  );
  return live ? { kind: "overlay", text: "Invasion running on this node", resolved: true } : null;
}

export interface GroupFacts {
  facts: ResolvedFact[];
  unresolved: PlanFactKind[];
}

/** Every derived fact this group can carry. A fact the app cannot compute today
 *  is named in `unresolved` rather than dropped or filled with a number. */
export function groupFacts(
  group: PlanGroup,
  options: {
    state: PlayerState;
    world: WorldState | null | undefined;
    itemName: string;
    eras: Set<string>;
    outstanding: Map<string, number>;
    /** Standing currencies this group is the one to report on. */
    standing: readonly string[];
    now: number;
  },
): GroupFacts {
  const { state, world, itemName, eras, outstanding, standing, now } = options;
  const facts: ResolvedFact[] = [];
  const unresolved: PlanFactKind[] = [];

  if (group.type === "foundry" || group.type === "craft") {
    const cooking = foundryFact(group, state, itemName, now);
    if (cooking) facts.push(cooking);
  }

  if (group.type === "relics" || group.type === "vendor") {
    const held = relicsHeldFact(state, group.rows);
    if (held) facts.push(held);
  }

  for (const currency of standing) {
    const banked = standingFact(state, currency, outstanding);
    if (banked) facts.push(banked);
  }

  if (world) {
    if (group.type === "fissure") {
      const fissure = fissureFact(eras, world, now);
      if (fissure) facts.push(fissure);
      else unresolved.push("fissure");
    }
    if (group.type === "vendor") {
      const varzia = varziaFact(group, itemName, world, now);
      if (varzia) facts.push(varzia);
    }
    const overlay = invasionFact(group, world);
    if (overlay) facts.push(overlay);
  } else if (group.type === "fissure") {
    unresolved.push("fissure");
  }

  const mentionsOverlay = group.conditions.some(
    (line) => NIGHTMARE.test(line) || INVASION.test(line),
  );
  // Nightmare overlays are in no feed the app reads, so a node that can carry one
  // keeps its authored condition and the gap is reported rather than guessed.
  if (mentionsOverlay && !facts.some((fact) => fact.kind === "overlay")) unresolved.push("overlay");

  if (group.type === "bounty") unresolved.push("bounty");

  return { facts, unresolved };
}

export { planEras };
