import { advances, masteryGain } from "./gain.js";
import type { MasteryData, MasteryStatus } from "../../types/inventory.js";

/** Whether the roster has this item finished. Selling or dissolving the gear
 *  never gives the XP back, so mastery answers "does the player still need one
 *  of these" where the inventory row alone cannot. A part-ranked or unlisted
 *  item is not finished: an unread roster is never "already done". */
export function createMasteryLookup(
  mastery: MasteryData | null | undefined,
): (uniqueName: string, name: string) => boolean {
  const byKey = new Map<string, MasteryStatus>();
  const remember = (key: string, status: MasteryStatus): void => {
    // One name can carry several rows; the finished one is the honest read.
    if (byKey.get(key) !== "mastered") byKey.set(key, status);
  };
  for (const item of mastery?.items ?? []) {
    if (!item.status) continue;
    if (item.uniqueName) remember(item.uniqueName, item.status);
    if (item.name) remember(item.name.toLowerCase(), item.status);
  }
  return (uniqueName, name) =>
    !advances(masteryGain(byKey.get(uniqueName) ?? byKey.get(name.toLowerCase())));
}
