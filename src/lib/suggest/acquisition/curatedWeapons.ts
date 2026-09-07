import { createCurated, type CuratedLookup } from "./curated.js";

// A glob rather than an import: the data build owns the file and it may not exist.
const loaded = import.meta.glob("../../../data/suggest/weapons.json");

let lookup: CuratedLookup = createCurated(undefined);

/** A sixth of a megabyte of rows for one fallback bonus range, so it is fetched
 *  beside the view rather than inside its chunk. The load starts the moment the
 *  feed's module graph does, and the only caller is a modal the player has to
 *  open, so it has always landed by the time an entry is asked for. */
function preload(): void {
  const open = Object.values(loaded)[0];
  if (!open) return;
  void open()
    .then((module) => {
      const raw = module && typeof module === "object" ? (module as { default?: unknown }) : null;
      lookup = createCurated(raw?.default ?? module);
    })
    .catch(() => undefined);
}

preload();

export const curatedWeapon: CuratedLookup = (name) => lookup(name);
