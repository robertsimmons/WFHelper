import { TIP_CONSENSUS, type Tip, type TipDispute, type TipsFile } from "./schema.js";

const loaded = import.meta.glob("../../../../data/suggest/acquisitionTips/*.json", {
  eager: true,
});

function contents(module: unknown): unknown {
  return (module as { default?: unknown }).default ?? module;
}

const DISPUTES_FILE = "/disputes.json";

const entries = Object.entries(loaded).sort(([left], [right]) => left.localeCompare(right));

const SHIPPED: TipsFile[] = entries
  .filter(([path]) => !path.endsWith(DISPUTES_FILE))
  .map(([, module]) => contents(module) as TipsFile);

const DISPUTES: TipDispute[] = entries
  .filter(([path]) => path.endsWith(DISPUTES_FILE))
  .flatMap(([, module]) => contents(module) as TipDispute[]);

function key(name: string): string {
  return name.trim().toLowerCase();
}

const BY_NAME = new Map(SHIPPED.map((file) => [key(file.name), file]));

/** A live tip as it renders: an open dispute travels with it. */
export interface ItemTip extends Tip {
  dispute: { claim: string; wiki: string } | null;
}

export type TipsLookup = (name: string) => ItemTip[];

export function tipsFiles(): TipsFile[] {
  return [...SHIPPED];
}

export function tipDisputes(): TipDispute[] {
  return [...DISPUTES];
}

export function tipsFile(name: string): TipsFile | null {
  return BY_NAME.get(key(name)) ?? null;
}

const STRENGTH = new Map<string, number>(TIP_CONSENSUS.map((level, index) => [level, index]));

/** Strongest first; file order breaks ties. */
export function byStrength<T extends Pick<Tip, "consensus">>(tips: readonly T[]): T[] {
  return [...tips].sort(
    (left, right) => (STRENGTH.get(left.consensus) ?? 0) - (STRENGTH.get(right.consensus) ?? 0),
  );
}

/** Every live tip for an item, each with its open dispute. Empty for an item
 *  nobody has written tips for. */
export function itemTips(
  file: TipsFile | null,
  disputes: readonly TipDispute[] = DISPUTES,
): ItemTip[] {
  if (!file) return [];
  const item = key(file.name);
  const open = new Map(
    disputes
      .filter((entry) => entry.status === "open" && key(entry.item) === item)
      .map((entry) => [entry.tipId, entry]),
  );
  return file.tips.map((tip) => {
    const dispute = open.get(tip.id);
    return { ...tip, dispute: dispute ? { claim: dispute.claim, wiki: dispute.wiki } : null };
  });
}

export const tipsFor: TipsLookup = (name) => itemTips(tipsFile(name));
