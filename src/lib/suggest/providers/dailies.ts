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
import { dayOfYearUtc, trackerExpiries, trackerLive } from "../../world/dailiesLive.js";
import { affinityBoost } from "../boosts.js";
import { readCircuit } from "../circuit.js";
import { summarizeDropPool } from "../dropPools.js";
import { missionOpinion, readMissions, type MissionRead } from "../missionTypes.js";
import { bestWorth, rewardWorth, rewardValue, taskWorth } from "../rewards.js";
import { clamp01, urgencyFromExpiry } from "../score.js";
import { UNPLACED_WORTH, UNRESOLVED_WORTH, bandCeiling, groupForWorth } from "../worthLadder.js";
import type {
  RewardWorth,
  SuggestionContext,
  SuggestionDetails,
  SuggestionDraft,
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

const DAY_MS = 24 * 60 * 60_000;
const WEEK_MS = 7 * DAY_MS;

/** Urgency is measured against the window's own length, so a weekly climbs
 *  across its week exactly as a daily climbs across its day. */
const PERIOD_WINDOW_MS: Record<string, number> = {
  daily: DAY_MS,
  sortie: DAY_MS,
  darvo: DAY_MS,
  weekly: WEEK_MS,
  archon: WEEK_MS,
  steelPath: WEEK_MS,
  descendia: WEEK_MS,
};

/** The whole season is the calendar's window, so a payday inside it registers
 *  as a window closing rather than as no deadline at all. */
function seasonWindowMs(wd: WorldState | null): number | null {
  const season = wd?.calendarSeason;
  const start = season?.activation ? Date.parse(season.activation) : Number.NaN;
  const end = season?.expiry ? Date.parse(season.expiry) : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return end - start;
}

function windowFor(period: string, wd: WorldState | null): number {
  if (period === "calendar1999") return seasonWindowMs(wd) ?? WEEK_MS;
  return PERIOD_WINDOW_MS[period] ?? WEEK_MS;
}

/** The best of everything a task resolved; nothing resolved is not a middling
 *  score, it is a floor. */
function bestOf(values: readonly (number | null | undefined)[]): number {
  let best: number | null = null;
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (best === null || value > best) best = value;
  }
  return best ?? UNRESOLVED_WORTH;
}

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

type CalendarSeason = NonNullable<WorldState["calendarSeason"]>;

/** How many days the season itself covers, from its start where world state
 *  carries one and from now where it does not. */
function seasonSpanDays(season: CalendarSeason, nowMs: number): number {
  const start = Date.parse(season.activation ?? "");
  const end = Date.parse(season.expiry ?? "");
  if (!Number.isFinite(end)) return CALENDAR_LOOKAHEAD_DAYS;
  const from = Number.isFinite(start) ? Math.min(start, nowMs) : nowMs;
  return Math.max(0, Math.ceil((end - from) / DAY_MS));
}

/** The days still on offer, and whether their numbers are dates. DE numbers a
 *  season against the 1999 calendar's own year, so a live Summer season ships
 *  days 185-271 inside one real week. A numbering too wide for the season's
 *  window reads as a running order, where no day distance exists. */
function seasonDays(
  season: CalendarSeason,
  nowMs: number,
): { days: CalendarDay[]; dated: boolean } {
  const days = season.days ?? [];
  if (days.length === 0) return { days, dated: false };
  const numbers = days.map((day) => day.day);
  if (Math.max(...numbers) - Math.min(...numbers) <= seasonSpanDays(season, nowMs)) {
    const today = dayOfYearUtc(nowMs);
    const upcoming = days.filter((day) => day.day >= today);
    if (upcoming.length > 0) return { days: upcoming, dated: true };
  }
  return { days, dated: false };
}

/** The reward the card pictures. A dated season's nearest payday is the reason
 *  to log in today; an undated one has none, so the best it pays wins. A day
 *  the ladder places nothing on still pays out, so it stands in once nothing
 *  placed is left, at the zero worth an unplaced name carries. */
function nextCalendarReward(
  prefs: SuggestionPreferences,
  season: CalendarSeason | null | undefined,
  nowMs: number,
): NamedReward | null {
  if (!season) return null;
  const { days, dated } = seasonDays(season, nowMs);
  const today = dayOfYearUtc(nowMs);
  let best: NamedReward | null = null;
  let unplaced: NamedReward | null = null;
  for (const day of days) {
    const inDays = dated ? day.day - today : null;
    if (inDays !== null && inDays > CALENDAR_LOOKAHEAD_DAYS) continue;
    let onDay: NamedReward | null = null;
    for (const event of day.events) {
      if (event.kind !== "reward") continue;
      const value = rewardValue(prefs, event.label);
      const named: NamedReward = {
        name: event.label,
        uniqueName: event.uniqueName,
        value: value ?? UNPLACED_WORTH,
        inDays,
        mention: true,
      };
      if (value === null) {
        unplaced ??= named;
        continue;
      }
      if (!onDay || value > onDay.value) onDay = named;
    }
    if (!onDay) continue;
    if (dated) return onDay;
    if (!best || onDay.value > best.value) best = onDay;
  }
  return best ?? unplaced;
}

/** The tile's worth band, read through rewardValue on the way so a name the
 *  ladder does not place is recorded as a coverage gap rather than only
 *  rendering unrated. */
function optionWorth(prefs: SuggestionPreferences, name: string): RewardWorth | undefined {
  return rewardValue(prefs, name) === null ? undefined : (rewardWorth(prefs, name) ?? undefined);
}

/** Every payday the season has left, in the order it hands them out; a day of
 *  buffs or challenges alone is not a payday. The card's line clamps this, the
 *  details view shows all of it. */
function calendarOptionGroups(
  prefs: SuggestionPreferences,
  season: CalendarSeason | null | undefined,
  nowMs: number,
): SuggestionOptionGroup[] {
  if (!season) return [];
  const groups: SuggestionOptionGroup[] = [];
  for (const day of seasonDays(season, nowMs).days) {
    const rewards = day.events.filter((event) => event.kind === "reward");
    if (rewards.length === 0) continue;
    groups.push({
      day: day.day,
      options: rewards.map((event) => ({
        name: event.label,
        uniqueName: event.uniqueName,
        displayName: rewardLabel(event.label),
        worth: optionWorth(prefs, event.label),
      })),
    });
  }
  return groups;
}

/** The card has one line, so it names the nearest picks and clamps. A day with a
 *  single reward is no pick, and the promoted reward's art already stands for it. */
const CALENDAR_CHOICE_DAYS = 3;

/** Text only: the card is already about the Calendar, so the prefix DE puts on
 *  its packs is noise. Worth, art and the unplaced ledger keep the full name. */
function rewardLabel(name: string): string {
  return name.replace(/^Calendar\s+/i, "");
}

function optionsWhy(groups: SuggestionOptionGroup[]): string | null {
  const picks = groups.filter((group) => group.options.length > 1);
  if (picks.length === 0) return null;
  return picks
    .slice(0, CALENDAR_CHOICE_DAYS)
    .map((group) => group.options.map((option) => rewardLabel(option.name)).join(" / "))
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
  if (taskId === "calendar1999") return nextCalendarReward(prefs, wd.calendarSeason, nowMs);
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
  const label = rewardLabel(reward.name);
  // Item names stay English, matched against the game, so one stands alone.
  if (reward.inDays === undefined) return label;
  if (reward.inDays === null) return t("nextUp.whyRewardUpcoming", { reward: label });
  if (reward.inDays === 0) return t("nextUp.whyRewardToday", { reward: label });
  if (reward.inDays === 1) return t("nextUp.whyRewardTomorrow", { reward: label });
  return t("nextUp.whyRewardInDays", { reward: label, days: String(reward.inDays) });
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
  /** The best thing in the pool, which is the reason to run it. */
  value: number;
}

/** What an activity pays when world state names nothing: the pool labels the
 *  card, picks its art, and is worth the best row on the ladder. */
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
    value:
      bestWorth(
        ctx.prefs,
        rows.map((row) => row.item),
      ) ?? UNPLACED_WORTH,
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

/** Runs cost more than one run but nowhere near proportionally, and the count
 *  that matters is what is still owed: four Netracells down is one run away. */
const EFFORT_HALF_RUNS = 4;

function effortFor(runs: number): number {
  return runs <= 0 ? 0 : clamp01(runs / (runs + EFFORT_HALF_RUNS));
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
        task.id === "calendar1999" ? calendarOptionGroups(prefs, world?.calendarSeason, nowMs) : [];
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
      // The week's own picks are the whole of what Circuit pays. Everything else
      // is worth the best thing it resolved, from world state, its drop pool or
      // the curated table - a resolved reward can never demote its own task.
      const value = circuit
        ? circuit.value
        : bestOf([reward?.value, pool?.value, taskWorth(prefs, task.id)]);
      // A boost lifts a levelling run past its neighbours, never past its group.
      const boosted = boostLine
        ? Math.min(bandCeiling(groupForWorth(value)), value + AFFINITY_BOOST_VALUE)
        : value;

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
          value: boosted,
          effort: circuit?.effort ?? effortFor(remaining) + missionEffort(missions),
          urgency: urgencyFromExpiry(expiry, nowMs, windowFor(task.period, world)),
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

    return drafts;
  },
};

function periodResetIso(period: string, now: Date): string | null {
  if (period === "daily") return nextDailyResetUtc(now).toISOString();
  if (period === "weekly") return nextWeeklyResetUtc(now).toISOString();
  return null;
}
