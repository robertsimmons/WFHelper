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
import {
  dayOfYearUtc,
  trackerExpiries,
  trackerLive,
  upcomingCalendarDays,
} from "../../world/dailiesLive.js";
import { affinityBoost } from "../boosts.js";
import { readCircuit } from "../circuit.js";
import { summarizeDropPool } from "../dropPools.js";
import { missionOpinion, readMissions, type MissionRead } from "../missionTypes.js";
import { NIGHTWAVE_ACTIVITY } from "../preferences.js";
import { rewardTier, rewardValue, taskRewardValue } from "../rewards.js";
import { clamp01, urgencyFromExpiry } from "../score.js";
import type {
  SuggestionContext,
  SuggestionDetails,
  SuggestionDraft,
  SuggestionOption,
  SuggestionOptionGroup,
  SuggestionPreferences,
  SuggestionProvider,
  SuggestionReward,
  WhySegment,
} from "../../../types/suggest.js";
import type { CalendarDay, WorldState } from "../../../types/world.js";

/** Vendors and alerts are their own thing and are not covered here yet. */
const COVERED_GROUPS = new Set<TrackerGroup>(["daily", "weekly"]);

/** Tracker rows that stay in the World tab but never become a card. Incursions
 *  rotate constantly and are best read in-game, so a card for them is noise. */
const NOT_SUGGESTED = new Set(["spIncursions"]);

/** Where the curated tables have no opinion, a category is worth what it always was. */
const BASE_VALUE: Record<"daily" | "weekly" | "nightwave", number> = {
  daily: 0.45,
  weekly: 0.6,
  nightwave: 0.5,
};

/** A dated calendar reward further out than this is not a reason to log in today. */
const CALENDAR_LOOKAHEAD_DAYS = 7;

interface NamedReward {
  name: string;
  uniqueName?: string | undefined;
  value: number;
  /** Calendar only: days out, or null when the season's numbering is not a
   *  countdown. Absent for a reward already on offer. */
  inDays?: number | null;
  /** False when the task's own detail line already names the reward. */
  mention: boolean;
}

/** DE names the shard after the Archon, so the boss is the reward. */
const ARCHON_SHARDS: Record<string, string> = {
  Boreal: "Azure Archon Shard",
  Amar: "Crimson Archon Shard",
  Nira: "Amber Archon Shard",
};

/** Higher value wins; between equals, the one the player reaches first. */
function beats(candidate: NamedReward, best: NamedReward | null): boolean {
  if (!best) return true;
  if (candidate.value !== best.value) return candidate.value > best.value;
  return (candidate.inDays ?? Infinity) < (best.inDays ?? Infinity);
}

/** Best rated reward among the days the World tab is showing. That list is a
 *  countdown only while the season's day numbers are this year's; when they are
 *  not, it falls back to a running order, and a day distance would be fiction. */
function bestCalendarReward(
  prefs: SuggestionPreferences,
  days: CalendarDay[] | undefined,
  nowMs: number,
): NamedReward | null {
  if (!days?.length) return null;
  const today = dayOfYearUtc(nowMs);
  let best: NamedReward | null = null;
  for (const day of upcomingCalendarDays(days, nowMs)) {
    const inDays = day.day - today;
    if (inDays > CALENDAR_LOOKAHEAD_DAYS) continue;
    for (const event of day.events) {
      if (event.kind !== "reward") continue;
      const value = rewardValue(prefs, event.label);
      if (value === null) continue;
      const candidate: NamedReward = {
        name: event.label,
        uniqueName: event.uniqueName,
        value,
        inDays: inDays < 0 ? null : inDays,
        mention: true,
      };
      if (beats(candidate, best)) best = candidate;
    }
  }
  return best;
}

/** A day the season lists more than one reward for is a pick between them; a lone
 *  reward is simply what that day is, and a day of buffs is not a reward at all. */
function calendarOptionGroups(
  prefs: SuggestionPreferences,
  days: CalendarDay[] | undefined,
  nowMs: number,
): SuggestionOptionGroup[] {
  if (!days?.length) return [];
  const groups: SuggestionOptionGroup[] = [];
  for (const day of upcomingCalendarDays(days, nowMs)) {
    const rewards = day.events.filter((event) => event.kind === "reward");
    if (rewards.length < 2) continue;
    const options: SuggestionOption[] = rewards.map((event) => ({
      name: event.label,
      uniqueName: event.uniqueName,
      tier: rewardTier(prefs, event.label) ?? undefined,
    }));
    groups.push({ day: day.day, options });
  }
  return groups;
}

/** The card has one line, so it names the nearest picks and clamps. */
const CALENDAR_CHOICE_DAYS = 3;

function optionsWhy(groups: SuggestionOptionGroup[]): string | null {
  if (groups.length === 0) return null;
  return groups
    .slice(0, CALENDAR_CHOICE_DAYS)
    .map((group) => group.options.map((option) => option.name).join(" / "))
    .join(", ");
}

/** The reward this task is actually offering, when the world state names one. */
function namedReward(
  prefs: SuggestionPreferences,
  taskId: string,
  wd: WorldState | null,
  nowMs: number,
): NamedReward | null {
  if (!wd) return null;
  if (taskId === "calendar1999") return bestCalendarReward(prefs, wd.calendarSeason?.days, nowMs);
  if (taskId === "steelPathHonors") {
    const name = wd.steelPath?.currentReward?.name;
    const value = rewardValue(prefs, name);
    // Teshin's row already reads "<reward> - <cost>", so naming it again is noise.
    return name && value !== null ? { name, value, mention: false } : null;
  }
  if (taskId === "archonHunt") {
    const name = ARCHON_SHARDS[wd.archonHunt?.boss ?? ""];
    const value = rewardValue(prefs, name);
    return name && value !== null ? { name, value, mention: true } : null;
  }
  return null;
}

/** The shard or item on offer; a dated calendar reward says how far off it is. */
function rewardWhy(reward: NamedReward | null, t: SuggestionContext["t"]): string | null {
  if (!reward || !reward.mention) return null;
  // Item names stay English, matched against the game, so one stands alone.
  if (reward.inDays === undefined) return reward.name;
  if (reward.inDays === null) return t("nextUp.whyRewardUpcoming", { reward: reward.name });
  if (reward.inDays === 0) return t("nextUp.whyRewardToday", { reward: reward.name });
  if (reward.inDays === 1) return t("nextUp.whyRewardTomorrow", { reward: reward.name });
  return t("nextUp.whyRewardInDays", { reward: reward.name, days: String(reward.inDays) });
}

/** The same line with the name left to the art tile; null when only the name was there. */
function plainRewardWhy(reward: NamedReward | null, t: SuggestionContext["t"]): string | null {
  if (!reward || !reward.mention || reward.inDays === undefined) return null;
  if (reward.inDays === null) return t("nextUp.whyUpcoming");
  if (reward.inDays === 0) return t("nextUp.whyToday");
  if (reward.inDays === 1) return t("nextUp.whyTomorrow");
  return t("nextUp.whyInDays", { days: String(reward.inDays) });
}

interface PoolReward {
  /** Reward families the pool pays, comma-joined for the why line. */
  text: string;
  /** The same families, unjoined, for the details view. */
  families: string[];
  /** Drop-table name of the top family, for the art join. */
  item: string;
  /** Art can only stand in for the text when there is one thing to picture. */
  single: boolean;
}

/** What an activity pays when world state names nothing. A pool labels the card
 *  and picks its art; it never feeds the score. */
function poolReward(ctx: SuggestionContext, taskId: string): PoolReward | null {
  const rows = ctx.dropPools[taskId];
  if (!rows?.length) return null;
  const families = summarizeDropPool(rows, (name) => rewardValue(ctx.prefs, name));
  const top = families[0];
  if (!top) return null;
  const labels = families.map((family) => family.label);
  return {
    text: labels.join(", "),
    families: labels,
    item: top.item,
    single: families.length === 1,
  };
}

/** Tasks that always pay the same thing, which no pool or world state names. */
const FIXED_REWARD: Record<string, SuggestionReward> = {
  ayatanHunt: {
    name: "Ayatan Anasa Sculpture",
    uniqueName: "/Lotus/Types/Items/FusionTreasures/OroFusexF",
  },
};

function rewardArt(
  taskId: string,
  reward: NamedReward | null,
  pool: PoolReward | null,
): SuggestionReward | undefined {
  if (reward) return { name: reward.name, uniqueName: reward.uniqueName };
  if (pool) return { name: pool.item };
  return FIXED_REWARD[taskId];
}

/** Mission types the player has an opinion about, for the tasks that list them. */
function missionsFor(taskId: string, wd: WorldState | null): string[] {
  if (taskId === "archonHunt") return (wd?.archonHunt?.missions ?? []).map((m) => m.mission);
  if (taskId === "sortie") return (wd?.sortie?.missions ?? []).map((m) => m.mission);
  return [];
}

/** Everything the provider already worked out that the card face cannot show. */
function detailsFor(
  prefs: SuggestionPreferences,
  missionNames: readonly string[],
  pool: PoolReward | null,
  expiry: string | null,
  options: SuggestionOptionGroup[],
): SuggestionDetails | undefined {
  const missions = missionNames.map((name) => ({
    name,
    opinion: missionOpinion(prefs, name),
  }));
  if (missions.length === 0 && !pool && !expiry && options.length === 0) return undefined;
  return {
    pool: pool?.families,
    missions: missions.length > 0 ? missions : undefined,
    expiry,
    options: options.length > 0 ? options : undefined,
  };
}

/** A disliked mission type is the difference between a quick run and a chore. */
const SLOW_MISSION_EFFORT = 0.3;
const FAST_MISSION_RELIEF = 0.1;

function missionEffort(read: MissionRead): number {
  if (read.slow.length > 0) return SLOW_MISSION_EFFORT;
  return read.allFast ? -FAST_MISSION_RELIEF : 0;
}

function missionWhy(read: MissionRead, t: SuggestionContext["t"]): string | null {
  if (read.slow.length > 0) return t("nextUp.whySlowMissions", { types: read.slow.join(", ") });
  return read.allFast ? t("nextUp.whyFastMissions") : null;
}

/** The Archon Hunt card is its mission list, so the line is toned rather than
 *  summarized. Mission names are game terms and stay English. */
function missionSegments(prefs: SuggestionPreferences, names: readonly string[]): WhySegment[] {
  return names.map((name) =>
    missionOpinion(prefs, name) === "bad" ? { text: name, tone: "bad" } : { text: name },
  );
}

/** Tasks a kill-XP boost actually changes the worth of: the daily Focus cap fills
 *  at the boosted rate, and Steel Path Circuit is the Undercroft run you bring
 *  your own gear to. Normal Circuit hands out a random loadout, so it levels
 *  nothing of yours. */
const AFFINITY_TASKS = new Set(["dailyFocus", "circuitSteelPath"]);

/** Enough to lift a levelling run past its neighbours, not to clear the board. */
const AFFINITY_BOOST_VALUE = 0.12;

const ELITE_BONUS = 0.05;

/** Runs a five-run task costs about this much more than a one-and-done. */
const EFFORT_RUNS = 5;

/** The task's own cost, not what is left of it: progress must not re-rank a card. */
function effortFor(target: number): number {
  return clamp01(target / EFFORT_RUNS);
}

/** An act's requirement counts kills, pickups or missions depending on the act,
 *  so it cannot be read as runs; the tier is the only comparable cost we have. */
function nightwaveEffort(isDaily: boolean, isElite: boolean): number {
  if (isDaily) return 0.2;
  return isElite ? 0.75 : 0.5;
}

export const dailiesProvider: SuggestionProvider = {
  id: "dailies",

  collect(ctx: SuggestionContext): SuggestionDraft[] {
    const { tracker, world, inventory, inventoryModifiedAt, prefs, nowMs, t } = ctx;
    const now = new Date(nowMs);
    const auto = autoTrackerState(inventory, world, nowMs, inventoryModifiedAt);
    const expiries = trackerExpiries(world);
    const boost = affinityBoost(world, nowMs);
    const drafts: SuggestionDraft[] = [];

    for (const task of trackerList(tracker)) {
      const group = trackerGroup(task.period, task.group);
      if (!COVERED_GROUPS.has(group)) continue;
      if (NOT_SUGGESTED.has(task.id)) continue;
      if (tracker.hidden.includes(task.id)) continue;
      const activity = prefs.activities[task.id] ?? "normal";
      if (activity === "never") continue;

      const periodKey = trackerPeriodKey(task.period, now, expiries);
      const done = Math.max(
        trackerCount(tracker, task.id, periodKey, nowMs),
        auto[task.id]?.count ?? 0,
      );
      const remaining = task.target - done;
      if (remaining <= 0) continue;

      const live = task.label ? {} : trackerLive(task.id, world, t, nowMs);
      const expiry = live.expiry ?? periodResetIso(task.period, now);
      const category = group === "weekly" ? "weekly" : "daily";
      // The week's own choices say more than a pool or a rotation reward would.
      const circuit = task.label ? null : readCircuit(ctx, task.id);
      const reward = task.label || circuit ? null : namedReward(prefs, task.id, world, nowMs);
      const pool = reward || task.label || circuit ? null : poolReward(ctx, task.id);
      const missionNames = task.label ? [] : missionsFor(task.id, world);
      const missions = readMissions(prefs, missionNames);
      const segments =
        task.id === "archonHunt" ? missionSegments(prefs, missionNames) : ([] as WhySegment[]);
      const options =
        task.id === "calendar1999"
          ? calendarOptionGroups(prefs, world?.calendarSeason?.days, nowMs)
          : [];
      const picks = optionsWhy(options);
      // A named reward is the better headline, so it stands in for the task's own
      // detail; a pool label is weaker and only ever appends to it.
      const named = rewardWhy(reward, t);
      const headline = circuit?.why ?? named ?? picks ?? live.detail;
      const missionLine =
        segments.length > 0
          ? segments.map((segment) => segment.text).join(", ")
          : missionWhy(missions, t);
      const boostLine =
        boost !== null && AFFINITY_TASKS.has(task.id)
          ? t("nextUp.whyAffinityBoost", { multiplier: String(boost) })
          : null;
      const rest = [
        boostLine,
        missionLine,
        task.target > 1
          ? t("nextUp.whyRemaining", { remaining: String(remaining), target: String(task.target) })
          : null,
      ];
      // Art stands in for the text only where it pictures one thing.
      const carried = reward?.mention === true;
      // A promoted reward takes the headline, so the picks follow it instead.
      const trailingPicks = carried ? picks : null;
      const withReward = [headline, trailingPicks, pool?.text, ...rest].filter(Boolean).join(" - ");
      const why = [
        carried ? plainRewardWhy(reward, t) : headline,
        trailingPicks,
        pool?.single ? null : pool?.text,
        ...rest,
      ]
        .filter(Boolean)
        .join(" - ");
      const art = rewardArt(task.id, reward, pool);
      const period = periodKey ?? task.id;
      const value =
        circuit?.value ?? reward?.value ?? taskRewardValue(task.id) ?? BASE_VALUE[category];

      drafts.push({
        id: `dailies:${task.id}`,
        category,
        title: task.label ?? t(`dailies.task.${task.id}` as MessageKey),
        why,
        // Segments stand for the whole line, so a line that grew past them is
        // left to the plain string.
        whySegments: why === missionLine && segments.length > 0 ? segments : undefined,
        reward: art,
        choices: circuit?.choices,
        whyWithReward: withReward === why ? undefined : withReward,
        signals: {
          value: boostLine ? clamp01(value + AFFINITY_BOOST_VALUE) : value,
          effort: circuit?.effort ?? effortFor(task.target) + missionEffort(missions),
          urgency: urgencyFromExpiry(expiry, nowMs),
        },
        // The promoted reward is what the card is about, so a dismissal lifts
        // once a better one comes round rather than riding out the whole season.
        fingerprint: reward ? `${period}|${reward.name}` : period,
        deprioritized: activity === "low",
        progress: task.target > 1 ? { current: done, required: task.target } : undefined,
        complete: { taskId: task.id, periodKey, count: done, target: task.target },
        wiki: task.wiki,
        details: detailsFor(prefs, missionNames, pool, expiry, options),
      });
    }

    const nightwave = prefs.activities[NIGHTWAVE_ACTIVITY] ?? "normal";

    for (const act of nightwave === "never" ? [] : (world?.nightwave?.challenges ?? [])) {
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
          effort: nightwaveEffort(act.isDaily, act.isElite),
          urgency: urgencyFromExpiry(act.expiry, nowMs),
        },
        fingerprint: periodKey ?? id,
        deprioritized: nightwave === "low",
        progress,
        complete: { taskId: id, periodKey, count: 0, target: 1 },
        details: act.expiry ? { expiry: act.expiry } : undefined,
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
