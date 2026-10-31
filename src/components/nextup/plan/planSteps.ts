import { formatNumber } from "../../../lib/format.js";
import type { Translator } from "../../../lib/i18n.js";
import type {
  ItemTip,
  PlanLiveState,
  ResolvedGroup,
  ResolvedPlan,
  ResolvedRow,
} from "../../../lib/suggest/acquisition/plan/index.js";
import type { PlanDisclosure } from "../../../lib/suggest/acquisition/plan/schema.js";
import type { ResolvedOwed, ResolvedSpend } from "../../../lib/suggest/acquisition/plan/types.js";

export type PlanStepState =
  | { kind: "done" }
  | { kind: "ready" }
  /** `have` is null where nothing the app reads holds the balance. */
  | { kind: "count"; have: number | null; need: number; label: string | null }
  | { kind: "live"; text: string; tone: PlanLiveState };

/** `done` is a bought blueprint already held; `warn` a rank still to reach. */
export interface PlanStepTag {
  text: string;
  tone: "done" | "warn" | null;
}

export interface PlanStepRow {
  key: string;
  /** Every plan row this line stands for; a merged line ticks them together. */
  ids: string[];
  label: string;
  value: string | null;
  done: boolean;
  /** A rank-up pick still to reach reads as the reward, one already spent as its price. */
  pick: "reward" | "spent" | null;
  /** What buying the row takes: its price and the rank the vendor wants. */
  tags: PlanStepTag[];
  /** The plan file's own words on the row, which ride under it. */
  notes: string[];
}

export interface PlanStepAlt {
  id: string;
  label: string;
  text: string;
  /** An alternative with a price the ledger counts, which the player can take. */
  offer: boolean;
  taken: boolean;
}

/** A row the step's title already says, kept so the plan page can still tick it. */
export interface PlanStepFold {
  id: string;
  label: string;
  done: boolean;
}

export interface PlanStep {
  id: string;
  title: string;
  where: string | null;
  tags: string[];
  state: PlanStepState | null;
  done: boolean;
  /** Why a step the player has covered another way no longer applies. */
  skip: string | null;
  /** The rows the title already says, which the step's own tick answers. */
  folded: { rows: PlanStepFold[]; done: boolean; notes: string[] } | null;
  rows: PlanStepRow[];
  alts: PlanStepAlt[];
  map: { key: string; ready: boolean } | null;
  conditions: string[];
  bonuses: string[];
  tips: ItemTip[];
  disclosures: PlanDisclosure[];
}

/** What the plan page wires into the steps; the modal passes none. */
export interface PlanStepControls {
  onToggleDone: (rowIds: readonly string[], done: boolean) => void;
  onTakeAlt: (rowId: string) => void;
  onOpenMap: (map: string) => void;
}

interface StepOptions {
  t: Translator;
  /** What the card knows about the foundry when the plan lists no materials. */
  buildable?: boolean | undefined;
}

const STANDING = /standing$/i;
const BLUEPRINT = /\s+blueprint$/i;
const QUEST = /\s+quest$/i;

const isMaterialGroup = (group: ResolvedGroup): boolean => group.id.startsWith("m");
const isBuild = (group: ResolvedGroup): boolean =>
  group.type === "foundry" || (group.type === "craft" && !isMaterialGroup(group));

/** "ROKY, FORTUNA" reads as "Roky, Fortuna"; a token carrying a digit is a code. */
export function placeName(place: string): string {
  return place
    .split(/(\s+)/)
    .map((word) =>
      /\d/.test(word) || word.trim() === ""
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join("");
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function priceText(currency: string, value: number, t: Translator): string {
  const amount = formatNumber(value);
  return STANDING.test(currency)
    ? t("nextUp.planPickStanding", { amount })
    : `${amount} ${currency}`;
}

function spendsText(spends: readonly (ResolvedSpend | ResolvedOwed)[], t: Translator): string {
  return spends.map((spend) => priceText(spend.currency, spend.value, t)).join(", ");
}

function flowCurrencies(group: ResolvedGroup): Set<string> {
  const names = new Set<string>();
  for (const spend of group.spends) names.add(spend.currency.toLowerCase());
  for (const row of group.rows) {
    for (const owed of row.owes ?? []) names.add(owed.currency.toLowerCase());
  }
  for (const owed of group.owes ?? []) names.add(owed.currency.toLowerCase());
  return names;
}

/** A group that banks a currency reads before the first group that spends it,
 *  whatever order the plan file lists them in. */
export function displayOrder(groups: readonly ResolvedGroup[]): ResolvedGroup[] {
  const out = [...groups];
  for (const earner of groups) {
    const earns = earner.earns;
    if (!earns) continue;
    const names = [earns.currency, earns.ledger ?? earns.currency].map((name) =>
      name.toLowerCase(),
    );
    const at = out.indexOf(earner);
    const spender = out.findIndex((group, index) => {
      if (index >= at || group === earner) return false;
      const spent = flowCurrencies(group);
      return names.some((name) => spent.has(name));
    });
    if (spender === -1) continue;
    out.splice(at, 1);
    out.splice(spender, 0, earner);
  }
  return out;
}

/** What PlanRow prints for a rank-up pick: the reward still ahead, or its price. */
export function pickText(row: ResolvedRow, t: Translator): string | null {
  if (!row.pick) return null;
  return row.pick.state === "spent" ? spendsText(row.pick.spends, t) : t("nextUp.planPickReward");
}

/** "Feverspine Blueprint" on the Feverspine plan is just its blueprint. */
function shortLabel(label: string, planName: string): string {
  const prefix = `${planName.toLowerCase()} `;
  if (!label.toLowerCase().startsWith(prefix)) return label;
  return capitalized(label.slice(prefix.length).trim()) || label;
}

function quantityText(row: ResolvedRow): string | null {
  const qty = row.qty;
  if (!qty) return null;
  if (qty.tracked && !row.done) {
    return `${formatNumber(Math.min(qty.owned, qty.required))} / ${formatNumber(qty.required)}`;
  }
  return formatNumber(row.done ? qty.required : qty.remaining);
}

interface RowDraft extends PlanStepRow {
  priced: boolean;
}

/** A material's price rides beside its count; any other row's price is its value.
 *  The plan page shows every row's price as a tag. */
export function purchaseTags(row: ResolvedRow, withPrice: boolean, t: Translator): PlanStepTag[] {
  const purchase = row.purchase;
  if (!purchase) return [];
  const tags: PlanStepTag[] = [];
  if (withPrice && purchase.price.length > 0) {
    const price = spendsText(purchase.price, t);
    if (purchase.owned) tags.push({ text: t("nextUp.tagBlueprintDone"), tone: "done" });
    else if (purchase.blueprint)
      tags.push({ text: t("nextUp.tagBlueprint", { price }), tone: null });
    else tags.push({ text: purchase.each ? t("nextUp.stepEach", { price }) : price, tone: null });
  }
  return tags;
}

function rowDraft(row: ResolvedRow, t: Translator, material: boolean): RowDraft {
  const pick = pickText(row, t);
  const owed = !material && row.owes && row.owes.length > 0 ? spendsText(row.owes, t) : null;
  return {
    key: row.id,
    ids: [row.id],
    label: row.label,
    value: pick ?? owed ?? quantityText(row),
    done: row.done,
    pick: row.pick ? (row.pick.state === "spent" ? "spent" : "reward") : null,
    notes: row.note ? [row.note] : [],
    tags: purchaseTags(row, material, t),
    priced: pick === null && owed !== null,
  };
}

/** Open rows bought at one price read as one line; the item the plan is about
 *  keeps its own. */
function mergedRows(drafts: readonly RowDraft[], planName: string, t: Translator): PlanStepRow[] {
  const own = planName.toLowerCase();
  const mergeable = (draft: RowDraft): boolean =>
    draft.priced && !draft.done && !draft.label.toLowerCase().includes(own);
  // Rows behind different ranks are different purchases, so the tags join the price.
  const keyOf = (draft: RowDraft): string =>
    [draft.value, ...draft.tags.map((tag) => tag.text)].join("|");
  const byValue = new Map<string, RowDraft[]>();
  for (const draft of drafts) {
    if (!mergeable(draft) || draft.value === null) continue;
    byValue.set(keyOf(draft), [...(byValue.get(keyOf(draft)) ?? []), draft]);
  }
  const out: PlanStepRow[] = [];
  for (const draft of drafts) {
    const peers = draft.value === null ? undefined : byValue.get(keyOf(draft));
    const { priced: _priced, ...row } = draft;
    if (!mergeable(draft) || !peers || peers.length < 2) {
      out.push(row);
      continue;
    }
    if (peers[0] !== draft) continue;
    out.push({
      ...row,
      ids: peers.flatMap((peer) => peer.ids),
      label: peers.map((peer) => peer.label.replace(BLUEPRINT, "")).join(", "),
      notes: peers.flatMap((peer) => peer.notes.map((note) => `${peer.label}: ${note}`)),
      value: t("nextUp.stepEach", { price: draft.value ?? "" }),
    });
  }
  return out;
}

function stepTitle(group: ResolvedGroup, t: Translator): { title: string; where: string | null } {
  const place = placeName(group.place);
  const rows = group.rows;
  if (group.type === "gate" && rows.length > 0) {
    const labels = rows.map((row) => row.label);
    const quests = labels.length > 1 && labels.every((label) => QUEST.test(label));
    return {
      title: (quests ? labels.map((label) => label.replace(QUEST, "")) : labels).join(", "),
      where: null,
    };
  }
  if (group.earns) {
    return {
      title: t("nextUp.stepEarn", { currency: group.earns.currency }),
      where: [place, group.activity].filter(Boolean).join(": "),
    };
  }
  if (group.type === "foundry" && rows.length > 0) {
    return {
      title:
        rows.length === 1
          ? t("nextUp.stepBuild", { name: rows[0].label })
          : t("nextUp.stepBuildParts", { count: rows.length }),
      where: null,
    };
  }
  if (isMaterialGroup(group) && rows.some((row) => row.purchase)) {
    const action = rows.some((row) => row.purchase?.blueprint)
      ? t("nextUp.stepBuyCraft")
      : t("nextUp.stepBuy");
    // "FORTUNA, VENUS" is the hub; the vendor already says which planet.
    const hub = placeName(group.place.split(",")[0].trim());
    return { title: [action, group.sub, hub].filter(Boolean).join(", "), where: null };
  }
  if (group.type === "vendor" && (group.spends.length > 0 || rows.some((row) => row.owes))) {
    return { title: t("nextUp.stepBuyAt", { place }), where: group.sub };
  }
  return {
    title: group.activity ? `${capitalized(group.activity)}, ${place}` : place,
    where: group.sub,
  };
}

/** A banking step is finished once nothing the plan still buys owes its currency. */
function paidOff(group: ResolvedGroup, plan: ResolvedPlan): boolean {
  const ledger = group.earns?.ledger;
  if (!ledger) return false;
  const line = plan.ledger.find((entry) => entry.currency === ledger);
  return line !== undefined && line.spent > 0 && line.outstanding === 0;
}

/** The rows the step line already says: a quest list, a foundry batch, a farm
 *  that only restates the currency it banks, a lone row with no figure. */
function folds(group: ResolvedGroup, drafts: readonly RowDraft[]): RowDraft[] {
  if (group.type === "gate" || isBuild(group)) return [...drafts];
  if (group.earns) return drafts.filter((draft) => draft.pick === null && !draft.priced);
  const lone = drafts.length === 1 ? drafts[0] : null;
  if (lone && !lone.priced && lone.pick === null && lone.tags.length === 0) return [lone];
  return [];
}

/** A count whose row is folded away still says what it counts, unless the title does. */
function attributed(
  state: PlanStepState | null,
  group: ResolvedGroup,
  folded: ReadonlySet<RowDraft>,
  title: string,
  planName: string,
): PlanStepState | null {
  if (state?.kind !== "count" || state.label !== null || group.rows.length !== 1) return state;
  if (folded.size === 0 || group.earns) return state;
  const label = shortLabel(group.rows[0].label, planName);
  return title.toLowerCase().includes(label.toLowerCase()) ? state : { ...state, label };
}

function rowCount(group: ResolvedGroup, planName: string): PlanStepState | null {
  const rows = group.rows;
  if (rows.length === 1) {
    const row = rows[0];
    if (row.qty?.tracked) {
      return {
        kind: "count",
        have: Math.min(row.qty.owned, row.qty.required),
        need: row.qty.required,
        label: null,
      };
    }
    if (row.source === "inventory" && !row.qty) {
      return {
        kind: "count",
        have: row.done ? 1 : 0,
        need: 1,
        label: shortLabel(row.label, planName),
      };
    }
    return null;
  }
  const done = rows.filter((row) => row.done).length;
  return done > 0 ? { kind: "count", have: done, need: rows.length, label: null } : null;
}

function stepState(
  group: ResolvedGroup,
  plan: ResolvedPlan,
  done: boolean,
  materialsReady: boolean,
): PlanStepState | null {
  if (done) return { kind: "done" };
  if (group.live) return { kind: "live", text: group.live.text, tone: group.live.state };
  if (group.earns) {
    return { kind: "count", have: group.earns.held ?? null, need: group.earns.value, label: null };
  }
  if (isBuild(group) && materialsReady) return { kind: "ready" };
  return rowCount(group, plan.name);
}

function planStep(
  group: ResolvedGroup,
  plan: ResolvedPlan,
  t: Translator,
  materialsReady: boolean,
): PlanStep {
  const done = group.done || group.skip !== null || paidOff(group, plan);
  const material = isMaterialGroup(group);
  const drafts = group.rows.map((row) => rowDraft(row, t, material));
  const folded = new Set(folds(group, drafts));
  const { title, where } = stepTitle(group, t);
  return {
    id: group.id,
    title,
    where: where || null,
    tags: [
      ...group.facts.map((fact) => fact.text),
      ...(group.meta ? [group.meta] : []),
      ...(group.mode ? [group.mode] : []),
      ...group.spends.map((spend) =>
        t("nextUp.planSpends", { amount: spend.amount, currency: spend.currency }),
      ),
    ],
    state: attributed(
      stepState(group, plan, done, materialsReady),
      group,
      folded,
      title,
      plan.name,
    ),
    done,
    skip: group.skip?.reason ?? null,
    folded:
      folded.size > 0
        ? {
            rows: [...folded].map((draft) => ({
              id: draft.key,
              label: draft.label,
              done: draft.done,
            })),
            done: [...folded].every((draft) => draft.done),
            notes: [...folded].flatMap((draft) =>
              draft.notes.map((note) => `${draft.label}: ${note}`),
            ),
          }
        : null,
    rows: mergedRows(
      drafts.filter((draft) => !folded.has(draft)),
      plan.name,
      t,
    ),
    alts: group.rows.flatMap((row) =>
      row.alt
        ? [
            {
              id: row.id,
              label: row.label,
              text: row.alt.text,
              offer: row.alt.spends.length > 0,
              taken: row.alt.taken,
            },
          ]
        : [],
    ),
    map: group.map ? { key: group.map, ready: group.mapReady } : null,
    conditions: group.conditions,
    bonuses: group.bonuses,
    tips: group.tips,
    disclosures: group.disclosures,
  };
}

/** A row ticked by hand, or ticked this visit, keeps its step so a tick is never
 *  a one-way door. */
const answeredByHand = (row: ResolvedRow & { temporary?: boolean }): boolean =>
  row.temporary === true || row.source === "manual";

/** One numbered step per group, in the order a player walks them. A material
 *  farm the inventory already covers is the build step's "materials ready", not a step. */
export function planSteps(plan: ResolvedPlan, options: StepOptions): PlanStep[] {
  const materials = plan.groups.filter(isMaterialGroup);
  const materialsReady =
    materials.length > 0 ? materials.every((group) => group.done) : options.buildable === true;
  return displayOrder(plan.groups)
    .filter((group) => !(isMaterialGroup(group) && group.done && !group.rows.some(answeredByHand)))
    .map((group) => planStep(group, plan, options.t, materialsReady));
}

/** The step the player is on: the first one still open, or the last once all are done. */
export function stepProgress(steps: readonly PlanStep[]): { step: number; total: number } {
  const open = steps.findIndex((step) => !step.done);
  return { step: open === -1 ? steps.length : open + 1, total: steps.length };
}
