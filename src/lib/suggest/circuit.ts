import incarnons from "../../data/suggest/incarnons.json";
import warframes from "../../data/suggest/warframes.json";
import { itemTiers } from "./acquisition/tiers.js";
import { createMasteryLookup } from "./masteryRoster.js";
import { bandFloor, bandWorthAt } from "./worthLadder.js";
import { isSubsumableFrame } from "../helminth.js";
import { circuitChoices, resolveCircuitChoices, type CircuitChoice } from "../world.js";
import type { Translator } from "../i18n.js";
import type {
  ChoiceSource,
  ChoiceState,
  ChoiceStatus,
  LadderGroup,
  SuggestionChoice,
  SuggestionContext,
} from "../../types/suggest.js";

interface WarframeEntry {
  difficulty?: string;
  sources?: { kind?: string; where?: string }[];
}

interface IncarnonEntry {
  grade?: string;
  upgradePath?: string;
}

/** A tier is not a worth. It says where inside a ladder group a pick sits, so
 *  the group the player moves in settings is what moves the Circuit. */
const TIER_POSITION: Record<string, number> = { S: 0, A: 0.33, B: 0.66, C: 1, D: 1, F: 1 };

/** A suffix moves a grade inside its own letter, a third of the step to the next
 *  one, so an A- ranks under an A without reaching B. */
const SUFFIX_STEP = 0.11;

/** An unrated pick is unknown, never bad. */
const UNRATED_POSITION = 0.66;

function tierLetter(tier: string | null | undefined): string {
  return tier?.charAt(0).toUpperCase() ?? "";
}

function tierPosition(tier: string | null | undefined): number {
  const base = TIER_POSITION[tierLetter(tier)];
  if (base === undefined) return UNRATED_POSITION;
  const suffix = tier?.slice(1).trim() ?? "";
  const step = suffix === "+" ? -SUFFIX_STEP : suffix === "-" ? SUFFIX_STEP : 0;
  return Math.min(1, Math.max(0, base + step));
}

function tierWorth(group: LadderGroup, tier: string | null | undefined): number {
  return bandWorthAt(group, tierPosition(tier));
}

/** A pick the player does not own yet is the gear itself, which is a want. */
const OUTSTANDING: LadderGroup = "want";

/** Nothing left to win, so the week pays nothing; the run is still the player's
 *  to make, so it sinks rather than vanishing. */
const NOTHING_LEFT = bandFloor("junk");

const NORMAL_EFFORT = 0.85;
const STEEL_PATH_EFFORT = 0.6;

const INCARNON_SUFFIX = / incarnon genesis$/;

// The tables spell "Ack & Brunt" where the game exports "Ack And Brunt", and
// Steel Path names the adapter rather than the weapon it evolves.
function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*&\s*/g, " and ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(INCARNON_SUFFIX, "");
}

function keyed<T>(table: Record<string, T>): Map<string, T> {
  return new Map(Object.entries(table).map(([name, value]) => [nameKey(name), value]));
}

const INCARNONS = keyed<IncarnonEntry>(incarnons);
const SOURCES = keyed<WarframeEntry>(warframes);

function effortWord(name: string): string | undefined {
  return SOURCES.get(nameKey(name))?.difficulty;
}

function frameValue(name: string): number {
  return tierWorth(OUTSTANDING, itemTiers(name));
}

/** No subsume-tier table ships yet, so every subsume reads as unrated. One
 *  letter back from here is the whole hookup: Overframe rates abilities under
 *  its own category, and `rankings.json` carries those rows with a null name. */
function subsumeTier(_frame: string): string | undefined {
  return undefined;
}

/** Only the Helminth feed is left, which is part of what the frame was worth: a
 *  middling subsume is useful, a top one is still a want. */
function subsumeValue(name: string): number {
  const letter = subsumeTier(name);
  return tierWorth(tierLetter(letter) === "S" ? OUTSTANDING : "useful", letter);
}

function tier(name: string): string | undefined {
  return INCARNONS.get(nameKey(name))?.grade;
}

function upgradePath(name: string): string | undefined {
  return INCARNONS.get(nameKey(name))?.upgradePath;
}

function adapterValue(name: string): number {
  return tierWorth(OUTSTANDING, tier(name));
}

function sources(name: string): ChoiceSource[] {
  return (SOURCES.get(nameKey(name))?.sources ?? []).flatMap((source) =>
    source.kind && source.where ? [{ kind: source.kind, where: source.where }] : [],
  );
}

function display(choice: CircuitChoice): string {
  return choice.displayName || choice.name;
}

/** Whether the roster has the frame banked, which is not whether it is in hand. */
type Mastered = (choice: CircuitChoice) => boolean;

/** Owning the frame and feeding it to the Helminth are separate wins. Mastery is
 *  banked, so a frame levelled and sold leaves only the subsume to win. */
function frameState(choice: CircuitChoice, mastered: boolean): ChoiceState {
  if (choice.subsumed) return "done";
  return choice.inInventory || mastered ? "subsume" : "wanted";
}

function frameStateValue(choice: CircuitChoice, mastered: boolean): number {
  const state = frameState(choice, mastered);
  if (state === "done") return 0;
  return state === "subsume" ? subsumeValue(choice.name) : frameValue(choice.name);
}

/** Both wins, always, each with its own answer: one value could never say
 *  whether a frame is mastered and whether it has been fed to the Helminth. */
function frameStatuses(choice: CircuitChoice, mastered: boolean): ChoiceStatus[] {
  const statuses: ChoiceStatus[] = [{ win: "mastery", done: mastered }];
  if (isSubsumableFrame(choice.name)) {
    statuses.push({ win: "subsume", done: choice.subsumed === true });
  }
  return statuses;
}

function best(
  choices: CircuitChoice[],
  value: (choice: CircuitChoice) => number,
): CircuitChoice | null {
  let winner: CircuitChoice | null = null;
  for (const choice of choices) {
    if (!winner || value(choice) > value(winner)) winner = choice;
  }
  return winner;
}

interface CircuitRead {
  choices: SuggestionChoice[];
  value: number;
  effort: number;
  why: string;
}

const CATEGORIES: Record<string, "normal" | "hard"> = {
  circuitNormal: "normal",
  circuitSteelPath: "hard",
};

function normalWhy(pick: CircuitChoice | null, state: ChoiceState, t: Translator): string {
  if (!pick || state === "done") return t("nextUp.whyCircuitAllOwned");
  const frame = display(pick);
  return state === "subsume"
    ? t("nextUp.whyCircuitSubsume", { frame })
    : t("nextUp.whyCircuitFrame", { frame });
}

function readNormal(resolved: CircuitChoice[], mastered: Mastered, t: Translator): CircuitRead {
  const value = (choice: CircuitChoice): number => frameStateValue(choice, mastered(choice));
  const pick = best(resolved, value);
  return {
    choices: resolved.map((choice) => ({
      name: display(choice),
      imageUrl: choice.imageUrl,
      kind: "frame",
      state: frameState(choice, mastered(choice)),
      statuses: frameStatuses(choice, mastered(choice)),
      effort: effortWord(choice.name),
      sources: sources(choice.name),
    })),
    value: Math.max(pick ? value(pick) : 0, NOTHING_LEFT),
    effort: NORMAL_EFFORT,
    why: normalWhy(pick, pick ? frameState(pick, mastered(pick)) : "done", t),
  };
}

/** An adapter is owned or it is not; there is no Helminth step behind it. */
function adapterState(choice: CircuitChoice): ChoiceState {
  return choice.inInventory ? "done" : "wanted";
}

function steelPathWhy(pick: CircuitChoice | null, count: number, t: Translator): string {
  if (!pick) return t("nextUp.whyIncarnonAllOwned");
  const weapon = display(pick);
  const letter = tier(pick.name);
  if (!letter) return t("nextUp.whyIncarnon", { weapon, count: String(count) });
  return t("nextUp.whyIncarnonGraded", { weapon, grade: letter, count: String(count) });
}

function readSteelPath(resolved: CircuitChoice[], t: Translator): CircuitRead {
  const wanted = resolved.filter((choice) => !choice.inInventory);
  const pick = best(wanted, (choice) => adapterValue(choice.name));
  return {
    choices: resolved.map((choice) => ({
      name: display(choice),
      imageUrl: choice.imageUrl,
      kind: "adapter",
      state: adapterState(choice),
      statuses: [{ win: "adapter", done: choice.inInventory }],
      tier: tier(choice.name),
      upgradePath: upgradePath(choice.name),
    })),
    value: Math.max(pick ? adapterValue(pick.name) : 0, NOTHING_LEFT),
    effort: STEEL_PATH_EFFORT,
    why: steelPathWhy(pick, wanted.length, t),
  };
}

/** Null for any task that is not a Circuit, and for a week the game has not named. */
export function readCircuit(ctx: SuggestionContext, taskId: string): CircuitRead | null {
  const category = CATEGORIES[taskId];
  if (!category) return null;
  const resolved = resolveCircuitChoices(
    circuitChoices(ctx.world, category),
    ctx.itemDb,
    ctx.inventory,
  );
  // Before the item DB loads nothing resolves, which would read as a whole week
  // of picks the player is missing.
  if (!resolved.some((choice) => choice.uniqueName)) return null;
  if (category === "hard") return readSteelPath(resolved, ctx.t);
  const isMastered = createMasteryLookup(ctx.mastery);
  return readNormal(resolved, (choice) => isMastered(choice.uniqueName, choice.name), ctx.t);
}
