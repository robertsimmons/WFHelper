import { nextDailyResetUtc, nextWeeklyResetUtc } from "../../format.js";
import type { MessageKey } from "../../i18n.js";
import {
  trackerCount,
  trackerGroup,
  trackerList,
  trackerPeriodKey,
  type TrackerGroup,
} from "../../world/dailies.js";
import { autoTrackerState } from "../../world/dailiesAuto.js";
import { trackerExpiries, trackerLive } from "../../world/dailiesLive.js";
import { clamp01, urgencyFromExpiry } from "../score.js";
import type {
  SuggestionCategory,
  SuggestionContext,
  SuggestionDraft,
  SuggestionProvider,
} from "../../../types/suggest.js";

/** Vendors and alerts are their own thing and are not covered here yet. */
const COVERED_GROUPS = new Set<TrackerGroup>(["daily", "weekly"]);

const BASE_VALUE: Record<SuggestionCategory, number> = {
  daily: 0.45,
  weekly: 0.6,
  nightwave: 0.5,
};

const LINK_LABELS: Record<SuggestionCategory, MessageKey> = {
  daily: "nextUp.viewInDailies",
  weekly: "nextUp.viewInWeeklies",
  nightwave: "nextUp.viewInNightwave",
};

/** Something already part-done is worth more than the same task untouched. */
const STARTED_BONUS = 0.1;
const ELITE_BONUS = 0.05;

/** Runs a five-run task costs about this much more than a one-and-done. */
const EFFORT_RUNS = 5;

function effortFor(remaining: number): number {
  return clamp01(remaining / EFFORT_RUNS);
}

export const dailiesProvider: SuggestionProvider = {
  id: "dailies",

  collect(ctx: SuggestionContext): SuggestionDraft[] {
    const { tracker, world, inventory, inventoryModifiedAt, nowMs, t } = ctx;
    const now = new Date(nowMs);
    const auto = autoTrackerState(inventory, world, nowMs, inventoryModifiedAt);
    const expiries = trackerExpiries(world);
    const drafts: SuggestionDraft[] = [];

    for (const task of trackerList(tracker)) {
      const group = trackerGroup(task.period, task.group);
      if (!COVERED_GROUPS.has(group)) continue;
      if (tracker.hidden.includes(task.id)) continue;

      const periodKey = trackerPeriodKey(task.period, now, expiries);
      const done = Math.max(
        trackerCount(tracker, task.id, periodKey, nowMs),
        auto[task.id]?.count ?? 0,
      );
      const remaining = task.target - done;
      if (remaining <= 0) continue;

      const live = task.label ? {} : trackerLive(task.id, world, t, nowMs);
      const expiry = live.expiry ?? periodResetIso(task.period, now);
      const category: SuggestionCategory = group === "weekly" ? "weekly" : "daily";
      const why =
        live.detail ??
        (task.target > 1
          ? t("nextUp.whyRemaining", { remaining: String(remaining), target: String(task.target) })
          : "");

      drafts.push({
        id: `dailies:${task.id}`,
        category,
        title: task.label ?? t(`dailies.task.${task.id}` as MessageKey),
        why,
        signals: {
          value: BASE_VALUE[category] + (done > 0 ? STARTED_BONUS : 0),
          effort: effortFor(remaining),
          urgency: urgencyFromExpiry(expiry, nowMs),
        },
        fingerprint: periodKey ?? task.id,
        expiry,
        progress: task.target > 1 ? { current: done, required: task.target } : undefined,
        complete: { taskId: task.id, periodKey, count: done, target: task.target },
        link: { view: "world", labelKey: LINK_LABELS[category] },
        wiki: task.wiki,
      });
    }

    for (const act of world?.nightwave?.challenges ?? []) {
      const id = `nw:${act.id}`;
      if (tracker.hidden.includes(id)) continue;

      const periodKey = act.expiry ? `nw:${act.expiry}` : null;
      const progress = auto[id]?.progress;
      const done = Math.max(trackerCount(tracker, id, periodKey, nowMs), auto[id]?.count ?? 0);
      if (done > 0) continue;

      drafts.push({
        id: `dailies:${id}`,
        category: "nightwave",
        title: act.title,
        why: act.description,
        signals: {
          value: BASE_VALUE.nightwave + (act.isElite ? ELITE_BONUS : 0),
          effort: effortFor(act.requiredCount - (progress?.current ?? 0)),
          urgency: urgencyFromExpiry(act.expiry, nowMs),
        },
        fingerprint: periodKey ?? id,
        expiry: act.expiry,
        progress,
        complete: { taskId: id, periodKey, count: 0, target: 1 },
        link: { view: "world", labelKey: LINK_LABELS.nightwave },
      });
    }

    return drafts;
  },
};

function periodResetIso(period: string, now: Date): string | null {
  if (period === "daily") return nextDailyResetUtc(now).toISOString();
  if (period === "weekly") return nextWeeklyResetUtc(now).toISOString();
  return null;
}
