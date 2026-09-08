import { ownedComponentCount } from "../../../../config/shared/componentNames.js";
import { resolveRewardUniqueName } from "../../bountyRewards.js";
import { buildOwnership, ownsItem, unbuiltResourceNeed } from "../acquisition/parts.js";
import { FULL_GAIN, NO_GAIN, leastGain, masteryGain } from "../gain.js";
import { NIGHTWAVE_ACTIVITY } from "../preferences.js";
import { rewardValue } from "../rewards.js";
import { clamp01 } from "../score.js";
import { UNPLACED_WORTH, ladderWorth, normalizeName } from "../worthLadder.js";
import { DEFAULT_NIGHTWAVE_STOCK, NIGHTWAVE_STAPLES } from "../../../types/suggest.js";
import type { MessageKey } from "../../i18n.js";
import type {
  ItemDbEntry,
  MasteryData,
  MasteryStatus,
  RawInventoryData,
} from "../../../types/inventory.js";
import type {
  LadderGroup,
  SuggestionContext,
  SuggestionDraft,
  SuggestionProvider,
  WhySegment,
} from "../../../types/suggest.js";

/** Nobody publishes the weekly Cred rotation, so this provider only ever speaks
 *  about the always-available tier, which needs no rotation to be true. */

const WHY_STOCK: MessageKey = "nextUp.whyNightwaveStock";
const WHY_CRED: MessageKey = "nextUp.whyNightwaveCred";
const WHY_CRED_EACH: MessageKey = "nextUp.whyNightwaveCredEach";
const WHY_PARTS: MessageKey = "nextUp.whyAcqParts";

type StapleKey = (typeof NIGHTWAVE_STAPLES)[number];

/** The wiki page the whole shop reads off. */
const WIKI = "Nightwave";

/** One always-available offering, at the price Nora charges for it. */
interface StapleOffer {
  id: string;
  /** Normalized name, which is how the keep-on-hand levels are keyed. */
  key: StapleKey;
  name: string;
  /** Copies one purchase grants. */
  bundle: number;
  cred: number;
}

const STAPLES: readonly StapleOffer[] = [
  { id: "catalyst", key: "orokin catalyst", name: "Orokin Catalyst", bundle: 1, cred: 75 },
  { id: "reactor", key: "orokin reactor", name: "Orokin Reactor", bundle: 1, cred: 75 },
  { id: "nitain", key: "nitain extract", name: "Nitain Extract", bundle: 5, cred: 15 },
];

/** The gear in the shop rather than the stock: Creds are the only route to it,
 *  which is a wait to plan around rather than a farm to start. */
interface PartsOffer {
  id: string;
  /** Ladder entry, in the filler group, so the player can move it. */
  entry: string;
  titleKey: MessageKey;
  /** One entry per part, each key either an item-database name or a uniqueName
   *  path, which is the only handle on a part no export names at all. Several
   *  keys stand for one part: a recipe is named after the thing it builds, which
   *  is not always the shop's wording. */
  parts: readonly (readonly string[])[];
  /** Price of one part. */
  cred: number;
  /** What the parts build, which is what the card pictures. */
  builds: string;
  /** Where no database name spells `builds`. */
  buildsUniqueName?: string;
  wiki: string;
}

/** The Nightwave landing craft. Its own name in the item database is just
 *  "Nightwave", which several other things could answer to. */
const NORA_SHIP = "/Lotus/Types/Items/Ships/NoraShip";

/** Its four parts. No DE export names them, so the item database holds no entry
 *  to look up: these paths are DE's own, out of the image manifest, and they are
 *  what the inventory rows carry. The blueprint is the part the shop sells; the
 *  component is what the foundry turns it into. */
const NORA_SHIP_RECIPES = "/Lotus/Types/Recipes/LandingCraftRecipes/NightwaveShip";

/** A landing craft carries productCategory "Ships", which is the inventory
 *  slice it lands in, and neither the component read nor `buildBaroOwnedSet`
 *  covers that one. */
const SHIPS = "Ships";

const PARTS_OFFERS: readonly PartsOffer[] = [
  {
    id: "vauban",
    entry: "Vauban parts",
    titleKey: "nextUp.nightwaveVaubanParts",
    parts: [["Vauban Chassis"], ["Vauban Neuroptics"], ["Vauban Systems"]],
    cred: 25,
    builds: "Vauban",
    wiki: "Vauban",
  },
  {
    id: "landingCraft",
    entry: "Nightwave landing craft parts",
    titleKey: "nextUp.nightwaveCraftParts",
    // Four parts, not three: the craft's own blueprint is bought like a segment.
    parts: [
      [`${NORA_SHIP_RECIPES}/NoraShipBlueprint`],
      [
        `${NORA_SHIP_RECIPES}/NoraShipAvionicsBlueprint`,
        `${NORA_SHIP_RECIPES}/NoraShipAvionicsComponent`,
      ],
      [
        `${NORA_SHIP_RECIPES}/NoraShipEnginesBlueprint`,
        `${NORA_SHIP_RECIPES}/NoraShipEnginesComponent`,
      ],
      [
        `${NORA_SHIP_RECIPES}/NoraShipFuselageBlueprint`,
        `${NORA_SHIP_RECIPES}/NoraShipFuselageComponent`,
      ],
    ],
    cred: 35,
    // The item database's own name for the craft, so its art resolves by name
    // as well as by path; the card's own wording comes from its title key.
    builds: "Nightwave",
    buildsUniqueName: NORA_SHIP,
    wiki: "Nightwave",
  },
];

/** `SuggestionDetails` carries no field for structured rows, so the provider
 *  parks what it computed here and the card reads it back by suggestion id. */
export interface NightwaveOfferRow {
  /** Normalized name, as the keep-on-hand levels and the ladder key it. */
  key: string;
  /** English name, for the itemDb join; `displayName` is what renders. */
  name: string;
  displayName?: string | undefined;
  uniqueName?: string | undefined;
  /** Stock the player keeps on hand, or parts of a set already bought. */
  kind: "stock" | "parts";
  /** Copies in hand; null when no inventory has been read. */
  held: number | null;
  /** The keep-on-hand level, or how many parts the set takes. */
  level: number;
  /** Cred price: of one purchase for stock, of one part for a set. */
  cred: number;
  /** Copies one purchase grants. */
  bundle: number;
}

const rows = new Map<string, NightwaveOfferRow>();

function setRow(id: string, row: NightwaveOfferRow): void {
  rows.set(id, row);
}

/** Null for any suggestion that is not a Cred offering. */
export function nightwaveRowFor(id: string): NightwaveOfferRow | null {
  return rows.get(id) ?? null;
}

function entryFor(
  name: string,
  itemDb: Record<string, ItemDbEntry>,
): { uniqueName: string; entry: ItemDbEntry } | null {
  const uniqueName = resolveRewardUniqueName(name, itemDb);
  const entry = uniqueName ? itemDb[uniqueName] : undefined;
  return uniqueName && entry ? { uniqueName, entry } : null;
}

function masteryStatusOf(mastery: MasteryData | null, name: string): MasteryStatus | undefined {
  const needle = name.toLowerCase();
  return mastery?.items.find((item) => item.name.toLowerCase() === needle)?.status;
}

function credSegment(
  offer: { cred: number },
  each: boolean,
  t: SuggestionContext["t"],
): WhySegment {
  return { text: t(each ? WHY_CRED_EACH : WHY_CRED, { cred: String(offer.cred) }) };
}

/** What the player holds of a staple: the item, plus any blueprint for it, which
 *  is a catalyst the foundry has not cooked yet rather than none at all. Null is
 *  an unread inventory, which is never "the player has none". */
function heldCount(
  offer: StapleOffer,
  itemDb: Record<string, ItemDbEntry>,
  ownership: Map<string, number>,
): number | null {
  if (ownership.size === 0) return null;
  const item = entryFor(offer.name, itemDb);
  const blueprint = entryFor(`${offer.name} Blueprint`, itemDb);
  if (!item && !blueprint) return null;
  return (
    (item ? ownedComponentCount(item.uniqueName, ownership) : 0) +
    (blueprint ? ownedComponentCount(blueprint.uniqueName, ownership) : 0)
  );
}

/** Nothing new has called for Nitain in years, so being out of it is only urgent
 *  while something the player has not built still asks for it. Null before the
 *  acquisition sweep has run, which is not the same as nothing needing it. */
function nitainStillNeeded(itemDb: Record<string, ItemDbEntry>): boolean | null {
  const need = unbuiltResourceNeed();
  if (!need) return null;
  const item = entryFor("Nitain Extract", itemDb);
  if (!item) return null;
  return (need.get(item.uniqueName) ?? 0) > 0;
}

const NITAIN: StapleKey = "nitain extract";

function groupFor(offer: StapleOffer, held: number, nitainNeeded: boolean | null): LadderGroup {
  if (held > 0) return "useful";
  if (offer.key === NITAIN && nitainNeeded === false) return "useful";
  return "must";
}

function stockDraft(
  offer: StapleOffer,
  ctx: SuggestionContext,
  ownership: Map<string, number>,
  nitainNeeded: boolean | null,
  low: boolean,
): SuggestionDraft | null {
  const { prefs, itemDb, t } = ctx;
  const level = prefs.nightwaveStock[offer.key] ?? DEFAULT_NIGHTWAVE_STOCK;
  if (level <= 0) return null;
  const held = heldCount(offer, itemDb, ownership);
  if (held === null || held >= level) return null;

  const item = entryFor(offer.name, itemDb);
  const short: WhySegment = {
    text: t(WHY_STOCK, { held: String(held), level: String(level) }),
    ...(held === 0 ? { tone: "bad" as const } : {}),
  };
  const segments = [short, credSegment(offer, false, t)];
  const id = `nightwave:${offer.id}`;
  setRow(id, {
    key: offer.key,
    name: offer.name,
    ...(item?.entry.displayName ? { displayName: item.entry.displayName } : {}),
    ...(item ? { uniqueName: item.uniqueName } : {}),
    kind: "stock",
    held,
    level,
    cred: offer.cred,
    bundle: offer.bundle,
  });
  return {
    id,
    category: "vendor",
    title: item?.entry.displayName ?? item?.entry.name ?? offer.name,
    why: segments.map((segment) => segment.text).join(", "),
    whySegments: segments,
    reward: { name: offer.name, ...(item ? { uniqueName: item.uniqueName } : {}) },
    signals: {
      value: ladderWorth(groupFor(offer, held, nitainNeeded), offer.key),
      // A Cred purchase costs nothing once the acts are done, and effort orders
      // nothing regardless.
      effort: 0,
      urgency: 0,
      gain: clamp01((level - held) / level),
    },
    // Every copy bought or spent changes the shortfall, so a dismissal lifts as
    // soon as the pile moves.
    fingerprint: `${offer.key}|${held}/${level}`,
    deprioritized: low,
    progress: { current: held, required: level },
    wiki: WIKI,
  };
}

/** Parts of a set already in hand; null when nothing can name a part, which is
 *  unknown rather than none. Building the set consumes them, so a count of none
 *  says nothing on its own about whether the thing is already built. */
function partsHeld(
  offer: PartsOffer,
  itemDb: Record<string, ItemDbEntry>,
  ownership: Map<string, number>,
): number | null {
  if (ownership.size === 0) return null;
  let held = 0;
  for (const part of offer.parts) {
    const keys = partKeys(part, itemDb);
    if (keys.length === 0) return null;
    if (keys.some((key) => ownedComponentCount(key, ownership) > 0)) held += 1;
  }
  return held;
}

/** Every uniqueName that proves one part is in hand: the part itself, and the
 *  blueprint either side of it, since a bought blueprint the foundry has not
 *  cooked yet is a part the player holds rather than one still to buy. */
function partKeys(part: readonly string[], itemDb: Record<string, ItemDbEntry>): string[] {
  const keys = new Set<string>();
  for (const key of part) {
    const uniqueName = key.startsWith("/") ? key : entryFor(key, itemDb)?.uniqueName;
    if (!uniqueName) continue;
    keys.add(uniqueName);
    const entry = itemDb[uniqueName];
    if (entry?.recipe?.blueprintUniqueName) keys.add(entry.recipe.blueprintUniqueName);
    if (entry?.buildsProduct) keys.add(entry.buildsProduct);
  }
  return [...keys];
}

function builtFor(
  offer: PartsOffer,
  itemDb: Record<string, ItemDbEntry>,
): { uniqueName: string; entry: ItemDbEntry } | null {
  if (!offer.buildsUniqueName) return entryFor(offer.builds, itemDb);
  const entry = itemDb[offer.buildsUniqueName];
  return entry ? { uniqueName: offer.buildsUniqueName, entry } : null;
}

/** Whether the finished thing is already in hand: built gear for a frame, and
 *  the ships slice for a landing craft, which no shared read reaches. */
function ownsBuilt(
  uniqueName: string,
  inventory: RawInventoryData | null,
  ownership: Map<string, number>,
): boolean {
  if (ownsItem(uniqueName, ownership)) return true;
  const rows = inventory?.[SHIPS];
  return (
    Array.isArray(rows) &&
    rows.some((row) => (row as { ItemType?: unknown })?.ItemType === uniqueName)
  );
}

function partsDraft(
  offer: PartsOffer,
  ctx: SuggestionContext,
  ownership: Map<string, number>,
  low: boolean,
): SuggestionDraft | null {
  const { itemDb, mastery, prefs, t } = ctx;
  const built = builtFor(offer, itemDb);
  const held = partsHeld(offer, itemDb, ownership);
  const total = offer.parts.length;
  const gain = leastGain(
    built && ownsBuilt(built.uniqueName, ctx.inventory, ownership) ? NO_GAIN : FULL_GAIN,
    masteryGain(masteryStatusOf(mastery, offer.builds)),
    held !== null && held >= total ? NO_GAIN : FULL_GAIN,
  );
  if (gain <= NO_GAIN) return null;

  const missing = held === null ? total : total - held;
  const segments = [
    { text: t(WHY_PARTS, { missing: String(missing), total: String(total) }) },
    credSegment(offer, true, t),
  ];
  const id = `nightwave:${offer.id}`;
  setRow(id, {
    key: normalizeName(offer.entry),
    name: offer.entry,
    ...(built ? { uniqueName: built.uniqueName } : {}),
    kind: "parts",
    held,
    level: total,
    cred: offer.cred,
    bundle: 1,
  });
  return {
    id,
    category: "vendor",
    title: t(offer.titleKey),
    why: segments.map((segment) => segment.text).join(", "),
    whySegments: segments,
    reward: { name: offer.builds, ...(built ? { uniqueName: built.uniqueName } : {}) },
    signals: {
      value: rewardValue(prefs, offer.entry) ?? UNPLACED_WORTH,
      effort: 0,
      urgency: 0,
      gain,
    },
    fingerprint: `${offer.id}|${held ?? "?"}/${total}`,
    deprioritized: low,
    ...(held === null ? {} : { progress: { current: held, required: total } }),
    wiki: offer.wiki,
  };
}

export const nightwaveProvider: SuggestionProvider = {
  id: "nightwave",

  collect(ctx: SuggestionContext): SuggestionDraft[] {
    // The rows only ever stand for the cards this pass produced.
    rows.clear();
    const activity = ctx.prefs.activities[NIGHTWAVE_ACTIVITY] ?? "normal";
    if (activity === "never") return [];
    const low = activity === "low";
    const ownership = buildOwnership(ctx.inventory, ctx.itemDb);
    const nitainNeeded = nitainStillNeeded(ctx.itemDb);
    const drafts: SuggestionDraft[] = [];
    for (const offer of STAPLES) {
      const draft = stockDraft(offer, ctx, ownership, nitainNeeded, low);
      if (draft) drafts.push(draft);
    }
    for (const offer of PARTS_OFFERS) {
      const draft = partsDraft(offer, ctx, ownership, low);
      if (draft) drafts.push(draft);
    }
    return drafts;
  },
};
