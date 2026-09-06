import { activeWindow } from "../format.js";
import type { GlobalBoost, WorldState } from "../../types/world.js";

/** The server-wide boost of a kind running right now, or null. World state is
 *  cached past the fetch that built it, so the window is judged against nowMs
 *  rather than trusted from the parse. */
export function liveBoost(
  world: WorldState | null | undefined,
  kind: GlobalBoost["kind"],
  nowMs: number,
): GlobalBoost | null {
  const boosts = world?.globalBoosts ?? [];
  return (
    boosts.find(
      (boost) => boost.kind === kind && activeWindow(boost.activation, boost.expiry, nowMs),
    ) ?? null
  );
}

/** The live affinity multiplier, or null when no boost is running. */
export function affinityBoost(world: WorldState | null | undefined, nowMs: number): number | null {
  return liveBoost(world, "affinity", nowMs)?.multiplier ?? null;
}
