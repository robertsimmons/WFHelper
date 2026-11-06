// Typed shim over the generated table (scripts/suggest/build-modular-mastery.mjs
// writes the JSON from the bundled public export).
import data from "./modularMastery.json";

export interface ModularPiece {
  /** The part that awards the mastery. */
  uniqueName: string;
  /** Per slot, the part types one build takes one of. */
  slots: string[][];
  /** Gild blueprint the piece owes before it ranks for mastery. */
  gild?: string;
}

export interface GildCost {
  uniqueName: string;
  count: number;
}

export const MODULAR_PIECES = data.pieces as ModularPiece[];
/** Part type -> its buildable parts. */
export const MODULAR_PARTS = data.parts as Record<string, string[]>;
/** Gild blueprint -> what it costs. */
export const GILDS = data.gilds as Record<string, GildCost[]>;
/** Materials refined from a raw prospecting find. */
export const REFINED = new Set<string>(data.refined);
