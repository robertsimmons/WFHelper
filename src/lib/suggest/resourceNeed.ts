import { ownedComponentCount } from "../../../config/shared/componentNames.js";
import { ownsItem } from "./acquisition/parts.js";
import type { AcquisitionTarget, ModularGear, ModularPlan } from "./acquisition/types.js";
import type { ItemDbEntry } from "../../types/inventory.js";

/** A resource the unbuilt game still asks for, by the goal it serves. Each bucket
 *  is gross: what the player holds is taken off the total, never off one goal. */
export interface ResourceNeed {
  /** Masterable gear, Primes aside, still to build for its mastery. */
  normal: number;
  prime: number;
  /** Frames whose mastery is banked but which are not in hand to feed the
   *  Helminth. One still owed its mastery counts under `normal` instead. */
  subsume: number;
  held: number;
  /** The total less what is held. */
  short: number;
}

/** A build still asking for the resource, and how many it takes. */
interface ResourceWanter {
  name: string;
  count: number;
}

function resourceInRecipe(
  uniqueName: string,
  resource: string,
  itemDb: Record<string, ItemDbEntry>,
): number {
  let total = 0;
  for (const ingredient of itemDb[uniqueName]?.recipe?.ingredients ?? []) {
    if (ingredient.uniqueName === resource) total += ingredient.count;
  }
  return total;
}

/** A modular type carries no recipe of its own: every unbanked head is one more
 *  build, each taking one part per slot. A spare part already built covers a
 *  build, and the rest are priced at the slot's cheapest option. */
function resourceInModular(
  plan: ModularPlan,
  resource: string,
  itemDb: Record<string, ItemDbEntry>,
  ownership: Map<string, number>,
): number {
  const heads = plan.heads.filter((head) => !head.owned);
  let total = 0;
  for (const head of heads) {
    if (!ownsItem(head.uniqueName, ownership)) {
      total += resourceInRecipe(head.uniqueName, resource, itemDb);
    }
  }
  for (const slot of plan.slots) {
    if (slot.length === 0) continue;
    const spare = slot.reduce((sum, part) => sum + ownedComponentCount(part, ownership), 0);
    const least = Math.min(...slot.map((part) => resourceInRecipe(part, resource, itemDb)));
    total += Math.max(0, heads.length - spare) * least;
  }
  return total;
}

function resourceIn(target: AcquisitionTarget, resource: string): number {
  let total = 0;
  for (const material of target.parts.materials) {
    if (material.uniqueName === resource) total += material.required;
  }
  return total;
}

type Goal = "normal" | "prime" | "subsume";

function goalOf(target: AcquisitionTarget, ownership: Map<string, number>): Goal | null {
  if (target.needs.includes("mastery")) return target.isPrime ? "prime" : "normal";
  if (
    target.needs.includes("subsume") &&
    !target.isPrime &&
    !ownsItem(target.uniqueName, ownership)
  )
    return "subsume";
  return null;
}

/** A Moa or Hound card per model still draws on one pool of spare slot parts. */
function modularPools(targets: readonly AcquisitionTarget[]): Map<ModularGear, ModularPlan> {
  const modular = new Map<ModularGear, ModularPlan>();
  for (const target of targets) {
    if (!target.modular) continue;
    const pool = modular.get(target.modular.gear);
    modular.set(
      target.modular.gear,
      pool ? { ...pool, heads: [...pool.heads, ...target.modular.heads] } : target.modular,
    );
  }
  return modular;
}

export function resourceNeed(
  targets: readonly AcquisitionTarget[],
  resource: string,
  itemDb: Record<string, ItemDbEntry>,
  ownership: Map<string, number>,
): ResourceNeed {
  const need: Record<Goal, number> = { normal: 0, prime: 0, subsume: 0 };
  for (const plan of modularPools(targets).values()) {
    need.normal += resourceInModular(plan, resource, itemDb, ownership);
  }
  for (const target of targets) {
    if (target.modular) continue;
    const count = resourceIn(target, resource);
    const goal = count > 0 ? goalOf(target, ownership) : null;
    if (goal) need[goal] += count;
  }
  const held = ownedComponentCount(resource, ownership);
  const total = need.normal + need.prime + need.subsume;
  return { ...need, held, short: Math.max(0, total - held) };
}

/** The builds `resourceNeed` counts the resource against, largest ask first. */
export function resourceWanters(
  targets: readonly AcquisitionTarget[],
  resource: string,
  ownership: Map<string, number>,
): ResourceWanter[] {
  const wanters: ResourceWanter[] = [];
  for (const target of targets) {
    const count = resourceIn(target, resource);
    if (count <= 0 || (!target.modular && goalOf(target, ownership) === null)) continue;
    wanters.push({ name: target.displayName ?? target.name, count });
  }
  return wanters.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
