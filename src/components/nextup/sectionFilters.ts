import { ACQUISITION_INCLUDES, ACQUISITION_NONE } from "../../lib/suggest/acquisition/kinds.js";
import {
  MASTERY_KINDS,
  RELIC_ERAS,
  TASK_KINDS,
  type SuggestionOptions,
  type SuggestionSectionId,
} from "../../types/suggest.js";

/** Every list option reads an empty selection as "all", so a narrowing is a
 *  selection that is neither empty nor the whole list. */
function narrowedList(picked: readonly string[], all: readonly string[]): boolean {
  return picked.length > 0 && picked.length < all.length;
}

/** Whether the section's own controls are hiding anything, which is what tells
 *  the two empties apart: a section narrowed to nothing was emptied from
 *  controls that exist only while it is drawn, so it has to stay drawn for the
 *  player to undo it. An unnarrowed empty section has nothing to undo. */
export function sectionNarrowed(id: SuggestionSectionId, options: SuggestionOptions): boolean {
  switch (id) {
    case "tasks":
      return narrowedList(options.taskKinds, TASK_KINDS);
    case "relics":
      return narrowedList(options.relicEras, RELIC_ERAS);
    case "mastery":
      return narrowedList(options.masteryKinds, MASTERY_KINDS);
    case "acquisition":
      return (
        options.acquisitionKinds.includes(ACQUISITION_NONE) ||
        narrowedList(options.acquisitionKinds, ACQUISITION_INCLUDES)
      );
  }
}
