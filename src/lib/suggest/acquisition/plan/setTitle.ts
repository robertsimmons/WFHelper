const BLUEPRINT = /\bblueprint$/i;

export interface SetRow {
  label: string;
  blueprint: boolean;
  /** The syndicate a rank-up row ranks, null for anything else. */
  rankUp?: string | null;
  /** An item a rank-up sacrifices. */
  sacrifice?: boolean;
}

interface SetGroup {
  type: string;
  place: string;
  title?: string | null | undefined;
  rows: readonly SetRow[];
}

/** What a bought set holds, before translation: rank-ups, the plan item's own
 *  parts, or a family of other items named by the words they share. */
export type SetGoods =
  | { kind: "rankUps"; name: string }
  | { kind: "blueprints" | "parts"; name: string };

/** What a collapsed set's line reads, before translation. */
type SetTitle =
  | { kind: "titled"; title: string; vendor: string | null }
  | { kind: "buy"; vendor: string; goods: SetGoods[] }
  | { kind: "buildParts" }
  | { kind: "buildPartsThen"; item: string };

/** A vendor, foundry or craft step over two or more rows reads as one counted line. */
export function isPartSet(group: { type: string; rows: readonly unknown[] }): boolean {
  const kind = group.type === "vendor" || group.type === "foundry" || group.type === "craft";
  return kind && group.rows.length > 1;
}

/** "HOK, CETUS" sells as Hok: the vendor is the place before its first comma. */
const setVendor = (place: string): string => place.split(",")[0].trim();

const isBlueprint = (row: SetRow): boolean => row.blueprint || BLUEPRINT.test(row.label);

/** The trailing words every label shares: "Zymos Barrel Blueprint" and
 *  "Trumna Barrel Blueprint" share "Barrel Blueprint". */
function sharedTail(labels: readonly string[]): string {
  const words = labels.map((label) => label.trim().split(/\s+/).reverse());
  const tail: string[] = [];
  for (let index = 0; words.every((list) => index < list.length - 1); index++) {
    const word = words[0][index];
    if (!words.every((list) => list[index].toLowerCase() === word.toLowerCase())) break;
    tail.unshift(word);
  }
  return tail.join(" ");
}

/** A family of other items: their shared words, blueprints when they are blueprints. */
function family(rows: readonly SetRow[]): SetGoods {
  const tail = rows.length > 1 ? sharedTail(rows.map((row) => row.label)) : rows[0].label;
  const name = tail.replace(BLUEPRINT, "").trim() || rows.map((row) => row.label).join(" + ");
  return { kind: rows.every(isBlueprint) ? "blueprints" : "parts", name };
}

/** What the rows buy: each syndicate's rank-ups, the items a rank-up sacrifices,
 *  and the rest as the plan item's own blueprints or parts. */
export function setGoods(rows: readonly SetRow[], itemName: string): SetGoods[] {
  const ranks = [...new Set(rows.flatMap((row) => (row.rankUp ? [row.rankUp] : [])))];
  const sacrifices = rows.filter((row) => !row.rankUp && row.sacrifice);
  const own = rows.filter((row) => !row.rankUp && !row.sacrifice);
  return [
    ...(ranks.length > 0 ? [{ kind: "rankUps", name: ranks.join(" + ") } as const] : []),
    ...(sacrifices.length > 0 ? [family(sacrifices)] : []),
    ...(own.length > 0
      ? [{ kind: own.every(isBlueprint) ? "blueprints" : "parts", name: itemName } as const]
      : []),
  ];
}

export function setTitle(group: SetGroup, itemName: string): SetTitle {
  const vendor = group.type === "vendor" ? setVendor(group.place) : null;
  if (group.title) return { kind: "titled", title: group.title, vendor };
  if (vendor !== null) return { kind: "buy", vendor, goods: setGoods(group.rows, itemName) };
  const item = itemName.toLowerCase();
  return group.rows.some((row) => row.label.toLowerCase() === item)
    ? { kind: "buildPartsThen", item: itemName }
    : { kind: "buildParts" };
}

/** Two sets reading the same title collide; case and the vendor's spelling aside. */
export function setTitleKey(title: SetTitle): string {
  return JSON.stringify(title).toLowerCase();
}
