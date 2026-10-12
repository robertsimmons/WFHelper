import { baseMapKey } from "./registry.js";

export interface MapPin {
  id: string;
  /** On the wiki grid, origin bottom-left. */
  position: [number, number];
  kind: string;
  label: string;
  refs: string[];
  note: string | null;
}

/** A pin with the needed names it serves, in the order the needs list them. */
export interface PlacedPin {
  pin: MapPin;
  refs: string[];
}

const loaded = import.meta.glob("../../data/maps/pins/*.json", { eager: true });

function contents(module: unknown): unknown {
  return (module as { default?: unknown }).default ?? module;
}

function readPin(value: unknown): MapPin | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const position = raw.position;
  if (typeof raw.id !== "string" || typeof raw.kind !== "string") return null;
  if (!Array.isArray(position) || position.length !== 2) return null;
  const [x, y] = position as unknown[];
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Array.isArray(raw.refs)) return null;
  return {
    id: raw.id,
    position: [x, y],
    kind: raw.kind,
    label: typeof raw.label === "string" ? raw.label : "",
    refs: raw.refs.filter((ref): ref is string => typeof ref === "string"),
    note: typeof raw.note === "string" && raw.note !== "" ? raw.note : null,
  };
}

/** A pin file is named `<category>-<mapKey>.json`; a place inside a base map
 *  shares that map's grid, so its pins join the base map's. */
function pinsByMap(files: Record<string, unknown>): Map<string, MapPin[]> {
  const out = new Map<string, MapPin[]>();
  const entries = Object.entries(files).sort(([left], [right]) => left.localeCompare(right));
  for (const [path, module] of entries) {
    const file = path.slice(path.lastIndexOf("/") + 1).replace(/\.json$/, "");
    const dash = file.indexOf("-");
    if (dash < 0) continue;
    const key = file.slice(dash + 1);
    const target = baseMapKey(key) ?? key;
    const raw = contents(module);
    const pins = Array.isArray(raw)
      ? raw.map(readPin).filter((pin): pin is MapPin => pin !== null)
      : [];
    out.set(target, [...(out.get(target) ?? []), ...pins]);
  }
  return out;
}

const SHIPPED = pinsByMap(loaded);

export function mapPins(key: string): MapPin[] {
  const target = baseMapKey(key);
  return target ? (SHIPPED.get(target) ?? []) : [];
}

/** Pin counts per kind for each needed name the placed pins serve. */
export function pinKinds(placed: readonly PlacedPin[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const { pin, refs } of placed) {
    for (const name of refs) {
      const counts = out.get(name) ?? new Map<string, number>();
      counts.set(pin.kind, (counts.get(pin.kind) ?? 0) + 1);
      out.set(name, counts);
    }
  }
  return out;
}

/** How a need reads in the sidebar: the first kind here that it has a pin of. */
const KIND_PRIORITY = ["mining", "fishing", "resource"];

const kindRank = (kind: string): number => {
  const rank = KIND_PRIORITY.indexOf(kind);
  return rank < 0 ? KIND_PRIORITY.length : rank;
};

/** A need's pin kinds, most telling first. */
export function orderedKinds(counts: ReadonlyMap<string, number>): string[] {
  return [...counts.keys()].sort((left, right) => kindRank(left) - kindRank(right));
}

const DRAW_ORDER: Readonly<Record<string, number>> = {
  mining: 0,
  resource: 1,
  fishing: 2,
};

/** More slices than this stop reading as colours on a pin a dozen pixels wide. */
export const MAX_PIN_FILLS = 4;

const UNCOLORED = "#8d9ab3";

/** The fills one pin draws as slices, and whether refs went undrawn. A kind
 *  colour, when given for the pin's kind, paints the whole pin. */
export function pinFills(
  placed: PlacedPin,
  colors: Readonly<Record<string, string>>,
  kindColors?: Readonly<Record<string, string>>,
): { fills: string[]; more: boolean } {
  const kindColor = kindColors?.[placed.pin.kind];
  if (kindColor) return { fills: [kindColor], more: false };
  const fills = placed.refs.slice(0, MAX_PIN_FILLS).map((ref) => colors[ref] ?? UNCOLORED);
  return { fills, more: placed.refs.length > MAX_PIN_FILLS };
}

/** Screen pixels a pin sharing its spot moves out from it, at any zoom. */
const FAN_RADIUS = 9;

/** Screen offset per pin id for pins that share an exact position, spread
 *  evenly round a circle from the left so each stays visible and hoverable.
 *  A pin alone at its spot gets no entry. */
export function fanOffsets(placed: readonly PlacedPin[]): Map<string, [number, number]> {
  const groups = new Map<string, string[]>();
  for (const { pin } of placed) {
    const key = `${pin.position[0]},${pin.position[1]}`;
    groups.set(key, [...(groups.get(key) ?? []), pin.id]);
  }
  const out = new Map<string, [number, number]>();
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const step = (2 * Math.PI) / ids.length;
    ids.forEach((id, index) => {
      const angle = Math.PI + index * step;
      out.set(id, [FAN_RADIUS * Math.cos(angle), FAN_RADIUS * Math.sin(angle)]);
    });
  }
  return out;
}

const drawRank = (kind: string): number => DRAW_ORDER[kind] ?? 1;

/** Only pins that serve a needed name, mining areas drawn first so a harvest
 *  pin on top of one stays clickable. */
export function pinsForNeeds(pins: readonly MapPin[], names: readonly string[]): PlacedPin[] {
  const wanted = names.map((name) => name.trim().toLowerCase());
  return pins
    .map((pin) => {
      const refs = new Set(pin.refs.map((ref) => ref.trim().toLowerCase()));
      return { pin, refs: names.filter((_, index) => refs.has(wanted[index])) };
    })
    .filter((placed) => placed.refs.length > 0)
    .sort((left, right) => drawRank(left.pin.kind) - drawRank(right.pin.kind));
}
