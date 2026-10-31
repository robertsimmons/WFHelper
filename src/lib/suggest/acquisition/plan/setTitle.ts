const BLUEPRINT = /\bblueprint$/i;

interface SetRow {
  label: string;
  blueprint: boolean;
}

interface SetGroup {
  type: string;
  place: string;
  title?: string | null | undefined;
  rows: readonly SetRow[];
}

/** What a collapsed set's line reads, before translation. */
type SetTitle =
  | { kind: "titled"; title: string; vendor: string | null }
  | { kind: "buyBlueprints" | "buy"; vendor: string }
  | { kind: "buildParts" }
  | { kind: "buildPartsThen"; item: string };

/** A vendor, foundry or craft step over two or more rows reads as one counted line. */
export function isPartSet(group: { type: string; rows: readonly unknown[] }): boolean {
  const kind = group.type === "vendor" || group.type === "foundry" || group.type === "craft";
  return kind && group.rows.length > 1;
}

/** "HOK, CETUS" sells as Hok: the vendor is the place before its first comma. */
const setVendor = (place: string): string => place.split(",")[0].trim();

export function setTitle(group: SetGroup, itemName: string): SetTitle {
  const vendor = group.type === "vendor" ? setVendor(group.place) : null;
  if (group.title) return { kind: "titled", title: group.title, vendor };
  if (vendor !== null) {
    const blueprints = group.rows.every((row) => row.blueprint || BLUEPRINT.test(row.label));
    return { kind: blueprints ? "buyBlueprints" : "buy", vendor };
  }
  const item = itemName.toLowerCase();
  return group.rows.some((row) => row.label.toLowerCase() === item)
    ? { kind: "buildPartsThen", item: itemName }
    : { kind: "buildParts" };
}

/** Two sets reading the same title collide; case and the vendor's spelling aside. */
export function setTitleKey(title: SetTitle): string {
  return JSON.stringify(title).toLowerCase();
}
