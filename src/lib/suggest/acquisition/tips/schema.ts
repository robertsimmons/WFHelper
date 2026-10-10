import type { PlanGroupType } from "../plan/schema.js";

/** Community knowledge about getting one item, kept apart from the plan's facts
 *  so a fact pass can never cut it. */

export const TIP_KINDS = ["tactic", "gotcha", "gear", "sentiment"] as const;

export type TipKind = (typeof TIP_KINDS)[number];

/** Strongest first: the order tips render in. */
export const TIP_CONSENSUS = ["unanimous", "common", "some", "single"] as const;

export type TipConsensus = (typeof TIP_CONSENSUS)[number];

export const DISPUTE_STATUSES = ["open", "confirmed", "dismissed"] as const;

export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/** The step a tip is about, matched by meaning rather than position, so a
 *  reordered or regenerated plan keeps it on the right step. */
export interface TipAnchor {
  route?: "afterQuest";
  group: PlanGroupType;
  /** A substring of the group's place. */
  place?: string;
  /** A substring of a row label in the group. */
  row?: string;
}

export interface Tip {
  /** Stable within the item's file and never reused. */
  id: string;
  text: string;
  kind: TipKind;
  consensus: TipConsensus;
  /** Null only for sentiment. */
  anchor: TipAnchor | null;
}

/** A tip the wiki was confirmed to contradict. It never renders; it keeps the
 *  same text from being written back. */
export interface RemovedTip {
  id: string;
  text: string;
  reason: string;
  wiki: string;
}

export interface TipsFile {
  name: string;
  tips: Tip[];
  removed: RemovedTip[];
}

/** A fact pass's claim that the wiki contradicts a tip. A claim, never a verdict. */
export interface TipDispute {
  item: string;
  tipId: string;
  claim: string;
  wiki: string;
  status: DisputeStatus;
}
