import { QUEST_KEYCHAIN, readCompletedQuests } from "./plan/state.js";
import type { ItemDbEntry, RawInventoryData } from "../../../types/inventory.js";

/** Whether the quest a source row names is one the player has finished. */
export type QuestDone = (where: string) => boolean;

const LEADING_THE = /^the\s+/i;
/** A row naming a quest as what opens the farm rather than as what pays it out
 *  is only more available once the quest is done. */
const GATE_PHRASE = /\b(?:after completing|first complete)\b/i;

function questKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim()
    .replace(LEADING_THE, "");
}

function keychainsByName(itemDb: Record<string, ItemDbEntry>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [uniqueName, entry] of Object.entries(itemDb)) {
    if (!QUEST_KEYCHAIN.test(uniqueName) || typeof entry?.name !== "string") continue;
    const key = questKey(entry.name);
    if (!key) continue;
    const rows = out.get(key);
    if (rows) rows.push(uniqueName);
    else out.set(key, [uniqueName]);
  }
  return out;
}

/** The longest quest name the text spells out, so "Jade Shadows: Constellations"
 *  is never read as "Jade Shadows". */
function namedQuest(where: string, names: readonly string[]): string | null {
  const text = ` ${questKey(where)} `;
  let best: string | null = null;
  for (const name of names) {
    if (best !== null && name.length <= best.length) continue;
    if (text.includes(` ${name} `)) best = name;
  }
  return best;
}

/** Null when the payload carries no quest progress at all: that is unknown,
 *  never "nothing finished". */
export function createQuestDone(
  inventory: RawInventoryData | null,
  itemDb: Record<string, ItemDbEntry>,
): QuestDone | null {
  if (!Array.isArray(inventory?.QuestKeys)) return null;
  const finished = readCompletedQuests(inventory);
  const keychains = keychainsByName(itemDb ?? {});
  const names = [...keychains.keys()];
  const seen = new Map<string, boolean>();
  return (where) => {
    const known = seen.get(where);
    if (known !== undefined) return known;
    const name = GATE_PHRASE.test(where) ? null : namedQuest(where, names);
    const done =
      name !== null && (keychains.get(name) ?? []).every((uniqueName) => finished.has(uniqueName));
    seen.set(where, done);
    return done;
  };
}
