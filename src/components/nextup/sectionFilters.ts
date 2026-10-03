import { ACQUISITION_INCLUDES, ACQUISITION_NONE } from "../../lib/suggest/acquisition/kinds.js";
import { ACQUISITION_SOURCES } from "../../lib/suggest/acquisition/sources.js";
import {
  MASTERY_KINDS,
  RELIC_ERAS,
  TASK_KINDS,
  type SuggestionOptions,
  type SuggestionSectionId,
} from "../../types/suggest.js";

function narrowedList(picked: readonly string[], all: readonly string[]): boolean {
  return picked.length < all.length;
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
        options.acquisitionSources.includes(ACQUISITION_NONE) ||
        options.acquisitionSearch.trim().length > 0 ||
        (options.acquisitionKinds.length > 0 &&
          narrowedList(options.acquisitionKinds, ACQUISITION_INCLUDES)) ||
        (options.acquisitionSources.length > 0 &&
          narrowedList(options.acquisitionSources, ACQUISITION_SOURCES))
      );
    case "mods":
      return options.modSearch.trim().length > 0;
    case "arcanes":
      return options.arcaneSearch.trim().length > 0;
  }
}
