import { ownedComponentCount } from "../../../config/shared/componentNames.js";
import { ownsItem } from "./acquisition/parts.js";
import type { AcquisitionTarget, ModularPlan } from "./acquisition/types.js";
import type { ItemDbEntry } from "../../types/inventory.js";

/** Nitain the unbuilt game still asks for, by the goal it serves. Each bucket is
 *  gross: what the player holds is taken off the total, never off one goal. */
export interface NitainNeed {
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

function nitainInRecipe(
  uniqueName: string,
  nitain: string,
  itemDb: Record<string, ItemDbEntry>,
): number {
  let total = 0;
  for (const ingredient of itemDb[uniqueName]?.recipe?.ingredients ?? []) {
    if (ingredient.uniqueName === nitain) total += ingredient.count;
  }
  return total;
}

/** A modular type carries no recipe of its own: every unbanked head is one more
 *  build, each taking one part per slot. A spare part already built covers a
 *  build, and the rest are priced at the slot's least Nitain option. */
function nitainInModular(
  plan: ModularPlan,
  nitain: string,
  itemDb: Record<string, ItemDbEntry>,
  ownership: Map<string, number>,
): number {
  const heads = plan.heads.filter((head) => !head.owned);
  let total = 0;
  for (const head of heads) {
    if (!ownsItem(head.uniqueName, ownership)) {
      total += nitainInRecipe(head.uniqueName, nitain, itemDb);
    }
  }
  for (const slot of plan.slots) {
    if (slot.length === 0) continue;
    const spare = slot.reduce((sum, part) => sum + ownedComponentCount(part, ownership), 0);
    const least = Math.min(...slot.map((part) => nitainInRecipe(part, nitain, itemDb)));
    total += Math.max(0, heads.length - spare) * least;
  }
  return total;
}

function nitainIn(
  target: AcquisitionTarget,
  nitain: string,
  itemDb: Record<string, ItemDbEntry>,
  ownership: Map<string, number>,
): number {
  if (target.modular) return nitainInModular(target.modular, nitain, itemDb, ownership);
  let total = 0;
  for (const material of target.parts.materials) {
    if (material.uniqueName === nitain) total += material.required;
  }
  return total;
}

export function nitainNeed(
  targets: readonly AcquisitionTarget[],
  nitain: string,
  itemDb: Record<string, ItemDbEntry>,
  ownership: Map<string, number>,
): NitainNeed {
  let normal = 0;
  let prime = 0;
  let subsume = 0;
  for (const target of targets) {
    const count = nitainIn(target, nitain, itemDb, ownership);
    if (count <= 0) continue;
    if (target.needs.includes("mastery")) {
      if (target.isPrime) prime += count;
      else normal += count;
    } else if (
      target.needs.includes("subsume") &&
      !target.isPrime &&
      !ownsItem(target.uniqueName, ownership)
    ) {
      subsume += count;
    }
  }
  const held = ownedComponentCount(nitain, ownership);
  return { normal, prime, subsume, held, short: Math.max(0, normal + prime + subsume - held) };
}
