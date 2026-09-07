/** The order the game lists the progenitor elements in. */
export const PROGENITOR_ELEMENTS = [
  "Impact",
  "Heat",
  "Cold",
  "Electricity",
  "Toxin",
  "Magnetic",
  "Radiation",
];

export interface NemesisProgenitor {
  element: string;
  warframes: string[];
}

function elementRank(element: string): number {
  const index = PROGENITOR_ELEMENTS.indexOf(element);
  return index === -1 ? PROGENITOR_ELEMENTS.length : index;
}

/** The file is generated and optional: an unreadable row leaves the element
 *  unknown rather than naming a Warframe that does not roll it. */
export function createProgenitors(source?: unknown): NemesisProgenitor[] {
  if (!source || typeof source !== "object" || Array.isArray(source)) return [];
  const grouped = new Map<string, string[]>();
  for (const [name, element] of Object.entries(source as Record<string, unknown>)) {
    if (typeof element !== "string" || !element.trim() || !name.trim()) continue;
    const key = element.trim();
    const list = grouped.get(key);
    if (list) list.push(name);
    else grouped.set(key, [name]);
  }
  return [...grouped.entries()]
    .map(([element, warframes]) => ({
      element,
      warframes: warframes.sort((a, b) => a.localeCompare(b)),
    }))
    .sort(
      (a, b) =>
        elementRank(a.element) - elementRank(b.element) || a.element.localeCompare(b.element),
    );
}

// A glob rather than an import: the data build owns the file and it may not exist.
const loaded = import.meta.glob("../../../data/suggest/progenitors.json", { eager: true });

function shipped(): unknown {
  const module = Object.values(loaded)[0];
  if (!module || typeof module !== "object") return null;
  return (module as { default?: unknown }).default ?? module;
}

export const progenitors: NemesisProgenitor[] = createProgenitors(shipped());
